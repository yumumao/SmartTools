import { requireAuth, jsonResponse, getPayload } from '../_shared/auth.js';

/* ================================================================================
 * /api/comment —— 单条卡片 comment 字段的精准 patch
 * ─────────────────────────────────────────────────────────────────────────────
 * A0 v2 改造（2026-05-17）：按身份选 namespace
 *   admin → admin:data_js / admin:data_source / admin:backup:*
 *   user  → user:<uid>:data_js / user:<uid>:data_source / user:<uid>:backup:*
 *          + 写完后 users[uid].hasData = true（best-effort）
 *
 * patchCommentInSource 与源码扫描器完全不变，schema 不动。
 *
 * 请求体（不变）：
 *   {
 *     path:    ['usbDriveData', 3, 'comment'] 或 [...customSections, 'cards', n, ...]
 *     comment: '新内容'        // 空串表示删除该字段
 *   }
 * ================================================================================ */

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

/**
 * 模块作用域 flag：按 namespace 维护。语义同 save.js。
 */
const _sourceConfirmedKv = new Set();

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

    const { path, comment } = body || {};
    if (!Array.isArray(path) || path.length < 2) {
        return jsonResponse({ ok: false, error: '缺少或无效的 path' }, 400);
    }
    if (typeof comment !== 'string') {
        return jsonResponse({ ok: false, error: 'comment 必须是字符串' }, 400);
    }
    if (path[path.length - 1] !== 'comment') {
        return jsonResponse({ ok: false, error: 'path 必须以 comment 结尾' }, 400);
    }

    const old = await env.FAV_KV.get(KEYS.data);
    if (!old) return jsonResponse({ ok: false, error: '数据文件不存在于 KV' }, 404);

    let patched;
    try {
        patched = patchCommentInSource(old, path, comment);
    } catch (e) {
        return jsonResponse({ ok: false, error: '定位/修改失败: ' + (e.message || e) }, 400);
    }

    if (patched === old) {
        return jsonResponse({ ok: true, unchanged: true, backup: null, namespace: ns });
    }

    // 备份旧版本
    let backupName = null;
    if (old.trim()) {
        backupName = KEYS.backupP + timestamp();
        await env.FAV_KV.put(backupName, old);
        if (Math.random() < PRUNE_PROBABILITY) {
            try { await pruneBackups(env.FAV_KV, KEYS.backupP); } catch {}
        }
    }

    // 主数据写入 + SOURCE_KEY 自动激活 → 并行
    const writes = [env.FAV_KV.put(KEYS.data, patched)];
    if (!_sourceConfirmedKv.has(ns)) {
        const currentSource = await env.FAV_KV.get(KEYS.source);
        if (currentSource !== 'kv') {
            writes.push(env.FAV_KV.put(KEYS.source, 'kv'));
        }
        _sourceConfirmedKv.add(ns);
    }
    await Promise.all(writes);

    // user 路径：标记 hasData=true（best-effort）
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

    return jsonResponse({ ok: true, backup: backupName, namespace: ns });
}

// 北京时间时间戳（与 save.js 一致）
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

/* ════════════════════════════════════════════════════════════════════════════════
 *  ★ 核心：JS 源码字符串级的 comment 字段 patcher
 *  ────────────────────────────────────────────────────────────────────────────
 *  策略：不用 eval/AST，直接带 token-aware 的线性扫描，遇到目标对象 { ... }
 *        找到 comment 字段就替换/删除；找不到就在末尾插入。
 * ════════════════════════════════════════════════════════════════════════════════ */

function patchCommentInSource(src, path, comment) {
    // ★ 新格式：path = ['sections', sectionIdx, 'cards', cardIdx, ..., 'comment']
    // 兼容老格式：path = ['usbDriveData', cardIdx, ..., 'comment']
    const firstSeg = path[0];

    let pos;
    if (firstSeg === 'sections') {
        // 新格式：从 var sections = [...] 开始
        const varPos = findTopLevelVarDecl(src, 'sections');
        if (varPos < 0) throw new Error('未找到变量 sections');
        const eqPos = src.indexOf('=', varPos);
        if (eqPos < 0) throw new Error('变量声明缺少 =');
        pos = skipWs(src, eqPos + 1);

        // 导航：跳过 path 中的 'sections'（已处理），从 path[1] 开始
        for (let i = 1; i < path.length - 1; i++) {
            const seg = path[i];
            if (typeof seg === 'number') {
                if (src[pos] !== '[') throw new Error('导航第 ' + i + ' 段期望 [，实际: ' + src[pos]);
                pos = enterArrayIndex(src, pos, seg);
            } else if (typeof seg === 'string') {
                if (src[pos] !== '{') throw new Error('导航第 ' + i + ' 段期望 {，实际: ' + src[pos]);
                pos = enterObjectKey(src, pos, seg);
            } else {
                throw new Error('path 段类型错误');
            }
        }
    } else {
        // 老格式：path[0] 是顶级变量名
        const varPos = findTopLevelVarDecl(src, firstSeg);
        if (varPos < 0) throw new Error('未找到变量 ' + firstSeg);
        const eqPos = src.indexOf('=', varPos);
        if (eqPos < 0) throw new Error('变量声明缺少 =');
        pos = skipWs(src, eqPos + 1);

        for (let i = 1; i < path.length - 1; i++) {
            const seg = path[i];
            if (typeof seg === 'number') {
                if (src[pos] !== '[') throw new Error('导航第 ' + i + ' 段期望 [，实际: ' + src[pos]);
                pos = enterArrayIndex(src, pos, seg);
            } else if (typeof seg === 'string') {
                if (src[pos] !== '{') throw new Error('导航第 ' + i + ' 段期望 {，实际: ' + src[pos]);
                pos = enterObjectKey(src, pos, seg);
            } else {
                throw new Error('path 段类型错误');
            }
        }
    }

    if (src[pos] !== '{') throw new Error('目标卡片对象起始不是 {');
    return updateCommentInObject(src, pos, comment);
}

