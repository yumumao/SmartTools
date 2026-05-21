// A1.5 共享工具:公开访问 slug 的格式校验 + KV 反向索引读写。
// 2026-05-19 增强 B:角色化校验(admin 1-32 / user 3-32)+ 自动生成工具。
//
// KV 数据模型:
//   users[uid].publicSlug     当前 slug 字符串(空表示未设置)
//   users[uid].publicEnabled  开关
//   slug:<slug>  → <uid>      反向索引(O(1) 反查)
//
// 写入路径:开启公开 / 修改 slug 时同步维护 users[uid] 与 slug:<>。
// 删除路径:关闭公开 / 改名 / 用户被删 → 释放老 slug:<old>。

// 角色化校验:
//   admin 设置 / 系统生成:1-32 字符,首字符字母/数字
//   user 自助设置:3-32 字符,首字符字母/数字
// 查询路径用 admin 规则(宽松)以兼容历史短 slug。
const ADMIN_SLUG_RE = /^[a-z0-9][a-z0-9_\-]{0,31}$/;
const USER_SLUG_RE  = /^[a-z0-9][a-z0-9_\-]{2,31}$/;

// 保留词:避免 slug 撞 Pages 静态路由或常见路径。
// 注意 slug 必须以 [a-z0-9] 开头,所以以 _ 起的(_shared 等)天然过滤,不必列入。
const RESERVED_SLUGS = new Set([
    'tools', 'toolsindex',
    'databak', 'shared', 'scripts',
    'config', 'admin', 'login', 'logout',
    'about', 'index', 'data',
    'index1', 'index2', 'index3', 'index4', 'index5',
    'home', 'help', 'static', 'public', 'assets',
    'api', 'auth', 'user', 'users', 'archive', 'archives',
    'save', 'comment', 'backup', 'backups',
    'check', 'change', 'migrate',
    'favicon', 'robots', 'sitemap'
]);

// 校验 slug 格式。role='user' 严格(≥3),其它(admin/未传)宽松(≥1)。
export function isValidSlug(s, role) {
    if (typeof s !== 'string') return false;
    const re = (role === 'user') ? USER_SLUG_RE : ADMIN_SLUG_RE;
    return re.test(s);
}

export function isReservedSlug(s) {
    return RESERVED_SLUGS.has((s || '').toLowerCase());
}

// 由 username 派生默认 slug 的基础串(只保留合法字符,大写转小写)。
// 输出可能长度 <4(比如 username 是 "bo" 时),需要由调用方加后缀达到合法长度。
export function genSlugFromUsername(username) {
    let base = (username || '').toLowerCase().replace(/[^a-z0-9_\-]/g, '');
    // 首字符必须是字母/数字(replace 后可能首字符是 - 或 _)
    base = base.replace(/^[^a-z0-9]+/, '');
    if (!base) base = 'user';
    return base;
}

// 随机后缀(默认 4 字符,小写字母+数字,去掉易混字符 0/o/1/l/i)。
export function randomSlugSuffix(len = 4) {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    const buf = new Uint8Array(len);
    crypto.getRandomValues(buf);
    for (let i = 0; i < len; i++) {
        s += chars[buf[i] % chars.length];
    }
    return s;
}

// 生成唯一 slug:自动处理保留词冲突 + 唯一性冲突 + 长度不足。
// role 决定校验规则严格度(默认 admin,1-32 字符)。
// 自动生成时强制最小长度 MIN_AUTO_LEN(防扫描),即使 admin 规则允许更短。
// 返回生成的 slug 字符串。极端情况下抛错。
const MIN_AUTO_LEN = 4;
export async function genUniqueSlug(env, base, role) {
    if (!env || !env.FAV_KV) throw new Error('no KV binding');
    let candidate = genSlugFromUsername(base);
    // 自动生成时:长度 < MIN_AUTO_LEN 或不符合 role 规则 → 加随机后缀达标
    if (candidate.length < MIN_AUTO_LEN || !isValidSlug(candidate, role)) {
        candidate = candidate + '-' + randomSlugSuffix();
    }
    // 保留词
    if (isReservedSlug(candidate)) {
        candidate = candidate + '-' + randomSlugSuffix();
    }
    // 唯一性(最多尝试 6 次)
    let baseClean = genSlugFromUsername(base);
    for (let i = 0; i < 6; i++) {
        const existing = await env.FAV_KV.get('slug:' + candidate);
        if (!existing) return candidate;
        candidate = baseClean + '-' + randomSlugSuffix();
    }
    // 极端兜底:纯随机
    candidate = 'user-' + randomSlugSuffix(6);
    const existing = await env.FAV_KV.get('slug:' + candidate);
    if (!existing) return candidate;
    throw new Error('cannot generate unique slug');
}

// slug → uid。返回 uid 字符串,不存在或非法 slug 返回 null。
// 用 admin 规则校验(宽松),以查询所有历史 slug(包括 1-2 字符的)。
export async function lookupSlugUid(env, slug) {
    if (!isValidSlug(slug)) return null;
    if (!env || !env.FAV_KV) return null;
    const uid = await env.FAV_KV.get('slug:' + slug);
    return uid || null;
}

// slug → {uid, user, enabled}。
// 已校验 publicEnabled 与 users 表条目存在;失败返回 null。
// 给 /api/data 用,一站式拿到全部需要的信息。
export async function getUserBySlug(env, slug) {
    const uid = await lookupSlugUid(env, slug);
    if (!uid) return null;
    try {
        const raw = await env.FAV_KV.get('users');
        if (!raw) return null;
        const users = JSON.parse(raw);
        const user = users[uid];
        if (!user) return null;
        // status=disabled 或 publicEnabled=false → 不允许公开访问
        if (user.status === 'disabled') return null;
        if (user.publicEnabled !== true) return null;
        // 双向一致性:users[uid].publicSlug 必须与当前请求的 slug 一致(防止反向索引滞后)
        if (user.publicSlug !== slug) return null;
        return { uid, user, enabled: true, role: user.role || 'user' };
    } catch {
        return null;
    }
}

// 写反向索引。调用方负责先释放老 slug。
// 用 admin 规则校验(宽松,允许 1-32),让 admin 设置的短 slug 也能写入。
export async function writeSlugIndex(env, slug, uid) {
    if (!isValidSlug(slug)) throw new Error('invalid slug');
    if (!env || !env.FAV_KV) throw new Error('no KV binding');
    await env.FAV_KV.put('slug:' + slug, uid);
}

// 释放反向索引。slug 非法或不存在时静默忽略(幂等)。
export async function deleteSlugIndex(env, slug) {
    if (!slug || typeof slug !== 'string') return;
    if (!env || !env.FAV_KV) return;
    try {
        await env.FAV_KV.delete('slug:' + slug);
    } catch {}
}
