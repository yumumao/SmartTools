// /api/public-slug  — 公开访问 slug 的管理端点(A1.5)
//
// GET    /api/public-slug?u=alice
//        → 查询某用户的 slug + enabled 状态;admin 可查任何人,user 只能查自己
//
// POST   /api/public-slug
//        body: { username, slug, enabled }
//        → 设置 / 修改 slug;admin 可改任何人,user 只能改自己
//        - enabled=true 时 slug 必须合法且未被占用,会写入反向索引
//        - enabled=false 时 slug 可保留(供再次开启),但反向索引被释放
//        - slug 改名时:先写新索引 → 再删旧索引(确保两边不同时缺失)
//
// DELETE /api/public-slug?u=alice
//        → 关闭公开访问 + 释放 slug;admin 可删任何人,user 只能删自己
//
// 权限模型(getRole + payload.uid):
//   admin              → 可操作任何用户
//   user (uid==target) → 可操作自己
//   user (uid!=target) → 403
//   未登录             → 401

import {
    jsonResponse,
    getPayload,
    getSecret,
    getCookieToken,
    verifyToken,
    isValidUsername
} from '../_shared/auth.js';
import {
    isValidSlug,
    isReservedSlug,
    lookupSlugUid,
    writeSlugIndex,
    deleteSlugIndex
} from '../_shared/slug.js';

const USERS_KEY = 'users';

// 鉴权 + 权限判定:返回 { payload, target, isAdmin } 或 Response(出错时)
async function authorizeAndResolveTarget(request, env, targetUsername) {
    const secret = getSecret(env);
    if (!secret) {
        return jsonResponse({ ok: false, error: '服务端未配置 AUTH_SECRET,请联系管理员' }, 500);
    }
    const token = getCookieToken(request);
    const payload = await verifyToken(token, secret);
    if (!payload) {
        return jsonResponse({ ok: false, error: '未登录或会话已过期' }, 401);
    }
    const role = payload.role
        || (env && env.ADMIN_USER && payload.u === env.ADMIN_USER ? 'admin' : 'user');
    const myUid = payload.uid != null ? payload.uid : payload.u;
    if (!isValidUsername(targetUsername)) {
        return jsonResponse({ ok: false, error: '无效的用户名格式' }, 400);
    }
    const isAdmin = role === 'admin';
    if (!isAdmin && myUid !== targetUsername) {
        return jsonResponse({ ok: false, error: '仅管理员可操作他人的公开链接' }, 403);
    }
    return { payload, target: targetUsername, isAdmin, myUid };
}

// 从 KV 读 users 表,返回 [users, user]。user 不存在时返回 [users, null]。
async function readUserEntry(env, target) {
    const raw = await env.FAV_KV.get(USERS_KEY);
    const users = raw ? JSON.parse(raw) : {};
    return [users, users[target] || null];
}

export async function onRequestGet({ request, env }) {
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);
    const url = new URL(request.url);
    const target = url.searchParams.get('u');
    if (!target) return jsonResponse({ ok: false, error: '缺少参数 u' }, 400);

    const auth = await authorizeAndResolveTarget(request, env, target);
    if (auth instanceof Response) return auth;

    const [, user] = await readUserEntry(env, target);
    if (!user) return jsonResponse({ ok: false, error: '用户不存在' }, 404);

    return jsonResponse({
        ok: true,
        username: target,
        slug: user.publicSlug || '',
        enabled: user.publicEnabled === true
    });
}

