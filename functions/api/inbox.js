// /api/inbox  — 收件箱待审消息(2026-05-23,§12)
//
// 数据模型:
//   inbox:<uid>:<msgId>           JSON 单条消息(fromUid/fromUsername/fromRole/sentAt/section_key/cards/message/status/...)
//   inbox-list:<uid>              JSON { ids: [msgId,...时间倒序], unreadCount }
//
// 端点:
//   GET    /api/inbox                              列出自己所有 inbox(支持 ?status=pending)
//   POST   /api/inbox?action=accept-public         body: { msgId, target_section_key }  → 合并到非加密大类(允许 pending / rejected → accepted)
//   POST   /api/inbox?action=reject                body: { msgId, reason? }
//   POST   /api/inbox?action=delete-rejected       body: { msgId }                       → 彻底删除已拒绝的消息(2026-05-24 §16-A.3 新增)
//   POST   /api/inbox?action=delete-accepted       body: { msgId }                       → 删除已接受的历史记录(2026-05-24 §16-A.5 新增;不动 data.js 中已合并的卡)
//   POST   /api/inbox?action=delete-sent           body: { msgId }                       → 发件方删除自己的 sent 历史(不动收件方 inbox)
//   POST   /api/inbox?action=fetch-for-encrypt     body: { msgId }                       → 返回明文 cards,供前端加密合并;不删消息
//   POST   /api/inbox?action=mark-encrypted-done   body: { msgId }                       → 前端加密合并完成后调,标 accepted + 减 unread
//
// 状态机(2026-05-24 §16-A.3 简化):
//   pending → accepted(public/encrypted)
//   pending → rejected
//   rejected → accepted(重新激活;unreadCount 不再减)
//   rejected → 彻底删除(KV 移除)
//   旧版 acceptKind='discarded' 的历史消息保留,纯只读不再产生
//
// 加密大类合并的特殊性(2026-05-23 设计):
//   后端读不到用户解锁密码 → 不能直接把卡片合并到加密 section。
//   方案:接受到加密大类时,前端先 POST fetch-for-encrypt 拿到明文 cards,然后用 sessionStorage 里
//   的解锁密码本地解密 → 合并 → AES-GCM 重新加密 → /api/save 写回。完成后 POST mark-encrypted-done。
//
// 权限:任意已登录用户(不限角色)。每人只能操作自己的 inbox。

import {
    jsonResponse,
    getPayload,
    isValidUsername
} from '../_shared/auth.js';
import { trySanitizeMarkdown } from '../_shared/markdown-sanitize.js';

const INBOX_PREFIX = 'inbox:';
const INBOX_LIST_PREFIX = 'inbox-list:';
// §14 P2P(2026-05-29):sent 副本走发件方 user namespace,users.js DELETE 已按 user:<target>:* 前缀清理
const SENT_PREFIX = 'user:';            // user:<senderUid>:sent:<msgId>
const SENT_LIST_PREFIX = 'user:';       // user:<senderUid>:sent-list
// §14 P2P 速率限制 KV key 前缀(UTC+8 时区,与项目其他时间戳一致;接受 ±1-2 条 race 误差)
const RATE_PREFIX = 'inbox-rate:';      // inbox-rate:<sender>:<YYYYMMDD> 86400s TTL / inbox-rate:<sender>:<recipient>:<YYYYMMDDHH> 3600s TTL
const RATE_DAILY_LIMIT = 100;
const RATE_PER_RECIPIENT_HOURLY = 10;
const MAX_CARDS_PER_SEND = 20;          // §14 单次推送上限(与 §11.5 决策一致)
const MAX_MESSAGE_LEN = 500;            // §14 留言长度上限(与 push.js 一致)
const USERS_KEY = 'users';

const BUILTIN_KEYS = ['usbDriveData', 'teachingData', 'onlineAIData', 'videoData', 'emailData', 'contactData'];
const UNCLASSIFIED_KEY = 'custom_unclassified';
const ALLOWED_PUBLIC_KEYS = [...BUILTIN_KEYS, UNCLASSIFIED_KEY];

