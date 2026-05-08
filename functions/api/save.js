import { requireAuth, jsonResponse } from '../_shared/auth.js';

const DATA_KEY = 'data_js';
const BACKUP_PREFIX = 'backup:';
const MAX_BACKUPS = 30;

export async function onRequestPost({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV（FAV_KV）' }, 500);

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

    const { content } = body || {};
    if (typeof content !== 'string' || !content.trim()) {
        return jsonResponse({ ok: false, error: '内容为空' }, 400);
    }

    // 备份旧版本
    let backupName = null;
    const old = await env.FAV_KV.get(DATA_KEY);
    if (old && old.trim()) {
        backupName = BACKUP_PREFIX + timestamp();
        await env.FAV_KV.put(backupName, old);
        try { await pruneBackups(env.FAV_KV); } catch {}
    }

    await env.FAV_KV.put(DATA_KEY, content);
    return jsonResponse({ ok: true, backup: backupName });
}

function timestamp() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '_' +
           p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

async function pruneBackups(kv) {
    const list = await kv.list({ prefix: BACKUP_PREFIX });
    if (list.keys.length <= MAX_BACKUPS) return;
    const sorted = list.keys.sort((a, b) => a.name.localeCompare(b.name));
    const toDelete = sorted.slice(0, sorted.length - MAX_BACKUPS);
    await Promise.all(toDelete.map(k => kv.delete(k.name)));
}