export async function onRequestPost({ request, env }) {
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

    const target = body && body.username;
    const newSlugRaw = body && body.slug;
    const newSlug = typeof newSlugRaw === 'string' ? newSlugRaw.trim().toLowerCase() : '';
    const enabled = !!(body && body.enabled);

    const auth = await authorizeAndResolveTarget(request, env, target);
    if (auth instanceof Response) return auth;
    // 调用者角色决定 slug 长度规则:admin 宽松(1-32)/ user 严格(3-32)
    const callerRole = auth.isAdmin ? 'admin' : 'user';
    const minLen = auth.isAdmin ? 1 : 3;

    // slug 格式 / 保留词校验(enabled=true 时强制;enabled=false 时 slug 可空)
    if (enabled) {
        if (!isValidSlug(newSlug, callerRole)) {
            return jsonResponse({
                ok: false,
                error: 'slug 不合法:首字符必须字母/数字,允许 a-z 0-9 _ -,长度 ' + minLen + '-32'
            }, 400);
        }
        if (isReservedSlug(newSlug)) {
            return jsonResponse({
                ok: false,
                error: '该 slug 是保留词,请换一个'
            }, 400);
        }
    } else if (newSlug && !isValidSlug(newSlug, callerRole)) {
        // 禁用但又给了一个不合法的 slug → 拒绝(避免脏数据写入)
        return jsonResponse({
            ok: false,
            error: 'slug 不合法(即使禁用也需通过格式校验或清空)'
        }, 400);
    }

    const [users, user] = await readUserEntry(env, target);
    if (!user) return jsonResponse({ ok: false, error: '用户不存在' }, 404);

    const oldSlug = user.publicSlug || '';

    // 唯一性检查:新 slug 已存在且不属于 target → 冲突
    if (enabled && newSlug && newSlug !== oldSlug) {
        const occupantUid = await lookupSlugUid(env, newSlug);
        if (occupantUid && occupantUid !== target) {
            return jsonResponse({
                ok: false,
                error: '该 slug 已被占用',
                conflict: true
            }, 409);
        }
    }

    try {
        // 先写反向索引(enabled=true 才写)
        if (enabled && newSlug) {
            await writeSlugIndex(env, newSlug, target);
        }

        // 再写 users 表
        users[target] = {
            ...user,
            publicSlug: newSlug || '',
            publicEnabled: enabled && !!newSlug
        };
        await env.FAV_KV.put(USERS_KEY, JSON.stringify(users));

        // 最后释放旧反向索引(只有在 slug 改名 或 enabled=false 时)
        if (oldSlug && oldSlug !== newSlug) {
            await deleteSlugIndex(env, oldSlug);
        } else if (!enabled && oldSlug) {
            await deleteSlugIndex(env, oldSlug);
        }

        return jsonResponse({
            ok: true,
            username: target,
            slug: newSlug || '',
            enabled: enabled && !!newSlug,
            previousSlug: oldSlug || null
        });
    } catch (e) {
        const msg = (e && (e.message || e.name)) || String(e);
        console.warn('public-slug.POST failed:', msg, e && e.stack);
        return jsonResponse({
            ok: false,
            error: '写入失败: ' + msg,
            where: 'public-slug.POST'
        }, 500);
    }
}

export async function onRequestDelete({ request, env }) {
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);
    const url = new URL(request.url);
    const target = url.searchParams.get('u');
    if (!target) return jsonResponse({ ok: false, error: '缺少参数 u' }, 400);

    const auth = await authorizeAndResolveTarget(request, env, target);
    if (auth instanceof Response) return auth;

    const [users, user] = await readUserEntry(env, target);
    if (!user) return jsonResponse({ ok: false, error: '用户不存在' }, 404);

    const oldSlug = user.publicSlug || '';
    try {
        users[target] = {
            ...user,
            publicSlug: '',
            publicEnabled: false
        };
        await env.FAV_KV.put(USERS_KEY, JSON.stringify(users));
        if (oldSlug) await deleteSlugIndex(env, oldSlug);
        return jsonResponse({
            ok: true,
            username: target,
            cleared: true,
            previousSlug: oldSlug || null
        });
    } catch (e) {
        const msg = (e && (e.message || e.name)) || String(e);
        console.warn('public-slug.DELETE failed:', msg, e && e.stack);
        return jsonResponse({
            ok: false,
            error: '清除失败: ' + msg,
            where: 'public-slug.DELETE'
        }, 500);
    }
}
