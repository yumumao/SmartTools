// 2026-05-22:/@<slug> 短链接路由(替代 /u/<slug>)
//
// 路由:functions/@[[slug]].js → 拦截 /@<任意子路径>
// 与 functions/u/[[slug]].js 共存(永久向后兼容旧链接)
//
// ⚠️ 部署风险点:Cloudflare Pages 官方文档未明示 @ 开头的 Functions 文件路由是否支持。
// 大部分情况下能正常工作(@ 是合法文件名字符),但若 build pipeline 不识别,
// 备选方案是在 `_redirects` 加 `/@:slug /u/:slug 200` 做 200 内部 rewrite。
//
// 行为(与 /u/[[slug]].js 一致):
//   1. 提取 slug 并转小写(大小写不敏感)
//   2. 根据 ?theme=<key> query 选 indexN.html(默认 index2.html / notion)
//   3. 用 env.ASSETS.fetch 读取该 indexN.html 直接返回(URL 保持 /@<slug>,不 302)
//   4. 注入 <base href="/"> 让相对路径锚定根域,解决相对资源加载问题

const THEME_TO_INDEX = {
    nebula: 'index1.html',
    notion: 'index2.html',
    stripe: 'index3.html',
    dark:   'index4.html',
    mint:   'index5.html'
};

export async function onRequest({ request, env, params }) {
    let slugRaw = params && params.slug;
    if (Array.isArray(slugRaw)) slugRaw = slugRaw[0];
    if (typeof slugRaw !== 'string' || !slugRaw) {
        return new Response('Not Found', { status: 404 });
    }
    // 大小写不敏感:统一转小写(@Z = @z)
    const slug = slugRaw.toLowerCase();
    // 简单格式检查(防止恶意 path)— 符合 slug 字符集
    // 注意:这里不拒绝纯数字,因为 /@123 也可能是合法历史 slug;真实存在性校验在 /api/data 里
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

    // URL 是 /@<slug>,indexN.html 内的相对路径(shared/* 等)会被解析成 /shared/* — 不对。
    // 注入 <base href="/"> 把相对路径锚定到根域。
    let html = await resp.text();
    html = html.replace(/<head(\s[^>]*)?>/i, function (match) {
        return match + '\n    <base href="/">';
    });

    const headers = new Headers();
    headers.set('Content-Type', 'text/html;charset=utf-8');
    headers.set('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
    headers.set('X-Public-Slug-Path', slug);
    headers.set('X-Slug-Route', '@');  // 调试:标识走了 @ 路由
    return new Response(html, {
        status: 200,
        headers
    });
}
