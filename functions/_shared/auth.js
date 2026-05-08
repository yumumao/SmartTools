// 共享鉴权工具（带下划线前缀的目录，Pages 不会当路由）

const encoder = new TextEncoder();

function b64urlEncode(str) {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return atob(str);
}

async function hmacSign(data, secret) {
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
    return b64urlEncode(String.fromCharCode(...new Uint8Array(sig)));
}

/**
 * 从环境变量读取 AUTH_SECRET。
 * 未配置或过短时返回 null（调用方需据此返回 500）。
 * 这样避免了使用不安全的默认密钥。
 */
export function getSecret(env) {
    const s = env && env.AUTH_SECRET;
    if (!s || typeof s !== 'string' || s.length < 16) {
        return null;
    }
    return s;
}

export async function createToken(username, secret, days = 7) {
    if (!secret) throw new Error('AUTH_SECRET 未配置');
    const payload = { u: username, exp: Date.now() + days * 86400 * 1000 };
    const payloadStr = b64urlEncode(JSON.stringify(payload));
    const sig = await hmacSign(payloadStr, secret);
    return `${payloadStr}.${sig}`;
}

export async function verifyToken(token, secret) {
    if (!token || !secret) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadStr, sig] = parts;
    try {
        const expected = await hmacSign(payloadStr, secret);
        if (expected !== sig) return null;
        const payload = JSON.parse(b64urlDecode(payloadStr));
        if (payload.exp && payload.exp < Date.now()) return null;
        return payload;
    } catch {
        return null;
    }
}

export function getCookieToken(request) {
    const cookie = request.headers.get('Cookie') || '';
    const m = cookie.match(/(?:^|;\s*)auth=([^;]+)/);
    return m ? m[1] : null;
}

export async function requireAuth(request, env) {
    const secret = getSecret(env);
    if (!secret) {
        return jsonResponse(
            { ok: false, error: '服务端未配置 AUTH_SECRET，请联系管理员' },
            500
        );
    }
    const token = getCookieToken(request);
    const payload = await verifyToken(token, secret);
    if (!payload) {
        return jsonResponse({ ok: false, error: '未登录或会话已过期' }, 401);
    }
    return null;
}

export function jsonResponse(obj, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: {
            'Content-Type': 'application/json;charset=utf-8',
            'Cache-Control': 'no-store',
            ...extraHeaders
        }
    });
}