// §16-A.4(2026-05-24):"编辑后接受"用 — 字段白名单 + 长度上限,与 push.js 的 sanitizeCard 行为一致
const ALLOWED_CARD_FIELDS = new Set([
    'type', 'title', 'url', 'desc', 'icon', 'iconImg', 'isLocal',
    'descClickable', 'descUrl', 'content', 'address', 'mailto', 'note',
    'comment', 'id', 'subCards', 'pushedBy', 'pushedAt'
]);
const MAX_FIELD_LEN = 8000;
function sanitizeCardField(card) {
    const clean = {};
    for (const k of Object.keys(card || {})) {
        if (!ALLOWED_CARD_FIELDS.has(k)) continue;
        let v = card[k];
        if (typeof v === 'string' && v.length > MAX_FIELD_LEN) v = v.slice(0, MAX_FIELD_LEN);
        clean[k] = v;
    }
    return clean;
}

function inboxKey(uid, msgId) { return INBOX_PREFIX + uid + ':' + msgId; }
function inboxListKey(uid)    { return INBOX_LIST_PREFIX + uid; }
// §14 P2P:sent 副本 key(放发件方 user namespace 下,删除用户时自动随 user:<uid>:* 清理)
function sentKey(uid, msgId)  { return SENT_PREFIX + uid + ':sent:' + msgId; }
function sentListKey(uid)     { return SENT_LIST_PREFIX + uid + ':sent-list'; }
// §14 P2P:速率限制 key(UTC+8)
function dateKeyCN() {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate());
}
function hourKeyCN() {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours());
}
function rateDayKey(senderUid)             { return RATE_PREFIX + senderUid + ':' + dateKeyCN(); }
function rateHourKey(senderUid, recipient) { return RATE_PREFIX + senderUid + ':' + recipient + ':' + hourKeyCN(); }
function generateMsgId() {
    return Date.now().toString() + '_' + Math.random().toString(36).slice(2, 8);
}

// 读取 inbox 索引;不存在则返回空 { ids:[], unreadCount:0 }
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

async function writeInboxList(env, uid, list) {
    await env.FAV_KV.put(inboxListKey(uid), JSON.stringify(list));
}

// 从索引里移除一个 msgId
function removeFromList(list, msgId) {
    const i = list.ids.indexOf(msgId);
    if (i >= 0) list.ids.splice(i, 1);
}

// ─────────────────────────────────────────────────────────────
// §14 P2P 工具函数(sent 副本索引读写 / 限速检查)
// ─────────────────────────────────────────────────────────────
async function readSentList(env, uid) {
    if (!env.FAV_KV) return { ids: [] };
    try {
        const raw = await env.FAV_KV.get(sentListKey(uid));
        if (!raw) return { ids: [] };
        const obj = JSON.parse(raw);
        if (!obj || !Array.isArray(obj.ids)) return { ids: [] };
        return obj;
    } catch {
        return { ids: [] };
    }
}

async function writeSentList(env, uid, list) {
    await env.FAV_KV.put(sentListKey(uid), JSON.stringify(list));
}

// 限速检查 + 计数:接受 ±1-2 race 误差(用户决策 Q3=A,无 atomic CAS)
// 返回 { ok:true, dayUsed, hourUsed } 或 { ok:false, code:'RATE_LIMIT_DAILY'|'RATE_LIMIT_PER_RECIPIENT', limit, retryAfter }
async function checkAndIncrementRate(env, fromUid, toUsername) {
    const dKey = rateDayKey(fromUid);
    const hKey = rateHourKey(fromUid, toUsername);
    const [dayRaw, hourRaw] = await Promise.all([
        env.FAV_KV.get(dKey),
        env.FAV_KV.get(hKey)
    ]);
    const dayN  = parseInt(dayRaw  || '0', 10) || 0;
    const hourN = parseInt(hourRaw || '0', 10) || 0;
    if (dayN >= RATE_DAILY_LIMIT) {
        return { ok: false, code: 'RATE_LIMIT_DAILY', limit: RATE_DAILY_LIMIT, retryAfter: 86400 };
    }
    if (hourN >= RATE_PER_RECIPIENT_HOURLY) {
        return { ok: false, code: 'RATE_LIMIT_PER_RECIPIENT', limit: RATE_PER_RECIPIENT_HOURLY, retryAfter: 3600 };
    }
    // 写入(race 接受误差;不做 CAS)
    try {
        await Promise.all([
            env.FAV_KV.put(dKey, String(dayN + 1),  { expirationTtl: 86400 }),
            env.FAV_KV.put(hKey, String(hourN + 1), { expirationTtl: 3600  })
        ]);
    } catch (e) {
        // 写失败不阻断主流程(限速失效优于发送失败)
        console.warn('rate counter put failed:', e && e.message);
    }
    return { ok: true, dayUsed: dayN + 1, hourUsed: hourN + 1 };
}

