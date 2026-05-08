import { createToken, jsonResponse, getSecret } from '../_shared/auth.js';

/**
 * 时序安全的字符串比较，避免通过响应时间差推测密码。
 * 注意：长度不同会立即返回 false，这本身也算一种泄漏，
 * 但对登录场景来说风险可忽略。
 */
function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

export async function onRequestPost({ request, env }) {
    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ ok: false, error: '请求格式错误' }, 400);
    }

    const { username, password } = body || {};
    if (!username || !password) {
        return jsonResponse({ ok: false, error: '用户名或密码为空' }, 400);
    }

    const adminUser = env.ADMIN_USER;
    const adminPass = env.ADMIN_PASS;
    if (!adminUser || !adminPass) {
        return jsonResponse({
            ok: false,
            error: '服务端未配置 ADMIN_USER / ADMIN_PASS 环境变量'
        }, 500);
    }

    // 统一从 auth.js 读取密钥，未配置则直接 500(不再使用默认弱密钥)
    const secret = getSecret(env);
    if (!secret) {
        return jsonResponse({
            ok: false,
            error: '服务端未配置 AUTH_SECRET 或长度不足 16 位'
        }, 500);
    }

    // 时序安全比较，防止定时攻击
    const userOk = timingSafeEqual(username, adminUser);
    const passOk = timingSafeEqual(password, adminPass);
    if (!userOk || !passOk) {
        return jsonResponse({ ok: false, error: '用户名或密码错误' }, 401);
    }

    const token = await createToken(username, secret);

    return jsonResponse({ ok: true, username }, 200, {
        'Set-Cookie': `auth=${token}; Path=/; Max-Age=${7 * 86400}; HttpOnly; Secure; SameSite=Strict`
    });
}