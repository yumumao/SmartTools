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
 * 【区块 2】数据缺失兜底
 * ════════════════════════════════════════════════════════════════════════════════ */
if (typeof usbDriveData === 'undefined' || typeof emailData === 'undefined') {
    var _container = document.querySelector('.container');
    if (_container) {
        _container.innerHTML =
            '<div class="error-container">' +
                '<div class="error-card">' +
                    '<span class="error-emoji">📂</span>' +
                    '<h2 class="error-title">数据加载失败</h2>' +
                    '<p class="error-message">收藏夹内容未能加载，可能是数据文件缺失或存在语法错误。</p>' +
                    '<div class="error-hint-box">' +
                        '<div class="error-hint-title">排查建议</div>' +
                        '<div class="error-hint-item">确认 <code>数据文件</code> 与本页面在同一目录下</div>' +
                        '<div class="error-hint-item">用浏览器 F12 控制台查看是否有 404 或语法报错</div>' +
                        '<div class="error-hint-item">检查 SVG 图标是否写在同一行，避免模板字符串解析失败</div>' +
                    '</div>' +
                    '<a href="toolsindex.html" class="error-home-btn">← 返回主页</a>' +
                '</div>' +
            '</div>';
    }
    throw new Error('数据文件未加载');
}


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 3】全局状态变量
 * ════════════════════════════════════════════════════════════════════════════════ */
var currentExpanded  = null;
var currentLayout    = 'mobile';
var currentEmailData = emailData[0];
var isAnimating      = false;


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
    var url = card.url || '';
    if (!url) return;
    if (card.isLocal) window.location.href = url;
    else              window.open(url, '_blank');
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
 */
