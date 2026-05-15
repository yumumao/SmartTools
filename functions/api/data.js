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

    // ★ 并行读取 SOURCE_KEY 和 DATA_KEY，减少串行 KV 往返
    let source = 'static';
    let kvContent = null;
    if (env.FAV_KV) {
        const [saved, dataResult] = await Promise.all([
            env.FAV_KV.get(SOURCE_KEY),
            env.FAV_KV.get(DATA_KEY)
        ]);
        if (saved === 'kv' || saved === 'static') source = saved;
        kvContent = dataResult || null;
    }
    if (forceSource === 'kv' || forceSource === 'static') source = forceSource;

    let content = null;
    let actualSource = source;

    if (source === 'kv' && env.FAV_KV) {
        content = kvContent;
        if (!content) {
            // KV 为空时自动回退到静态文件
            actualSource = 'static-fallback';
        }
    }

    // 读取仓库静态 data.js（KV 为空或 source=static 时）
    // ★ P3-4：优先用 Cloudflare Pages 的 ASSETS binding，省掉一次外部 HTTP 跳；
    //   极端情况下（本地 wrangler dev / binding 不可用）回退到原来的 fetch。
    if (!content) {
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
            // ★ P3-7: max-age=30 让浏览器在 30 秒内复用上次响应，刷新更顺。
            //   代价：刚保存后 30s 内可能仍看到旧数据，对个人收藏夹场景可接受。
            //   注意：?format=json 走 jsonResponse(no-store)，不受此影响 —
            //         那条路径是 config.html 编辑器即时拉取，必须实时。
            'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
            'X-Data-Source': actualSource
        }
    });
}