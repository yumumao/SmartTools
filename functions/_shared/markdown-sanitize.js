// functions/_shared/markdown-sanitize.js
// 2026-05-23 创建。共用 Markdown 文本安全过滤工具,服务端使用。
//
// 用途:
//   - P2P 推送(未来 §11):接收到 message 字段后,后端二次 sanitize 再落库
//   - 任何接受用户 Markdown 输入的端点(/api/inbox/send 等)
//   - 不信任前端,即使前端已做过 sanitize 也再做一次(零信任)
//
// 设计原则(详见 .claude/改进计划.md §5.2):
//   - 长度上限可配,默认 5000 字符(推送 message 调用方应传 500)
//   - 链接 URL 白名单:http / https / mailto(其它如 javascript:/data:/file:/tel: 一律拒)
//   - 图片 src 白名单:仅 https(避免 mixed content + http 图床滥用 + data:image base64 内联)
//   - HTML 黑名单:删除 <script> <iframe> <style> <link> <meta> 标签整段,以及任何 on*= 事件属性
//   - 不渲染、不转换为 HTML — 只对原始 Markdown 文本做规约,渲染层另说
//
// 注意:
//   - 本工具不替代前端 note-modal.js 的 renderMarkdown(那里专门做 esc + 渲染)
//   - 输出仍是 Markdown 文本(过滤后的),给前端继续走渲染管线
//   - 若调用方拒绝整条消息(超长 / 黑名单触发),抛出 SanitizeError,由路由层转 4xx

export class SanitizeError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'SanitizeError';
        this.code = code || 'SANITIZE_REJECTED';
    }
}

// 协议白名单(Markdown 链接 [text](url) 的 url 部分)
const LINK_PROTOCOL_RE = /^(?:https?:|mailto:)/i;
// 图片严格 https-only(§5.2 规范)
const IMAGE_PROTOCOL_RE = /^https:/i;

// 危险 HTML 标签(整段连同内容一起删除)
const DANGER_TAG_RE = /<\s*(script|iframe|style|link|meta|object|embed|base|form)\b[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi;
// 自闭合 / 单独出现的危险标签(<meta>、<link> 等 void elements)
const DANGER_VOID_RE = /<\s*(meta|link|base|input|source|track)\b[^>]*\/?>/gi;
// 事件属性(on* / formaction)— 即使留下了无害标签,也要剔除事件
const EVENT_ATTR_RE = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const FORMACTION_RE = /\s+formaction\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
// javascript: / data: / vbscript: 协议(出现在 href / src 等任何属性值里都拒)
const DANGER_PROTOCOL_ATTR_RE = /(href|src|xlink:href|action|formaction|background|poster)\s*=\s*["']?\s*(?:javascript|data|vbscript|file)\s*:/gi;

// Markdown 链接 / 图片正则
const MD_LINK_RE  = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * sanitizeMarkdown(text, opts)
 *
 * @param {string} text — 用户输入的 Markdown 文本
 * @param {object} [opts]
 * @param {number} [opts.maxLength=5000] — 长度上限(字符数,超出抛 SanitizeError)
 * @param {boolean} [opts.allowDataImage=false] — 是否允许 data:image/* 图片(默认拒,§5.2 严格 https-only)
 * @param {boolean} [opts.allowHttpImage=false] — 是否允许 http: 图片(默认拒)
 * @returns {string} — 过滤后的 Markdown 文本
 * @throws {SanitizeError} — 长度超限 / 输入类型不对
 */
export function sanitizeMarkdown(text, opts) {
    opts = opts || {};
    const maxLength = typeof opts.maxLength === 'number' ? opts.maxLength : 5000;
    const allowDataImage = !!opts.allowDataImage;
    const allowHttpImage = !!opts.allowHttpImage;

    if (typeof text !== 'string') {
        throw new SanitizeError('输入必须是字符串', 'INVALID_INPUT');
    }
    if (text.length > maxLength) {
        throw new SanitizeError('内容超过 ' + maxLength + ' 字符', 'TOO_LONG');
    }

    let out = text;

    // 1. 剔除危险 HTML 标签(整段)
    out = out.replace(DANGER_TAG_RE, '');
    out = out.replace(DANGER_VOID_RE, '');

    // 2. 剔除任何残留标签的事件属性 / 危险协议属性
    out = out.replace(EVENT_ATTR_RE, '');
    out = out.replace(FORMACTION_RE, '');
    out = out.replace(DANGER_PROTOCOL_ATTR_RE, function (_, attr) {
        // 把 href="javascript:..." 等替换为 href="#" 而不是删属性,避免标签结构破裂
        return attr + '="#"';
    });

    // 3. Markdown 图片 src 白名单(图片在前,避免 ![]()  被链接正则吃掉)
    out = out.replace(MD_IMAGE_RE, function (full, alt, src) {
        const u = String(src || '').trim();
        if (IMAGE_PROTOCOL_RE.test(u)) return full;
        if (allowDataImage && /^data:image\/[a-zA-Z+.-]+;/i.test(u)) return full;
        if (allowHttpImage && /^http:/i.test(u)) return full;
        // 拒绝 → 退化为纯文本(保留 alt 文字,丢图)
        return alt || '';
    });

    // 4. Markdown 链接 URL 白名单
    out = out.replace(MD_LINK_RE, function (full, text, url) {
        const u = String(url || '').trim();
        if (LINK_PROTOCOL_RE.test(u)) return full;
        // 拒绝 → 退化为纯文本(保留 link text,丢 url)
        return text || '';
    });

    return out;
}

// 便捷:返回 { ok, text, error } 包装版,路由层好用
export function trySanitizeMarkdown(text, opts) {
    try {
        return { ok: true, text: sanitizeMarkdown(text, opts) };
    } catch (e) {
        return {
            ok: false,
            error: (e && e.message) || 'sanitize failed',
            code: (e && e.code) || 'SANITIZE_REJECTED'
        };
    }
}
