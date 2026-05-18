// GET    /api/users                                                → 列出所有用户（仅 admin，脱敏）
// POST   /api/users                                                → 创建用户 / 重置密码（仅 admin）
//                                                                    body: { username, password }
// DELETE /api/users?u=xxx                                          → 删除用户（仅 admin，hasData 拒绝走 force）
// DELETE /api/users?u=xxx&force=1&confirm=DELETE-xxx               → 强制删除(D3=B):归档全部数据后再删用户
//
// A0 v2 改造（2026-05-17）：
//   - admin 判定改用 token role（修复 env-admin 登录但 users 表无 admin 条目时 GET 永远 403）
//   - 创建用户用 PBKDF2 + 16B 盐；passHash hex 64 字符
//   - 用户名走 isValidUsername 白名单
//   - 不动 GET / DELETE 的对外 JSON shape；POST 多返回 algo 字段供前端识别
//
// A1-c2 (2026-05-17)：强制删除走 D3=B 永久归档
//   - 归档 KV 命名空间:archive:<uid>:<ts>:meta / :data / :source / :backup:<bts>
//   - 归档成功后才删原始 user:<uid>:* 与 users[uid]
//   - 任何一步失败:停止后续步骤,不删原始,返回 errors(可重试)
//   - confirm 字段必须等于 'DELETE-' + target,前端二次确认
//
// 兼容：老 sha256Hex 写入的 {passHash, role} 条目继续可读（GET 列出），
//      但本端点写入路径已全部用 PBKDF2；老条目在用户首次登录时由 login.js 借机升级。

import {
    requireAdmin,
    jsonResponse,
    getUsername,
    isValidUsername,
    pbkdf2Hex,
    randomSaltB64
} from '../_shared/auth.js';
import { deleteSlugIndex, genUniqueSlug, writeSlugIndex } from '../_shared/slug.js';

const USERS_KEY = 'users';
const PBKDF2_ITER = 100000;

// 北京时间时间戳（与 save.js / comment.js / backups.js / migrate-v2.js 保持一致）
function archiveTimestamp() {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() +
           p(d.getUTCMonth() + 1) +
           p(d.getUTCDate()) + '_' +
           p(d.getUTCHours()) +
           p(d.getUTCMinutes()) +
           p(d.getUTCSeconds());
}

