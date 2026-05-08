import { createToken, jsonResponse } from '../_shared/auth.js';

export async function onRequestPost({ request, env }) {
    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

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
    if (username !== adminUser || password !== adminPass) {
        return jsonResponse({ ok: false, error: '用户名或密码错误' }, 401);
    }

    const secret = env.AUTH_SECRET || 'please-change-this-secret';
    const token = await createToken(username, secret);

    return jsonResponse({ ok: true, username }, 200, {
        'Set-Cookie': `auth=${token}; Path=/; Max-Age=${7 * 86400}; HttpOnly; Secure; SameSite=Strict`
    });
}