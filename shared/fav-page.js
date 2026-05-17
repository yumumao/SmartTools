/* ================================================================================
 * shared/fav-page.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 收藏夹页面通用逻辑（index1 / index2 / index3 / index4 / index5 五个风格共用）
 *
 * 依赖（必须在本文件之前加载）：
 *   1. data.js                → 提供 usbDriveData / teachingData / onlineAIData /
 *                               videoData / contactData / emailData / customSections
 *   2. shared/enc-unlock.js   → 加密大类解锁模块（可选）
 *   3. shared/enc-rerender.js → 加密模块锁/解锁无刷新重渲染（可选）
 *   4. shared/note-modal.js   → 卡片注释模态框（可选）
 *
 * 每个页面在引入本文件之前，需要设置：
 *   <script>window.__FAV_PAGE_ID = 'indexN.html';</script>
 * ================================================================================ */


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 1】风格持久化
 * ════════════════════════════════════════════════════════════════════════════════ */
try {
    if (window.__FAV_PAGE_ID) {
        localStorage.setItem('fav_last_style', window.__FAV_PAGE_ID);
    }
} catch (e) {}


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 2】数据格式适配 & 缺失兜底
 * ════════════════════════════════════════════════════════════════════════════════ */
// ★ 统一格式：老数据（分散 var）自动包装为 sections 数组
function normalizeData() {
    if (window.__sections) return window.__sections;
    if (Array.isArray(window.sections)) {
        // ★ 修正内置分类的 dynamic 标志（防止 generateDataJs 可能写入的错误值）
        var BUILTIN_DYNAMIC = { onlineAIData: true, videoData: true };
        window.sections.forEach(function(s) {
            if (s.builtin && BUILTIN_DYNAMIC.hasOwnProperty(s.key)) s.dynamic = BUILTIN_DYNAMIC[s.key];
        });
        window.__sections = window.sections;
        window.__sectionIndexMap = {};
        window.__sections.forEach(function(sec, i) { window.__sectionIndexMap[sec.key] = i; });
        return window.__sections;
    }

    // 老格式：var usbDriveData / teachingData / ... → 包装
    if (typeof usbDriveData !== 'undefined') {
        var s = [];
        // ★ 普通卡片大类（自定义大类会插在它们之后）
        var cardDefs = [
            { key:'usbDriveData',  kind:'card',    defaultLabel:'☁️ 在线U盘',    label:'☁️ 在线U盘',    dynamic:false },
            { key:'teachingData',  kind:'card',    defaultLabel:'📚 授课资料',    label:'📚 授课资料',    dynamic:false },
            { key:'onlineAIData',  kind:'card',    defaultLabel:'🖥️ 网络资源',    label:'🖥️ 网络资源',    dynamic:true  },
            { key:'videoData',     kind:'card',    defaultLabel:'🎬 视频聚合',    label:'🎬 视频聚合',    dynamic:true  }
        ];
        // ★ 联系类大类（永远排在自定义大类之后，让 email/contact 紧贴显示）
        var contactDefs = [
            { key:'emailData',     kind:'email',   defaultLabel:'📨 联系方式',    label:'📨 联系方式',    dynamic:false },
            { key:'contactData',   kind:'contact', defaultLabel:'📨 其他联系方式', label:'📨 其他联系方式', dynamic:false }
        ];
        cardDefs.forEach(function(d) {
            s.push({ builtin:true, key:d.key, kind:d.kind, defaultLabel:d.defaultLabel, label:d.label, visible:true, dynamic:d.dynamic, cards: window[d.key] || [] });
        });
        // 自定义大类插在 card 之后、contact 之前
        if (Array.isArray(window.customSections)) {
            window.customSections.forEach(function(c) {
                // ★ P3-5: 透传 anchor 字段(老格式),fav-page 渲染时会过 __safeAnchor
                s.push({ builtin:false, key:c.key, kind:'card', defaultLabel:c.label, label:c.label, visible:true, dynamic:!!c.dynamic, encrypted:!!c.encrypted, enc:c.enc||null, cards:c.cards||[], anchor: c.anchor || '' });
            });
        }
        contactDefs.forEach(function(d) {
            s.push({ builtin:true, key:d.key, kind:d.kind, defaultLabel:d.defaultLabel, label:d.label, visible:true, dynamic:d.dynamic, cards: window[d.key] || [] });
        });
        window.__sections = s;
        // ★ 建立 key→index 映射供 note-modal.js 等使用
        window.__sectionIndexMap = {};
        s.forEach(function(sec, i) { window.__sectionIndexMap[sec.key] = i; });
        return s;
    }

    // 完全无数据
    var _container = document.querySelector('.container');
    if (_container) {
        _container.innerHTML =
            '<div class="error-container"><div class="error-card">' +
                '<span class="error-emoji">📂</span>' +
                '<h2 class="error-title">数据加载失败</h2>' +
                '<p class="error-message">收藏夹内容未能加载，可能是数据文件缺失或存在语法错误。</p>' +
                '<a href="toolsindex.html" class="error-home-btn">← 返回主页</a>' +
            '</div></div>';
    }
    throw new Error('数据文件未加载');
}
normalizeData();


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 3】全局状态变量
 * ════════════════════════════════════════════════════════════════════════════════ */
var currentExpanded  = null;
var currentLayout    = 'mobile';
var currentEmailData = null;  // ★ 动态设置（首个 email 类型 section 的第一张卡片）
var isAnimating      = false;
var __allSections    = window.__sections;  // ★ 统一数据源


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 3.5】卡片注册表（供 NoteModal 定位卡片对象 + 保存时回写 meta）
 * ════════════════════════════════════════════════════════════════════════════════
 * 每次重渲染会重新生成新的 id，旧 id 仍留在表里不影响当前页面使用。
 * meta 字段：
 *   sectionKey   → 'usb-drive' / 'teaching' / 'ai' / 'video' / 'contact' / 自定义 key
 *   cardIndex    → 在该大类数组里的下标
 *   subIndex     → 子卡片下标（仅子卡片）
 *   emailIndex   → 邮箱 Tab 下标（仅邮箱卡）
 *   encrypted    → 是否加密大类
 *   uniqueKey    → 会话级备份用的稳定 key
 * ──────────────────────────────────────────────────────────────────────────────── */