function isWs(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r'; }
function isIdChar(c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_' || c === '$';
}

// 跳过空白 + 注释
function skipWs(src, pos) {
    const n = src.length;
    while (pos < n) {
        const c = src[pos];
        if (isWs(c)) { pos++; continue; }
        if (c === '/' && src[pos + 1] === '/') {
            while (pos < n && src[pos] !== '\n') pos++;
            continue;
        }
        if (c === '/' && src[pos + 1] === '*') {
            pos += 2;
            while (pos + 1 < n && !(src[pos] === '*' && src[pos + 1] === '/')) pos++;
            pos += 2;
            continue;
        }
        break;
    }
    return pos;
}

// 从引号位置跳到字符串结束之后（支持 " ' `，处理 \ 转义）
function skipString(src, pos) {
    const quote = src[pos];
    pos++;
    const n = src.length;
    while (pos < n) {
        const c = src[pos];
        if (c === '\\') { pos += 2; continue; }
        if (c === quote) return pos + 1;
        pos++;
    }
    throw new Error('字符串未闭合 @ ' + pos);
}

// 跳过平衡的 {...} 或 [...]（内部正确处理字符串/注释）
function skipBalanced(src, pos, open, close) {
    if (src[pos] !== open) throw new Error('期望 ' + open);
    pos++;
    let depth = 1;
    const n = src.length;
    while (pos < n && depth > 0) {
        const c = src[pos];
        if (c === '"' || c === "'" || c === '`') { pos = skipString(src, pos); continue; }
        if (c === '/' && src[pos + 1] === '/') {
            while (pos < n && src[pos] !== '\n') pos++;
            continue;
        }
        if (c === '/' && src[pos + 1] === '*') {
            pos += 2;
            while (pos + 1 < n && !(src[pos] === '*' && src[pos + 1] === '/')) pos++;
            pos += 2;
            continue;
        }
        if (c === open) depth++;
        else if (c === close) depth--;
        pos++;
    }
    if (depth !== 0) throw new Error('括号未闭合');
    return pos;
}

// 跳过一个完整 JS 值（对象/数组/字符串/数字/布尔/null 等）
function skipValue(src, pos) {
    pos = skipWs(src, pos);
    const c = src[pos];
    if (c === '{') return skipBalanced(src, pos, '{', '}');
    if (c === '[') return skipBalanced(src, pos, '[', ']');
    if (c === '"' || c === "'" || c === '`') return skipString(src, pos);
    // 字面量：读到分隔符
    const n = src.length;
    while (pos < n) {
        const ch = src[pos];
        if (ch === ',' || ch === '}' || ch === ']') break;
        if (isWs(ch)) break;
        if (ch === '/' && (src[pos + 1] === '/' || src[pos + 1] === '*')) break;
        pos++;
    }
    return pos;
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// 查找顶级 const/let/var <name> = ... 的位置（跳过字符串/注释中的假阳性）
function findTopLevelVarDecl(src, varName) {
    const pattern = new RegExp('^(const|let|var)\\s+' + escapeRegExp(varName) + '\\s*=');
    const n = src.length;
    let pos = 0;
    while (pos < n) {
        const c = src[pos];
        if (c === '"' || c === "'" || c === '`') { pos = skipString(src, pos); continue; }
        if (c === '/' && src[pos + 1] === '/') {
            while (pos < n && src[pos] !== '\n') pos++;
            continue;
        }
        if (c === '/' && src[pos + 1] === '*') {
            pos += 2;
            while (pos + 1 < n && !(src[pos] === '*' && src[pos + 1] === '/')) pos++;
            pos += 2;
            continue;
        }
        if ((c === 'c' || c === 'l' || c === 'v') && (pos === 0 || !isIdChar(src[pos - 1]))) {
            const chunk = src.substring(pos, Math.min(pos + varName.length + 16, n));
            if (pattern.test(chunk)) return pos;
        }
        pos++;
    }
    return -1;
}

// 从数组 [ 位置进入第 idx 个元素，返回该元素起始
function enterArrayIndex(src, pos, idx) {
    if (src[pos] !== '[') throw new Error('期望 [');
    pos++;
    pos = skipWs(src, pos);
    for (let i = 0; i < idx; i++) {
        pos = skipValue(src, pos);
        pos = skipWs(src, pos);
        if (src[pos] !== ',') throw new Error('数组索引越界：需要 ' + idx + '，到 ' + i + ' 就结束');
        pos++;
        pos = skipWs(src, pos);
    }
    return pos;
}

// 读取对象键（标识符 或 "..."/'...' 字面量）
function readKey(src, pos) {
    const c = src[pos];
    if (c === '"' || c === "'" || c === '`') {
        const end = skipString(src, pos);
        const raw = src.substring(pos + 1, end - 1);
        return { name: raw.replace(/\\(.)/g, '$1'), end };
    }
    const n = src.length;
    const start = pos;
    while (pos < n && isIdChar(src[pos])) pos++;
    if (pos === start) throw new Error('无法读取键名 @ ' + pos);
    return { name: src.substring(start, pos), end: pos };
}

// 从对象 { 位置进入键 key 的值位置
function enterObjectKey(src, pos, key) {
    if (src[pos] !== '{') throw new Error('期望 {');
    pos++;
    const n = src.length;
    while (pos < n) {
        pos = skipWs(src, pos);
        if (src[pos] === '}') throw new Error('对象中未找到键 ' + key);
        const keyInfo = readKey(src, pos);
        pos = keyInfo.end;
        pos = skipWs(src, pos);
        if (src[pos] !== ':') throw new Error('键 ' + keyInfo.name + ' 后期望 :');
        pos++;
        pos = skipWs(src, pos);
        if (keyInfo.name === key) return pos;
        pos = skipValue(src, pos);
        pos = skipWs(src, pos);
        if (src[pos] === ',') { pos++; continue; }
        if (src[pos] === '}') throw new Error('对象中未找到键 ' + key);
    }
    throw new Error('对象解析失败');
}

// 在 objStart 指向的对象里：替换/删除/插入 comment 字段
function updateCommentInObject(src, objStart, newComment) {
    if (src[objStart] !== '{') throw new Error('期望 {');
    const n = src.length;
    let pos = objStart + 1;
    let fieldStart = -1, fieldValStart = -1, fieldValEnd = -1;

    while (pos < n) {
        pos = skipWs(src, pos);
        if (src[pos] === '}') break;
        const entryStart = pos;
        const keyInfo = readKey(src, pos);
        pos = keyInfo.end;
        pos = skipWs(src, pos);
        if (src[pos] !== ':') throw new Error('键 ' + keyInfo.name + ' 后期望 :');
        pos++;
        pos = skipWs(src, pos);
        const valStart = pos;
        pos = skipValue(src, pos);
        const valEnd = pos;
        if (keyInfo.name === 'comment') {
            fieldStart = entryStart;
            fieldValStart = valStart;
            fieldValEnd = valEnd;
            break;
        }
        pos = skipWs(src, pos);
        if (src[pos] === ',') { pos++; continue; }
        if (src[pos] === '}') break;
    }

    if (fieldStart >= 0) {
        if (newComment === '') {
            // 删除整个 comment 字段（含前后多余逗号）
            let delEnd = fieldValEnd;
            const after = skipWs(src, delEnd);
            if (src[after] === ',') {
                delEnd = after + 1;
            } else if (src[after] === '}') {
                // 末尾字段：把前面的逗号一起删掉
                let before = fieldStart - 1;
                while (before >= 0 && isWs(src[before])) before--;
                if (before >= 0 && src[before] === ',') {
                    fieldStart = before;
                }
                delEnd = after;
            }
            return src.substring(0, fieldStart) + src.substring(delEnd);
        }
        // 替换值
        return src.substring(0, fieldValStart) + JSON.stringify(newComment) + src.substring(fieldValEnd);
    }

    // 对象中无 comment 字段
    if (newComment === '') return src;
    const objEnd = skipBalanced(src, objStart, '{', '}'); // 指向 } 之后
    const braceIdx = objEnd - 1;
    const firstInside = skipWs(src, objStart + 1);
    let insertion;
    if (firstInside === braceIdx) {
        insertion = ' comment: ' + JSON.stringify(newComment) + ' ';
    } else {
        let beforeBrace = braceIdx - 1;
        while (beforeBrace > objStart && isWs(src[beforeBrace])) beforeBrace--;
        if (src[beforeBrace] === ',') {
            insertion = ' comment: ' + JSON.stringify(newComment);
        } else {
            insertion = ', comment: ' + JSON.stringify(newComment);
        }
    }
    return src.substring(0, braceIdx) + insertion + src.substring(braceIdx);
}