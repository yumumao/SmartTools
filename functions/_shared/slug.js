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
//
// ★ 设计意图(2026-05-22):字符集严格限定 ASCII [a-z0-9_-],拒绝任何 Unicode 字符。
// 这是同形字攻击(homograph)的天然防御 —— 西里尔 а(U+0430)、希腊 α(U+03B1) 等
// 视觉上与 ASCII a 几乎一致,但 codepoint 不同,会被正则直接拒绝。
// 大小写策略:服务端统一 toLowerCase,@Z 与 @z 等价(URL 不做 301 跳转,内部 lowercase)。
// 未来若有人想放宽字符集(国际化用户名),必须同步加 Unicode 规范化 + 同形字检测,
// 否则 @admin vs @аdmin 假冒账号风险立刻成立。
const ADMIN_SLUG_RE = /^[a-z0-9][a-z0-9_\-]{0,31}$/;
const USER_SLUG_RE  = /^[a-z0-9][a-z0-9_\-]{2,31}$/;
// 纯数字 slug 禁用(防扫描爆破 + 给未来"用户 ID 路径"留余地)
const ALL_DIGITS_RE = /^[0-9]+$/;

// 保留词:避免 slug 撞 Pages 静态路由、域名前缀、系统路径或品牌词。
// 注意 slug 必须以 [a-z0-9] 开头,所以以 _ 起的(_shared 等)天然过滤,不必列入。
// 2026-05-22 扩充:子域名常用前缀 / 系统路径 / 内容站常用 / JS 关键字 / HTTP 状态码 / 自指概念词。
const RESERVED_SLUGS = new Set([
    // 项目内已有路径
    'tools', 'toolsindex',
    'databak', 'shared', 'scripts',
    'config', 'admin', 'login', 'logout',
    'about', 'index', 'data',
    'index1', 'index2', 'index3', 'index4', 'index5',
    'home', 'help', 'static', 'public', 'assets',
    'api', 'auth', 'user', 'users', 'archive', 'archives',
    'save', 'comment', 'backup', 'backups',
    'check', 'change', 'migrate',
    'favicon', 'robots', 'sitemap',
    // 子域名常用前缀
    'www', 'mail', 'ftp', 'ns', 'ns1', 'ns2',
    'cdn', 'img', 'images', 'media', 'files', 'download', 'downloads',
    // 系统/账户路径
    'settings', 'setting', 'preferences', 'profile', 'me',
    'signup', 'signin', 'register', 'reset', 'forgot',
    'password', 'passwd', 'security', 'verify',
    // 内容站常用
    'search', 'tag', 'tags', 'category', 'categories',
    'feed', 'rss', 'atom',
    'blog', 'post', 'posts', 'news',
    'contact', 'support', 'feedback', 'terms', 'privacy', 'legal',
    'docs', 'doc', 'documentation', 'wiki', 'manual',
    'status', 'health', 'ping', 'test',
    'app', 'apps', 'web', 'm', 'mobile',
    'cgi', 'bin',
    // JS 关键字 / HTTP 状态(防误用)
    'null', 'undefined', 'true', 'false',
    'errors', 'error', '404', '500',
    // 自指/概念词
    'u',   // 防止 /@u 与 /u/<slug> 路径概念混淆
    'at',  // 防止 /@at 与 @ 符号概念混淆
    // 品牌词
    'smarttools', 'mrr'
]);

// 校验 slug 格式。role='user' 严格(≥3),其它(admin/未传)宽松(≥1)。
// 纯数字 slug 一律拒绝(无论角色)。
export function isValidSlug(s, role) {
    if (typeof s !== 'string') return false;
    if (ALL_DIGITS_RE.test(s)) return false;
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

// ─────────────────────────────────────────────────────────────
// A1.5 增强 D(2026-05-23):slug 改名后,老 slug → 新 slug 的 30 天重定向。
// KV:slug-old:<oldSlug> → <newSlug>(value 是新 slug 字符串,30 天 TTL)
// 用途:用户改了公开链接后,旧分享出去的 /@old 仍能找到内容,前端显示 banner 告知改名。
// 写入路径:public-slug POST,oldSlug && oldSlug !== newSlug && enabled 时触发。
// 查询路径:data.js 在常规 slug 查找失败后,尝试一次 slug-old:<x> 兜底。
// ─────────────────────────────────────────────────────────────
const OLD_SLUG_TTL_SECONDS = 30 * 24 * 3600; // 30 天

export async function writeOldSlugRedirect(env, oldSlug, newSlug) {
    if (!env || !env.FAV_KV) return;
    if (!oldSlug || !newSlug) return;
    if (oldSlug === newSlug) return;
    // 用 admin 规则校验(宽松)— 老 slug 可能是任意历史长度
    if (!isValidSlug(oldSlug)) return;
    if (!isValidSlug(newSlug)) return;
    try {
        await env.FAV_KV.put('slug-old:' + oldSlug, newSlug, {
            expirationTtl: OLD_SLUG_TTL_SECONDS
        });
    } catch {}
}

// 查询老 slug → 新 slug。返回新 slug 字符串,不存在或非法返回 null。
export async function lookupOldSlugRedirect(env, oldSlug) {
    if (!isValidSlug(oldSlug)) return null;
    if (!env || !env.FAV_KV) return null;
    try {
        const v = await env.FAV_KV.get('slug-old:' + oldSlug);
        return v || null;
    } catch {
        return null;
    }
}

// 删除老 slug 重定向(用于:① 新 slug 改回老 slug ② 用户被强删时清理)
export async function deleteOldSlugRedirect(env, oldSlug) {
    if (!oldSlug || typeof oldSlug !== 'string') return;
    if (!env || !env.FAV_KV) return;
    try {
        await env.FAV_KV.delete('slug-old:' + oldSlug);
    } catch {}
}
