import {
    createToken,
    jsonResponse,
    getSecret,
    pbkdf2Hex,
    randomSaltB64
} from '../_shared/auth.js';

/**
 * 时序安全的字符串比较，避免通过响应时间差推测密码。
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

// 兼容老 users 条目的 sha256 校验（A0 v2 兼容路径）
async function sha256Hex(str) {
    const data = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ════════════════════════════════════════════════════════════════════════════
 * 登录速率限制（P2-1）— 保持原状
 * ════════════════════════════════════════════════════════════════════════════ */
const LOCKOUT_PREFIX  = 'lockout:';
const MAX_ATTEMPTS    = 5;
const WINDOW_SECONDS  = 600;
const USERS_KEY       = 'users';
const PBKDF2_ITER     = 100000;

function getClientIP(request) {
    const cf = request.headers.get('CF-Connecting-IP');
    if (cf) return cf.trim();
    const xff = request.headers.get('X-Forwarded-For');
    if (xff) {
        const first = xff.split(',')[0];
        if (first) return first.trim();
    }
    return 'unknown';
}

async function readLockout(env, ip) {
    if (!env.FAV_KV) return null;
    try {
        const r = await env.FAV_KV.getWithMetadata(LOCKOUT_PREFIX + ip, { type: 'text' });
        if (!r || r.value == null) return null;
        const count = parseInt(r.value, 10) || 0;
        const expireAt = (r.metadata && r.metadata.expireAt) || 0;
        return { count, expireAt };
    } catch {
        return null;
    }
}

async function recordFailure(env, ip) {
    if (!env.FAV_KV) return;
    try {
        const cur = await readLockout(env, ip);
        const nowSec = Math.floor(Date.now() / 1000);
        const expireAt = (cur && cur.expireAt && cur.expireAt > nowSec)
            ? cur.expireAt
            : nowSec + WINDOW_SECONDS;
        const ttl = Math.max(1, expireAt - nowSec);
        const next = (cur ? cur.count : 0) + 1;
        await env.FAV_KV.put(LOCKOUT_PREFIX + ip, String(next), {
            expirationTtl: ttl,
            metadata: { expireAt }
        });
    } catch {}
}

async function clearFailure(env, ip) {
    if (!env.FAV_KV) return;
    try { await env.FAV_KV.delete(LOCKOUT_PREFIX + ip); } catch {}
}

/* ════════════════════════════════════════════════════════════════════════════
 * 主入口
 * ════════════════════════════════════════════════════════════════════════════ */
