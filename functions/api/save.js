import { requireAuth, jsonResponse } from '../_shared/auth.js';

const DATA_KEY = 'data_js';
const SOURCE_KEY = 'data_source';
const BACKUP_PREFIX = 'backup:';
const MAX_BACKUPS = 100;

export async function onRequestPost({ request, env }) {
    const fail = await requireAuth(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV(FAV_KV)' }, 500);

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

    const { content } = body || {};
    if (typeof content !== 'string' || !content.trim()) {
        return jsonResponse({ ok: false, error: '内容为空' }, 400);
    }

    // 读取旧版本用于对比
    const old = await env.FAV_KV.get(DATA_KEY);

    // ★ 内容对比：完全相同则跳过备份
    const contentChanged = old !== content;

    let backupName = null;
    if (old && old.trim() && contentChanged) {
        backupName = BACKUP_PREFIX + timestamp();
        await env.FAV_KV.put(backupName, old);
        try { await pruneBackups(env.FAV_KV); } catch {}
    }

    // ★ 仅当内容变化时才写入主数据（节省 KV 写次数；如想强制更新时间戳，把这判断去掉即可）
    if (contentChanged) {
        await env.FAV_KV.put(DATA_KEY, content);
    }

    // 保存数据后,自动确保开关在 kv 模式
    // 这样首次部署的用户保存一次后,整个系统就自动激活了
    const currentSource = await env.FAV_KV.get(SOURCE_KEY);
    if (currentSource !== 'kv') {
        await env.FAV_KV.put(SOURCE_KEY, 'kv');
    }

    return jsonResponse({
        ok: true,
        backup: backupName,           // 无变化时为 null
        unchanged: !contentChanged    // ★ 新增字段，告诉前端是否真的有变化
    });
}

// 修复时区:生成北京时间(UTC+8)的时间戳
function timestamp() {
    // Cloudflare Workers 默认是 UTC,手动加 8 小时偏移得到北京时间
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() +
           p(d.getUTCMonth() + 1) +
           p(d.getUTCDate()) + '_' +
           p(d.getUTCHours()) +
           p(d.getUTCMinutes()) +
           p(d.getUTCSeconds());
}

async function pruneBackups(kv) {
    const list = await kv.list({ prefix: BACKUP_PREFIX });
    if (list.keys.length <= MAX_BACKUPS) return;
    const sorted = list.keys.sort((a, b) => a.name.localeCompare(b.name));
    const toDelete = sorted.slice(0, sorted.length - MAX_BACKUPS);
    await Promise.all(toDelete.map(k => kv.delete(k.name)));
}