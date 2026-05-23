// A2-1 推送卡片端点(2026-05-19,2026-05-23 §12 改造)
//
// POST /api/push  (仅 admin)
//   body: {
//     target_users: ['alice', 'bob'],    // 必须手选(D6=A,不接受 __all__)
//     section_key:  'videoData' | null,  // null = 推到 custom_unclassified;接收方接受时可改
//     cards: [{type, title, url, ...}],  // 字段白名单清洗
//     message:      'Markdown 留言',     // 可选,≤500 字符;走 markdown-sanitize
//     mode:         'append' | 'force'   // append(默认):写对方 inbox 待审 / force(§13):直推 data.js
//   }
//
// 流程(append 默认 = inbox 待审):
//   1. admin 鉴权 + 字段白名单清洗 + 合法性校验
//   2. 对每个 target_user:
//      - 验证用户存在 + 未禁用
//      - 写 inbox:<uid>:<msgId> 单条 + inbox-list:<uid> 索引(unreadCount++)
//   3. 返回 {ok, successes, failures}
//
// 流程(force = §13 强制推送,单卡限制):
//   1. 加密大类禁止 force
//   2. 对每个 target_user:
//      - 读 user:<uid>:data_js(若 null 用新格式骨架)
//      - 找 sectionKey 对应的 section:加密 → 跳过 + 记 skipped
//      - cards 数组末尾插入新卡片
//      - 备份旧 data 到 user:<uid>:backup:<ts>
//      - 写新 data + 标 hasData=true
//
// 支持的数据格式(force 路径):
//   - 新格式:var sections = [{key, cards}, ...]
//   - 老格式:var <sectionKey> = [...] (内置 6 个) + var customSections = [...]
//   - null/空(EMPTY_STUB):自动生成新格式骨架

import {
    requireAdmin,
    jsonResponse,
    isValidUsername,
    getUsername,
    getPayload
} from '../_shared/auth.js';
import { trySanitizeMarkdown } from '../_shared/markdown-sanitize.js';

const USERS_KEY = 'users';
const MAX_BACKUPS = 100;
const PRUNE_PROBABILITY = 0.2;

const BUILTIN_KEYS = ['usbDriveData', 'teachingData', 'onlineAIData', 'videoData', 'emailData', 'contactData'];
const UNCLASSIFIED_KEY = 'custom_unclassified';
const ALLOWED_KEYS_FOR_PUSH = [...BUILTIN_KEYS, UNCLASSIFIED_KEY];

// inbox(§12)KV 键
const INBOX_PREFIX = 'inbox:';
const INBOX_LIST_PREFIX = 'inbox-list:';
const MAX_MESSAGE_LEN = 500; // 推送留言上限(§5.2 / §12)
function inboxKey(uid, msgId) { return INBOX_PREFIX + uid + ':' + msgId; }
function inboxListKey(uid)    { return INBOX_LIST_PREFIX + uid; }

// 卡片字段白名单(防 admin 推脏字段污染用户数据)
const ALLOWED_CARD_FIELDS = new Set([
    'type', 'title', 'url', 'desc', 'icon', 'iconImg', 'isLocal',
    'descClickable', 'descUrl', 'content', 'address', 'mailto', 'note',
    'comment', 'id', 'subCards',    // subCards 给 expandable 卡(从已有卡片选时会带过来)
    'pushedBy', 'pushedAt'          // §13 强制推送:管理员放置标注(2026-05-23)
]);

const MAX_FIELD_LEN = 8000;
const MAX_CARDS_PER_PUSH = 100;
const MAX_TARGETS = 50;

function emptyUserDataSkeleton() {
    return `var sections = [
    { builtin: true, key: 'usbDriveData', kind: 'card', label: '☁️ 在线U盘', visible: true, cards: [] },
    { builtin: true, key: 'teachingData', kind: 'card', label: '📚 授课资料', visible: true, cards: [] },
    { builtin: true, key: 'onlineAIData', kind: 'card', label: '🌐 网络资源', visible: true, cards: [] },
    { builtin: true, key: 'videoData', kind: 'card', label: '🎬 视频聚合', visible: true, cards: [] },
    { builtin: true, key: 'emailData', kind: 'email', label: '📧 邮箱', visible: true, cards: [] },
    { builtin: true, key: 'contactData', kind: 'contact', label: '📱 联系方式', visible: true, cards: [] }
];
`;
}