// 鉴权 + 返回 { uid, payload }
async function authUser(request, env) {
    const payload = await getPayload(request, env);
    if (!payload) return { error: jsonResponse({ ok: false, error: '未登录' }, 401) };
    const uid = payload.uid != null ? payload.uid : payload.u;
    if (!uid) return { error: jsonResponse({ ok: false, error: 'token 缺少 uid' }, 401) };
    return { uid, payload };
}

export async function onRequestGet({ request, env }) {
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const auth = await authUser(request, env);
    if (auth.error) return auth.error;
    const { uid } = auth;

    const url = new URL(request.url);
    const statusFilter = url.searchParams.get('status'); // pending / accepted / rejected / null
    const type = url.searchParams.get('type');           // §14 P2P(2026-05-29):'sent' = 我发出的;不传/其它 = 我收到的(默认 inbox)

    // §14 P2P:发件箱视图 — 列出自己 send 过的 P2P 消息(只有走 /api/inbox?action=send 才有 sent 副本;admin /api/push 路径不在此)
    if (type === 'sent') {
        const sentList = await readSentList(env, uid);
        const messages = [];
        for (const msgId of sentList.ids) {
            try {
                const raw = await env.FAV_KV.get(sentKey(uid, msgId));
                if (!raw) continue;
                const msg = JSON.parse(raw);
                if (statusFilter && msg.status !== statusFilter) continue;
                messages.push(msg);
            } catch {}
        }
        return jsonResponse({
            ok: true,
            type: 'sent',
            uid,
            total: sentList.ids.length,
            messages
        });
    }

    // 默认:收件箱视图
    const list = await readInboxList(env, uid);

    const messages = [];
    for (const msgId of list.ids) {
        try {
            const raw = await env.FAV_KV.get(inboxKey(uid, msgId));
            if (!raw) continue;
            const msg = JSON.parse(raw);
            if (statusFilter && msg.status !== statusFilter) continue;
            messages.push(msg);
        } catch {}
    }

    return jsonResponse({
        ok: true,
        uid,
        total: list.ids.length,
        unreadCount: list.unreadCount,
        messages
    });
}

