// GET    /api/archives                              → 列出所有归档(admin only,读 archive:*:meta)
// GET    /api/archives?key=archive:<uid>:<ts>        → 单条归档详情(meta + backup 列表概要,不含 data 内容)
// GET    /api/archives?key=...&include=full          → 单条归档全量(meta + data 内容 + 全部 backups 内容);响应可能很大
// DELETE /api/archives?key=archive:<uid>:<ts>&confirm=DELETE-ARCHIVE-<ts>
//                                                    → 删除整条归档(meta + data + source + backup:*)
//
// A1-c2 (2026-05-18):D3=B 永久归档管理
//   - admin only,所有路径走 requireAdmin
//   - D3=B 永久保留语义:**不**自动清理,只能 admin 手动 DELETE
//   - 列表性能:KV list({prefix:'archive:'}) 一次性拿全部 meta 后端解析(每条 meta JSON ~200 字节)
//     若未来归档量大可改分页;A1-c2 初版按全量返回
//   - 单条 GET 不返回 data 字段(可能很大),只回 meta + backup 名字列表
//   - DELETE 二次校验:confirm === 'DELETE-ARCHIVE-' + ts,防误删
//
// 归档 KV 结构(由 users.js force delete 创建):
//   archive:<uid>:<ts>:meta       JSON {username,uid,role,archivedAt,archivedAtLocal,archivedBy,dataSize,backupCount,...}
//   archive:<uid>:<ts>:data       data_js 文本
//   archive:<uid>:<ts>:source     data_source 文本(可选)
//   archive:<uid>:<ts>:backup:<bts>   每条用户备份

import { requireAdmin, jsonResponse } from '../_shared/auth.js';

const ARCHIVE_PREFIX = 'archive:';

// 从 archive key 提取 ts(用于 DELETE confirm 校验):archive:<uid>:<ts>
function extractTs(archiveKey) {
    // archiveKey 形如 archive:alice:20260518_123456
    const parts = archiveKey.split(':');
    if (parts.length < 3) return null;
    return parts[parts.length - 1];
}

// 校验 archiveKey 格式:archive:<uid>:<ts>(只有 3 段)
function isValidArchiveKey(key) {
    if (!key || typeof key !== 'string') return false;
    if (!key.startsWith(ARCHIVE_PREFIX)) return false;
    const parts = key.split(':');
    if (parts.length !== 3) return false;
    // ts 必须是 YYYYMMDD_HHMMSS 格式
    if (!/^\d{8}_\d{6}$/.test(parts[2])) return false;
    return true;
}

