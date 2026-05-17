// GET  /api/source        → 查询当前身份的数据源（无需登录;未登录默认 admin namespace）
// POST /api/source        → 切换当前身份的数据源（必须登录）
//   body: { source: 'kv' | 'static' }
//
// A0 v2 改造（2026-05-17）：按身份选 namespace
//   未登录 / admin → admin:data_source（迁移期回退老 data_source）
//   user           → user:<uid>:data_source
// 注意:本端点不限制 user 设置 'static'(D1=Z 由 UI 层决定 user 是否暴露此选项);
// 后端忠实读写,接受 'kv' / 'static' 两值。

import { requireAuth, jsonResponse, getPayload } from '../_shared/auth.js';

const OLD_SOURCE_KEY   = 'data_source';
const ADMIN_SOURCE_KEY = 'admin:data_source';
function userSourceKey(uid) { return 'user:' + uid + ':data_source'; }

async function pickSourceKey(request, env) {
    const payload = await getPayload(request, env);
    if (!payload) {
        return { key: ADMIN_SOURCE_KEY, ns: 'admin', isLoggedIn: false };
    }
    const role = payload.role || 'user';
    const uid  = payload.uid != null ? payload.uid : payload.u;
    if (role === 'admin') {
        return { key: ADMIN_SOURCE_KEY, ns: 'admin', isLoggedIn: true };
    }
    return { key: userSourceKey(uid), ns: 'user:' + uid, isLoggedIn: true };
}

// 查询当前 namespace 的 data_source
export async function onRequestGet({ request, env }) {
    if (!env.FAV_KV) {
        return jsonResponse({
            ok: true,
            source: 'static',
            configured: false,
            namespace: 'admin',
            note: '未绑定 KV，默认使用 static'
        });
    }

    const { key, ns } = await pickSourceKey(request, env);
    let saved = await env.FAV_KV.get(key);

    // ★ 迁移期兼容（仅 admin namespace）：admin:data_source 未设置时回退老 data_source
    if (saved == null && ns === 'admin') {
        saved = await env.FAV_KV.get(OLD_SOURCE_KEY);
    }

    const valid = (saved === 'kv' || saved === 'static');
    return jsonResponse({
        ok: true,
        source: valid ? saved : 'static',
        configured: valid,
        namespace: ns
    });
}

// 切换当前 namespace 的 data_source
export async function onRequestPost({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;

    if (!env.FAV_KV) {
        return jsonResponse({ ok: false, error: '未绑定 KV，无法切换数据源' }, 500);
    }

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误（需 JSON）' }, 400); }

    const { source } = body || {};
    if (source !== 'kv' && source !== 'static') {
        return jsonResponse({ ok: false, error: 'source 必须是 "kv" 或 "static"' }, 400);
    }

    const { key, ns } = await pickSourceKey(request, env);
    await env.FAV_KV.put(key, source);
    return jsonResponse({ ok: true, source, namespace: ns });
}