export async function onRequestPost({ request, env }) {
    if (!env.FAV_KV) return jsonResponse({ ok: false, error: '未绑定 KV' }, 500);

    const auth = await authUser(request, env);
    if (auth.error) return auth.error;
    const { uid } = auth;

    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    if (!action) return jsonResponse({ ok: false, error: '缺少 action 参数' }, 400);

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ ok: false, error: '请求格式错误' }, 400); }

    // §14 P2P send action 没有 msgId 输入(后端生成),独立分流
    if (action === 'send') {
        return await handleSend(env, body, uid, auth.payload);
    }
    // §14 P2P set-policy action 没有 msgId 输入(改自己的 inboxPolicy)
    if (action === 'set-policy') {
        return await handleSetPolicy(env, body, uid);
    }

    const msgId = body && body.msgId;
    if (!msgId || typeof msgId !== 'string') {
        return jsonResponse({ ok: false, error: 'msgId 必传' }, 400);
    }

    // §14 候选 A(2026-06-08):发件方只删除自己的 sent 历史副本,不读取/修改接收方 inbox。
    if (action === 'delete-sent') {
        const sentRaw = await env.FAV_KV.get(sentKey(uid, msgId));
        if (!sentRaw) return jsonResponse({ ok: false, error: '发件记录不存在或已删除' }, 404);
        await env.FAV_KV.delete(sentKey(uid, msgId));
        const sentList = await readSentList(env, uid);
        removeFromList(sentList, msgId);
        await writeSentList(env, uid, sentList);
        return jsonResponse({ ok: true, msgId, status: 'deleted' });
    }

    // 读消息(必须存在 + 必须 pending,除了 fetch-for-encrypt 允许 pending)
    const msgRaw = await env.FAV_KV.get(inboxKey(uid, msgId));
    if (!msgRaw) return jsonResponse({ ok: false, error: '消息不存在或已被处理' }, 404);
    let msg;
    try { msg = JSON.parse(msgRaw); }
    catch { return jsonResponse({ ok: false, error: '消息数据损坏' }, 500); }

    if (action === 'accept-public') {
        // §16-A.3(2026-05-24):允许从 rejected 重新激活到 accepted(用户在已拒绝列表点"重新接受")
        if (msg.status !== 'pending' && msg.status !== 'rejected') {
            return jsonResponse({ ok: false, error: '该消息状态不可接受: ' + msg.status }, 409);
        }
        // §16-B(2026-05-24):加密来源的消息只能接受到加密大类,不能走 accept-public
        if (msg.fromEncrypted === true) {
            return jsonResponse({ ok: false, error: '该消息含加密来源卡片,只能"接受到加密大类"' }, 403);
        }
        const targetKey = body.target_section_key || msg.section_key || UNCLASSIFIED_KEY;
        if (!ALLOWED_PUBLIC_KEYS.includes(targetKey)) {
            return jsonResponse({ ok: false, error: '不允许的目标 section: ' + targetKey }, 400);
        }
        // §16-A.4(2026-05-24):支持"编辑后接受" — 用 edited_cards 替换原 msg.cards
        //   仅校验是数组 + 字段白名单(防止用户写入未知字段污染 data.js)
        let cardsToWrite = msg.cards;
        let edited = false;
        if (Array.isArray(body.edited_cards) && body.edited_cards.length > 0) {
            cardsToWrite = body.edited_cards.map(sanitizeCardField);
            edited = true;
        }
        return await acceptPublic(env, uid, msg, targetKey, cardsToWrite, edited);
    }

    if (action === 'fetch-for-encrypt') {
        // 用于前端获取明文 cards 做加密合并;不改 msg 状态
        if (msg.status !== 'pending') {
            return jsonResponse({ ok: false, error: '该消息状态不可接受: ' + msg.status }, 409);
        }
        return jsonResponse({
            ok: true,
            msgId,
            cards: msg.cards,
            message: msg.message,
            fromUsername: msg.fromUsername
        });
    }

    if (action === 'mark-encrypted-done') {
        // 前端完成加密合并 + /api/save 后调,标 accepted + 减 unread
        if (msg.status !== 'pending') {
            return jsonResponse({ ok: false, error: '该消息状态已变更: ' + msg.status }, 409);
        }
        const targetEncKey = body.target_section_key || ''; // 仅留存元信息
        return await markAcceptedAndCleanup(env, uid, msg, msgId, targetEncKey, 'encrypted');
    }

    if (action === 'delete-rejected') {
        // §16-A.3(2026-05-24):仅 rejected 消息可被彻底删除(代替原 accept-discard 的"已读丢弃"语义)
        if (msg.status !== 'rejected') {
            return jsonResponse({ ok: false, error: '只有已拒绝的消息能彻底删除: ' + msg.status }, 409);
        }
        await env.FAV_KV.delete(inboxKey(uid, msgId));
        const list = await readInboxList(env, uid);
        removeFromList(list, msgId);
        await writeInboxList(env, uid, list);
        return jsonResponse({ ok: true, msgId, status: 'deleted' });
    }

    if (action === 'delete-accepted') {
        // §16-A.5(2026-05-24):删除已接受的历史记录(只删 inbox 索引中的消息记录,不动 user data.js 中已合并的卡片)
        // 注:force 推送不走 inbox,所以这里永远不会涉及 force 推送的"标注"
        if (msg.status !== 'accepted') {
            return jsonResponse({ ok: false, error: '只有已接受的消息能删除记录: ' + msg.status }, 409);
        }
        await env.FAV_KV.delete(inboxKey(uid, msgId));
        const list = await readInboxList(env, uid);
        removeFromList(list, msgId);
        await writeInboxList(env, uid, list);
        return jsonResponse({ ok: true, msgId, status: 'deleted' });
    }

    if (action === 'reject') {
        if (msg.status !== 'pending') {
            return jsonResponse({ ok: false, error: '该消息状态不可拒绝: ' + msg.status }, 409);
        }
        const reason = (body.reason || '').toString().slice(0, 500);
        msg.status = 'rejected';
        msg.rejectedAt = timestamp();
        if (reason) msg.rejectReason = reason;
        await env.FAV_KV.put(inboxKey(uid, msgId), JSON.stringify(msg));
        // 更新 unreadCount(从 pending 转出 → 减)
        const list = await readInboxList(env, uid);
        if (list.unreadCount > 0) list.unreadCount -= 1;
        await writeInboxList(env, uid, list);
        // §14 P2P(2026-05-29):同步发件方 sent 副本状态
        await syncSentStatus(env, msg, {
            status: 'rejected',
            rejectedAt: msg.rejectedAt,
            rejectReason: reason || undefined
        });
        return jsonResponse({ ok: true, msgId, status: 'rejected' });
    }

    return jsonResponse({ ok: false, error: '未知 action: ' + action }, 400);
}

