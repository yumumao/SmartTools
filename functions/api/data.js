// GET /api/data                → 返回 data.js 文本（按身份选 namespace）
// GET /api/data?format=json    → 返回 JSON { ok, content, source, ... }
// GET /api/data?source=kv|static → 强制使用指定数据源（仅对当前身份的 namespace 有效）
// GET /api/data?u=<slug>       → A1.5 公开访问模式（忽略 cookie，返回该 slug 用户的 user:<uid>:data_js）
//
// A0 v2 改造（2026-05-17）：
//   - 按身份选 KV namespace:
//     * 未登录 / admin → admin:data_js（缺失回退老 data_js 过渡期）
//     * user            → user:<uid>:data_js（缺失返回空白 stub，绝不回退 admin，严格 D2=B）
//   - 缓存按身份分:
//     * 未登录          → public, max-age=30, s-maxage=60（保 P3-7 行为；5 个 indexN 受益）
//     * 已登录          → private, no-store（避免 CDN 把 admin 内容缓存给 alice）
//   - data_source 也按身份选 namespace（admin:data_source / user:<uid>:data_source）
//   - format=json 路径走 no-store（同 P3-7）
//
// A1.5 改造（2026-05-18）：?u=<slug> 公开访问
//   - 优先于 cookie 鉴权;slug 命中且 publicEnabled=true → 走 user:<uid>:* namespace（忽略 cookie）
//   - slug 不存在 / publicEnabled=false / 格式不合法 → 静默回退到默认逻辑（D9=b，不暴露失败原因）
//   - IP 限速 lockout:ipublic:<ip>（10 次/30 分钟 → 锁 60 分钟）防 slug 枚举
//   - 响应头 X-Public-Slug 标识当前模式（前端用它判断公开访问态）

import { jsonResponse, getPayload } from '../_shared/auth.js';
import { isValidSlug, getUserBySlug } from '../_shared/slug.js';

const OLD_DATA_KEY    = 'data_js';
const OLD_SOURCE_KEY  = 'data_source';
const ADMIN_DATA_KEY  = 'admin:data_js';
const ADMIN_SOURCE_KEY = 'admin:data_source';

// A1.5 — 公开 slug IP 限速参数
const SLUG_LOCKOUT_PREFIX = 'lockout:ipublic:';
const SLUG_MAX_ATTEMPTS   = 10;    // 失败上限
const SLUG_WINDOW_SECONDS = 1800;  // 失败计数窗口 30 分钟
const SLUG_LOCK_SECONDS   = 3600;  // 达上限后锁定 60 分钟

// 空白 stub（user 首次访问 / KV 完全为空的兜底）
const EMPTY_STUB = `/* data.js 尚未初始化 */
var usbDriveData = [];
var teachingData = [];
var onlineAIData = [];
var videoData = [];
var emailData = [];
var contactData = [];
var customSections = [];
`;

function userDataKey(uid)   { return 'user:' + uid + ':data_js'; }
function userSourceKey(uid) { return 'user:' + uid + ':data_source'; }

function getClientIP(request) {
    const cf = request.headers.get('CF-Connecting-IP');
    if (cf) return cf.trim();
    const xff = request.headers.get('X-Forwarded-For');
    if (xff) {
        const first = xff.split(',')[0];
        if (first) return first.trim();
    }
    return 'unknown';
}

async function readSlugLockout(env, ip) {
    if (!env.FAV_KV) return null;
    try {
        const r = await env.FAV_KV.getWithMetadata(SLUG_LOCKOUT_PREFIX + ip, { type: 'text' });
        if (!r || r.value == null) return null;
        const count = parseInt(r.value, 10) || 0;
        const expireAt = (r.metadata && r.metadata.expireAt) || 0;
        return { count, expireAt };
    } catch {
        return null;
    }
}