window.__favEmailClick = function() {
    var cd = currentEmailData;
    if (!cd) return;
    if (cd.comment && window.NoteModal) {
        var idx = emailData.indexOf(cd);
        var cid = __registerCard(cd, {
            sectionKey: 'contact',
            emailIndex: idx,
            uniqueKey:  'contact/email/' + idx
        });
        window.NoteModal.show(cid);
    } else if (cd.url) {
        window.open(cd.url, '_blank');
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

function renderIcon(item, extraAttrs) {
    extraAttrs = extraAttrs || '';
    if (item.iconImg) {
        return '<span class="link-icon" ' + extraAttrs + ' aria-hidden="true"><img src="' + item.iconImg + '" alt="" /></span>';
    }
    var icon = item.icon || '';
    if (icon.charAt(0) === '<') {
        return '<span class="link-icon link-icon-svg" ' + extraAttrs + '>' + icon + '</span>';
    }
    return '<span class="link-icon" ' + extraAttrs + '>' + icon + '</span>';
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
            return '<a href="' + __attr(card.url) + '" target="_blank" class="link-card' + noteCls + '" ' +
                   'data-card-id="' + cid + '" ' +
                   'onclick="return __favLinkClick(\'' + cid + '\', event)">' +
                renderIcon(card) +
                '<h3 class="link-title">' + card.title + '</h3>' +
                '<p class="link-desc">' + (card.desc || '') + '</p></a>';
        }
        return '<div class="link-card' + noteCls + '" data-card-id="' + cid + '" ' +
               'onclick="__favCardOpen(\'' + cid + '\')">' +
            renderIcon(card) +
            '<h3 class="link-title">' + card.title + '</h3>' +
            '<p class="link-desc">' + (card.desc || '') + '</p></div>';
    }

    // ─── 类型 2：描述可独立点击的卡片 ───────────────────────────────
    if (card.type === 'desc-clickable') {
        // 描述行独立跳转：descUrl 为空则只触发父卡片点击（不 stopPropagation 也不 open）
        var descClickHandler = card.descUrl
            ? 'event.stopPropagation(); window.open(\'' + __attr(card.descUrl) + '\', \'_blank\')'
            : '';
        return '<div class="link-card' + noteCls + '" data-card-id="' + cid + '" ' +
               'onclick="__favCardOpen(\'' + cid + '\')">' +
            renderIcon(card) +
            '<h3 class="link-title">' + card.title + '</h3>' +
            '<p class="link-desc-clickable"' +
                (descClickHandler ? ' onclick="' + descClickHandler + '"' : '') +
            '>' + card.descClickable + '</p></div>';
    }

    // ─── 类型 3：可展开子卡片的卡片 ─────────────────────────────────
    if (card.type === 'expandable') {
        var descHTML = '';
        if (card.descClickable) {
            var descClickHandler2 = card.descUrl
                ? 'event.stopPropagation(); window.open(\'' + __attr(card.descUrl) + '\', \'_blank\')'
                : '';
            descHTML = '<p class="link-desc-clickable"' +
                (descClickHandler2 ? ' onclick="' + descClickHandler2 + '"' : '') +
                '>' + card.descClickable + '</p>';
        } else if (card.desc) {
            descHTML = '<p class="link-desc">' + card.desc + '</p>';
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

        return '<div class="card-container">' +
            '<div class="link-card link-card-with-expand' + noteCls + '" ' +
                 'data-card-id="' + cid + '" ' +
                 'onclick="handleCardClick(event, \'' + cid + '\', \'' + card.id + '-subcards\')">' +
            renderIcon(card) +
            '<h3 class="link-title">' + card.title + '</h3>' +
            descHTML +
            '<div class="expand-zone" onclick="event.stopPropagation(); handleExpandZone(\'' + card.id + '-subcards\', this)"></div>' +
            '<button class="expand-btn" title="展开更多"></button></div>' +
            '<div class="sub-cards" id="' + card.id + '-subcards">' + subHTML + '</div></div>';
    }
    return '';
}

/**
 * 生成子卡片。注意：compact-card 里的 sc.note 是"额外小字说明"，
 * 新注释功能使用 sc.comment 字段，二者互不冲突。
 */
function generateSubCardHTML(sc, meta) {
    var cid      = __registerCard(sc, meta || {});
    var iconHTML = renderIcon(sc);
    var noteCls  = __noteCls(sc);

    if (sc.content !== undefined) {
        return '<div class="sub-card compact-card' + noteCls + '" data-card-id="' + cid + '" ' +
               'onclick="__favCardOpen(\'' + cid + '\')">' +
            iconHTML +
            '<div class="link-content"><span class="link-url">' + sc.content + '</span>' +
            (sc.note ? '<span class="link-note">' + sc.note + '</span>' : '') +
            '</div></div>';
    }
    return '<div class="sub-card two-line-card' + noteCls + '" data-card-id="' + cid + '" ' +
           'onclick="__favCardOpen(\'' + cid + '\')">' +
        '<div class="card-header">' + iconHTML +
        '<h3 class="link-title">' + sc.title + '</h3></div>' +
        '<p class="link-url">' + (sc.desc || '') + '</p></div>';
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
    if (prefix === 'video') {
        return layout === 'mobile' ? 4 : layout === 'tablet' ? 6 : 8;
    }
    if (prefix === 'ai') {
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
        html += '<button class="expand-section-btn" onclick="toggleSection(\'' + prefix + '\')" id="' + prefix + '-expand-btn">' +
            '<span>展开卡片</span><span class="arrow">▼</span></button>';
        html += '<div class="hidden-cards" id="' + prefix + '-hidden-cards">';
        hidden.forEach(function(card, idx) {
            html += generateCardHTML(card, {
                sectionKey: prefix,
                cardIndex:  count + idx,
                encrypted:  !!encrypted
            });
        });
        html += '</div>';
        html += '<button class="expand-section-btn" onclick="toggleSection(\'' + prefix + '\')" id="' + prefix + '-collapse-btn" style="display:none;">' +
            '<span>折叠卡片</span><span class="arrow">▲</span></button>';
    }
    return html;
}


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 7】联系方式 / 邮箱卡片
 * ════════════════════════════════════════════════════════════════════════════════ */

function generateEmailCardHTML() {
    var tabsHTML = '';
    emailData.forEach(function(em, i) {
        var cls = i === 0 ? ' active' : '';
        tabsHTML += '<div class="email-tab' + cls + '" onclick="event.stopPropagation(); switchEmail(' + i + ')" data-email="' + i + '">' + (i + 1) + '</div>';
    });
    // 邮箱卡主区域改走 __favEmailClick，内部判断 currentEmailData.comment
    var noteCls = __noteCls(emailData[0]);
    return '<div class="card-container">' +
        '<div class="link-card email-card' + noteCls + '" id="email-card-root" onclick="__favEmailClick()">' +
        '<div class="email-main-content" id="email-main-content">' +
        '<div class="email-contact-header">' +
        renderIcon(emailData[0], 'id="email-icon"') +
        '<h3 class="link-title" id="email-title">' + emailData[0].title + '</h3>' +
        '</div>' +
        '<p class="email-contact-desc" id="email-address" onclick="event.stopPropagation(); if(currentEmailData.mailto) window.open(currentEmailData.mailto, \'_blank\')">' + emailData[0].address + '</p>' +
        '</div>' +
        '<div class="email-tabs active-0" id="email-tabs">' + tabsHTML + '</div>' +
        '</div></div>';
}

function generateContactCardHTML(card, meta) {
    var cid = __registerCard(card, meta || {});
    var noteCls = __noteCls(card);
    var descClickHandler = card.descUrl
        ? 'event.stopPropagation(); window.open(\'' + __attr(card.descUrl) + '\', \'_blank\')'
        : '';
    return '<div class="link-card contact-card-wrap' + noteCls + '" data-card-id="' + cid + '" ' +
           'onclick="__favCardOpen(\'' + cid + '\')">' +
        '<div class="contact-header">' + renderIcon(card) +
        '<h3 class="link-title">' + card.title + '</h3></div>' +
        '<p class="contact-desc"' +
            (descClickHandler ? ' onclick="' + descClickHandler + '"' : '') +
        '>' + card.desc + '</p></div>';
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
function switchEmail(index) {
    if (isAnimating) return;
    var currentIndex = emailData.indexOf(currentEmailData);
    if (currentIndex === index) return;

    isAnimating = true;
    var mainContent = document.getElementById('email-main-content');
    mainContent.classList.add('slide-out');

    setTimeout(function() {
        currentEmailData = emailData[index];

        var emailIconEl = document.getElementById('email-icon');
        if (currentEmailData.iconImg) {
            emailIconEl.innerHTML = '<img src="' + currentEmailData.iconImg + '" alt="" />';
            emailIconEl.className = 'link-icon';
        } else if (currentEmailData.icon && currentEmailData.icon.charAt(0) === '<') {
            emailIconEl.innerHTML = currentEmailData.icon;
            emailIconEl.className = 'link-icon link-icon-svg';
        } else {
            emailIconEl.innerHTML = currentEmailData.icon || '';
            emailIconEl.className = 'link-icon';
        }

        document.getElementById('email-title').textContent   = currentEmailData.title;
        document.getElementById('email-address').textContent = currentEmailData.address;

        var addressEl = document.getElementById('email-address');
        addressEl.onclick = function(event) {
            event.stopPropagation();
            if (currentEmailData.mailto) {
                window.open(currentEmailData.mailto, '_blank');
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

function openEmail(url) { window.open(url, '_blank'); }


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 10】自定义大类 + 加密大类
 * ════════════════════════════════════════════════════════════════════════════════ */

function injectCustomSections(layout) {
    if (typeof customSections === 'undefined' || !Array.isArray(customSections) || !customSections.length) return;

    var contactTitle = document.getElementById('contact');
    if (!contactTitle) return;
    var contactSection = contactTitle.closest('.section');
    if (!contactSection) return;

    customSections.forEach(function(cs) {
        if (!cs || !cs.key || typeof cs.key !== 'string') return;
        if (document.getElementById(cs.key + '-content')) return;

        var sectionEl = document.createElement('div');
        sectionEl.className = 'section';
        sectionEl.dataset.customKey = cs.key;

        if (window.EncUnlock && EncUnlock.isLocked(cs)) {
            sectionEl.classList.add('section-locked-pill');
            sectionEl.innerHTML = '<div id="' + cs.key + '-content"></div>';
        } else {
            sectionEl.innerHTML =
                '<h2 class="section-title" id="' + cs.key + '">' + (cs.label || cs.key) + '</h2>' +
                '<div id="' + cs.key + '-content"></div>';
        }
        contactSection.parentNode.insertBefore(sectionEl, contactSection);

        renderCustomSection(cs, layout);
    });
}

function renderCustomSection(cs, layout) {
    var contentEl = document.getElementById(cs.key + '-content');
    if (!contentEl) return;

    if (window.EncUnlock && EncUnlock.isLocked(cs)) {
        contentEl.innerHTML = '';
        contentEl.appendChild(EncUnlock.makeLockedPlaceholder(cs));
        return;
    }

    var cards = Array.isArray(cs.cards) ? cs.cards : [];
    if (!cards.length) {
        contentEl.innerHTML = '';
        return;
    }
    if (cs.dynamic) {
        contentEl.innerHTML = generateDynamicGrid(cs.key, cards, layout, !!cs.encrypted);
        if (layout === 'desktop') {
            autoExpandSection(cs.key);
        }
    } else {
        contentEl.innerHTML = generateStaticGrid(cards, cs.key, !!cs.encrypted);
    }
}

/**
 * 暴露给 shared/enc-rerender.js + shared/note-modal.js 使用的 API。
 */
window.__favPageAPI = {
    getLayout: function() { return currentLayout; },
    renderSection: function(cs, layout) { renderCustomSection(cs, layout); },
    // NoteModal 通过这个取卡片
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
 * 【区块 12】页面初始化
 * ════════════════════════════════════════════════════════════════════════════════ */
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

    // 传入 sectionKey 以便注释功能定位
    document.getElementById('usb-drive-content').innerHTML = generateStaticGrid(usbDriveData, 'usb-drive');
    document.getElementById('teaching-content').innerHTML  = generateStaticGrid(teachingData,  'teaching');

    injectCustomSections(currentLayout);

    document.getElementById('contact-content').innerHTML   = generateContactGrid();
    document.getElementById('online-ai-content').innerHTML = generateDynamicGrid('ai',    onlineAIData, currentLayout);
    document.getElementById('video-content').innerHTML     = generateDynamicGrid('video', videoData,    currentLayout);

    if (currentLayout === 'desktop') {
        autoExpandSection('ai');
        autoExpandSection('video');
    }

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
 * 【区块 13】窗口 resize 响应
 * ════════════════════════════════════════════════════════════════════════════════ */
window.addEventListener('resize', function() {
    var newLayout = detectLayout();
    if (newLayout !== currentLayout) {
        currentLayout = newLayout;

        if (currentExpanded) {
            currentExpanded = null;
            document.getElementById('overlay').classList.remove('active');
        }

        document.getElementById('online-ai-content').innerHTML = generateDynamicGrid('ai',    onlineAIData, currentLayout);
        document.getElementById('video-content').innerHTML     = generateDynamicGrid('video', videoData,    currentLayout);

        if (currentLayout === 'desktop') {
            autoExpandSection('ai');
            autoExpandSection('video');
        }

        if (typeof customSections !== 'undefined' && Array.isArray(customSections)) {
            customSections.forEach(function(cs) {
                if (cs && cs.key) renderCustomSection(cs, currentLayout);
            });
        }
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