// ─────────────────────────────────────────────────────────────
// §14 P2P send action(2026-05-29)
// 任意登录用户 → 推送卡片到指定 recipient 的 inbox + 写发件方 sent 副本
// 防爆破:recipient 不存在 / disabled / inboxPolicy=closed → 静默 200(不写 inbox 也不写 sent)
// 速率限:全日 50 / 同收件人 1h 5(超 → 429,不静默,告诉发件方触发自己限速)
// 加密卡:fromEncrypted 透传(复用 §16-B 机制,接收方只能加密接受)
// ─────────────────────────────────────────────────────────────
async function handleSend(env, body, fromUid, payload) {
    // 1. body 字段校验(cheap first)
    const toUsername    = body && body.toUsername;
    const cards         = body && body.cards;
    const rawMessage    = body && body.message;
    const rawSectionKey = body && body.section_key;

    if (!toUsername || typeof toUsername !== 'string' || !isValidUsername(toUsername)) {
        return jsonResponse({ ok: false, error: '收件人用户名不合法' }, 400);
    }
    if (!Array.isArray(cards) || cards.length === 0) {
        return jsonResponse({ ok: false, error: 'cards 必须是非空数组' }, 400);
    }
    if (cards.length > MAX_CARDS_PER_SEND) {
        return jsonResponse({ ok: false, error: '单次最多 ' + MAX_CARDS_PER_SEND + ' 张卡片' }, 400);
    }

    // 2. self-send 拒绝(Q6)
    if (toUsername === fromUid) {
        return jsonResponse({ ok: false, error: '不能给自己发送' }, 400);
    }

    // 3. section_key:可选;为空 = 推到未分类
    const targetSecKey = rawSectionKey || UNCLASSIFIED_KEY;
    if (!ALLOWED_PUBLIC_KEYS.includes(targetSecKey)) {
        return jsonResponse({ ok: false, error: '不允许的目标 section: ' + targetSecKey }, 400);
    }

    // 4. 限速检查(发件方自己的限速 → 失败 429 不静默)
    //    放在用户检查之前 → 攻击者扫描收件人也消耗自己配额
    const rate = await checkAndIncrementRate(env, fromUid, toUsername);
    if (!rate.ok) {
        return jsonResponse({
            ok: false,
            error: rate.code === 'RATE_LIMIT_DAILY'
                ? '今日推送已达上限 (' + rate.limit + ' 条/天),请明日再试'
                : '同收件人 1 小时内最多发送 ' + rate.limit + ' 条',
            code: rate.code,
            retryAfter: rate.retryAfter
        }, 429);
    }

    // 5. 静默检查:recipient 不存在 / disabled / inboxPolicy=closed → 200 但不写
    const usersRaw = await env.FAV_KV.get(USERS_KEY);
    const users = usersRaw ? JSON.parse(usersRaw) : {};
    const target = users[toUsername];
    if (!target || target.status === 'disabled') {
        // 防爆破:返回与成功相同的 shape,但 msgId=null 表明实际未写
        return jsonResponse({ ok: true, sentTo: toUsername, msgId: null, silent: true });
    }
    if (target.inboxPolicy === 'closed') {
        return jsonResponse({ ok: true, sentTo: toUsername, msgId: null, silent: true });
    }

    // 6. sanitize message(Markdown 黑名单 + 长度上限)
    let cleanMessage = '';
    if (rawMessage != null && rawMessage !== '') {
        const sanRes = trySanitizeMarkdown(String(rawMessage), { maxLength: MAX_MESSAGE_LEN });
        if (!sanRes.ok) {
            return jsonResponse({ ok: false, error: '留言不合法: ' + sanRes.error, code: sanRes.code }, 400);
        }
        cleanMessage = sanRes.text;
    }

    // 7. fromEncrypted 检测(复用 §16-B 机制):任一张卡 __fromEncrypted=true → 整个消息标加密来源
    const fromEncrypted = cards.some(c => c && c.__fromEncrypted === true);

    // 8. sanitize cards(白名单 + 长度截断 + 自动补 id)
    const cleanCards = cards.map(c => {
        const clean = sanitizeCardField(c);
        if (!clean.id) clean.id = 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        return clean;
    });

    // 9. 构造消息体(与 push.js append 路径完全一致的 shape)
    const msgId = generateMsgId();
    const fromUsername = (payload && payload.u) || fromUid;
    const fromRole = (payload && payload.role) || 'user';
    const message = {
        msgId,
        fromUid,
        fromUsername,
        fromRole,
        sentAt: timestamp(),
        section_key: targetSecKey,
        cards: cleanCards,
        message: cleanMessage,
        status: 'pending',
        fromEncrypted: !!fromEncrypted
    };

    // 10. 写入(顺序:inbox → inbox-list → sent → sent-list;任一步失败留着,不回滚)
    try {
        await env.FAV_KV.put(inboxKey(toUsername, msgId), JSON.stringify(message));
        const inList = await readInboxList(env, toUsername);
        inList.ids.unshift(msgId);
        inList.unreadCount = (inList.unreadCount || 0) + 1;
        await writeInboxList(env, toUsername, inList);

        // sent 副本(用于发件方查"对方接受没")— 多存 toUsername 字段,inbox 副本不存(接收方自己知道是自己)
        const sentMessage = Object.assign({}, message, { toUsername });
        await env.FAV_KV.put(sentKey(fromUid, msgId), JSON.stringify(sentMessage));
        const sentList = await readSentList(env, fromUid);
        sentList.ids.unshift(msgId);
        await writeSentList(env, fromUid, sentList);
    } catch (e) {
        const msg = (e && (e.message || e.name)) || String(e);
        console.warn('inbox send write failed:', msg);
        return jsonResponse({ ok: false, error: '写入失败: ' + msg }, 500);
    }

    return jsonResponse({
        ok: true,
        sentTo: toUsername,
        msgId,
        cardsCount: cleanCards.length,
        fromEncrypted: !!fromEncrypted,
        rate: { dayUsed: rate.dayUsed, hourUsed: rate.hourUsed }
    });
}

