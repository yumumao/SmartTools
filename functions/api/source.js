// GET  /api/source        → 查询当前首页数据源（无需登录，方便首页或外部检查）
// POST /api/source { source: 'kv' | 'static' } → 切换数据源（必须登录）

import { requireAuth, jsonResponse } from '../_shared/auth.js';

const SOURCE_KEY = 'data_source';

// 查询：返回当前 KV 中存的 data_source 值
export async function onRequestGet({ request, env }) {
    if (!env.FAV_KV) {
        return jsonResponse({
            ok: true,
            source: 'static',
            configured: false,
            note: '未绑定 KV，默认使用 static'
        });
    }

    const saved = await env.FAV_KV.get(SOURCE_KEY);
    // 兼容默认值：未设置时按 data.js 逻辑（默认 static）保持一致
    const valid = (saved === 'kv' || saved === 'static');
    return jsonResponse({
        ok: true,
        source: valid ? saved : 'static',
        configured: valid   // true 表示 KV 中显式设置过
    });
}

// 切换：写入新值
export async function onRequestPost({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;

    if (!env.FAV_KV) {
        return jsonResponse({ ok: false, error: '未绑定 KV，无法切换数据源' }, 500);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ ok: false, error: '请求格式错误（需 JSON）' }, 400);
    }

    const { source } = body || {};
    if (source !== 'kv' && source !== 'static') {
        return jsonResponse({ ok: false, error: 'source 必须是 "kv" 或 "static"' }, 400);
    }

    await env.FAV_KV.put(SOURCE_KEY, source);
    return jsonResponse({ ok: true, source });
}