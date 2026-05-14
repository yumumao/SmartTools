import { getCookieToken, verifyToken, getSecret, jsonResponse } from '../_shared/auth.js';

export async function onRequestGet({ request, env }) {
    const secret = getSecret(env);
    if (!secret) {
        return jsonResponse({
            ok: true,
            loggedIn: false,
            username: null,
            hasKV: !!env.FAV_KV,
            hasAdmin: !!(env.ADMIN_USER && env.ADMIN_PASS),
            error: 'AUTH_SECRET 未配置'
        });
    }
    const token = getCookieToken(request);
    const payload = await verifyToken(token, secret);
    return jsonResponse({
        ok: true,
        loggedIn: !!payload,
        username: payload ? payload.u : null,
        hasKV: !!env.FAV_KV,
        hasAdmin: !!(env.ADMIN_USER && env.ADMIN_PASS)
    });
}