export async function onRequestPost({ request, env }) {
    // ★ 速率限制最早判断
    const ip = getClientIP(request);
    const lock = await readLockout(env, ip);
    if (lock && lock.count >= MAX_ATTEMPTS) {
        const nowSec = Math.floor(Date.now() / 1000);
        const retryAfter = Math.max(1, (lock.expireAt || nowSec) - nowSec);
        return jsonResponse({
            ok: false,
            error: '登录失败次数过多，请稍后再试'
        }, 429, { 'Retry-After': String(retryAfter) });
    }

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

    const secret = getSecret(env);
    if (!secret) {
        return jsonResponse({
            ok: false,
            error: '服务端未配置 AUTH_SECRET 或长度不足 16 位'
        }, 500);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 决策树:
    //   1. 读 KV users 表
    //   2. 若 users[username] 存在 且 status=active 且 密码匹配 → 签 KV 用户 token
    //   3. 否则 若 username === ADMIN_USER 且 password === ADMIN_PASS(env) → env-admin 路径 (兜底)
    //      - 顺便 bootstrap users[ADMIN_USER] (若缺)
    //   4. 都不匹配 → 401
    // ──────────────────────────────────────────────────────────────────────────

    // 读 users 表
    let users = {};
    if (env.FAV_KV) {
        try {
            const raw = await env.FAV_KV.get(USERS_KEY);
            if (raw) users = JSON.parse(raw);
        } catch (e) {
            // KV 读失败不算致命，继续走 env-admin 兜底
            users = {};
        }
    }
    const kvUser = users[username];

    // 路径 1: KV user 存在且 active
    let kvAuthOk = false;
    let kvUserUpgradedFromLegacy = false;
    if (kvUser && kvUser.status !== 'disabled') {
        const isLegacy = !kvUser.salt;
        try {
            let computed;
            if (isLegacy) {
                computed = await sha256Hex(password);
            } else {
                computed = await pbkdf2Hex(password, kvUser.salt, kvUser.iter || PBKDF2_ITER);
            }
            kvAuthOk = timingSafeEqual(computed, kvUser.passHash || '');
            kvUserUpgradedFromLegacy = kvAuthOk && isLegacy;
        } catch {
            kvAuthOk = false;
        }
    }

    if (kvAuthOk) {
        // ★ 顺手升级老 sha256 用户（best-effort：失败不阻断登录）
        if (kvUserUpgradedFromLegacy && env.FAV_KV) {
            try {
                const newSalt = randomSaltB64(16);
                const newHash = await pbkdf2Hex(password, newSalt, PBKDF2_ITER);
                users[username] = {
                    ...kvUser,
                    passHash: newHash,
                    salt: newSalt,
                    iter: PBKDF2_ITER
                };
                await env.FAV_KV.put(USERS_KEY, JSON.stringify(users));
            } catch (e) {
                console.warn('pbkdf2 upgrade failed for', username, e && e.message);
                // 不阻断登录；下次登录再试
            }
        }

        await clearFailure(env, ip);
        const role = kvUser.role === 'admin' ? 'admin' : 'user';
        const token = await createToken({ u: username, uid: username, role }, secret);
        return jsonResponse({ ok: true, username, role }, 200, {
            'Set-Cookie': `auth=${token}; Path=/; Max-Age=${7 * 86400}; HttpOnly; Secure; SameSite=Strict`
        });
    }

    // 路径 2: env-admin 兜底
    //   适用场景:
    //     (a) users 表里没 ADMIN_USER (首次部署 / 全新 KV)
    //     (b) users 表里 ADMIN_USER 被 disabled (防自锁)
    //     (c) users 表里 ADMIN_USER 的 KV passHash 校验失败 (KV 被改坏)
    //   都用 env 凭据校验,通过就 bootstrap/更新 users 表
    const userOk = timingSafeEqual(username, adminUser);
    const passOk = timingSafeEqual(password, adminPass);

    if (!userOk || !passOk) {
        await recordFailure(env, ip);
        // 区分 4 种失败,但对外统一返回 401(不泄漏哪个字段错)
        // 1. KV user 不存在 + username !== ADMIN_USER → "用户名或密码错误"
        // 2. KV user 存在 + 密码错 → 同上
        // 3. KV user 存在 + status=disabled + 不是 ADMIN_USER → 同上(避免泄漏账号已停用这个信息)
        // 4. username === ADMIN_USER 但 env password 错 → 同上
        return jsonResponse({ ok: false, error: '用户名或密码错误' }, 401);
    }

    // env-admin 通过：bootstrap users[ADMIN_USER] (若缺) 或 同步 (若存在但密码漂移)
    if (env.FAV_KV) {
        const needBootstrap = !kvUser
            || !kvUser.salt
            || !kvAuthOk;   // 后者覆盖 "kvUser 存在但 KV passHash 不匹配 env"
        if (needBootstrap) {
            try {
                const newSalt = randomSaltB64(16);
                const newHash = await pbkdf2Hex(password, newSalt, PBKDF2_ITER);
                const nowIso = new Date().toISOString();
                users[username] = {
                    ...(kvUser || {}),
                    passHash: newHash,
                    salt: newSalt,
                    iter: PBKDF2_ITER,
                    role: 'admin',
                    status: 'active',
                    createdAt: (kvUser && kvUser.createdAt) || nowIso,
                    createdBy: (kvUser && kvUser.createdBy) || '__bootstrap__',
                    hasData: (kvUser && kvUser.hasData) || false
                };
                await env.FAV_KV.put(USERS_KEY, JSON.stringify(users));
            } catch (e) {
                console.warn('admin bootstrap failed:', e && e.message);
                // 不阻断登录,env 路径仍然有效
            }
        }
    }

    await clearFailure(env, ip);
    const token = await createToken({ u: username, uid: username, role: 'admin' }, secret);
    return jsonResponse({ ok: true, username, role: 'admin' }, 200, {
        'Set-Cookie': `auth=${token}; Path=/; Max-Age=${7 * 86400}; HttpOnly; Secure; SameSite=Strict`
    });
}
