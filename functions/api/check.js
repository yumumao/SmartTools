// GET /api/check  → 返回当前会话状态与服务端配置概览
//
// A0 v2 改造（2026-05-17）：新增 uid / role / migrationNeeded 字段
//   - username 字段保持不变（A0 阶段 config.html 仍依赖它）
//   - role 从 token 取，老 token 兼容时按 ADMIN_USER 推断
//   - migrationNeeded = 老 KV 有 data 但 migration:v2:done 标记缺失
//   - A0 阶段前端不消费 migrationNeeded，A1 才会真用；后端先输出避免日后再加字段

import { getCookieToken, verifyToken, getSecret, jsonResponse, getRole } from '../_shared/auth.js';

const MIGRATION_DONE_KEY = 'migration:v2:done';
const OLD_DATA_KEY = 'data_js';

export async function onRequestGet({ request, env }) {
    const secret = getSecret(env);
    if (!secret) {
        return jsonResponse({
            ok: true,
            loggedIn: false,
            username: null,
            uid: null,
            role: null,
            hasKV: !!env.FAV_KV,
            hasAdmin: !!(env.ADMIN_USER && env.ADMIN_PASS),
            migrationNeeded: false,
            error: 'AUTH_SECRET 未配置'
        });
    }

    const token = getCookieToken(request);
    const payload = await verifyToken(token, secret);
    const role = payload ? await getRole(request, env) : null;
    const uid  = payload ? (payload.uid != null ? payload.uid : payload.u) : null;

    // 迁移检测：仅在 KV 绑定时判断
    //   migrationNeeded = true 当且仅当 老 data_js 存在 && migration:v2:done 缺失
    //   只读两个 key,不影响登录路径性能
    let migrationNeeded = false;
    if (env.FAV_KV) {
        try {
            const [done, oldData] = await Promise.all([
                env.FAV_KV.get(MIGRATION_DONE_KEY),
                env.FAV_KV.get(OLD_DATA_KEY)
            ]);
            migrationNeeded = !done && !!oldData;
        } catch {
            // KV 异常时静默,不阻断 check 主响应
        }
    }

    return jsonResponse({
        ok: true,
        loggedIn: !!payload,
        username: payload ? payload.u : null,
        uid,
        role,
        hasKV: !!env.FAV_KV,
        hasAdmin: !!(env.ADMIN_USER && env.ADMIN_PASS),
        migrationNeeded
    });
}