function sanitizeCard(card) {
    const clean = {};
    for (const k of Object.keys(card || {})) {
        if (!ALLOWED_CARD_FIELDS.has(k)) continue;
        let v = card[k];
        if (typeof v === 'string' && v.length > MAX_FIELD_LEN) v = v.slice(0, MAX_FIELD_LEN);
        clean[k] = v;
    }
    return clean;
}

function generateCardId() {
    return 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function timestamp() {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + '_' +
           p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
}

async function pruneBackups(kv, prefix) {
    const list = await kv.list({ prefix });
    if (list.keys.length <= MAX_BACKUPS) return;
    const sorted = list.keys.sort((a, b) => a.name.localeCompare(b.name));
    const toDelete = sorted.slice(0, sorted.length - MAX_BACKUPS);
    await Promise.all(toDelete.map(k => kv.delete(k.name)));
}

export async function onRequestPost({ request, env }) {
    const fail = await requireAdmin(request, env);
    if (fail) return fail;
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

    const { target_users, section_key, cards, message: rawMessage, mode = 'append' } = body || {};

    if (!Array.isArray(target_users) || target_users.length === 0) {
        return jsonResponse({ ok: false, error: 'target_users 必须是非空数组' }, 400);
    }
    if (target_users.length > MAX_TARGETS) {
        return jsonResponse({ ok: false, error: 'target_users 数量上限 ' + MAX_TARGETS }, 400);
    }
    for (const u of target_users) {
        if (!isValidUsername(u)) {
            return jsonResponse({ ok: false, error: '非法用户名: ' + u }, 400);
        }
    }
    const targetSecKey = section_key || UNCLASSIFIED_KEY;
    if (!ALLOWED_KEYS_FOR_PUSH.includes(targetSecKey)) {
        return jsonResponse({ ok: false, error: '不允许推送到该 section: ' + targetSecKey }, 400);
    }
    if (!Array.isArray(cards) || cards.length === 0) {
        return jsonResponse({ ok: false, error: 'cards 必须非空数组' }, 400);
    }
    if (cards.length > MAX_CARDS_PER_PUSH) {
        return jsonResponse({ ok: false, error: 'cards 数量上限 ' + MAX_CARDS_PER_PUSH }, 400);
    }
    if (mode !== 'append' && mode !== 'force') {
        return jsonResponse({ ok: false, error: '不支持的 mode: ' + mode }, 400);
    }
    // §13 强制推送:单卡限制(每次只能 1 张)
    if (mode === 'force' && cards.length > 1) {
        return jsonResponse({ ok: false, error: '强制推送一次只能 1 张卡' }, 400);
    }
    // §16-B(2026-05-24):force 模式禁止推送加密来源卡片(隐私边界 — 加密卡只能走 inbox 让接收方加密保存)
    if (mode === 'force' && cards.some(c => c && c.__fromEncrypted === true)) {
        return jsonResponse({ ok: false, error: '加密大类的卡片不能强制推送,只能走默认推送让对方接受到加密大类' }, 400);
    }
    // §13 强制推送:不能推到加密大类(隐私边界)
    // 注:单纯 section_key 命中 BUILTIN_KEYS 不能直接判断"加密",真正加密标在 section.encrypted
    // 这里仅做 section_key 校验;运行时 force 路径会再次扫描 section.encrypted 兜底
    // (不做提前拦截,因为 admin 不知道 user 的哪个 section 是加密)

    // 留言 sanitize(可选字段;两条路径都用)
    let cleanMessage = '';
    if (rawMessage != null && rawMessage !== '') {
        const sanRes = trySanitizeMarkdown(String(rawMessage), { maxLength: MAX_MESSAGE_LEN });
        if (!sanRes.ok) {
            return jsonResponse({ ok: false, error: '留言不合法: ' + sanRes.error, code: sanRes.code }, 400);
        }
        cleanMessage = sanRes.text;
    }

    // §16-B(2026-05-24):任一张卡片标 __fromEncrypted=true → 整个消息打加密标记
    //   接收方 inbox 看到 fromEncrypted=true 的消息只允许"接受到加密大类",隐藏公开接受/编辑接受
    const fromEncrypted = cards.some(c => c && c.__fromEncrypted === true);
    const cleanCards = cards.map(c => {
        const clean = sanitizeCard(c);
        if (!clean.id) clean.id = generateCardId();
        return clean;
    });

    const pushedBy = (await getUsername(request, env)) || '__unknown__';
    const callerPayload = await getPayload(request, env);
    const callerRole = (callerPayload && callerPayload.role) || 'admin';
    const callerUid = (callerPayload && (callerPayload.uid != null ? callerPayload.uid : callerPayload.u)) || pushedBy;

    const usersRaw = await env.FAV_KV.get(USERS_KEY);
    const users = usersRaw ? JSON.parse(usersRaw) : {};

    // ─────────────────────────────────────────────────────────────
    // 分支 A:append(默认)— 写对方 inbox 待审
    // ─────────────────────────────────────────────────────────────
    if (mode === 'append') {
        const successes = [];
        const failures = [];

        for (const target of target_users) {
            if (!users[target]) {
                failures.push({ user: target, reason: '用户不存在' });
                continue;
            }
            if (users[target].status === 'disabled') {
                failures.push({ user: target, reason: '用户已禁用' });
                continue;
            }
            try {
                const msgId = generateMsgId();
                const message = {
                    msgId,
                    fromUid: callerUid,
                    fromUsername: pushedBy,
                    fromRole: callerRole,
                    sentAt: timestamp(),
                    section_key: targetSecKey,
                    cards: cleanCards,
                    message: cleanMessage,
                    status: 'pending',
                    // §16-B(2026-05-24):加密来源标记 — 接收方 inbox 据此限制只能接受到加密大类
                    fromEncrypted: !!fromEncrypted
                };
                // 先写消息体
                await env.FAV_KV.put(inboxKey(target, msgId), JSON.stringify(message));
                // 后写索引(失败也不留孤儿:索引没加,GET 看不到那条 — 对用户透明)
                const list = await readInboxList(env, target);
                list.ids.unshift(msgId); // 时间倒序
                list.unreadCount = (list.unreadCount || 0) + 1;
                await env.FAV_KV.put(inboxListKey(target), JSON.stringify(list));
                successes.push({ user: target, msgId, cardsInserted: cleanCards.length });
            } catch (e) {
                const msg = (e && (e.message || e.name)) || String(e);
                console.warn('inbox push failed for', target, msg);
                failures.push({ user: target, reason: msg });
            }
        }

        return jsonResponse({
            ok: true,
            mode: 'inbox',
            section: targetSecKey,
            cardsCount: cleanCards.length,
            pushedBy,
            successes,
            failures,
            skipped: []
        });
    }

    // ─────────────────────────────────────────────────────────────
    // 分支 B:force(§13)— 直推 data.js,绕过 inbox
    // ─────────────────────────────────────────────────────────────
    // §13 标注(2026-05-23):force 推送的卡注入 pushedBy + pushedAt,前端渲染右上角 📌 徽章
    const forceCards = cleanCards.map(c => ({
        ...c,
        pushedBy: pushedBy,
        pushedAt: timestamp()
    }));

    const successes = [];
    const failures = [];
    const skipped = [];
    let usersTableDirty = false;

    for (const target of target_users) {
        if (!users[target]) {
            failures.push({ user: target, reason: '用户不存在' });
            continue;
        }
        if (users[target].status === 'disabled') {
            failures.push({ user: target, reason: '用户已禁用' });
            continue;
        }
        const ns = 'user:' + target;
        const dataKey = ns + ':data_js';

        try {
            let userData = await env.FAV_KV.get(dataKey);
            let isFirstWrite = false;
            if (!userData) {
                userData = emptyUserDataSkeleton();
                isFirstWrite = true;
            }

            const result = appendCardsToSection(userData, targetSecKey, forceCards);
            if (result.skipped) {
                // 加密大类被跳过 — force 模式下视为失败(强制不能穿透加密)
                skipped.push({ user: target, reason: result.skippedReason });
                continue;
            }
            if (!result.modified) {
                failures.push({ user: target, reason: result.error || '修改未生效' });
                continue;
            }

            let backupName = null;
            if (!isFirstWrite && userData.trim()) {
                backupName = ns + ':backup:' + timestamp();
                await env.FAV_KV.put(backupName, userData);
                if (Math.random() < PRUNE_PROBABILITY) {
                    try { await pruneBackups(env.FAV_KV, ns + ':backup:'); } catch {}
                }
            }

            await env.FAV_KV.put(dataKey, result.newSrc);

            if (users[target] && !users[target].hasData) {
                users[target].hasData = true;
                usersTableDirty = true;
            }

            successes.push({
                user: target,
                cardsInserted: cleanCards.length,
                backup: backupName,
                firstWrite: isFirstWrite
            });
        } catch (e) {
            const msg = (e && (e.message || e.name)) || String(e);
            console.warn('force push failed for', target, msg);
            failures.push({ user: target, reason: msg });
        }
    }

    if (usersTableDirty) {
        try { await env.FAV_KV.put(USERS_KEY, JSON.stringify(users)); }
        catch (e) { console.warn('users.hasData update failed:', e && e.message); }
    }

    return jsonResponse({
        ok: true,
        mode: 'force',
        section: targetSecKey,
        cardsCount: cleanCards.length,
        pushedBy,
        successes,
        failures,
        skipped
    });
}

// 生成 inbox msgId:`<timestampMs>_<rand6>`,可字典序排序 = 时间序
function generateMsgId() {
    return Date.now().toString() + '_' + Math.random().toString(36).slice(2, 8);
}

// 读 inbox-list 索引(同 inbox.js,本文件复用免循环引)
async function readInboxList(env, uid) {
    if (!env.FAV_KV) return { ids: [], unreadCount: 0 };
    try {
        const raw = await env.FAV_KV.get(inboxListKey(uid));
        if (!raw) return { ids: [], unreadCount: 0 };
        const obj = JSON.parse(raw);
        if (!obj || !Array.isArray(obj.ids)) return { ids: [], unreadCount: 0 };
        if (typeof obj.unreadCount !== 'number') obj.unreadCount = 0;
        return obj;
    } catch {
        return { ids: [], unreadCount: 0 };
    }
}

/* ==========================================================
 * 源码扫描:在数据文本中,找到 sectionKey 对应的 section,
 * 在其 cards 数组末尾追加 newCards。加密 section 自动跳过。
 * 返回 {modified, newSrc, skipped, skippedReason, error}
 * ========================================================== */
function appendCardsToSection(src, sectionKey, newCards) {
    const newFormatPos = findTopLevelVarDecl(src, 'sections');
    if (newFormatPos >= 0) {
        return appendCardsNewFormat(src, sectionKey, newCards, newFormatPos);
    }
    if (BUILTIN_KEYS.includes(sectionKey)) {
        return appendCardsOldFormat(src, sectionKey, newCards);
    }
    if (sectionKey === UNCLASSIFIED_KEY) {
        return appendCardsOldFormatCustom(src, sectionKey, newCards);
    }
    return { modified: false, error: '未识别的数据格式' };
}

function appendCardsNewFormat(src, sectionKey, newCards, sectionsStart) {
    const eqPos = src.indexOf('=', sectionsStart);
    if (eqPos < 0) return { modified: false, error: 'sections var 缺少 =' };
    let pos = skipWs(src, eqPos + 1);
    if (src[pos] !== '[') return { modified: false, error: 'sections 不是数组' };
    const sectionsArrStart = pos;
    pos++;

    while (pos < src.length) {
        pos = skipWs(src, pos);
        if (src[pos] === ']') break;
        if (src[pos] !== '{') return { modified: false, error: '期望 { 但实际: ' + src[pos] };

        const objStart = pos;
        const objEnd = skipBalanced(src, pos, '{', '}');
        const info = inspectSection(src, objStart);
        if (info.key === sectionKey) {
            if (info.encrypted) {
                return { modified: true, skipped: true, skippedReason: '该 section 是加密大类,无法推送' };
            }
            return insertIntoCards(src, objStart, newCards);
        }
        pos = objEnd;
        pos = skipWs(src, pos);
        if (src[pos] === ',') { pos++; continue; }
        if (src[pos] === ']') break;
    }

    if (sectionKey === UNCLASSIFIED_KEY) {
        return insertNewUnclassifiedSection(src, sectionsArrStart, newCards);
    }
    return { modified: false, error: '未找到 section: ' + sectionKey };
}

function inspectSection(src, objStart) {
    let pos = objStart + 1;
    let key = null, encrypted = false;
    while (pos < src.length) {
        pos = skipWs(src, pos);
        if (src[pos] === '}') break;
        const keyInfo = readKey(src, pos);
        pos = keyInfo.end;
        pos = skipWs(src, pos);
        if (src[pos] !== ':') break;
        pos++;
        pos = skipWs(src, pos);
        const valStart = pos;
        if (keyInfo.name === 'key') {
            if (src[pos] === '"' || src[pos] === "'" || src[pos] === '`') {
                const valEnd = skipString(src, pos);
                key = src.substring(pos + 1, valEnd - 1).replace(/\\(.)/g, '$1');
                pos = valEnd;
            } else {
                pos = skipValue(src, pos);
            }
        } else if (keyInfo.name === 'encrypted') {
            const valEnd = skipValue(src, pos);
            encrypted = src.substring(valStart, valEnd).trim() === 'true';
            pos = valEnd;
        } else {
            pos = skipValue(src, pos);
        }
        pos = skipWs(src, pos);
        if (src[pos] === ',') { pos++; continue; }
        if (src[pos] === '}') break;
    }
    return { key, encrypted };
}

function insertIntoCards(src, objStart, newCards) {
    let pos = objStart + 1;
    let cardsArrStart = -1;
    while (pos < src.length) {
        pos = skipWs(src, pos);
        if (src[pos] === '}') break;
        const keyInfo = readKey(src, pos);
        pos = keyInfo.end;
        pos = skipWs(src, pos);
        if (src[pos] !== ':') break;
        pos++;
        pos = skipWs(src, pos);
        if (keyInfo.name === 'cards') {
            if (src[pos] !== '[') return { modified: false, error: 'cards 不是数组' };
            cardsArrStart = pos;
            break;
        }
        pos = skipValue(src, pos);
        pos = skipWs(src, pos);
        if (src[pos] === ',') { pos++; continue; }
        if (src[pos] === '}') break;
    }
    if (cardsArrStart < 0) {
        return { modified: false, error: 'section 缺少 cards 字段' };
    }
    const cardsEnd = skipBalanced(src, cardsArrStart, '[', ']');
    return insertBeforeBracket(src, cardsArrStart, cardsEnd - 1, newCards);
}

function insertBeforeBracket(src, arrStart, bracketIdx, newCards) {
    const inner = src.substring(arrStart + 1, bracketIdx).trim();
    const isEmpty = inner === '';
    const cardLines = newCards.map(c => stringifyCard(c));

    let insertion;
    if (isEmpty) {
        insertion = '\n            ' + cardLines.join(',\n            ') + '\n        ';
    } else {
        let beforeBracket = bracketIdx - 1;
        while (beforeBracket > arrStart && isWs(src[beforeBracket])) beforeBracket--;
        const hasTrailingComma = src[beforeBracket] === ',';
        const prefix = hasTrailingComma ? '\n            ' : ',\n            ';
        insertion = prefix + cardLines.join(',\n            ') + '\n        ';
    }
    return { modified: true, newSrc: src.substring(0, bracketIdx) + insertion + src.substring(bracketIdx) };
}

function stringifyCard(card) {
    const parts = [];
    for (const k of Object.keys(card)) {
        const v = card[k];
        if (v == null) continue;
        if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') {
            parts.push(k + ': ' + JSON.stringify(v));
        } else if (Array.isArray(v) || typeof v === 'object') {
            parts.push(k + ': ' + JSON.stringify(v));
        }
    }
    return '{ ' + parts.join(', ') + ' }';
}