// ─────────────────────────────────────────────────────────────
// §14 P2P set-policy(2026-05-29)
// 用户改自己的 inboxPolicy('open' / 'closed')
// admin 也只能改自己(V1 简化;管理他人 policy 留到 V2)
// 不存在/老用户(无 inboxPolicy 字段)视为 'open',此 action 写入后即固化
// ─────────────────────────────────────────────────────────────
async function handleSetPolicy(env, body, uid) {
    const policy = body && body.policy;
    if (policy !== 'open' && policy !== 'closed') {
        return jsonResponse({ ok: false, error: 'policy 必须是 open 或 closed' }, 400);
    }
    try {
        const usersRaw = await env.FAV_KV.get(USERS_KEY);
        if (!usersRaw) {
            return jsonResponse({ ok: false, error: '用户表不存在' }, 500);
        }
        const users = JSON.parse(usersRaw);
        if (!users[uid]) {
            return jsonResponse({ ok: false, error: '用户不存在' }, 404);
        }
        users[uid].inboxPolicy = policy;
        await env.FAV_KV.put(USERS_KEY, JSON.stringify(users));
        return jsonResponse({ ok: true, policy });
    } catch (e) {
        const msg = (e && (e.message || e.name)) || String(e);
        console.warn('set-policy failed:', msg);
        return jsonResponse({ ok: false, error: '保存失败: ' + msg }, 500);
    }
}

