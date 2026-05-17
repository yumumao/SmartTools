// GET    /api/backups                          → 列出当前身份的所有备份
// GET    /api/backups?name=xxx                 → 读取指定备份内容（当前身份的）
// POST   /api/backups?name=xxx&action=restore  → 恢复为主数据（当前身份的）
// DELETE /api/backups?name=xxx                 → 删除备份（当前身份的）
//
// A0 v2 改造（2026-05-17）：按身份选 namespace
//   admin → 操作 admin:backup:* 和 admin:data_js
//   user  → 操作 user:<uid>:backup:* 和 user:<uid>:data_js
//   admin **不跨用户**（即使是 admin 也只看 admin 自己的备份；A1 会单独提供归档管理 API）

import { requireAuth, jsonResponse, getPayload } from '../_shared/auth.js';

function nsKeys(ns) {
    return {
        data:    `${ns}:data_js`,
        backupP: `${ns}:backup:`
    };
}

async function pickNamespace(request, env) {
    const payload = await getPayload(request, env);
    const role = (payload && payload.role) || 'user';
    const uid  = payload && (payload.uid != null ? payload.uid : payload.u);
    return role === 'admin' ? 'admin' : `user:${uid}`;
}

export async function onRequestGet({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const ns = await pickNamespace(request, env);
    const KEYS = nsKeys(ns);

    const url = new URL(request.url);
    const name = url.searchParams.get('name');

    if (name) {
        let content = await env.FAV_KV.get(KEYS.backupP + name);
        // ★ 迁移期兼容（仅 admin namespace）：新 key 不存在时尝试老 backup:* 前缀
        if (content == null && ns === 'admin') {
            content = await env.FAV_KV.get('backup:' + name);
        }
        if (content == null) return jsonResponse({ ok: false, error: '备份不存在' }, 404);
        return jsonResponse({ ok: true, content, namespace: ns });
    }

    const list = await env.FAV_KV.list({ prefix: KEYS.backupP });
    let items = list.keys.map(k => ({
        name: k.name.substring(KEYS.backupP.length)
    }));

    // ★ 迁移期兼容（仅 admin namespace）：admin:backup:* 全空但 backup:* 非空时，列出老备份
    //   带 legacy:true 标记。migrate-v2 调用后 admin:backup:* 出现，这条路径自动停用。
    if (ns === 'admin' && items.length === 0) {
        try {
            const legacy = await env.FAV_KV.list({ prefix: 'backup:' });
            if (legacy.keys.length > 0) {
                items = legacy.keys.map(k => ({
                    name: k.name.substring('backup:'.length),
                    legacy: true
                }));
            }
        } catch {}
    }

    items.sort((a, b) => b.name.localeCompare(a.name));
    return jsonResponse({ ok: true, backups: items, namespace: ns });
}

export async function onRequestPost({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const ns = await pickNamespace(request, env);
    const KEYS = nsKeys(ns);

    const url = new URL(request.url);
    const name = url.searchParams.get('name');
    const action = url.searchParams.get('action');
    if (!name) return jsonResponse({ ok: false, error: '缺少 name' }, 400);

    if (action === 'restore') {
        // ★ 迁移期兼容：新 key 不存在时尝试老 backup:*（仅 admin namespace）
        let content = await env.FAV_KV.get(KEYS.backupP + name);
        if (content == null && ns === 'admin') {
            content = await env.FAV_KV.get('backup:' + name);
        }
        if (content == null) return jsonResponse({ ok: false, error: '备份不存在' }, 404);
        // 保存当前作为新备份（同 namespace 内，写到新 key）
        const old = await env.FAV_KV.get(KEYS.data);
        if (old && old.trim()) {
            await env.FAV_KV.put(KEYS.backupP + timestamp(), old);
        }
        await env.FAV_KV.put(KEYS.data, content);
        return jsonResponse({ ok: true, namespace: ns });
    }
    return jsonResponse({ ok: false, error: '未知 action' }, 400);
}

// 北京时间时间戳（与 save.js / comment.js 一致）
function timestamp() {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() +
           p(d.getUTCMonth() + 1) +
           p(d.getUTCDate()) + '_' +
           p(d.getUTCHours()) +
           p(d.getUTCMinutes()) +
           p(d.getUTCSeconds());
}

export async function onRequestDelete({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const ns = await pickNamespace(request, env);
    const KEYS = nsKeys(ns);

    const url = new URL(request.url);
    const name = url.searchParams.get('name');
    if (!name) return jsonResponse({ ok: false, error: '缺少 name' }, 400);
    // ★ 迁移期兼容：先尝试新 key，如果不存在再尝试老 key（仅 admin namespace）
    await env.FAV_KV.delete(KEYS.backupP + name);
    if (ns === 'admin') {
        // 同时删老 key（如果还在）——避免 admin 删了备份但老备份还在
        await env.FAV_KV.delete('backup:' + name);
    }
    return jsonResponse({ ok: true, namespace: ns });
}