function insertNewUnclassifiedSection(src, sectionsArrPos, newCards) {
    const arrEnd = skipBalanced(src, sectionsArrPos, '[', ']');
    const closeBracket = arrEnd - 1;
    const inner = src.substring(sectionsArrPos + 1, closeBracket).trim();
    const cardLines = newCards.map(c => stringifyCard(c));
    const unclassObj = '\n    { builtin: false, key: \'custom_unclassified\', kind: \'card\', label: \'📥 未分类\', visible: true, cards: [\n            '
        + cardLines.join(',\n            ') + '\n        ] }';
    let insertion;
    if (inner === '') {
        insertion = unclassObj + '\n';
    } else {
        let beforeBracket = closeBracket - 1;
        while (beforeBracket > sectionsArrPos && isWs(src[beforeBracket])) beforeBracket--;
        const hasTrailingComma = src[beforeBracket] === ',';
        insertion = (hasTrailingComma ? '' : ',') + unclassObj + '\n';
    }
    return { modified: true, newSrc: src.substring(0, closeBracket) + insertion + src.substring(closeBracket) };
}

function appendCardsOldFormat(src, sectionKey, newCards) {
    const varPos = findTopLevelVarDecl(src, sectionKey);
    if (varPos < 0) return { modified: false, error: '老格式未找到 var ' + sectionKey };
    const eqPos = src.indexOf('=', varPos);
    if (eqPos < 0) return { modified: false, error: '老格式 var 缺少 =' };
    let pos = skipWs(src, eqPos + 1);
    if (src[pos] !== '[') return { modified: false, error: '老格式 var 不是数组' };
    const arrEnd = skipBalanced(src, pos, '[', ']');
    return insertBeforeBracket(src, pos, arrEnd - 1, newCards);
}

