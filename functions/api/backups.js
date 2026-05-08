// GET  /api/backups                 → 列出所有备份
// GET  /api/backups?name=xxx        → 读取指定备份内容
// POST /api/backups?name=xxx&action=restore  → 恢复为主数据
// DELETE /api/backups?name=xxx      → 删除备份

import { requireAuth, jsonResponse } from '../_shared/auth.js';

const DATA_KEY = 'data_js';
const BACKUP_PREFIX = 'backup:';

export async function onRequestGet({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const url = new URL(request.url);
    const name = url.searchParams.get('name');

    if (name) {
        const content = await env.FAV_KV.get(BACKUP_PREFIX + name);
        if (content == null) return jsonResponse({ ok: false, error: '备份不存在' }, 404);
        return jsonResponse({ ok: true, content });
    }
    const list = await env.FAV_KV.list({ prefix: BACKUP_PREFIX });
    const items = list.keys.map(k => ({
        name: k.name.replace(BACKUP_PREFIX, '')
    })).sort((a, b) => b.name.localeCompare(a.name));
    return jsonResponse({ ok: true, backups: items });
}

export async function onRequestPost({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const url = new URL(request.url);
    const name = url.searchParams.get('name');
    const action = url.searchParams.get('action');
    if (!name) return jsonResponse({ ok: false, error: '缺少 name' }, 400);

    if (action === 'restore') {
        const content = await env.FAV_KV.get(BACKUP_PREFIX + name);
        if (content == null) return jsonResponse({ ok: false, error: '备份不存在' }, 404);
        // 保存当前作为新备份
        const old = await env.FAV_KV.get(DATA_KEY);
        if (old && old.trim()) {
            const d = new Date(), p = n => String(n).padStart(2, '0');
            const ts = d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '_' +
                       p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
            await env.FAV_KV.put(BACKUP_PREFIX + ts, old);
        }
        await env.FAV_KV.put(DATA_KEY, content);
        return jsonResponse({ ok: true });
    }
    return jsonResponse({ ok: false, error: '未知 action' }, 400);
}

export async function onRequestDelete({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const url = new URL(request.url);
    const name = url.searchParams.get('name');
    if (!name) return jsonResponse({ ok: false, error: '缺少 name' }, 400);
    await env.FAV_KV.delete(BACKUP_PREFIX + name);
    return jsonResponse({ ok: true });
}