var __cardRegistry = {};
var __cardIdSeq    = 0;

function __registerCard(card, meta) {
    meta = meta || {};
    if (!meta.uniqueKey) {
        meta.uniqueKey =
            (meta.sectionKey || '?') +
            '/' + (meta.cardIndex != null ? meta.cardIndex : (meta.emailIndex != null ? 'email' + meta.emailIndex : '?')) +
            (meta.subIndex != null ? '/' + meta.subIndex : '');
    }
    var id = '__fc_' + (++__cardIdSeq);
    __cardRegistry[id] = { card: card, meta: meta };
    return id;
}

/**
 * 卡片点击统一入口（非 <a> 标签使用）：
 *   有 comment → 弹注释；无 comment → 打开 url；两者都没有 → 不响应
 */
window.__favCardOpen = function(cardId) {
    var entry = __cardRegistry[cardId];
    if (!entry) return;
    var card = entry.card;
    if (card.comment && window.NoteModal) {
        window.NoteModal.show(cardId);
        return;
    }
    var url = __safeUrl(card.url);
    if (!url || url === '#') return;
    if (card.isLocal) window.location.href = url;
    else              window.open(url, '_blank', 'noopener,noreferrer');
};

/**
 * <a href> 版本的点击拦截：有 comment 就拦截，否则让浏览器默认行为（支持中键）
 */
window.__favLinkClick = function(cardId, event) {
    var entry = __cardRegistry[cardId];
    if (!entry || !entry.card.comment || !window.NoteModal) return true;
    if (event && event.preventDefault) event.preventDefault();
    window.NoteModal.show(cardId);
    return false;
};

/**
 * 邮箱卡片点击（currentEmailData 会变，所以每次点击时动态注册）
 *
 * Step 4 改造:外层主卡现在是 <a target=_blank>,左键 onclick 必须 preventDefault 阻止默认跳转,
 * 才能走"有 comment 弹注释"分支;无 comment 时 fallback 仍然 window.open(等价于让 <a> 跳)。
 * 中键不触发 onclick → 走 <a> 原生 → 后台 ✅。
 */
window.__favEmailClick = function(event) {
    if (event && event.preventDefault) event.preventDefault();
    var cd = currentEmailData;
    if (!cd) return;
    if (cd.comment && window.NoteModal) {
        var cards = getEmailCards();
        var idx = cards.indexOf(cd);
        var cid = __registerCard(cd, {
            sectionKey: 'emailData',
            emailIndex: idx,
            uniqueKey:  'emailData/email/' + idx
        });
        window.NoteModal.show(cid);
    } else if (cd.url) {
        var url = __safeUrl(cd.url);
        if (url && url !== '#') window.open(url, '_blank', 'noopener,noreferrer');
    }
};

/** 有注释的卡片类名（用于右上角小红点） */
function __noteCls(card) { return card && card.comment ? ' has-note' : ''; }