function appendCardsOldFormatCustom(src, sectionKey, newCards) {
    const varPos = findTopLevelVarDecl(src, 'customSections');
    if (varPos < 0) return { modified: false, error: '老格式未找到 customSections' };
    const eqPos = src.indexOf('=', varPos);
    if (eqPos < 0) return { modified: false, error: '老格式 customSections 缺少 =' };
    let pos = skipWs(src, eqPos + 1);
    if (src[pos] !== '[') return { modified: false, error: '老格式 customSections 不是数组' };
    const arrStart = pos;
    const arrEnd = skipBalanced(src, pos, '[', ']');
    let p = pos + 1;
    while (p < arrEnd - 1) {
        p = skipWs(src, p);
        if (src[p] === ']') break;
        if (src[p] !== '{') return { modified: false, error: '期望 {' };
        const objStart = p;
        const objEnd = skipBalanced(src, p, '{', '}');
        const info = inspectSection(src, objStart);
        if (info.key === sectionKey) {
            if (info.encrypted) {
                return { modified: true, skipped: true, skippedReason: '该 section 是加密大类,无法推送' };
            }
            return insertIntoCards(src, objStart, newCards);
        }
        p = objEnd;
        p = skipWs(src, p);
        if (src[p] === ',') { p++; continue; }
        if (src[p] === ']') break;
    }
    return insertNewUnclassifiedSection(src, arrStart, newCards);
}

/* ============ 通用扫描工具(从 comment.js 借鉴) ============ */
function isWs(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r'; }
function isIdChar(c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_' || c === '$';
}

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

function skipValue(src, pos) {
    pos = skipWs(src, pos);
    const c = src[pos];
    if (c === '{') return skipBalanced(src, pos, '{', '}');
    if (c === '[') return skipBalanced(src, pos, '[', ']');
    if (c === '"' || c === "'" || c === '`') return skipString(src, pos);
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
