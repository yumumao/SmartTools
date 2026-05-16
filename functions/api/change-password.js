// POST /api/change-password  → 已登录用户修改自己的密码
// body: { oldPassword, newPassword }

import { requireAuth, jsonResponse, getUsername } from '../_shared/auth.js';

const USERS_KEY = 'users';

function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

async function sha256Hex(str) {
    const data = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const username = await getUsername(request, env);

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

    const { oldPassword, newPassword } = body || {};
    if (!oldPassword || !newPassword) {
        return jsonResponse({ ok: false, error: '新旧密码不能为空' }, 400);
    }
    if (newPassword.length < 4) {
        return jsonResponse({ ok: false, error: '新密码至少 4 位' }, 400);
    }

    const raw = await env.FAV_KV.get(USERS_KEY);
    const users = raw ? JSON.parse(raw) : {};
    const user = users[username];
    if (!user || !user.passHash) {
        return jsonResponse({ ok: false, error: '用户信息异常，请联系管理员' }, 500);
    }

    // 验证旧密码
    const oldHash = await sha256Hex(oldPassword);
    if (!timingSafeEqual(oldHash, user.passHash)) {
        return jsonResponse({ ok: false, error: '旧密码错误' }, 401);
    }

    // 更新密码
    user.passHash = await sha256Hex(newPassword);
    await env.FAV_KV.put(USERS_KEY, JSON.stringify(users));
    return jsonResponse({ ok: true, note: '密码已更新' });
}
