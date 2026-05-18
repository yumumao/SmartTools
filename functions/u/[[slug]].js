// A1.5 增强 C:/u/<slug> 短链接路径(2026-05-19)
//
// 路由:functions/u/[[slug]].js → 拦截 /u/<任意子路径>(不拦截光的 /u)
//
// 行为:
//   1. 提取 slug 并转小写(大小写不敏感)
//   2. 根据 ?theme=<key> query 选 indexN.html(默认 index2.html / notion)
//   3. 用 env.ASSETS.fetch 读取该 indexN.html 的内容直接返回
//   4. URL 保持 /u/<slug>(不 302 跳转,服务端 rewrite)
//
// slug 是否真实存在 — 不在这里校验:
//   - 真实校验在 /api/data?u=<slug> 时由 getUserBySlug 完成
//   - catch-all 只负责"路由分发",失败由前端 __publicSlugInfo.hit 处理(D9=b 静默回退)
//
// 主题切换:
//   - /u/alice-cute 默认 index2.html(notion)
//   - /u/alice-cute?theme=stripe → index3.html
//   - 进入 indexN 后,风格切换链接是 indexN.html?u=<slug> 形式(切换后变 query 形式,URL 变长 — 已知折中)

const THEME_TO_INDEX = {
    nebula: 'index1.html',
    notion: 'index2.html',
    stripe: 'index3.html',
    dark:   'index4.html',
    mint:   'index5.html'
};

export async function onRequest({ request, env, params }) {
    // params.slug 可能是字符串(/u/foo)或数组(/u/foo/bar — 但当前用单段 [[slug]])
    let slugRaw = params && params.slug;
    if (Array.isArray(slugRaw)) slugRaw = slugRaw[0];
    if (typeof slugRaw !== 'string' || !slugRaw) {
        return new Response('Not Found', { status: 404 });
    }
    // 大小写不敏感:统一转小写
    const slug = slugRaw.toLowerCase();
    // 简单格式检查(防止恶意 path)— 符合 slug 字符集
    if (!/^[a-z0-9][a-z0-9_\-]{0,31}$/.test(slug)) {
        return new Response('Not Found', { status: 404 });
    }

    // 主题选择(可选 query)
    const url = new URL(request.url);
    const themeKey = (url.searchParams.get('theme') || '').toLowerCase();
    const indexFile = THEME_TO_INDEX[themeKey] || 'index2.html';

    // 读取 indexN.html 静态文件
    const indexUrl = new URL('/' + indexFile, url.origin);
    let resp;
    try {
        if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
            resp = await env.ASSETS.fetch(indexUrl.toString());
        } else {
            resp = await fetch(indexUrl.toString(), { cf: { cacheTtl: 0 } });
        }
    } catch (e) {
        return new Response('Index file fetch failed: ' + (e && e.message), { status: 500 });
    }
    if (!resp || !resp.ok) {
        return new Response('Not Found', { status: 404 });
    }

    // 关键:URL 是 /u/<slug>,而 indexN.html 内的相对路径(shared/*.css/js,toolsindex.html,
    // indexN.html 等)默认会相对于 /u/<slug> 解析,变成 /u/shared/...(404)。
    // 在 <head> 开标签后立即注入 <base href="/">,把所有相对路径锚定到根域,所有资源正常加载。
    let html = await resp.text();
    html = html.replace(/<head(\s[^>]*)?>/i, function (match) {
        return match + '\n    <base href="/">';
    });

    // 缓存策略:跟未登录访问 indexN.html 一致(public, max-age 短)
    const headers = new Headers();
    headers.set('Content-Type', 'text/html;charset=utf-8');
    headers.set('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
    // 给前端一个 hint(供调试)
    headers.set('X-Public-Slug-Path', slug);
    return new Response(html, {
        status: 200,
        headers
    });
}