/** 工具：把字符串安全地嵌入到 HTML 属性里（仅针对 url / descUrl 等） */
function __attr(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 工具：HTML 文本节点转义（防止 XSS：title/desc/label 等用户内容拼进 innerHTML 前必过） */
function __txt(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 工具：URL 协议白名单（卡片跳转/描述跳转）→ 拒绝 javascript: 等危险协议 */
function __safeUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    if (/^(?:https?:|mailto:|tel:|\/|#|\?)/i.test(s)) return s;
    return '#';
}

/** 工具：图片 URL 白名单（iconImg）→ 允许 data:image/ + http(s) + 相对路径 */
function __safeImgUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    if (/^(?:https?:|\/|data:image\/[a-zA-Z+.-]+;)/i.test(s)) return s;
    return '';
}

/** 工具：HTML id / URL hash 的 anchor 合法性过滤（P3-5）
 *  - 只允许 [a-zA-Z0-9_-]，避免 CSS selector 转义 / URL encode 的麻烦
 *  - 不合法或空 → 返回空字符串，调用方降级到 sec.key */
function __safeAnchor(s) {
    if (s == null) return '';
    s = String(s).trim();
    if (!s) return '';
    return /^[a-zA-Z0-9_-]+$/.test(s) ? s : '';
}

/**
 * 全局事件委托：[data-desc-url] 的描述行跳转。
 * 替代原本拼到 onclick 属性里的 window.open(...) 字符串拼接，
 * 让 __safeUrl + __attr 真正生效，并统一加 noopener,noreferrer。
 * 注意：必须在文档解析后注册，所以放进 DOMContentLoaded 也可以；
 * 但 click 事件冒泡阶段委托对动态渲染同样有效，所以在脚本顶部注册即可。
 */
document.addEventListener('click', function(e) {
    if (!e.target || !e.target.closest) return;

    // ① 描述行独立跳转
    //    preventDefault 阻止外层 <a class="link-card"> 的默认跳转(desc-clickable 主卡现在是 <a> 包裹的)
    var descEl = e.target.closest('[data-desc-url]');
    if (descEl) {
        var url = descEl.getAttribute('data-desc-url');
        if (url && url !== '#') {
            e.preventDefault();
            e.stopPropagation();
            window.open(url, '_blank', 'noopener,noreferrer');
        }
        return;
    }

    // ② 展开/折叠 section 按钮
    var secBtn = e.target.closest('.expand-section-btn[data-section-key]');
    if (secBtn) {
        var key = secBtn.getAttribute('data-section-key');
        if (key && typeof toggleSection === 'function') toggleSection(key);
    }
});

/**
 * 全局事件委托:鼠标中键 → 在后台(新标签)打开卡片 url。
 * 与左键语义并行,**不影响**左键的注释弹窗/分区点击/展开等现有行为。
 *
 * 实现细节:用 `mousedown` + `e.button===1` + `preventDefault()`。
 *   - 不用 auxclick:Chrome/Edge 在 <div> 上按中键会进入"自动滚动模式"
 *     (光标变 ⊕),会吞掉后续的 auxclick;<a> 元素是浏览器原生路径不受影响。
 *   - mousedown + preventDefault 能阻止自动滚动模式启动,统一覆盖所有 DOM 类型。
 *
 * 规则:
 *   - desc-clickable / contact 描述行(data-desc-url) → 打开 descUrl
 *   - .expand-zone / .expand-btn / .expand-section-btn → 中键忽略(展开是左键专用)
 *   - <a> 卡片(simple 有 url) → 让浏览器原生处理,自身不拦截
 *   - 其它带 data-card-id 的卡片 → 跳过 comment 直接打开 card.url(__safeUrl 校验)
 *   - card.url 不存在/为 # → 不响应(加密未解锁、纯 comment 卡、email 卡等)
 * 安全:同样走 __safeUrl + noopener,noreferrer。
 */
document.addEventListener('mousedown', function(e) {
    if (e.button !== 1) return;          // 仅鼠标中键
    if (!e.target || !e.target.closest) return;

    // ① 描述行 → 打开 descUrl
    var descEl = e.target.closest('[data-desc-url]');
    if (descEl) {
        var dUrl = descEl.getAttribute('data-desc-url');
        if (dUrl && dUrl !== '#') {
            e.preventDefault();
            window.open(dUrl, '_blank', 'noopener,noreferrer');
        }
        return;
    }

    // ② 大类折叠按钮 → 中键忽略(大类不该被中键打开任何东西)
    //    ※ .expand-zone / .expand-btn 不再短路 — 它们现在位于 <a class="link-card-with-expand"> 内层,
    //    中键应该让 <a> 原生路径生效(整张卡后台打开)。下方 ③ 已用 cardEl.tagName==='A' 跳过 JS 路径。
    if (e.target.closest('.expand-section-btn')) return;

    // ③ 卡片本体 → 跳过 comment 打开 url
    var cardEl = e.target.closest('[data-card-id]');
    if (!cardEl) return;
    // <a> 卡片让浏览器原生中键处理,避免和 target=_blank 冲突
    if (cardEl.tagName === 'A') return;
    var entry = __cardRegistry[cardEl.getAttribute('data-card-id')];
    if (!entry || !entry.card) return;
    var cUrl = __safeUrl(entry.card.url);
    if (!cUrl || cUrl === '#') return;
    e.preventDefault();
    window.open(cUrl, '_blank', 'noopener,noreferrer');
}, true);  // capture 阶段,确保优先于其它潜在 mousedown 处理器


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 4】基础工具函数
 * ════════════════════════════════════════════════════════════════════════════════ */
function detectLayout() {
    var w = window.innerWidth;
    if (w <= 480) return 'mobile';
    if (w <= 799) return 'tablet';
    return 'desktop';
}

function alignStyleSwitcher() {
    var container = document.querySelector('.container');
    var switcher  = document.getElementById('styleSwitcher');
    if (!container || !switcher) return;
    var rect = container.getBoundingClientRect();
    switcher.style.right = (document.documentElement.clientWidth - rect.right) + 'px';
}

/** SVG 安全过滤：移除事件处理器、脚本、危险元素，防存储型 XSS */
function sanitizeSVG(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw
        .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
        .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
        .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
        .replace(/\bon\w+\s*=\s*[^\s>\/]+/gi, '')
        .replace(/(?:href|xlink:href)\s*=\s*["']\s*javascript:/gi, 'data-removed="javascript-uri"');
}

function renderIcon(item, extraAttrs) {
    extraAttrs = extraAttrs || '';
    if (item.iconImg) {
        var safeImg = __safeImgUrl(item.iconImg);
        if (safeImg) {
            return '<span class="link-icon" ' + extraAttrs + ' aria-hidden="true"><img src="' + __attr(safeImg) + '" alt="" /></span>';
        }
        return '<span class="link-icon" ' + extraAttrs + ' aria-hidden="true"></span>';
    }
    var icon = item.icon || '';
    if (icon.charAt(0) === '<') {
        return '<span class="link-icon link-icon-svg" ' + extraAttrs + '>' + sanitizeSVG(icon) + '</span>';
    }
    return '<span class="link-icon" ' + extraAttrs + '>' + __txt(icon) + '</span>';
}


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 5】卡片 HTML 生成器
 * ════════════════════════════════════════════════════════════════════════════════ */

function generateCardHTML(card, meta) {
    var cid = __registerCard(card, meta || {});
    var noteCls = __noteCls(card);

    // ─── 类型 1：简单卡片 ──────────────────────────────────────────────
    if (card.type === 'simple') {
        // ★ 有 url → 用 <a>（支持中键 / Ctrl+点击在新标签打开）
        // ★ 无 url → 用 <div>（避免 href=undefined 空白页；此时一般都有 comment）
        if (card.url) {
            return '<a href="' + __attr(__safeUrl(card.url)) + '" target="_blank" rel="noopener noreferrer" class="link-card' + noteCls + '" ' +
                   'data-card-id="' + cid + '" ' +
                   'onclick="return __favLinkClick(\'' + cid + '\', event)">' +
                renderIcon(card) +
                '<h3 class="link-title">' + __txt(card.title) + '</h3>' +
                '<p class="link-desc">' + __txt(card.desc || '') + '</p></a>';
        }
        return '<div class="link-card' + noteCls + '" data-card-id="' + cid + '" ' +
               'onclick="__favCardOpen(\'' + cid + '\')">' +
            renderIcon(card) +
            '<h3 class="link-title">' + __txt(card.title) + '</h3>' +
            '<p class="link-desc">' + __txt(card.desc || '') + '</p></div>';
    }

    // ─── 类型 2：描述可独立点击的卡片 ───────────────────────────────
    if (card.type === 'desc-clickable') {
        // descUrl 放 data-* 属性，由全局事件委托接管，避免 onclick 字符串拼接的 XSS
        var descUrlAttr = card.descUrl ? ' data-desc-url="' + __attr(__safeUrl(card.descUrl)) + '"' : '';
        // 中键后台打开:有 card.url 时改 <a> 包裹,左键复用 __favLinkClick(有 comment 拦截弹注释,无 comment 浏览器原生跳)
        if (card.url) {
            return '<a href="' + __attr(__safeUrl(card.url)) + '" target="_blank" rel="noopener noreferrer" class="link-card' + noteCls + '" ' +
                   'data-card-id="' + cid + '" ' +
                   'onclick="return __favLinkClick(\'' + cid + '\', event)">' +
                renderIcon(card) +
                '<h3 class="link-title">' + __txt(card.title) + '</h3>' +
                '<p class="link-desc-clickable"' + descUrlAttr + '>' + __txt(card.descClickable) + '</p></a>';
        }
        return '<div class="link-card' + noteCls + '" data-card-id="' + cid + '" ' +
               'onclick="__favCardOpen(\'' + cid + '\')">' +
            renderIcon(card) +
            '<h3 class="link-title">' + __txt(card.title) + '</h3>' +
            '<p class="link-desc-clickable"' + descUrlAttr + '>' + __txt(card.descClickable) + '</p></div>';
    }

    // ─── 类型 3：可展开子卡片的卡片 ─────────────────────────────────
    if (card.type === 'expandable') {
        var descHTML = '';
        if (card.descClickable) {
            var descUrlAttr2 = card.descUrl ? ' data-desc-url="' + __attr(__safeUrl(card.descUrl)) + '"' : '';
            descHTML = '<p class="link-desc-clickable"' + descUrlAttr2 + '>' + __txt(card.descClickable) + '</p>';
        } else if (card.desc) {
            descHTML = '<p class="link-desc">' + __txt(card.desc) + '</p>';
        }
        // 子卡片继承主卡片的 sectionKey + cardIndex，加 subIndex
        var subHTML = '';
        (card.subCards || []).forEach(function(sc, idx) {
            subHTML += generateSubCardHTML(sc, {
                sectionKey: (meta && meta.sectionKey) || '',
                cardIndex:  (meta && meta.cardIndex),
                subIndex:   idx,
                encrypted:  (meta && meta.encrypted)
            });
        });

        // 中键全区域后台打开:有 card.url 时主卡用 <a> 包裹,左键分区点击靠 handleCardClick + preventDefault
        var subcardsId = __attr(card.id) + '-subcards';
        var expandZone = '<div class="expand-zone" onclick="event.stopPropagation(); event.preventDefault(); handleExpandZone(\'' + subcardsId + '\', this)"></div>' +
                         '<button class="expand-btn" title="展开更多"></button>';
        if (card.url) {
            return '<div class="card-container">' +
                '<a href="' + __attr(__safeUrl(card.url)) + '" target="_blank" rel="noopener noreferrer" ' +
                   'class="link-card link-card-with-expand' + noteCls + '" ' +
                   'data-card-id="' + cid + '" ' +
                   'onclick="handleCardClick(event, \'' + cid + '\', \'' + subcardsId + '\')">' +
                renderIcon(card) +
                '<h3 class="link-title">' + __txt(card.title) + '</h3>' +
                descHTML +
                expandZone + '</a>' +
                '<div class="sub-cards" id="' + subcardsId + '">' + subHTML + '</div></div>';
        }
        return '<div class="card-container">' +
            '<div class="link-card link-card-with-expand' + noteCls + '" ' +
                 'data-card-id="' + cid + '" ' +
                 'onclick="handleCardClick(event, \'' + cid + '\', \'' + subcardsId + '\')">' +
            renderIcon(card) +
            '<h3 class="link-title">' + __txt(card.title) + '</h3>' +
            descHTML +
            expandZone + '</div>' +
            '<div class="sub-cards" id="' + subcardsId + '">' + subHTML + '</div></div>';
    }
    return '';
}

/**
 * 生成子卡片。注意：compact-card 里的 sc.note 是"额外小字说明"，
 * 新注释功能使用 sc.comment 字段，二者互不冲突。
 *
 * 中键后台打开:有 sc.url 时改用 <a target=_blank> 包裹,让浏览器原生中键
 * 路径生效(走 __favLinkClick 复用 simple-a 同一拦截:有 comment 弹注释,
 * 无 comment 浏览器原生跳转,中键则后台新标签)。
 * 无 sc.url 时仍用 <div>(没东西可开,保持现状)。
 */
function generateSubCardHTML(sc, meta) {
    var cid      = __registerCard(sc, meta || {});
    var iconHTML = renderIcon(sc);
    var noteCls  = __noteCls(sc);
    var hasUrl   = !!__safeUrl(sc.url);

    if (sc.content !== undefined) {
        // compact-card:有 url 用 <a>,否则用 <div>
        if (hasUrl) {
            return '<a href="' + __attr(__safeUrl(sc.url)) + '" target="_blank" rel="noopener noreferrer" ' +
                   'class="sub-card compact-card' + noteCls + '" data-card-id="' + cid + '" ' +
                   'onclick="return __favLinkClick(\'' + cid + '\', event)">' +
                iconHTML +
                '<div class="link-content"><span class="link-url">' + __txt(sc.content) + '</span>' +
                (sc.note ? '<span class="link-note">' + __txt(sc.note) + '</span>' : '') +
                '</div></a>';
        }
        return '<div class="sub-card compact-card' + noteCls + '" data-card-id="' + cid + '" ' +
               'onclick="__favCardOpen(\'' + cid + '\')">' +
            iconHTML +
            '<div class="link-content"><span class="link-url">' + __txt(sc.content) + '</span>' +
            (sc.note ? '<span class="link-note">' + __txt(sc.note) + '</span>' : '') +
            '</div></div>';
    }
    // two-line-card:有 url 用 <a>,否则用 <div>
    if (hasUrl) {
        return '<a href="' + __attr(__safeUrl(sc.url)) + '" target="_blank" rel="noopener noreferrer" ' +
               'class="sub-card two-line-card' + noteCls + '" data-card-id="' + cid + '" ' +
               'onclick="return __favLinkClick(\'' + cid + '\', event)">' +
            '<div class="card-header">' + iconHTML +
            '<h3 class="link-title">' + __txt(sc.title) + '</h3></div>' +
            '<p class="link-url">' + __txt(sc.desc || '') + '</p></a>';
    }
    return '<div class="sub-card two-line-card' + noteCls + '" data-card-id="' + cid + '" ' +
           'onclick="__favCardOpen(\'' + cid + '\')">' +
        '<div class="card-header">' + iconHTML +
        '<h3 class="link-title">' + __txt(sc.title) + '</h3></div>' +
        '<p class="link-url">' + __txt(sc.desc || '') + '</p></div>';
}


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 6】网格生成器
 * ════════════════════════════════════════════════════════════════════════════════ */

function generateStaticGrid(data, sectionKey, encrypted) {
    var html = '<div class="links-grid">';
    data.forEach(function(card, idx) {
        html += generateCardHTML(card, {
            sectionKey: sectionKey || '',
            cardIndex:  idx,
            encrypted:  !!encrypted
        });
    });
    return html + '</div>';
}

function getVisibleCount(prefix, layout) {
    // ★ 匹配新的 section key 格式
    if (prefix === 'videoData') {
        return layout === 'mobile' ? 4 : layout === 'tablet' ? 6 : 8;
    }
    if (prefix === 'onlineAIData') {
        return layout === 'tablet' ? 3 : 4;
    }
    if (typeof prefix === 'string' && prefix.indexOf('custom_') === 0) {
        return layout === 'mobile' ? 4 : layout === 'tablet' ? 6 : 8;
    }
    return 999;
}

function generateDynamicGrid(prefix, data, layout, encrypted) {
    var count   = getVisibleCount(prefix, layout);
    var visible = data.slice(0, count);
    var hidden  = data.slice(count);

    var html = '<div class="links-grid">';
    visible.forEach(function(card, idx) {
        html += generateCardHTML(card, {
            sectionKey: prefix,
            cardIndex:  idx,
            encrypted:  !!encrypted
        });
    });
    html += '</div>';

    if (hidden.length > 0) {
        html += '<button class="expand-section-btn" data-section-key="' + __attr(prefix) + '" id="' + __attr(prefix) + '-expand-btn">' +
            '<span>展开卡片</span><span class="arrow">▼</span></button>';
        html += '<div class="hidden-cards" id="' + __attr(prefix) + '-hidden-cards">';
        hidden.forEach(function(card, idx) {
            html += generateCardHTML(card, {
                sectionKey: prefix,
                cardIndex:  count + idx,
                encrypted:  !!encrypted
            });
        });
        html += '</div>';
        html += '<button class="expand-section-btn" data-section-key="' + __attr(prefix) + '" id="' + __attr(prefix) + '-collapse-btn" style="display:none;">' +
            '<span>折叠卡片</span><span class="arrow">▲</span></button>';
    }
    return html;
}


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 7】联系方式 / 邮箱卡片
 * ════════════════════════════════════════════════════════════════════════════════ */

function generateEmailCardHTML(cards) {
    cards = cards || [];
    var tabsHTML = '';
    cards.forEach(function(em, i) {
        var cls = i === 0 ? ' active' : '';
        // tab 内联 onclick 加 preventDefault,防止触发外层 <a> 的默认跳转
        tabsHTML += '<div class="email-tab' + cls + '" onclick="event.stopPropagation(); event.preventDefault(); switchEmail(' + i + ')" data-email="' + i + '">' + (i + 1) + '</div>';
    });
    var first = cards[0] || {};
    var noteCls = __noteCls(first);
    // 中键后台:外层用 <a> 包裹,href=当前邮箱卡(cards[0])的 url;切 tab 时由 switchEmail 同步更新 href。
    // 若 first.url 缺失则 href="#",中键不响应(浏览器对 # 不开新标签)。
    var firstUrl = __safeUrl(first.url) || '#';
    return '<div class="card-container">' +
        '<a href="' + __attr(firstUrl) + '" target="_blank" rel="noopener noreferrer" ' +
           'class="link-card email-card' + noteCls + '" id="email-card-root" ' +
           'onclick="return __favEmailClick(event)">' +
        '<div class="email-main-content" id="email-main-content">' +
        '<div class="email-contact-header">' +
        renderIcon(first, 'id="email-icon"') +
        '<h3 class="link-title" id="email-title">' + __txt(first.title || '') + '</h3>' +
        '</div>' +
        '<p class="email-contact-desc" id="email-address">' + __txt(first.address || '') + '</p>' +
        '</div>' +
        '<div class="email-tabs active-0" id="email-tabs">' + tabsHTML + '</div>' +
        '</a></div>';
}

function generateContactCardHTML(card, meta) {
    var cid = __registerCard(card, meta || {});
    var noteCls = __noteCls(card);
    var descUrlAttr = card.descUrl ? ' data-desc-url="' + __attr(__safeUrl(card.descUrl)) + '"' : '';
    // 中键后台:有 card.url 时主卡用 <a> 包裹,左键复用 __favLinkClick(同 desc-clickable 路径)
    if (card.url) {
        return '<a href="' + __attr(__safeUrl(card.url)) + '" target="_blank" rel="noopener noreferrer" ' +
               'class="link-card contact-card-wrap' + noteCls + '" data-card-id="' + cid + '" ' +
               'onclick="return __favLinkClick(\'' + cid + '\', event)">' +
            '<div class="contact-header">' + renderIcon(card) +
            '<h3 class="link-title">' + __txt(card.title) + '</h3></div>' +
            '<p class="contact-desc"' + descUrlAttr + '>' + __txt(card.desc) + '</p></a>';
    }
    return '<div class="link-card contact-card-wrap' + noteCls + '" data-card-id="' + cid + '" ' +
           'onclick="__favCardOpen(\'' + cid + '\')">' +
        '<div class="contact-header">' + renderIcon(card) +
        '<h3 class="link-title">' + __txt(card.title) + '</h3></div>' +
        '<p class="contact-desc"' + descUrlAttr + '>' + __txt(card.desc) + '</p></div>';
}

function generateContactGrid() {
    var html = '<div class="links-grid contact-row">';
    html += generateEmailCardHTML();
    contactData.forEach(function(card, idx) {
        html += generateContactCardHTML(card, {
            sectionKey: 'contact',
            cardIndex:  idx
        });
    });
    return html + '</div>';
}


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 8】卡片交互逻辑
 * ════════════════════════════════════════════════════════════════════════════════ */

/**
 * 可展开卡片的点击分区：
 *   - 右 40% → 展开/收起
 *   - 左 60% → __favCardOpen（有 comment 弹注释，否则打开 url）
 */
function handleCardClick(event, cardId, subcardId) {
    // expandable 主卡现在是 <a target=_blank> 包裹,左键必须阻止默认跳转才能走分区点击逻辑;
    // 中键不触发 onclick(浏览器中键直接走 <a> 原生路径 → 后台打开),所以这里不影响中键。
    if (event && event.preventDefault) event.preventDefault();
    var cardEl = event.currentTarget;
    var rect   = cardEl.getBoundingClientRect();
    var clickX = event.clientX - rect.left;
    if (clickX > rect.width * 3 / 5) {
        var btn = cardEl.querySelector('.expand-btn');
        if (btn) toggleSubCards(subcardId, btn);
    } else {
        __favCardOpen(cardId);
    }
}

function handleExpandZone(subcardId, zone) {
    var btn = zone.closest('.link-card').querySelector('.expand-btn');
    if (btn) toggleSubCards(subcardId, btn);
}

function toggleSubCards(subcardId, button) {
    var subcards      = document.getElementById(subcardId);
    var overlay       = document.getElementById('overlay');
    var cardContainer = button.closest('.card-container');
    var isExpanded    = subcards.classList.contains('expanded');

    if (currentExpanded && currentExpanded !== subcardId) {
        var otherSubcards = document.getElementById(currentExpanded);
        if (otherSubcards) {
            var otherButton    = otherSubcards.parentElement.querySelector('.expand-btn');
            var otherContainer = otherButton.closest('.card-container');
            otherSubcards.classList.remove('expanded');
            otherButton.classList.remove('expanded');
            otherContainer.classList.remove('active');
        }
    }

    if (isExpanded) {
        subcards.classList.remove('expanded');
        button.classList.remove('expanded');
        cardContainer.classList.remove('active');
        overlay.classList.remove('active');
        currentExpanded = null;
    } else {
        subcards.classList.add('expanded');
        button.classList.add('expanded');
        cardContainer.classList.add('active');
        overlay.classList.add('active');
        currentExpanded = subcardId;
    }
}

function toggleSection(prefix) {
    var section     = document.getElementById(prefix + '-hidden-cards');
    var expandBtn   = document.getElementById(prefix + '-expand-btn');
    var collapseBtn = document.getElementById(prefix + '-collapse-btn');
    var isExpanded  = section.classList.contains('expanded');

    if (isExpanded) {
        section.classList.remove('hover-ready');
        section.classList.add('collapsing');
        collapseBtn.classList.add('moving');
        setTimeout(function() {
            section.classList.remove('expanded', 'collapsing');
            collapseBtn.style.display = 'none';
            collapseBtn.classList.remove('moving');
            setTimeout(function() {
                expandBtn.style.display = 'flex';
                expandBtn.classList.remove('moving');
            }, 100);
        }, 600);
    } else {
        expandBtn.classList.add('moving');
        setTimeout(function() {
            expandBtn.style.display = 'none';
            section.classList.add('expanded');
            setTimeout(function() { section.classList.add('hover-ready'); }, 2500);
            setTimeout(function() {
                collapseBtn.style.display = 'flex';
                collapseBtn.classList.remove('moving');
            }, 400);
        }, 200);
    }
}

function autoExpandSection(prefix) {
    var section     = document.getElementById(prefix + '-hidden-cards');
    var expandBtn   = document.getElementById(prefix + '-expand-btn');
    var collapseBtn = document.getElementById(prefix + '-collapse-btn');
    if (!section || !expandBtn) return;
    expandBtn.style.display = 'none';
    section.classList.add('expanded', 'hover-ready');
    if (collapseBtn) collapseBtn.style.display = 'flex';
}


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 9】邮箱切换
 * ════════════════════════════════════════════════════════════════════════════════ */
// ★ 从 sections 中获取 email 数据
function getEmailCards() {
    var emailSec = __allSections.find(function(s) { return s.kind === 'email' && s.visible !== false; });
    return (emailSec && emailSec.cards) ? emailSec.cards : [];
}

function switchEmail(index) {
    var emailCards = getEmailCards();
    if (isAnimating || index >= emailCards.length) return;
    var currentIndex = emailCards.indexOf(currentEmailData);
    if (currentIndex === index) return;

    isAnimating = true;
    var mainContent = document.getElementById('email-main-content');
    mainContent.classList.add('slide-out');

    setTimeout(function() {
        currentEmailData = emailCards[index];

        // 中键后台:外层 <a> 的 href 同步到新邮箱卡的 url(若空则 # 表示中键不响应)
        var emailRootA = document.getElementById('email-card-root');
        if (emailRootA && emailRootA.tagName === 'A') {
            var newUrl = __safeUrl(currentEmailData.url) || '#';
            emailRootA.setAttribute('href', newUrl);
        }

        var emailIconEl = document.getElementById('email-icon');
        if (currentEmailData.iconImg) {
            var safeMailImg = __safeImgUrl(currentEmailData.iconImg);
            emailIconEl.innerHTML = safeMailImg
                ? '<img src="' + __attr(safeMailImg) + '" alt="" />'
                : '';
            emailIconEl.className = 'link-icon';
        } else if (currentEmailData.icon && currentEmailData.icon.charAt(0) === '<') {
            emailIconEl.innerHTML = sanitizeSVG(currentEmailData.icon);
            emailIconEl.className = 'link-icon link-icon-svg';
        } else {
            // textContent 已经隐式做了 HTML 转义,无需再 __txt
            emailIconEl.textContent = currentEmailData.icon || '';
            emailIconEl.className = 'link-icon';
        }

        document.getElementById('email-title').textContent   = currentEmailData.title;
        document.getElementById('email-address').textContent = currentEmailData.address;

        var addressEl = document.getElementById('email-address');
        addressEl.onclick = function(event) {
            event.stopPropagation();
            event.preventDefault();  // 外层 <a> 已经接管整张卡;address 行有 mailto 时单独走 window.open
            if (currentEmailData.mailto) {
                var u = __safeUrl(currentEmailData.mailto);
                if (u && u !== '#') window.open(u, '_blank', 'noopener,noreferrer');
            }
        };

        // 切换时同步"有注释"红点状态
        var emailRoot = document.getElementById('email-card-root');
        if (emailRoot) {
            if (currentEmailData.comment) emailRoot.classList.add('has-note');
            else                          emailRoot.classList.remove('has-note');
        }

        mainContent.classList.remove('slide-out');
        mainContent.classList.add('slide-in');
        setTimeout(function() {
            mainContent.classList.remove('slide-in');
            mainContent.classList.add('slide-in-active');
            setTimeout(function() {
                mainContent.classList.remove('slide-in-active');
                isAnimating = false;
            }, 400);
        }, 50);
    }, 200);

    document.querySelectorAll('.email-tab').forEach(function(tab, i) {
        if (i === index) tab.classList.add('active');
        else tab.classList.remove('active');
    });
    document.getElementById('email-tabs').className = 'email-tabs active-' + index;
}

function openEmail(url) {
    var u = __safeUrl(url);
    if (u && u !== '#') window.open(u, '_blank', 'noopener,noreferrer');
}


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 10】对外 API（enc-rerender.js / note-modal.js 使用）
 * ════════════════════════════════════════════════════════════════════════════════ */
window.__favPageAPI = {
    getLayout: function() { return currentLayout; },
    // ★ 重渲染单个 section（供 enc-rerender 调用）
    renderSection: function(sec, layout) {
        var contentEl = document.getElementById(sec.key + '-content');
        if (!contentEl) return;
        if (window.EncUnlock && EncUnlock.isLocked(sec)) {
            contentEl.innerHTML = '';
            contentEl.appendChild(EncUnlock.makeLockedPlaceholder(sec));
        } else {
            renderOneSection(sec, layout || currentLayout);
        }
    },
    getCardById: function(id) { return __cardRegistry[id] || null; },
    clearExpandedState: function() {
        if (!currentExpanded) return;
        var subs = document.getElementById(currentExpanded);
        if (subs) {
            var btn = subs.parentElement && subs.parentElement.querySelector('.expand-btn');
            var ctn = btn && btn.closest('.card-container');
            subs.classList.remove('expanded');
            if (btn) btn.classList.remove('expanded');
            if (ctn) ctn.classList.remove('active');
        }
        var ol = document.getElementById('overlay');
        if (ol) ol.classList.remove('active');
        currentExpanded = null;
    }
};


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 11】右上角风格切换下拉菜单
 * ════════════════════════════════════════════════════════════════════════════════ */
function toggleStyleMenu(e) {
    e.stopPropagation();
    var menu = document.getElementById('styleMenu');
    var btn  = document.getElementById('styleBtn');
    var isOpen = menu.classList.contains('menu-open');
    if (isOpen) {
        menu.classList.remove('menu-open');
        btn.classList.remove('menu-open');
        btn.setAttribute('aria-expanded', 'false');
    } else {
        menu.classList.add('menu-open');
        btn.classList.add('menu-open');
        btn.setAttribute('aria-expanded', 'true');
    }
}


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 12】页面初始化 → 统一遍历 sections 动态渲染
 * ════════════════════════════════════════════════════════════════════════════════ */

// ★ 渲染单个 section（根据 kind 分发）
function renderOneSection(sec, layout) {
    var contentEl = document.getElementById(sec.key + '-content');
    if (!contentEl) return;

    if (window.EncUnlock && EncUnlock.isLocked(sec)) {
        contentEl.innerHTML = '';
        contentEl.appendChild(EncUnlock.makeLockedPlaceholder(sec));
        return;
    }

    var cards = Array.isArray(sec.cards) ? sec.cards : [];
    if (!cards.length) {
        contentEl.innerHTML = '';
        return;
    }

    if (sec.kind === 'email') {
        // ★ 邮箱 + 联系方式合并在一行（桌面端并排，小屏上下）
        if (!currentEmailData) currentEmailData = cards[0];
        var html = '<div class="links-grid contact-row">';
        html += generateEmailCardHTML(cards);
        // 找到 contactData section，把它的卡片也渲染进来
        var contactSec = __allSections.find(function(s) { return s.key === 'contactData' && s.visible !== false; });
        if (contactSec && Array.isArray(contactSec.cards)) {
            contactSec.cards.forEach(function(card, idx) {
                html += generateContactCardHTML(card, { sectionKey: 'contactData', cardIndex: idx });
            });
        }
        html += '</div>';
        contentEl.innerHTML = html;
    } else if (sec.kind === 'contact') {
        contentEl.innerHTML = '<div class="links-grid contact-row">' +
            cards.map(function(card, idx) {
                return generateContactCardHTML(card, { sectionKey: sec.key, cardIndex: idx });
            }).join('') + '</div>';
    } else {
        // kind === 'card'
        if (sec.dynamic) {
            contentEl.innerHTML = generateDynamicGrid(sec.key, cards, layout, !!sec.encrypted);
            if (layout === 'desktop') autoExpandSection(sec.key);
        } else {
            contentEl.innerHTML = generateStaticGrid(cards, sec.key, !!sec.encrypted);
        }
    }
}

// ★ 显示用排序：内置 card 类 → 自定义大类 → 内置 email/contact 类
//   （导出顺序与之解耦，自定义在 data.js 文件中仍位于末尾）
function getDisplayOrderedSections() {
    var builtinCards = __allSections.filter(function(s) { return s.builtin && s.kind === 'card'; });
    var customAll    = __allSections.filter(function(s) { return !s.builtin; });
    var builtinRest  = __allSections.filter(function(s) { return s.builtin && s.kind !== 'card'; });
    return builtinCards.concat(customAll, builtinRest);
}

// ★ 统一渲染所有可见 section 到 #sectionsRoot
function renderAllSections(layout) {
    var root = document.getElementById('sectionsRoot');
    if (!root) return;
    root.innerHTML = '';

    getDisplayOrderedSections().forEach(function(sec) {
        if (sec.visible === false) return;
        // ★ contactData 合并到 email section 中渲染，此处跳过
        if (sec.key === 'contactData') return;
        var sectionEl = document.createElement('div');
        sectionEl.className = 'section';
        if (sec.builtin === false) sectionEl.dataset.customKey = sec.key;

        if (window.EncUnlock && EncUnlock.isLocked(sec)) {
            sectionEl.classList.add('section-locked-pill');
            sectionEl.innerHTML = '<div id="' + __attr(sec.key) + '-content"></div>';
        } else {
            // ★ P3-5：<h2> 的 id 用独立 anchor 字段（用户可自定义短锚点，如 #video）；
            //   未设或非法时降级到 sec.key 保持向后兼容。
            //   <div>...-content> 内部容器仍用 sec.key（renderOneSection / __favPageAPI 都靠它定位）。
            var anchorId = __safeAnchor(sec.anchor) || sec.key;
            sectionEl.innerHTML =
                '<h2 class="section-title" id="' + __attr(anchorId) + '">' + __txt(sec.label || sec.key) + '</h2>' +
                '<div id="' + __attr(sec.key) + '-content"></div>';
        }
        root.appendChild(sectionEl);
        renderOneSection(sec, layout);
    });
}

document.addEventListener('DOMContentLoaded', async function() {

    document.addEventListener('click', function(e) {
        if (!e.target.closest('#styleSwitcher')) {
            var menu = document.getElementById('styleMenu');
            var btn  = document.getElementById('styleBtn');
            if (menu && menu.classList.contains('menu-open')) {
                menu.classList.remove('menu-open');
                btn.classList.remove('menu-open');
                btn.setAttribute('aria-expanded', 'false');
            }
        }
    });

    currentLayout = detectLayout();

    if (window.EncUnlock) {
        try { await EncUnlock.bootstrap(); } catch (e) { console.warn('EncUnlock bootstrap error:', e); }
    }

    // ★ 初始化第一个 email section 的 currentEmailData
    var emailSec = __allSections.find(function(s) { return s.kind === 'email' && s.visible !== false; });
    if (emailSec && emailSec.cards && emailSec.cards.length) currentEmailData = emailSec.cards[0];

    renderAllSections(currentLayout);

    alignStyleSwitcher();
    var containerEl = document.querySelector('.container');
    if (typeof ResizeObserver !== 'undefined' && containerEl) {
        new ResizeObserver(function() { alignStyleSwitcher(); }).observe(containerEl);
    }

    if (window.EncUnlock && EncUnlock.mountLockButton) {
        EncUnlock.mountLockButton();
    }

    var ol = document.getElementById('overlay');
    if (ol) {
        ol.addEventListener('click', function() {
            if (currentExpanded) {
                var subcards = document.getElementById(currentExpanded);
                if (subcards) {
                    var button        = subcards.parentElement.querySelector('.expand-btn');
                    var cardContainer = button.closest('.card-container');
                    subcards.classList.remove('expanded');
                    button.classList.remove('expanded');
                    cardContainer.classList.remove('active');
                }
                currentExpanded = null;
            }
            this.classList.remove('active');
        });
    }
});


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 13】窗口 resize 响应 → 动态重渲染
 * ════════════════════════════════════════════════════════════════════════════════ */
window.addEventListener('resize', function() {
    var newLayout = detectLayout();
    if (newLayout !== currentLayout) {
        currentLayout = newLayout;

        if (currentExpanded) {
            currentExpanded = null;
            var ol = document.getElementById('overlay');
            if (ol) ol.classList.remove('active');
        }

        // ★ 只重渲染 dynamic sections（静态网格不受 layout 影响）
        __allSections.forEach(function(sec) {
            if (sec.visible === false) return;
            if (sec.kind === 'card' && sec.dynamic) {
                var contentEl = document.getElementById(sec.key + '-content');
                if (contentEl) {
                    contentEl.innerHTML = generateDynamicGrid(sec.key, sec.cards || [], currentLayout, !!sec.encrypted);
                    if (currentLayout === 'desktop') autoExpandSection(sec.key);
                }
            }
        });
    }

    requestAnimationFrame(alignStyleSwitcher);
});


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 14】Ripple 波纹点击效果
 * ════════════════════════════════════════════════════════════════════════════════ */
(function initRipple() {
    var rippleSelector = [
        '.link-card',
        '.sub-card',
        '.back-link',
        '.expand-section-btn',
        '.style-btn',
        '.style-opt',
        '.email-tab',
        '#backHomeBtn',
        '.error-home-btn',
        '.enc-lock-fab'
    ].join(',');

    function createRipple(e, target) {
        if (target.classList.contains('style-opt-active')) return;

        var rect  = target.getBoundingClientRect();
        var point = e.touches && e.touches[0] ? e.touches[0] : e;
        var x = point.clientX - rect.left;
        var y = point.clientY - rect.top;
        var size = Math.max(rect.width, rect.height) * 2;

        var ripple = document.createElement('span');
        ripple.className = 'ripple';
        ripple.style.width  = size + 'px';
        ripple.style.height = size + 'px';
        ripple.style.left   = (x - size / 2) + 'px';
        ripple.style.top    = (y - size / 2) + 'px';

        target.appendChild(ripple);

        setTimeout(function() {
            if (ripple && ripple.parentNode) {
                ripple.parentNode.removeChild(ripple);
            }
        }, 850);
    }

    var supportsPointer = 'PointerEvent' in window;
    var eventName = supportsPointer ? 'pointerdown' : 'mousedown';

    document.addEventListener(eventName, function(e) {
        var target = e.target.closest(rippleSelector);
        if (!target) return;
        createRipple(e, target);
    }, { passive: true });

    if (!supportsPointer) {
        document.addEventListener('touchstart', function(e) {
            var target = e.target.closest(rippleSelector);
            if (!target) return;
            createRipple(e, target);
        }, { passive: true });
    }
})();