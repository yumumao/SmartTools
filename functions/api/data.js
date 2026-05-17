// GET /api/data                → 返回 data.js 文本（按身份选 namespace）
// GET /api/data?format=json    → 返回 JSON { ok, content, source, ... }
// GET /api/data?source=kv|static → 强制使用指定数据源（仅对当前身份的 namespace 有效）
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

import { jsonResponse, getPayload } from '../_shared/auth.js';

const OLD_DATA_KEY    = 'data_js';
const OLD_SOURCE_KEY  = 'data_source';
const ADMIN_DATA_KEY  = 'admin:data_js';
const ADMIN_SOURCE_KEY = 'admin:data_source';

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

export async function onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const format = url.searchParams.get('format') || 'js';
    const forceSource = url.searchParams.get('source');

    // 鉴权（不强制，未登录也能访问）
    const payload = await getPayload(request, env);
    const isLoggedIn = !!payload;
    const role = isLoggedIn ? (payload.role || 'user') : null;
    const uid  = isLoggedIn ? (payload.uid != null ? payload.uid : payload.u) : null;

    // 决定本次走哪个 namespace
    //   未登录 → 'admin'(公共看 admin 数据)
    //   admin  → 'admin'
    //   user   → 'user'
    const ns = (role === 'user') ? 'user' : 'admin';

    // 选 source / data key
    let dataKey, sourceKey, fallbackOldDataKey = null;
    if (ns === 'admin') {
        dataKey   = ADMIN_DATA_KEY;
        sourceKey = ADMIN_SOURCE_KEY;
        // 迁移期回退：admin namespace 缺失时尝试老 key
        fallbackOldDataKey = OLD_DATA_KEY;
    } else {
        dataKey   = userDataKey(uid);
        sourceKey = userSourceKey(uid);
        // user 不回退 admin（严格 D2=B）
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

        // admin 命名空间下的迁移期回退：admin:* 没有时，读老 key
        if (ns === 'admin') {
            if (kvContent == null && fallbackOldDataKey) {
                const legacy = await env.FAV_KV.get(fallbackOldDataKey);
                if (legacy != null) kvContent = legacy;
            }
            if (source !== 'kv' && source !== 'static') {
                // 老 data_source 也尝试一下
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

    // 读取仓库静态 data.js（KV 为空 或 source=static 时）
    // 注意：user namespace 不走这条路径——user 没有 KV 数据就直接看空白 stub
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

    if (format === 'json') {
        return jsonResponse({
            ok: true,
            content,
            source: actualSource,
            configured: source,
            namespace: ns,
            uid: uid
        });
    }

    // 缓存策略：登录态严格 no-store；未登录沿用 P3-7
    const cacheHeader = isLoggedIn
        ? 'private, no-store'
        : 'public, max-age=30, s-maxage=60, stale-while-revalidate=300';

    return new Response(content, {
        headers: {
            'Content-Type': 'application/javascript;charset=utf-8',
            'Cache-Control': cacheHeader,
            'X-Data-Source': actualSource,
            'X-Data-Namespace': ns
        }
    });
}