// 接受到公开/未分类 section:后端读 user data.js + 合并 cards + 写回
// §16-A.4(2026-05-24):新增 cardsToWrite + edited 参数,支持"编辑后接受"
async function acceptPublic(env, uid, msg, targetKey, cardsToWrite, edited) {
    cardsToWrite = cardsToWrite || msg.cards;
    const dataKey = 'user:' + uid + ':data_js';
    let userData = await env.FAV_KV.get(dataKey);
    let isFirstWrite = false;
    if (!userData) {
        userData = emptyUserDataSkeleton();
        isFirstWrite = true;
    }

    const result = appendCardsToSection(userData, targetKey, cardsToWrite);
    if (result.skipped) {
        return jsonResponse({ ok: false, error: '目标 section 是加密大类,请用 accept-encrypted 流程' }, 400);
    }
    if (!result.modified) {
        return jsonResponse({ ok: false, error: result.error || '合并失败' }, 500);
    }

    // 备份旧 data
    let backupName = null;
    if (!isFirstWrite && userData.trim()) {
        backupName = 'user:' + uid + ':backup:' + timestamp();
        try { await env.FAV_KV.put(backupName, userData); } catch {}
    }
    await env.FAV_KV.put(dataKey, result.newSrc);

    // 标 users[uid].hasData = true
    try {
        const usersRaw = await env.FAV_KV.get('users');
        if (usersRaw) {
            const users = JSON.parse(usersRaw);
            if (users[uid] && !users[uid].hasData) {
                users[uid].hasData = true;
                await env.FAV_KV.put('users', JSON.stringify(users));
            }
        }
    } catch {}

    // §16-A.4:edited=true 时把 acceptedCards 落到消息里供后续审查
    if (edited) {
        msg.editedBeforeAccept = true;
        msg.acceptedCards = cardsToWrite;
    }
    return await markAcceptedAndCleanup(env, uid, msg, msg.msgId, targetKey, 'public');
}

// 标 msg 为 accepted + 更新 inbox-list.unreadCount
async function markAcceptedAndCleanup(env, uid, msg, msgId, acceptedSection, acceptKind) {
    // §16-A.3(2026-05-24):若从 rejected → accepted(重新激活),unreadCount 已在 reject 时减过,不再减
    const wasFromPending = msg.status === 'pending';
    msg.status = 'accepted';
    msg.acceptedAt = timestamp();
    if (acceptedSection) msg.acceptedSection = acceptedSection;
    msg.acceptKind = acceptKind; // 'public' | 'encrypted'(2026-05-24 起不再有 'discarded')
    delete msg.rejectedAt;       // 重新激活时清掉旧拒绝时间戳
    delete msg.rejectReason;
    await env.FAV_KV.put(inboxKey(uid, msgId), JSON.stringify(msg));
    if (wasFromPending) {
        const list = await readInboxList(env, uid);
        if (list.unreadCount > 0) list.unreadCount -= 1;
        await writeInboxList(env, uid, list);
    }
    // §14 P2P(2026-05-29):同步发件方 sent 副本状态(P2P 路径才有 sent;admin /api/push 路径无 sent 副本会被 syncSentStatus 跳过)
    await syncSentStatus(env, msg, {
        status: 'accepted',
        acceptedAt: msg.acceptedAt,
        acceptedSection: acceptedSection || null,
        acceptKind,
        editedBeforeAccept: msg.editedBeforeAccept === true ? true : undefined,
        acceptedCards: msg.acceptedCards || undefined
    });
    return jsonResponse({ ok: true, msgId, status: 'accepted', acceptKind, acceptedSection: acceptedSection || null });
}

