// GET    /api/users         → 列出所有用户（仅 admin）
// POST   /api/users         → 创建/重置用户（仅 admin）
// DELETE /api/users?u=xxx   → 删除用户（仅 admin）

import { requireAuth, jsonResponse, getUsername } from '../_shared/auth.js';

const USERS_KEY = 'users';

async function sha256Hex(str) {
    const data = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getRole(users, username) {
    return (users && users[username] && users[username].role) || null;
}

// 列出用户（脱敏：不返回密码哈希）
export async function onRequestGet({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const username = await getUsername(request, env);
    const raw = await env.FAV_KV.get(USERS_KEY);
    const users = raw ? JSON.parse(raw) : {};
    if (getRole(users, username) !== 'admin') {
        return jsonResponse({ ok: false, error: '仅管理员可查看用户列表' }, 403);
    }

    const list = Object.entries(users).map(([u, info]) => ({
        username: u,
        role: info.role || 'user'
    }));
    return jsonResponse({ ok: true, users: list });
}

// 创建或重置用户
export async function onRequestPost({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const currentUser = await getUsername(request, env);
    const raw = await env.FAV_KV.get(USERS_KEY);
    const users = raw ? JSON.parse(raw) : {};
    if (getRole(users, currentUser) !== 'admin') {
        return jsonResponse({ ok: false, error: '仅管理员可管理用户' }, 403);
    }

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

    const { username, password } = body || {};
    if (!username || typeof username !== 'string' || !username.trim()) {
        return jsonResponse({ ok: false, error: '用户名不能为空' }, 400);
    }
    if (!password || typeof password !== 'string' || password.length < 4) {
        return jsonResponse({ ok: false, error: '密码至少 4 位' }, 400);
    }

    const isNew = !users[username];
    users[username] = {
        passHash: await sha256Hex(password),
        role: isNew ? 'user' : (users[username].role || 'user')
    };

    await env.FAV_KV.put(USERS_KEY, JSON.stringify(users));
    return jsonResponse({
        ok: true,
        created: isNew,
        username,
        note: isNew ? '用户已创建' : '密码已重置'
    });
}

// 删除用户
export async function onRequestDelete({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const currentUser = await getUsername(request, env);
    const raw = await env.FAV_KV.get(USERS_KEY);
    const users = raw ? JSON.parse(raw) : {};
    if (getRole(users, currentUser) !== 'admin') {
        return jsonResponse({ ok: false, error: '仅管理员可管理用户' }, 403);
    }

    const url = new URL(request.url);
    const target = url.searchParams.get('u');
    if (!target) return jsonResponse({ ok: false, error: '缺少参数 u' }, 400);
    if (target === currentUser) {
        return jsonResponse({ ok: false, error: '不能删除自己' }, 400);
    }
    if (!users[target]) {
        return jsonResponse({ ok: false, error: '用户不存在' }, 404);
    }

    delete users[target];
    await env.FAV_KV.put(USERS_KEY, JSON.stringify(users));
    return jsonResponse({ ok: true, deleted: target });
}