// ───────────── GET ─────────────
export async function onRequestGet({ request, env }) {
    const fail = await requireAdmin(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const url = new URL(request.url);
    const key = url.searchParams.get('key');

    // ── 1. 单条详情 ──
    if (key) {
        if (!isValidArchiveKey(key)) {
            return jsonResponse({ ok: false, error: '无效的 archive key' }, 400);
        }
        const metaRaw = await env.FAV_KV.get(key + ':meta');
        if (metaRaw == null) {
            return jsonResponse({ ok: false, error: '归档不存在' }, 404);
        }
        let meta;
        try { meta = JSON.parse(metaRaw); }
        catch { return jsonResponse({ ok: false, error: '归档 meta 损坏' }, 500); }

        // 列出该归档的所有 backup
        const backupListing = await env.FAV_KV.list({ prefix: key + ':backup:' });
        const backupNames = backupListing.keys.map(k => {
            return k.name.substring((key + ':backup:').length);
        });

        const include = url.searchParams.get('include');
        const full = include === 'full';

        // 检查 data / source 是否还在(同时若 full 则读内容)
        const [dataVal, sourceVal] = await Promise.all([
            env.FAV_KV.get(key + ':data'),
            env.FAV_KV.get(key + ':source')
        ]);
        const hasData = dataVal != null;
        const hasSource = sourceVal != null;

        if (!full) {
            return jsonResponse({
                ok: true,
                archiveKey: key,
                meta,
                hasData,
                hasSource,
                backups: backupNames
            });
        }

        // full 模式:批量读所有 backup 内容
        const backupsContent = {};
        const BATCH = 10;
        for (let i = 0; i < backupListing.keys.length; i += BATCH) {
            const batch = backupListing.keys.slice(i, i + BATCH);
            const results = await Promise.all(batch.map(async k => {
                const content = await env.FAV_KV.get(k.name);
                const bts = k.name.substring((key + ':backup:').length);
                return { bts, content };
            }));
            for (const r of results) {
                if (r.content != null) backupsContent[r.bts] = r.content;
            }
        }

        return jsonResponse({
            ok: true,
            archiveKey: key,
            meta,
            hasData,
            hasSource,
            data: dataVal,
            source: sourceVal,
            backups: backupNames,
            backupsContent
        });
    }

    // ── 2. 列表 ──
    const listing = await env.FAV_KV.list({ prefix: ARCHIVE_PREFIX });
    // 只取 :meta 后缀的 key,代表一条归档
    const metaKeys = listing.keys
        .map(k => k.name)
        .filter(name => name.endsWith(':meta'));

    // 批量读 meta(每批 10 条避免单次 Promise.all 打爆)
    const archives = [];
    const BATCH = 10;
    for (let i = 0; i < metaKeys.length; i += BATCH) {
        const batch = metaKeys.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(async mk => {
            try {
                const raw = await env.FAV_KV.get(mk);
                if (raw == null) return null;
                const meta = JSON.parse(raw);
                // archiveKey 是 meta key 去掉 ':meta' 后缀
                const archiveKey = mk.substring(0, mk.length - ':meta'.length);
                return {
                    archiveKey,
                    username: meta.username || null,
                    uid: meta.uid || null,
                    archivedAt: meta.archivedAt || null,
                    archivedAtLocal: meta.archivedAtLocal || null,
                    archivedBy: meta.archivedBy || null,
                    dataSize: meta.dataSize || 0,
                    backupCount: meta.backupCount || 0,
                    role: meta.role || null
                };
            } catch {
                return null;
            }
        }));
        for (const r of results) if (r) archives.push(r);
    }

    // 按 archivedAt 倒序(最新归档在前)
    archives.sort((a, b) => {
        const ta = a.archivedAtLocal || '';
        const tb = b.archivedAtLocal || '';
        return tb.localeCompare(ta);
    });

    return jsonResponse({
        ok: true,
        count: archives.length,
        archives
    });
}

// ───────────── DELETE ─────────────
export async function onRequestDelete({ request, env }) {
    const fail = await requireAdmin(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    const confirm = url.searchParams.get('confirm') || '';

    if (!isValidArchiveKey(key)) {
        return jsonResponse({ ok: false, error: '无效的 archive key' }, 400);
    }

    const ts = extractTs(key);
    if (!ts) {
        return jsonResponse({ ok: false, error: '无法从 key 提取 ts' }, 400);
    }
    const expectedConfirm = 'DELETE-ARCHIVE-' + ts;
    if (confirm !== expectedConfirm) {
        return jsonResponse({
            ok: false,
            error: 'confirm 字段必须为 ' + expectedConfirm
        }, 400);
    }

    // 确认归档存在(meta 还在)
    const metaRaw = await env.FAV_KV.get(key + ':meta');
    if (metaRaw == null) {
        return jsonResponse({ ok: false, error: '归档不存在' }, 404);
    }

    // 列出该归档的所有 key(meta + data + source + backup:*)
    const listing = await env.FAV_KV.list({ prefix: key + ':' });

    // 批量删除
    const errors = [];
    let deletedCount = 0;
    const BATCH = 10;
    for (let i = 0; i < listing.keys.length; i += BATCH) {
        const batch = listing.keys.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(async k => {
            try {
                await env.FAV_KV.delete(k.name);
                return { ok: true };
            } catch (e) {
                return { ok: false, key: k.name, error: e.message || String(e) };
            }
        }));
        for (const r of results) {
            if (r.ok) deletedCount++;
            else errors.push({ key: r.key, error: r.error });
        }
    }

    if (errors.length > 0) {
        return jsonResponse({
            ok: false,
            error: '部分 key 删除失败,可重试',
            archiveKey: key,
            deletedCount,
            errors
        }, 500);
    }

    return jsonResponse({
        ok: true,
        archiveKey: key,
        deletedCount
    });
}
