// POST /api/migrate-v2  → 把老 KV 命名空间迁移到 admin: 前缀
//   body: { dryRun: true|false }  默认 false
//   admin only
//
// 设计原则（A0 v2-3 + v2-9）：
//   - 幂等：admin:* 已存在则跳过对应项
//   - 老 key 不删（保留 30 天回滚窗口）
//   - dryRun 模式只汇报"会迁移什么"，不写
//   - 写入 migration:v2:done = <UTC+8 时间戳> 标志
//   - 任何中途失败都不破坏已迁移项；可重试

import { requireAdmin, jsonResponse } from '../_shared/auth.js';

const OLD_DATA_KEY    = 'data_js';
const OLD_SOURCE_KEY  = 'data_source';
const OLD_BACKUP_PREF = 'backup:';

const NEW_DATA_KEY    = 'admin:data_js';
const NEW_SOURCE_KEY  = 'admin:data_source';
const NEW_BACKUP_PREF = 'admin:backup:';

const MIGRATION_DONE_KEY = 'migration:v2:done';

// 北京时间时间戳（与 save.js / comment.js / backups.js 保持一致）
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

export async function onRequestPost({ request, env }) {
    // 1. 鉴权
    const fail = await requireAdmin(request, env);
    if (fail) return fail;

    if (!env.FAV_KV) {
        return jsonResponse({ ok: false, error: '未绑定 KV(FAV_KV)' }, 500);
    }

    // 2. 解析参数
    let body = {};
    try { body = await request.json(); } catch { /* 允许空 body */ }
    const dryRun = body && body.dryRun === true;

    // 3. 计划阶段：读取所有需要操作的 key
    //    幂等性：每项操作前都检查"新 key 是否已存在"
    const plan = {
        dryRun,
        dataJs:     { old: OLD_DATA_KEY,   new: NEW_DATA_KEY,   action: 'skip', reason: '' },
        dataSource: { old: OLD_SOURCE_KEY, new: NEW_SOURCE_KEY, action: 'skip', reason: '' },
        backups:    []   // [{ old, new, action, reason }]
    };

    // 3a. data_js
    {
        const [oldVal, newVal] = await Promise.all([
            env.FAV_KV.get(OLD_DATA_KEY),
            env.FAV_KV.get(NEW_DATA_KEY)
        ]);
        if (newVal != null) {
            plan.dataJs.action = 'skip';
            plan.dataJs.reason = 'admin:data_js already exists';
        } else if (oldVal == null) {
            plan.dataJs.action = 'skip';
            plan.dataJs.reason = 'no legacy data_js to migrate';
        } else {
            plan.dataJs.action = 'copy';
            plan.dataJs.bytes = oldVal.length;
            // 真执行时使用：把 oldVal 暂存在 plan，避免再读一次
            plan.dataJs._payload = oldVal;
        }
    }

    // 3b. data_source
    {
        const [oldVal, newVal] = await Promise.all([
            env.FAV_KV.get(OLD_SOURCE_KEY),
            env.FAV_KV.get(NEW_SOURCE_KEY)
        ]);
        if (newVal != null) {
            plan.dataSource.action = 'skip';
            plan.dataSource.reason = 'admin:data_source already exists';
        } else if (oldVal == null) {
            plan.dataSource.action = 'skip';
            plan.dataSource.reason = 'no legacy data_source to migrate';
        } else {
            plan.dataSource.action = 'copy';
            plan.dataSource.value = oldVal;
            plan.dataSource._payload = oldVal;
        }
    }

    // 3c. backup:* - 列出所有老备份
    {
        const oldList = await env.FAV_KV.list({ prefix: OLD_BACKUP_PREF });
        // 列出新备份用于幂等检查
        const newList = await env.FAV_KV.list({ prefix: NEW_BACKUP_PREF });
        const newSet = new Set(newList.keys.map(k => k.name));

        for (const k of oldList.keys) {
            const ts = k.name.substring(OLD_BACKUP_PREF.length); // 提取时间戳部分
            const newKey = NEW_BACKUP_PREF + ts;
            if (newSet.has(newKey)) {
                plan.backups.push({ old: k.name, new: newKey, action: 'skip', reason: 'already exists' });
            } else {
                plan.backups.push({ old: k.name, new: newKey, action: 'copy' });
            }
        }
    }

    // 4. 干跑 → 只返回计划
    if (dryRun) {
        // 清理 _payload（不要泄漏数据内容到响应）
        const cleanPlan = JSON.parse(JSON.stringify(plan, (k, v) => k === '_payload' ? undefined : v));
        const wouldCopy = countCopy(cleanPlan);
        return jsonResponse({
            ok: true,
            dryRun: true,
            wouldCopy,
            plan: cleanPlan
        });
    }

    // 5. 真执行
    const errors = [];
    const result = {
        dataJs:     plan.dataJs.action === 'skip' ? 'skip' : 'pending',
        dataSource: plan.dataSource.action === 'skip' ? 'skip' : 'pending',
        backups:    { total: plan.backups.length, copied: 0, skipped: 0, failed: 0 }
    };

    // 5a. 复制 data_js
    if (plan.dataJs.action === 'copy') {
        try {
            await env.FAV_KV.put(NEW_DATA_KEY, plan.dataJs._payload);
            result.dataJs = 'copied';
        } catch (e) {
            result.dataJs = 'failed';
            errors.push({ step: 'data_js', error: e.message || String(e) });
        }
    }

    // 5b. 复制 data_source
    if (plan.dataSource.action === 'copy') {
        try {
            await env.FAV_KV.put(NEW_SOURCE_KEY, plan.dataSource._payload);
            result.dataSource = 'copied';
        } catch (e) {
            result.dataSource = 'failed';
            errors.push({ step: 'data_source', error: e.message || String(e) });
        }
    }

    // 5c. 批量复制 backup:*
    //     批次大小 10，避免单次 Promise.all 把 KV 打爆。
    //     单个失败不阻断其他备份的迁移。
    {
        const toCopy = plan.backups.filter(b => b.action === 'copy');
        result.backups.skipped = plan.backups.length - toCopy.length;
        const BATCH = 10;
        for (let i = 0; i < toCopy.length; i += BATCH) {
            const batch = toCopy.slice(i, i + BATCH);
            const results = await Promise.all(batch.map(async b => {
                try {
                    const content = await env.FAV_KV.get(b.old);
                    if (content == null) {
                        return { name: b.old, ok: false, reason: 'disappeared' };
                    }
                    await env.FAV_KV.put(b.new, content);
                    return { name: b.old, ok: true };
                } catch (e) {
                    return { name: b.old, ok: false, reason: e.message || String(e) };
                }
            }));
            for (const r of results) {
                if (r.ok) result.backups.copied++;
                else {
                    result.backups.failed++;
                    errors.push({ step: 'backup:' + r.name, error: r.reason });
                }
            }
        }
    }

    // 6. 写迁移完成标记
    //    只在没有失败时写；有失败时不写，调用方可以再调一次幂等补齐
    const allOk = errors.length === 0;
    if (allOk) {
        try {
            await env.FAV_KV.put(MIGRATION_DONE_KEY, timestamp());
        } catch (e) {
            errors.push({ step: 'migration_done_marker', error: e.message || String(e) });
        }
    }

    return jsonResponse({
        ok: allOk,
        dryRun: false,
        result,
        errors,
        markerWritten: allOk && errors.length === 0,
        note: allOk
            ? '迁移完成。老 key 保留作为回滚路径，不会自动删除。'
            : '部分项失败，请检查 errors 后重试。本次未写 migration:v2:done。'
    });
}

function countCopy(plan) {
    let n = 0;
    if (plan.dataJs.action === 'copy') n++;
    if (plan.dataSource.action === 'copy') n++;
    n += plan.backups.filter(b => b.action === 'copy').length;
    return n;
}
