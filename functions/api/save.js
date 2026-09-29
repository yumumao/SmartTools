import { requireAuth, jsonResponse, getPayload } from '../_shared/auth.js';

// A0 v2 改造（2026-05-17）：按身份选 namespace
//   admin → admin:data_js / admin:data_source / admin:backup:*
//   user  → user:<uid>:data_js / user:<uid>:data_source / user:<uid>:backup:*
//          + 写完后 users[uid].hasData = true（best-effort，失败不阻断保存）

const MAX_BACKUPS = 100;
const PRUNE_PROBABILITY = 0.2;
const USERS_KEY = 'users';

function nsKeys(ns) {
    return {
        data:    `${ns}:data_js`,
        source:  `${ns}:data_source`,
        backupP: `${ns}:backup:`
    };
}

export async function onRequestPost({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV(FAV_KV)' }, 500);

    // 选 namespace
    const payload = await getPayload(request, env);
    const role = (payload && payload.role) || 'user';
    const uid  = payload && (payload.uid != null ? payload.uid : payload.u);
    const ns   = role === 'admin' ? 'admin' : `user:${uid}`;
    const isUser = role !== 'admin';
    const KEYS = nsKeys(ns);

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

    const { content } = body || {};
    if (typeof content !== 'string' || !content.trim()) {
        return jsonResponse({ ok: false, error: '内容为空' }, 400);
    }

    // 读旧版本用于对比
    const old = await env.FAV_KV.get(KEYS.data);
    const contentChanged = old !== content;

    let backupName = null;
    if (old && old.trim() && contentChanged) {
        backupName = KEYS.backupP + timestamp();
        await env.FAV_KV.put(backupName, old);
        if (Math.random() < PRUNE_PROBABILITY) {
            try { await pruneBackups(env.FAV_KV, KEYS.backupP); } catch {}
        }
    }

    // 先确认主数据写入成功，再激活KV；写入失败时保留原数据源。
    if (contentChanged) {
        await env.FAV_KV.put(KEYS.data, content);
    }

    // 数据源可由/api/source随时切换，不能用isolate内缓存跳过检查。
    // 即使内容未变，每次保存也应恢复KV模式；失败后重试仍会检查。
    const currentSource = await env.FAV_KV.get(KEYS.source);
    if (currentSource !== 'kv') {
        await env.FAV_KV.put(KEYS.source, 'kv');
    }

    // user 路径：标记 hasData=true（best-effort）
    //   - 已经是 true 时跳过写,省 KV 操作
    //   - 失败时不阻断保存（用户感知"保存成功"是首要的）
    if (isUser && uid) {
        try {
            const raw = await env.FAV_KV.get(USERS_KEY);
            const users = raw ? JSON.parse(raw) : {};
            if (users[uid] && !users[uid].hasData) {
                users[uid].hasData = true;
                await env.FAV_KV.put(USERS_KEY, JSON.stringify(users));
            }
        } catch (e) {
            console.warn('hasData update failed for', uid, e && e.message);
        }
    }

    return jsonResponse({
        ok: true,
        backup: backupName,
        unchanged: !contentChanged,
        namespace: ns
    });
}

// 北京时间时间戳
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

async function pruneBackups(kv, prefix) {
    const list = await kv.list({ prefix });
    if (list.keys.length <= MAX_BACKUPS) return;
    const sorted = list.keys.sort((a, b) => a.name.localeCompare(b.name));
    const toDelete = sorted.slice(0, sorted.length - MAX_BACKUPS);
    await Promise.all(toDelete.map(k => kv.delete(k.name)));
}
