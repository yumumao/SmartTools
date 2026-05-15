import { requireAuth, jsonResponse } from '../_shared/auth.js';

const DATA_KEY = 'data_js';
const SOURCE_KEY = 'data_source';
const BACKUP_PREFIX = 'backup:';
const MAX_BACKUPS = 100;
const PRUNE_PROBABILITY = 0.2;  // 偶发触发 prune,降低每次保存的 KV list 开销

/**
 * 模块作用域 flag：本 isolate 内已确认 SOURCE_KEY 是 'kv'。
 * Cloudflare Workers 同 isolate 多次请求间复用此变量,新 isolate 启动会重置。
 * 这意味着 SOURCE_KEY 检查/写入从"每次保存"降为"每个 isolate 首次保存"。
 * 不影响最终一致性:新 isolate 仍会重做一次检查。
 */
let _sourceConfirmedKv = false;

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
        // 偶发触发：平均 5 次新备份才扫一次,统计学上 backup 数会在 MAX 附近小幅波动
        if (Math.random() < PRUNE_PROBABILITY) {
            try { await pruneBackups(env.FAV_KV); } catch {}
        }
    }

    // ★ 主数据写入 + SOURCE_KEY 自动激活 → 并行执行
    const writes = [];
    if (contentChanged) {
        writes.push(env.FAV_KV.put(DATA_KEY, content));
    }
    if (!_sourceConfirmedKv) {
        // 本 isolate 首次保存:check + 必要时切到 'kv'
        const currentSource = await env.FAV_KV.get(SOURCE_KEY);
        if (currentSource !== 'kv') {
            writes.push(env.FAV_KV.put(SOURCE_KEY, 'kv'));
        }
        _sourceConfirmedKv = true;
    }
    if (writes.length) await Promise.all(writes);

    return jsonResponse({
        ok: true,
        backup: backupName,           // 无变化时为 null
        unchanged: !contentChanged    // ★ 告诉前端是否真的有变化
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