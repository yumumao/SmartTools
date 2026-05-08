// GET  /api/settings  → 读取数据源等设置（公开，供 config 页面显示状态）
// POST /api/settings  → 修改设置（需登录）

import { requireAuth, jsonResponse } from '../_shared/auth.js';

const SOURCE_KEY = 'data_source';
const VALID_SOURCES = ['kv', 'static'];

export async function onRequestGet({ env }) {
    if (!env.FAV_KV) {
        return jsonResponse({ ok: true, data_source: 'static', hasKV: false });
    }
    const saved = await env.FAV_KV.get(SOURCE_KEY);
    const source = VALID_SOURCES.includes(saved) ? saved : 'static';
    const hasKVData = !!(await env.FAV_KV.get('data_js'));
    return jsonResponse({ ok: true, data_source: source, hasKV: true, hasKVData });
}

export async function onRequestPost({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

    const { data_source } = body || {};
    if (!VALID_SOURCES.includes(data_source)) {
        return jsonResponse({ ok: false, error: '无效的 data_source' }, 400);
    }
    await env.FAV_KV.put(SOURCE_KEY, data_source);
    return jsonResponse({ ok: true, data_source });
}