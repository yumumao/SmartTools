// GET /api/data          → 返回 data.js 文本
// GET /api/data?format=json → 返回 JSON { ok, content, source }
// 根据 KV 中的 data_source 设置决定数据源

import { jsonResponse } from '../_shared/auth.js';

const DATA_KEY = 'data_js';
const SOURCE_KEY = 'data_source';  // 'kv' 或 'static'

export async function onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const format = url.searchParams.get('format') || 'js';
    const forceSource = url.searchParams.get('source');  // config 页面预览用

    // 读取切换开关
    let source = 'static';
    if (env.FAV_KV) {
        const saved = await env.FAV_KV.get(SOURCE_KEY);
        if (saved === 'kv' || saved === 'static') source = saved;
    }
    if (forceSource === 'kv' || forceSource === 'static') source = forceSource;

    let content = null;
    let actualSource = source;

    if (source === 'kv' && env.FAV_KV) {
        content = await env.FAV_KV.get(DATA_KEY);
        if (!content) {
            // KV 为空时自动回退到静态文件
            actualSource = 'static-fallback';
        }
    }

    // 读取仓库静态 data.js
    if (!content) {
        try {
            const fallbackUrl = new URL('/data.js', request.url);
            const r = await fetch(fallbackUrl.toString(), { cf: { cacheTtl: 0 } });
            if (r.ok) content = await r.text();
        } catch {}
    }

    if (!content) {
        content = `/* data.js 尚未初始化 */
var usbDriveData = [];
var teachingData = [];
var onlineAIData = [];
var videoData = [];
var emailData = [];
var contactData = [];
`;
        actualSource = 'empty';
    }

    if (format === 'json') {
        return jsonResponse({ ok: true, content, source: actualSource, configured: source });
    }
    return new Response(content, {
        headers: {
            'Content-Type': 'application/javascript;charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Data-Source': actualSource
        }
    });
}