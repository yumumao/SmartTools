import { getCookieToken, verifyToken, jsonResponse } from '../_shared/auth.js';

export async function onRequestGet({ request, env }) {
    const token = getCookieToken(request);
    const secret = env.AUTH_SECRET || 'please-change-this-secret';
    const payload = await verifyToken(token, secret);
    return jsonResponse({
        ok: true,
        loggedIn: !!payload,
        username: payload ? payload.u : null,
        hasKV: !!env.FAV_KV,
        hasAdmin: !!(env.ADMIN_USER && env.ADMIN_PASS)
    });
}