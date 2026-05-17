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

/**
 * 签发 token。两种调用方式（向后兼容）：
 *   createToken('alice', secret)                 // 老签名 → 推断 uid=u, role='admin'(若 u===ADMIN_USER)|'user'
 *   createToken({u, uid, role}, secret)          // 新签名 → 直接组装 payload
 * 第三个参数 days 在两种签名下都可用，默认 7。
 *
 * 调用方决定 role：login.js 走 KV users 表时传明确 role；走 env-admin 兜底时传 'admin'。
 */
export async function createToken(userOrPayload, secret, days = 7) {
    if (!secret) throw new Error('AUTH_SECRET 未配置');
    let payload;
    if (typeof userOrPayload === 'string') {
        // 老签名：兼容现存调用方（A0 实施过程中 login.js 还没改造时的 fallback）
        payload = { u: userOrPayload, exp: Date.now() + days * 86400 * 1000 };
    } else if (userOrPayload && typeof userOrPayload === 'object') {
        const u    = userOrPayload.u;
        const uid  = userOrPayload.uid != null ? userOrPayload.uid : u;
        const role = userOrPayload.role || 'user';
        payload = { u, uid, role, exp: Date.now() + days * 86400 * 1000 };
    } else {
        throw new Error('createToken: 参数必须是 username 或 {u, uid, role}');
    }
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

/* ════════════════════════════════════════════════════════════════════════════════
 * A0 v2 扩展：多用户支持
 * ─────────────────────────────────────────────────────────────────────────────
 * 不改既有 export 行为；只添加新工具。所有 getXxx 函数对老 token 做兼容推断：
 *   老 token payload: { u, exp }
 *   新 token payload: { u, uid, role, exp }
 * 老 token 没有 uid 时视 uid = u；没有 role 时按 ADMIN_USER 判断角色。
 * ════════════════════════════════════════════════════════════════════════════════ */

/**
 * 从请求中提取 cookie token 并校验，返回 payload 对象（可能为 null）。
 * 同 verifyToken 但封装了 cookie 读取 + secret 读取。
 */
export async function getPayload(request, env) {
    const secret = getSecret(env);
    if (!secret) return null;
    const token = getCookieToken(request);
    return await verifyToken(token, secret);
}

/**
 * 取当前请求的 username（即 payload.u）。
 * 未登录返回 null。
 */
export async function getUsername(request, env) {
    const p = await getPayload(request, env);
    return p ? p.u : null;
}

/**
 * 取当前请求的 uid（多用户场景下数据 KV namespace 标识符）。
 * 老 token 没有 uid 字段时回退到 u。
 * 未登录返回 null。
 */
export async function getUserId(request, env) {
    const p = await getPayload(request, env);
    if (!p) return null;
    return p.uid != null ? p.uid : p.u;
}

/**
 * 取当前请求的 role（'admin' / 'user'）。
 * 兼容规则：
 *   - 新 token 直接读 payload.role
 *   - 老 token 无 role 字段：如果 payload.u === env.ADMIN_USER 则视为 admin，否则视为 user
 * 未登录返回 null。
 */
export async function getRole(request, env) {
    const p = await getPayload(request, env);
    if (!p) return null;
    if (p.role) return p.role;
    // 老 token 兼容推断
    if (env && env.ADMIN_USER && p.u === env.ADMIN_USER) return 'admin';
    return 'user';
}

/**
 * 要求当前请求是 admin 身份。
 * 返回 null 表示通过；返回 Response 表示已拦截（401 未登录 / 403 非 admin）。
 * 与 requireAuth 配合使用：管理员专属端点先 requireAuth 再 requireAdmin（或直接 requireAdmin，它内部也会 verify）。
 */
export async function requireAdmin(request, env) {
    const secret = getSecret(env);
    if (!secret) {
        return jsonResponse({ ok: false, error: '服务端未配置 AUTH_SECRET，请联系管理员' }, 500);
    }
    const role = await getRole(request, env);
    if (role == null) {
        return jsonResponse({ ok: false, error: '未登录或会话已过期' }, 401);
    }
    if (role !== 'admin') {
        return jsonResponse({ ok: false, error: '仅管理员可执行此操作' }, 403);
    }
    return null;
}

/**
 * 用户名合法性校验（用于 users.js POST 和迁移期 uid 一致性检查）。
 * 规则：只允许 A-Z a-z 0-9 _ - .  长度 1-32。
 * 不允许中文、空格、@、:、/ 等会破坏 KV key 形态的字符。
 */
export function isValidUsername(s) {
    return typeof s === 'string' && /^[A-Za-z0-9_\-\.]{1,32}$/.test(s);
}

/**
 * 生成 base64 编码的随机盐（默认 16 字节 = 128 bit）。
 */
export function randomSaltB64(bytes = 16) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return btoa(String.fromCharCode(...buf));
}

/**
 * PBKDF2-SHA256 派生 32 字节密钥，返回 hex 字符串（64 字符）。
 * saltB64 是 randomSaltB64 生成的 base64 字符串。
 * iter 推荐 250000（约 100ms 单次，可接受）。
 */
export async function pbkdf2Hex(password, saltB64, iter = 250000) {
    const saltBin = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const baseKey = await crypto.subtle.importKey(
        'raw', encoder.encode(password),
        { name: 'PBKDF2' },
        false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: saltBin, iterations: iter },
        baseKey,
        256
    );
    return Array.from(new Uint8Array(bits))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}