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

/* ════════════════════════════════════════════════════════════════════════════
 * 登录速率限制（P2-1）
 * ─────────────────────────────────────────────────────────────────────────
 * 策略：按客户端 IP 在 KV 里累计失败次数，达到阈值后窗口内全部 429。
 *   - 窗口大小 WINDOW_SECONDS，从首次失败开始计算，期间失败不重置。
 *   - 成功登录立即清空该 IP 的失败计数。
 *   - 未绑定 KV / KV 异常时静默降级：不阻断主流程，只是没有限速。
 *   - IP 取自 CF-Connecting-IP（Cloudflare 注入），回退到 X-Forwarded-For 首项。
 * ════════════════════════════════════════════════════════════════════════ */
const LOCKOUT_PREFIX  = 'lockout:';
const MAX_ATTEMPTS    = 5;
const WINDOW_SECONDS  = 600;  // 10 分钟

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
        // 首次失败时设置 expireAt；后续失败保持原 expireAt（窗口的固定上限）
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

export async function onRequestPost({ request, env }) {
    // ★ 速率限制最早判断：如果已锁定，直接 429 不消耗后续 CPU/KV
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
        // ★ 失败计数（不阻断本次响应，主流程仍返回 401）
        await recordFailure(env, ip);
        return jsonResponse({ ok: false, error: '用户名或密码错误' }, 401);
    }

    // ★ 成功登录：清空该 IP 失败计数
    await clearFailure(env, ip);

    const token = await createToken(username, secret);

    return jsonResponse({ ok: true, username }, 200, {
        'Set-Cookie': `auth=${token}; Path=/; Max-Age=${7 * 86400}; HttpOnly; Secure; SameSite=Strict`
    });
}