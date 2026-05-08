import { jsonResponse } from '../_shared/auth.js';

export async function onRequestPost() {
    return jsonResponse({ ok: true }, 200, {
        'Set-Cookie': 'auth=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict'
    });
}