// §14 P2P(2026-05-29):把接收方的 msg 状态变化同步到发件方的 sent 副本
//   发件方 sent KV key:user:<fromUid>:sent:<msgId>(放发件方 user namespace 下,删用户时自动清理)
//   只有 send action 写过 sent 副本时此函数才有目标;admin /api/push 路径无 sent → sent 副本读取 null → 直接 return
//   失败 try/catch 不阻断主路径(接收方 inbox 状态优先)
async function syncSentStatus(env, msg, updates) {
    if (!env.FAV_KV) return;
    const fromUid = msg && msg.fromUid;
    const msgId   = msg && msg.msgId;
    if (!fromUid || !msgId) return;
    try {
        const sentRaw = await env.FAV_KV.get(sentKey(fromUid, msgId));
        if (!sentRaw) return;  // 发件方走 /api/push (admin) 而非 send action → 无 sent 副本,跳过
        const sent = JSON.parse(sentRaw);
        // merge 非 undefined 字段(undefined 不覆盖现有值)
        for (const k of Object.keys(updates || {})) {
            if (updates[k] !== undefined) sent[k] = updates[k];
        }
        // 状态切换时清掉互斥字段
        if (updates && updates.status === 'accepted') {
            delete sent.rejectedAt;
            delete sent.rejectReason;
        } else if (updates && updates.status === 'rejected') {
            delete sent.acceptedAt;
            delete sent.acceptedSection;
            delete sent.acceptKind;
            delete sent.editedBeforeAccept;
            delete sent.acceptedCards;
        }
        await env.FAV_KV.put(sentKey(fromUid, msgId), JSON.stringify(sent));
    } catch (e) {
        console.warn('syncSentStatus failed:', e && e.message);
    }
}

function timestamp() {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + '_' +
           p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
}

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

// ─────────────────────────────────────────────────────────────
// appendCardsToSection 与 push.js 的实现完全一致(D RY 暂时复制,避免新建 _shared 模块的连锁改动)
// 后续若两边继续演化,再抽 _shared/data-merge.js
// ─────────────────────────────────────────────────────────────
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
                return { modified: true, skipped: true, skippedReason: '该 section 是加密大类' };
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
                return { modified: true, skipped: true, skippedReason: '该 section 是加密大类' };
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

/* ============ 通用扫描工具 ============ */
function isWs(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r'; }
function isIdChar(c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_' || c === '$';
}
function skipWs(src, pos) {
    const n = src.length;
    while (pos < n) {
        const c = src[pos];
        if (isWs(c)) { pos++; continue; }
        if (c === '/' && src[pos + 1] === '/') { while (pos < n && src[pos] !== '\n') pos++; continue; }
        if (c === '/' && src[pos + 1] === '*') {
            pos += 2;
            while (pos + 1 < n && !(src[pos] === '*' && src[pos + 1] === '/')) pos++;
            pos += 2; continue;
        }
        break;
    }
    return pos;
}
function skipString(src, pos) {
    const quote = src[pos]; pos++;
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
    pos++; let depth = 1; const n = src.length;
    while (pos < n && depth > 0) {
        const c = src[pos];
        if (c === '"' || c === "'" || c === '`') { pos = skipString(src, pos); continue; }
        if (c === '/' && src[pos + 1] === '/') { while (pos < n && src[pos] !== '\n') pos++; continue; }
        if (c === '/' && src[pos + 1] === '*') {
            pos += 2;
            while (pos + 1 < n && !(src[pos] === '*' && src[pos + 1] === '/')) pos++;
            pos += 2; continue;
        }
        if (c === open) depth++; else if (c === close) depth--;
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
        if (c === '/' && src[pos + 1] === '/') { while (pos < n && src[pos] !== '\n') pos++; continue; }
        if (c === '/' && src[pos + 1] === '*') {
            pos += 2;
            while (pos + 1 < n && !(src[pos] === '*' && src[pos + 1] === '/')) pos++;
            pos += 2; continue;
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