// 列出用户（脱敏）
export async function onRequestGet({ request, env }) {
    const fail = await requireAdmin(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const raw = await env.FAV_KV.get(USERS_KEY);
    const users = raw ? JSON.parse(raw) : {};

    const list = Object.entries(users).map(([u, info]) => ({
        username: u,
        role: info.role || 'user',
        status: info.status || 'active',
        hasData: !!info.hasData,
        algo: info.salt ? 'pbkdf2' : 'sha256',   // 帮助前端识别哪些用户尚未升级
        createdAt: info.createdAt || null,
        publicSlug: info.publicSlug || '',
        publicEnabled: info.publicEnabled === true
    }));
    return jsonResponse({ ok: true, users: list });
}

// POST 路径多功能(按 action 查询参数分发):
//   POST /api/users                                                → 创建用户 / 重置密码(body: {username, password})
//   POST /api/users?action=cleanup-after-archive&u=alice&archiveKey=archive:alice:<ts>
//                                                                  → 只清理 user:* + users 表条目,前置:归档必须存在且 username 匹配
export async function onRequestPost({ request, env }) {
    const fail = await requireAdmin(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const currentUser = await getUsername(request, env);

    // ── 分支:cleanup-after-archive ──
    const url = new URL(request.url);
    if (url.searchParams.get('action') === 'cleanup-after-archive') {
        const target = url.searchParams.get('u');
        const archiveKey = url.searchParams.get('archiveKey') || '';
        if (!target || !isValidUsername(target)) {
            return jsonResponse({ ok: false, error: '无效的 u 参数' }, 400);
        }
        if (target === currentUser) {
            return jsonResponse({ ok: false, error: '不能清理自己的数据' }, 400);
        }
        // 校验 archiveKey 格式与归档存在性
        if (!/^archive:[A-Za-z0-9_\-\.]{1,32}:\d{8}_\d{6}$/.test(archiveKey)) {
            return jsonResponse({ ok: false, error: '无效的 archiveKey' }, 400);
        }
        const metaRaw = await env.FAV_KV.get(archiveKey + ':meta');
        if (metaRaw == null) {
            return jsonResponse({ ok: false, error: '归档不存在,不能清理(必须先归档)' }, 404);
        }
        let meta;
        try { meta = JSON.parse(metaRaw); }
        catch { return jsonResponse({ ok: false, error: '归档 meta 损坏' }, 500); }
        if (meta.username !== target) {
            return jsonResponse({ ok: false, error: 'archiveKey 与 u 参数用户不匹配' }, 400);
        }

        // 清理 user:<target>:* 全部 KV
        const ns = 'user:' + target + ':';
        const userListing = await env.FAV_KV.list({ prefix: ns });
        const cleanupErrors = [];
        for (const k of userListing.keys) {
            try { await env.FAV_KV.delete(k.name); }
            catch (e) { cleanupErrors.push({ key: k.name, error: e.message || String(e) }); }
        }

        // 清理 users[target]
        const rawU = await env.FAV_KV.get(USERS_KEY);
        const usersTab = rawU ? JSON.parse(rawU) : {};
        let slugToRelease = '';
        if (usersTab[target]) {
            slugToRelease = usersTab[target].publicSlug || '';
            delete usersTab[target];
            try { await env.FAV_KV.put(USERS_KEY, JSON.stringify(usersTab)); }
            catch (e) { cleanupErrors.push({ step: 'users table', error: e.message || String(e) }); }
        }

        // 释放 slug 反向索引(A1.5)
        if (slugToRelease) {
            try { await deleteSlugIndex(env, slugToRelease); }
            catch (e) { cleanupErrors.push({ step: 'slug index', error: e.message || String(e) }); }
        }

        return jsonResponse({
            ok: true,
            cleaned: target,
            archiveKey,
            cleanupErrors: cleanupErrors.length > 0 ? cleanupErrors : undefined
        });
    }

    // ── 默认分支:创建用户 / 重置密码 ──
    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

    const { username, password } = body || {};
    if (!isValidUsername(username)) {
        return jsonResponse({
            ok: false,
            error: '用户名只能包含字母、数字、下划线、连字符和点，长度 1-32'
        }, 400);
    }
    if (!password || typeof password !== 'string' || password.length < 4) {
        return jsonResponse({ ok: false, error: '密码至少 4 位' }, 400);
    }

    const raw = await env.FAV_KV.get(USERS_KEY);
    const users = raw ? JSON.parse(raw) : {};

    const isNew = !users[username];

    try {
        const salt = randomSaltB64(16);
        const passHash = await pbkdf2Hex(password, salt, PBKDF2_ITER);
        const nowIso = new Date().toISOString();

        if (isNew) {
            // A1.5 增强 B:自动生成默认 slug 并开启公开访问
            // 失败不阻塞用户创建,仅 console.warn(用户可后续手动设置)
            let autoSlug = '';
            try {
                autoSlug = await genUniqueSlug(env, username, 'admin');
                if (autoSlug) {
                    await writeSlugIndex(env, autoSlug, username);
                }
            } catch (slugErr) {
                console.warn('auto slug gen failed for', username, slugErr && slugErr.message);
                autoSlug = '';
            }

            users[username] = {
                passHash,
                salt,
                iter: PBKDF2_ITER,
                role: 'user',
                status: 'active',
                createdAt: nowIso,
                createdBy: currentUser || '__unknown__',
                hasData: false,
                publicSlug: autoSlug,
                publicEnabled: !!autoSlug
            };
        } else {
            // 重置密码：保留 role / status / createdAt / hasData，只换密码字段
            const old = users[username];
            users[username] = {
                ...old,
                passHash,
                salt,
                iter: PBKDF2_ITER,
                role: old.role || 'user',
                status: old.status || 'active'
            };
        }

        await env.FAV_KV.put(USERS_KEY, JSON.stringify(users));
        return jsonResponse({
            ok: true,
            created: isNew,
            username,
            algo: 'pbkdf2',
            note: isNew ? '用户已创建' : '密码已重置'
        });
    } catch (e) {
        // 捕获 PBKDF2 / KV put / 其他运行时异常,避免 Cloudflare 返回 1101 HTML 错误页
        // 失败时把异常信息原样回前端,方便排错(异常 message 不含敏感数据)
        const msg = (e && (e.message || e.name)) || String(e);
        console.warn('users.POST failed:', msg, e && e.stack);
        return jsonResponse({
            ok: false,
            error: '创建用户/重置密码失败: ' + msg,
            where: 'users.POST',
            isNew
        }, 500);
    }
}

// 删除用户
//   普通: DELETE /api/users?u=alice            → hasData=false 才直接删;hasData=true 返回 409 + requiresForce
//   强制: DELETE /api/users?u=alice&force=1&confirm=DELETE-alice
//         → 归档 user:<uid>:* 全部 KV 到 archive:<uid>:<ts>:* 后删原始
//   强制(2 阶段-阶段 1): DELETE /api/users?u=alice&force=1&confirm=DELETE-alice&action=archive-only
//         → 只归档,不清理 user:* / users 表;返回 archiveKey 供前端下载;清理走 cleanup-after-archive
export async function onRequestDelete({ request, env }) {
    const fail = await requireAdmin(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const currentUser = await getUsername(request, env);

    const url = new URL(request.url);
    const target = url.searchParams.get('u');
    const force = url.searchParams.get('force') === '1';
    const confirm = url.searchParams.get('confirm') || '';
    const action = url.searchParams.get('action') || '';   // archive-only | (空=归档+清理)

    if (!target) return jsonResponse({ ok: false, error: '缺少参数 u' }, 400);
    if (!isValidUsername(target)) {
        return jsonResponse({ ok: false, error: '无效的用户名格式' }, 400);
    }
    if (target === currentUser) {
        return jsonResponse({ ok: false, error: '不能删除自己' }, 400);
    }

    const raw = await env.FAV_KV.get(USERS_KEY);
    const users = raw ? JSON.parse(raw) : {};
    if (!users[target]) {
        return jsonResponse({ ok: false, error: '用户不存在' }, 404);
    }

    // 没数据 → 直接硬删(同 A0 路径)
    if (!users[target].hasData) {
        const slugToRelease = users[target].publicSlug || '';
        delete users[target];
        await env.FAV_KV.put(USERS_KEY, JSON.stringify(users));
        if (slugToRelease) await deleteSlugIndex(env, slugToRelease);
        return jsonResponse({ ok: true, deleted: target });
    }

    // 有数据 → 必须走 force 路径
    if (!force) {
        return jsonResponse({
            ok: false,
            error: '该用户已存数据，需通过强制删除流程归档',
            requiresForce: true
        }, 409);
    }

    // force 路径:校验 confirm
    if (confirm !== 'DELETE-' + target) {
        return jsonResponse({
            ok: false,
            error: 'confirm 字段必须为 DELETE-' + target
        }, 400);
    }

    // ───── 归档阶段 ─────
    // 1. 列出 user:<uid>:* 全部 KV
    const ns = 'user:' + target + ':';
    const userListing = await env.FAV_KV.list({ prefix: ns });

    const ts = archiveTimestamp();
    const archPrefix = 'archive:' + target + ':' + ts + ':';
    const errors = [];
    const archivedKeys = [];  // 已写入的归档 key,失败时不回滚(KV 无事务,但失败重试是幂等的 — 同 ts 会覆盖)

    // 2. 拷贝 data_js
    let dataSize = 0;
    try {
        const dataVal = await env.FAV_KV.get(ns + 'data_js');
        if (dataVal != null) {
            dataSize = dataVal.length;
            await env.FAV_KV.put(archPrefix + 'data', dataVal);
            archivedKeys.push(archPrefix + 'data');
        }
    } catch (e) {
        errors.push({ step: 'data_js', error: e.message || String(e) });
    }

    // 3. 拷贝 data_source(可选)
    if (errors.length === 0) {
        try {
            const sourceVal = await env.FAV_KV.get(ns + 'data_source');
            if (sourceVal != null) {
                await env.FAV_KV.put(archPrefix + 'source', sourceVal);
                archivedKeys.push(archPrefix + 'source');
            }
        } catch (e) {
            errors.push({ step: 'data_source', error: e.message || String(e) });
        }
    }

    // 4. 拷贝 backup:*(批量,失败汇总)
    let backupCount = 0;
    let backupFailed = 0;
    if (errors.length === 0) {
        const backupKeys = userListing.keys
            .map(k => k.name)
            .filter(name => name.startsWith(ns + 'backup:'));
        const BATCH = 10;
        for (let i = 0; i < backupKeys.length; i += BATCH) {
            const batch = backupKeys.slice(i, i + BATCH);
            const results = await Promise.all(batch.map(async (oldKey) => {
                try {
                    const bts = oldKey.substring((ns + 'backup:').length);
                    const content = await env.FAV_KV.get(oldKey);
                    if (content == null) return { ok: false, reason: 'disappeared', key: oldKey };
                    await env.FAV_KV.put(archPrefix + 'backup:' + bts, content);
                    return { ok: true };
                } catch (e) {
                    return { ok: false, reason: e.message || String(e), key: oldKey };
                }
            }));
            for (const r of results) {
                if (r.ok) backupCount++;
                else {
                    backupFailed++;
                    errors.push({ step: r.key, error: r.reason });
                }
            }
        }
    }

    // 5. 写 meta(成功的前提下)
    if (errors.length === 0) {
        try {
            const meta = {
                username: target,
                uid: target,
                role: users[target].role || 'user',
                archivedAt: new Date().toISOString(),
                archivedAtLocal: ts,
                archivedBy: currentUser || '__unknown__',
                dataSize,
                backupCount,
                originalCreatedAt: users[target].createdAt || null,
                originalCreatedBy: users[target].createdBy || null,
                publicSlug: users[target].publicSlug || null,
                publicEnabled: users[target].publicEnabled === true
            };
            await env.FAV_KV.put(archPrefix + 'meta', JSON.stringify(meta));
            archivedKeys.push(archPrefix + 'meta');
        } catch (e) {
            errors.push({ step: 'meta', error: e.message || String(e) });
        }
    }

    // 任何步骤失败 → 不删原始,返回错误供前端重试
    if (errors.length > 0) {
        return jsonResponse({
            ok: false,
            error: '归档过程失败,原始数据未删除,可重试',
            archivedKeys,
            errors,
            archiveKey: archPrefix.slice(0, -1)
        }, 500);
    }

    // archive-only 模式:归档完成即返回,不清理 user:* / users 表(交给 cleanup-after-archive 第二阶段)
    if (action === 'archive-only') {
        return jsonResponse({
            ok: true,
            archived: true,
            cleaned: false,
            archiveKey: archPrefix.slice(0, -1),
            archiveTs: ts,
            dataSize,
            backupCount,
            username: target
        });
    }

    // ───── 清理阶段 ─────
    // 6. 删原始 user:<uid>:* 所有 key(data_js/source/backup:*)
    const cleanupErrors = [];
    for (const k of userListing.keys) {
        try {
            await env.FAV_KV.delete(k.name);
        } catch (e) {
            cleanupErrors.push({ key: k.name, error: e.message || String(e) });
        }
    }

    // 7. 删 users[target] 条目
    const slugToRelease = users[target].publicSlug || '';
    delete users[target];
    try {
        await env.FAV_KV.put(USERS_KEY, JSON.stringify(users));
    } catch (e) {
        cleanupErrors.push({ step: 'users table', error: e.message || String(e) });
    }

    // 8. 释放 slug 反向索引(A1.5)
    if (slugToRelease) {
        try { await deleteSlugIndex(env, slugToRelease); }
        catch (e) { cleanupErrors.push({ step: 'slug index', error: e.message || String(e) }); }
    }

    return jsonResponse({
        ok: true,
        deleted: target,
        archived: true,
        cleaned: true,
        archiveKey: archPrefix.slice(0, -1),
        archiveTs: ts,
        dataSize,
        backupCount,
        cleanupErrors: cleanupErrors.length > 0 ? cleanupErrors : undefined
    });
}
