// POST /api/change-password  → 已登录用户修改自己的密码
//   body: { oldPassword, newPassword }
//
// A0 v2 改造（2026-05-17）：
//   - 新密码统一用 PBKDF2 + 16B 盐写入
//   - 老 sha256Hex 用户：旧密码用 sha256 校验（无感升级路径），通过后用 PBKDF2 写新密码
//   - env-admin 尚未 bootstrap 时拒绝：env 密码请在 Cloudflare Dashboard 改

import {
    requireAuth,
    jsonResponse,
    getUsername,
    pbkdf2Hex,
    randomSaltB64
} from '../_shared/auth.js';

const USERS_KEY = 'users';
const PBKDF2_ITER = 100000;

function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

// 老格式 sha256Hex（用于兼容老 users.js 写入的 passHash）
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
    if (!username) {
        return jsonResponse({ ok: false, error: '无法识别当前用户' }, 401);
    }

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
        // env-admin 还没 bootstrap 进 users 表，或者 token 里的 u 在 users 表里找不到
        return jsonResponse({
            ok: false,
            error: 'KV 中无此用户条目；env 配置的管理员密码请在 Cloudflare Dashboard 修改'
        }, 400);
    }

    // 校验旧密码：根据条目格式选择算法
    const isLegacySha256 = !user.salt;
    let oldOk;
    if (isLegacySha256) {
        const oldHash = await sha256Hex(oldPassword);
        oldOk = timingSafeEqual(oldHash, user.passHash);
    } else {
        const oldHash = await pbkdf2Hex(oldPassword, user.salt, user.iter || PBKDF2_ITER);
        oldOk = timingSafeEqual(oldHash, user.passHash);
    }
    if (!oldOk) {
        return jsonResponse({ ok: false, error: '旧密码错误' }, 401);
    }

    // 写新密码：统一用 PBKDF2（顺手升级老条目）
    const newSalt = randomSaltB64(16);
    const newHash = await pbkdf2Hex(newPassword, newSalt, PBKDF2_ITER);
    users[username] = {
        ...user,
        passHash: newHash,
        salt: newSalt,
        iter: PBKDF2_ITER
    };
    await env.FAV_KV.put(USERS_KEY, JSON.stringify(users));

    return jsonResponse({
        ok: true,
        algo: 'pbkdf2',
        upgradedFromLegacy: isLegacySha256,
        note: isLegacySha256 ? '密码已更新（同时升级哈希算法）' : '密码已更新'
    });
}