async function recordSlugFailure(env, ip) {
    if (!env.FAV_KV) return;
    try {
        const cur = await readSlugLockout(env, ip);
        const nowSec = Math.floor(Date.now() / 1000);
        const next = (cur ? cur.count : 0) + 1;
        // 达阈值后切换到长锁定窗口(60 分钟),否则用 30 分钟滑动窗口
        const ttl = next >= SLUG_MAX_ATTEMPTS ? SLUG_LOCK_SECONDS : SLUG_WINDOW_SECONDS;
        const expireAt = nowSec + ttl;
        await env.FAV_KV.put(SLUG_LOCKOUT_PREFIX + ip, String(next), {
            expirationTtl: ttl,
            metadata: { expireAt }
        });
    } catch {}
}

async function clearSlugFailure(env, ip) {
    if (!env.FAV_KV) return;
    try { await env.FAV_KV.delete(SLUG_LOCKOUT_PREFIX + ip); } catch {}
}

export async function onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const format = url.searchParams.get('format') || 'js';
    const forceSource = url.searchParams.get('source');
    const slugParam = url.searchParams.get('u');

    // ───── A1.5 公开访问 slug 解析(优先于 cookie)─────
    let publicSlug = null;   // 命中的 slug
    let publicUid  = null;   // 命中的 uid
    let publicRole = null;   // 命中用户的角色(admin/user)— 决定 namespace
    let slugIp     = null;

    if (slugParam) {
        slugIp = getClientIP(request);
        // 先尝试解析 slug,命中即放行(真实用户优先于限速 — 避免恶意扫描影响合法访问)
        if (isValidSlug(slugParam)) {
            const found = await getUserBySlug(env, slugParam);
            if (found) {
                publicSlug = slugParam;
                publicUid  = found.uid;
                publicRole = found.role || 'user';
                await clearSlugFailure(env, slugIp);
            }
        }
        // slug 未命中(无效格式 / 不存在 / 已禁用)→ 检查 lockout + 累加失败计数
        if (!publicSlug) {
            const lock = await readSlugLockout(env, slugIp);
            const nowSec = Math.floor(Date.now() / 1000);
            // 已锁定 → 不静默回退,直接 429(此时确认是恶意扫描)
            if (lock && lock.count >= SLUG_MAX_ATTEMPTS && lock.expireAt > nowSec) {
                return jsonResponse(
                    { ok: false, error: '请求过于频繁,请稍后再试' },
                    429,
                    { 'Retry-After': String(lock.expireAt - nowSec) }
                );
            }
            await recordSlugFailure(env, slugIp);
            // 静默回退到默认逻辑(D9=b),不暴露失败原因
        }
    }

    // ───── 决定 namespace ─────
    let ns, uid, isLoggedIn, role;
    let isPublicSlugMode = false;

    if (publicSlug) {
        // 公开 slug 模式 — 忽略 cookie,按目标用户的 role 分流 namespace
        // admin 的 slug → 走 admin namespace(读 admin:data_js,与 admin 登录后看到的一致)
        // user  的 slug → 走 user namespace(读 user:<uid>:data_js)
        uid = publicUid;
        isLoggedIn = false;
        role = publicRole;
        ns = (publicRole === 'admin') ? 'admin' : 'user';
        isPublicSlugMode = true;
    } else {
        // 原 cookie 路径(slug 失败时静默回退至此)
        const payload = await getPayload(request, env);
        isLoggedIn = !!payload;
        role = isLoggedIn ? (payload.role || 'user') : null;
        uid  = isLoggedIn ? (payload.uid != null ? payload.uid : payload.u) : null;
        ns = (role === 'user') ? 'user' : 'admin';
    }

    // ───── 选 source / data key ─────
    let dataKey, sourceKey, fallbackOldDataKey = null;
    if (ns === 'admin') {
        dataKey   = ADMIN_DATA_KEY;
        sourceKey = ADMIN_SOURCE_KEY;
        fallbackOldDataKey = OLD_DATA_KEY;
    } else {
        dataKey   = userDataKey(uid);
        sourceKey = userSourceKey(uid);
    }

    // 并行读 source + data
    let source = 'static';
    let kvContent = null;
    if (env.FAV_KV) {
        const [saved, dataResult] = await Promise.all([
            env.FAV_KV.get(sourceKey),
            env.FAV_KV.get(dataKey)
        ]);
        if (saved === 'kv' || saved === 'static') source = saved;
        kvContent = dataResult || null;

        // admin 命名空间下的迁移期回退:admin:* 没有时,读老 key
        if (ns === 'admin') {
            if (kvContent == null && fallbackOldDataKey) {
                const legacy = await env.FAV_KV.get(fallbackOldDataKey);
                if (legacy != null) kvContent = legacy;
            }
            if (source !== 'kv' && source !== 'static') {
                const legacySrc = await env.FAV_KV.get(OLD_SOURCE_KEY);
                if (legacySrc === 'kv' || legacySrc === 'static') source = legacySrc;
            }
        }
    }
    if (forceSource === 'kv' || forceSource === 'static') source = forceSource;

    let content = null;
    let actualSource = source;

    if (source === 'kv' && env.FAV_KV) {
        content = kvContent;
        if (!content) {
            actualSource = 'static-fallback';
        }
    }

    // 读取仓库静态 data.js(KV 为空 或 source=static 时)
    // 注意:user namespace 不走这条路径——user 没有 KV 数据就直接看空白 stub
    if (!content && ns === 'admin') {
        const fallbackUrl = new URL('/data.js', request.url);
        try {
            if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
                const r = await env.ASSETS.fetch(fallbackUrl.toString());
                if (r.ok) content = await r.text();
            }
        } catch {}
        if (!content) {
            try {
                const r = await fetch(fallbackUrl.toString(), { cf: { cacheTtl: 0 } });
                if (r.ok) content = await r.text();
            } catch {}
        }
    }

    // 兜底
    if (!content) {
        content = EMPTY_STUB;
        actualSource = (ns === 'user') ? 'user-empty' : 'empty';
    }

    // A1.5 增强 A:在响应内容首行前置 window.__publicSlugInfo
    // 前端 indexN.html 据此撤销/保留 data-public-mode(slug 失败时显示正常 admin UI)
    let publicSlugInfoLine = '';
    if (slugParam) {
        // 只在请求带 ?u= 时才注入,正常加载不打扰
        const info = isPublicSlugMode
            ? { hit: true, slug: publicSlug, uid: publicUid }
            : { hit: false };
        publicSlugInfoLine = 'window.__publicSlugInfo = ' + JSON.stringify(info) + ';\n';
    }

    if (format === 'json') {
        return jsonResponse({
            ok: true,
            content,
            source: actualSource,
            configured: source,
            namespace: ns,
            uid: uid,
            publicSlug: isPublicSlugMode ? publicSlug : null,
            publicSlugHit: isPublicSlugMode
        });
    }

    // 前置 __publicSlugInfo(仅 JS 路径)
    const finalContent = publicSlugInfoLine + content;

    // 缓存策略:
    //   登录态(非 slug 模式) → 严格 no-store
    //   slug 公开模式         → public, max-age=30(可缓存,跨 cookie 共享)
    //   未登录默认            → 沿用 P3-7 的 public, max-age=30
    const cacheHeader = (isLoggedIn && !isPublicSlugMode)
        ? 'private, no-store'
        : 'public, max-age=30, s-maxage=60, stale-while-revalidate=300';

    const headers = {
        'Content-Type': 'application/javascript;charset=utf-8',
        'Cache-Control': cacheHeader,
        'X-Data-Source': actualSource,
        'X-Data-Namespace': ns
    };
    if (isPublicSlugMode) {
        headers['X-Public-Slug'] = publicSlug;
    }

    return new Response(finalContent, { headers });
}
