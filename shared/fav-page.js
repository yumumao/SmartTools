/* ================================================================================
 * shared/fav-page.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 收藏夹页面通用逻辑（index1 / index2 / index3 / index4 / index5 五个风格共用）
 *
 * 依赖（必须在本文件之前加载）：
 *   1. data.js            → 提供 usbDriveData / teachingData / onlineAIData /
 *                            videoData / contactData / emailData / customSections
 *   2. shared/enc-unlock.js  → 加密大类解锁模块（可选）
 *   3. shared/enc-rerender.js → 加密模块锁/解锁无刷新重渲染（可选）
 *
 * 每个页面在引入本文件之前，需要设置：
 *   <script>window.__FAV_PAGE_ID = 'indexN.html';</script>
 * 用于 localStorage 记录最近使用的风格。
 * ================================================================================ */


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 1】风格持久化：记录用户最近一次使用的页面风格
 * ════════════════════════════════════════════════════════════════════════════════
 * 作用：其它页面（比如 toolsindex.html）可以读取 fav_last_style，
 *       自动跳到用户上次选择的收藏夹风格。
 * ──────────────────────────────────────────────────────────────────────────────── */
try {
    if (window.__FAV_PAGE_ID) {
        localStorage.setItem('fav_last_style', window.__FAV_PAGE_ID);
    }
} catch (e) {}


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 2】数据缺失兜底
 * ════════════════════════════════════════════════════════════════════════════════
 * 作用：如果 data.js 加载失败或内部有语法错误导致变量未定义，
 *       在页面上显示一个友好的错误卡片，而不是白屏。
 * ──────────────────────────────────────────────────────────────────────────────── */
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
 * ════════════════════════════════════════════════════════════════════════════════
 * currentExpanded  : 当前展开的子卡片容器 id（null 表示无）
 * currentLayout    : 当前布局 'mobile' | 'tablet' | 'desktop'
 * currentEmailData : 当前选中的邮箱数据（用于邮箱卡片切换动画）
 * isAnimating      : 邮箱切换动画是否进行中（防止动画期间重复触发）
 * ──────────────────────────────────────────────────────────────────────────────── */
var currentExpanded  = null;
var currentLayout    = 'mobile';
var currentEmailData = emailData[0];
var isAnimating      = false;


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 4】基础工具函数
 * ════════════════════════════════════════════════════════════════════════════════ */

/**
 * 根据窗口宽度检测当前布局类型。
 * 断点：≤480 手机 / 481–799 平板 / ≥800 桌面。
 */
function detectLayout() {
    var w = window.innerWidth;
    if (w <= 480) return 'mobile';
    if (w <= 799) return 'tablet';
    return 'desktop';
}

/**
 * 把右上角的风格切换器水平对齐到 .container 的右边缘。
 * 在 resize 和 ResizeObserver 里都会被调用。
 */
function alignStyleSwitcher() {
    var container = document.querySelector('.container');
    var switcher  = document.getElementById('styleSwitcher');
    if (!container || !switcher) return;
    var rect = container.getBoundingClientRect();
    switcher.style.right = (document.documentElement.clientWidth - rect.right) + 'px';
}

/**
 * 渲染卡片左上角的图标。支持三种格式：
 *   1. iconImg → <img> 图片 URL
 *   2. icon 以 '<' 开头 → 内联 SVG 字符串
 *   3. icon 普通字符串 → emoji 或文字
 */
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
 * ════════════════════════════════════════════════════════════════════════════════
 * 支持三种卡片类型：
 *   - simple         : 整张卡片点击打开 url
 *   - desc-clickable : 卡片主体点 url，描述文字单独点 descUrl
 *   - expandable     : 有子卡片，左 60% 打开 url，右 40% 展开子卡片浮层
 * ──────────────────────────────────────────────────────────────────────────────── */

function generateCardHTML(card) {
    // ─── 类型 1：简单卡片 ──────────────────────────────────────────────
    if (card.type === 'simple') {
        return '<a href="' + card.url + '" target="_blank" class="link-card">' +
            renderIcon(card) +
            '<h3 class="link-title">' + card.title + '</h3>' +
            '<p class="link-desc">' + (card.desc || '') + '</p></a>';
    }

    // ─── 类型 2：描述可独立点击的卡片 ───────────────────────────────
    if (card.type === 'desc-clickable') {
        return '<div class="link-card" onclick="window.open(\'' + card.url + '\', \'_blank\')">' +
            renderIcon(card) +
            '<h3 class="link-title">' + card.title + '</h3>' +
            '<p class="link-desc-clickable" onclick="event.stopPropagation(); window.open(\'' + card.descUrl + '\', \'_blank\')">' + card.descClickable + '</p></div>';
    }

    // ─── 类型 3：可展开子卡片的卡片 ─────────────────────────────────
    if (card.type === 'expandable') {
        // 描述区（可点击或静态）
        var descHTML = '';
        if (card.descClickable) {
            descHTML = '<p class="link-desc-clickable" onclick="event.stopPropagation(); window.open(\'' + card.descUrl + '\', \'_blank\')">' + card.descClickable + '</p>';
        } else if (card.desc) {
            descHTML = '<p class="link-desc">' + card.desc + '</p>';
        }
        // 子卡片列表
        var subHTML = '';
        card.subCards.forEach(function(sc) { subHTML += generateSubCardHTML(sc); });

        return '<div class="card-container">' +
            '<div class="link-card link-card-with-expand" onclick="handleCardClick(event, \'' + card.url + '\', \'' + card.id + '-subcards\')">' +
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
 * 渲染浮层中的子卡片。
 *   - sc.content 存在 → compact-card（单行紧凑）
 *   - 否则            → two-line-card（两行：标题 + 描述）
 *   - sc.isLocal      → 本页跳转（不新开标签页）
 */
function generateSubCardHTML(sc) {
    var iconHTML = renderIcon(sc);
    var onclick = sc.isLocal
        ? 'window.location.href=\'' + sc.url + '\''
        : 'window.open(\'' + sc.url + '\', \'_blank\')';

    if (sc.content !== undefined) {
        return '<div class="sub-card compact-card" onclick="' + onclick + '">' +
            iconHTML +
            '<div class="link-content"><span class="link-url">' + sc.content + '</span>' +
            (sc.note ? '<span class="link-note">' + sc.note + '</span>' : '') +
            '</div></div>';
    }
    return '<div class="sub-card two-line-card" onclick="' + onclick + '">' +
        '<div class="card-header">' + iconHTML +
        '<h3 class="link-title">' + sc.title + '</h3></div>' +
        '<p class="link-url">' + (sc.desc || '') + '</p></div>';
}


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 6】网格生成器（静态 & 动态）
 * ════════════════════════════════════════════════════════════════════════════════
 * - 静态网格：一次性显示全部卡片（用于在线U盘、授课资料）
 * - 动态网格：超出 N 张自动折叠 + 展开/收起按钮（用于 网络资源 / 视频聚合 / 自定义大类）
 * ──────────────────────────────────────────────────────────────────────────────── */

/** 生成静态网格（不折叠）。 */
function generateStaticGrid(data) {
    var html = '<div class="links-grid">';
    data.forEach(function(card) { html += generateCardHTML(card); });
    return html + '</div>';
}

/**
 * 根据大类前缀和布局，返回"首屏可见卡片数"。
 * 超出该数字的卡片会放进 .hidden-cards 折叠区。
 */
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

/** 生成动态网格（首屏 + 折叠区 + 展开/收起按钮）。 */
function generateDynamicGrid(prefix, data, layout) {
    var count   = getVisibleCount(prefix, layout);
    var visible = data.slice(0, count);
    var hidden  = data.slice(count);

    // 首屏可见卡片
    var html = '<div class="links-grid">';
    visible.forEach(function(card) { html += generateCardHTML(card); });
    html += '</div>';

    // 折叠区 + 展开/收起按钮
    if (hidden.length > 0) {
        html += '<button class="expand-section-btn" onclick="toggleSection(\'' + prefix + '\')" id="' + prefix + '-expand-btn">' +
            '<span>展开卡片</span><span class="arrow">▼</span></button>';
        html += '<div class="hidden-cards" id="' + prefix + '-hidden-cards">';
        hidden.forEach(function(card) { html += generateCardHTML(card); });
        html += '</div>';
        html += '<button class="expand-section-btn" onclick="toggleSection(\'' + prefix + '\')" id="' + prefix + '-collapse-btn" style="display:none;">' +
            '<span>折叠卡片</span><span class="arrow">▲</span></button>';
    }
    return html;
}


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 7】联系方式 / 邮箱卡片
 * ════════════════════════════════════════════════════════════════════════════════
 * 邮箱卡片特殊：右侧有 5 个垂直 Tab，切换时左侧主区域有滑动动画。
 * ──────────────────────────────────────────────────────────────────────────────── */

/** 生成邮箱卡片 HTML（含右侧 Tab 切换条）。 */
function generateEmailCardHTML() {
    var tabsHTML = '';
    emailData.forEach(function(em, i) {
        var cls = i === 0 ? ' active' : '';
        tabsHTML += '<div class="email-tab' + cls + '" onclick="event.stopPropagation(); switchEmail(' + i + ')" data-email="' + i + '">' + (i + 1) + '</div>';
    });
    return '<div class="card-container">' +
        '<div class="link-card email-card" onclick="openEmail(currentEmailData.url)">' +
        '<div class="email-main-content" id="email-main-content">' +
        '<div class="email-contact-header">' +
        renderIcon(emailData[0], 'id="email-icon"') +
        '<h3 class="link-title" id="email-title">' + emailData[0].title + '</h3>' +
        '</div>' +
        '<p class="email-contact-desc" id="email-address" onclick="event.stopPropagation(); window.open(currentEmailData.mailto, \'_blank\')">' + emailData[0].address + '</p>' +
        '</div>' +
        '<div class="email-tabs active-0" id="email-tabs">' + tabsHTML + '</div>' +
        '</div></div>';
}

/** 生成一个普通联系方式卡片（Telegram / 微信 等）。 */
function generateContactCardHTML(card) {
    return '<div class="link-card contact-card-wrap" onclick="window.open(\'' + card.url + '\', \'_blank\')">' +
        '<div class="contact-header">' + renderIcon(card) +
        '<h3 class="link-title">' + card.title + '</h3></div>' +
        '<p class="contact-desc" onclick="event.stopPropagation(); window.open(\'' + card.descUrl + '\', \'_blank\')">' + card.desc + '</p></div>';
}

/** 生成整个联系方式大类的网格（邮箱卡 + 其他联系卡）。 */
function generateContactGrid() {
    var html = '<div class="links-grid contact-row">';
    html += generateEmailCardHTML();
    contactData.forEach(function(card) { html += generateContactCardHTML(card); });
    return html + '</div>';
}


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 8】卡片交互逻辑
 * ════════════════════════════════════════════════════════════════════════════════ */

/**
 * 可展开卡片的点击分区逻辑：
 *   - 点击左 60%：打开 url
 *   - 点击右 40%：展开/收起子卡片
 */
function handleCardClick(event, url, subcardId) {
    var card   = event.currentTarget;
    var rect   = card.getBoundingClientRect();
    var clickX = event.clientX - rect.left;
    if (clickX > rect.width * 3 / 5) {
        var btn = card.querySelector('.expand-btn');
        if (btn) toggleSubCards(subcardId, btn);
    } else {
        window.open(url, '_blank');
    }
}

/** 右侧透明"展开区"（.expand-zone）被点击时的处理。 */
function handleExpandZone(subcardId, zone) {
    var btn = zone.closest('.link-card').querySelector('.expand-btn');
    if (btn) toggleSubCards(subcardId, btn);
}

/**
 * 展开/收起子卡片浮层 + 黑色半透明遮罩。
 * 同一时间只允许一个子卡片浮层打开；打开新浮层时会自动关闭旧的。
 */
function toggleSubCards(subcardId, button) {
    var subcards      = document.getElementById(subcardId);
    var overlay       = document.getElementById('overlay');
    var cardContainer = button.closest('.card-container');
    var isExpanded    = subcards.classList.contains('expanded');

    // 关闭其它已展开的浮层
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

    // 切换当前浮层状态
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

/**
 * 大类"展开卡片 / 折叠卡片"按钮的切换逻辑。
 * 包含依次出现 / 依次隐藏的动画、按钮显隐切换。
 */
function toggleSection(prefix) {
    var section     = document.getElementById(prefix + '-hidden-cards');
    var expandBtn   = document.getElementById(prefix + '-expand-btn');
    var collapseBtn = document.getElementById(prefix + '-collapse-btn');
    var isExpanded  = section.classList.contains('expanded');

    if (isExpanded) {
        // 收起动画
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
        // 展开动画
        expandBtn.classList.add('moving');
        setTimeout(function() {
            expandBtn.style.display = 'none';
            section.classList.add('expanded');
            // 动画结束后加 hover-ready，避免动画期间 hover 冲突
            setTimeout(function() { section.classList.add('hover-ready'); }, 2500);
            setTimeout(function() {
                collapseBtn.style.display = 'flex';
                collapseBtn.classList.remove('moving');
            }, 400);
        }, 200);
    }
}

/**
 * 桌面布局下，初始化完就自动展开折叠区（不播放动画）。
 * 用于 ai / video / 自定义大类，让桌面端一屏看到更多卡片。
 */
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
 * 【区块 9】邮箱切换（带滑动动画）
 * ════════════════════════════════════════════════════════════════════════════════ */

/**
 * 切换邮箱 Tab：
 *   1. 主内容向左滑出
 *   2. 替换图标 / 标题 / 地址 / onclick
 *   3. 主内容从右滑入
 *   4. Tab 视觉状态切换（active-N）
 */
function switchEmail(index) {
    if (isAnimating) return;
    var currentIndex = emailData.indexOf(currentEmailData);
    if (currentIndex === index) return;

    isAnimating = true;
    var mainContent = document.getElementById('email-main-content');
    mainContent.classList.add('slide-out');

    setTimeout(function() {
        currentEmailData = emailData[index];

        // 更新图标（兼容 emoji / SVG / iconImg）
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

        // 更新标题和地址
        document.getElementById('email-title').textContent   = currentEmailData.title;
        document.getElementById('email-address').textContent = currentEmailData.address;

        // 重新绑定地址点击（因为闭包变量需要刷新）
        var addressEl = document.getElementById('email-address');
        addressEl.onclick = function(event) {
            event.stopPropagation();
            window.open(currentEmailData.mailto, '_blank');
        };

        // 滑入动画
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

    // Tab 视觉状态切换
    document.querySelectorAll('.email-tab').forEach(function(tab, i) {
        if (i === index) tab.classList.add('active');
        else tab.classList.remove('active');
    });
    document.getElementById('email-tabs').className = 'email-tabs active-' + index;
}

/** 邮箱卡片主区域点击：打开 mailto/url。 */
function openEmail(url) { window.open(url, '_blank'); }


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 10】自定义大类 + 加密大类（锁定/解锁占位）
 * ════════════════════════════════════════════════════════════════════════════════
 * customSections 在 data.js 里定义，会被动态插入到"联系方式"大类之前。
 * 加密大类未解锁时：只渲染一个小药丸占位（不显示标题、不显示卡片内容）。
 * ──────────────────────────────────────────────────────────────────────────────── */

/**
 * 首次渲染时，把 customSections 从 data.js 注入到 DOM。
 * 每个自定义大类会生成一个 <div class="section"> 插在联系方式之前。
 */
function injectCustomSections(layout) {
    if (typeof customSections === 'undefined' || !Array.isArray(customSections) || !customSections.length) return;

    var contactTitle = document.getElementById('contact');
    if (!contactTitle) return;
    var contactSection = contactTitle.closest('.section');
    if (!contactSection) return;

    customSections.forEach(function(cs) {
        if (!cs || !cs.key || typeof cs.key !== 'string') return;
        if (document.getElementById(cs.key + '-content')) return; // 已存在则跳过

        var sectionEl = document.createElement('div');
        sectionEl.className = 'section';
        sectionEl.dataset.customKey = cs.key;

        // 🔐 锁定状态：不渲染标题，只留药丸占位（隐私保护）
        if (window.EncUnlock && EncUnlock.isLocked(cs)) {
            sectionEl.classList.add('section-locked-pill');
            sectionEl.innerHTML = '<div id="' + cs.key + '-content"></div>';
        } else {
            // 普通状态：渲染标题
            sectionEl.innerHTML =
                '<h2 class="section-title" id="' + cs.key + '">' + (cs.label || cs.key) + '</h2>' +
                '<div id="' + cs.key + '-content"></div>';
        }
        contactSection.parentNode.insertBefore(sectionEl, contactSection);

        renderCustomSection(cs, layout);
    });
}

/**
 * 渲染单个自定义大类的内容区（卡片 or 锁定占位）。
 * 会在 resize 布局变化、锁定/解锁时被调用。
 */
function renderCustomSection(cs, layout) {
    var contentEl = document.getElementById(cs.key + '-content');
    if (!contentEl) return;

    // 🔐 加密大类未解锁 → 渲染小药丸占位
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
        contentEl.innerHTML = generateDynamicGrid(cs.key, cards, layout);
        if (layout === 'desktop') {
            autoExpandSection(cs.key);
        }
    } else {
        contentEl.innerHTML = generateStaticGrid(cards);
    }
}

/**
 * 暴露给 shared/enc-rerender.js 使用的 API。
 * 加密大类锁/解锁时会调用这里的方法实现无刷新更新。
 */
window.__favPageAPI = {
    getLayout: function() { return currentLayout; },
    renderSection: function(cs, layout) { renderCustomSection(cs, layout); },
    clearExpandedState: function() {
        // 锁定时如果正好某个加密卡片的子浮层在开，需要强制关掉
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

/** 切换风格下拉菜单的展开/收起状态。 */
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
 * 【区块 12】页面初始化（DOMContentLoaded）
 * ════════════════════════════════════════════════════════════════════════════════
 * 执行顺序：
 *   1. 注册"点击页面其它地方关闭下拉菜单"
 *   2. 检测当前布局
 *   3. 等待 EncUnlock bootstrap（如果 sessionStorage 有密码就自动解锁）
 *   4. 渲染静态大类（U盘、授课资料）
 *   5. 注入自定义大类（含加密大类占位）
 *   6. 渲染联系方式 / 网络资源 / 视频聚合
 *   7. 桌面布局自动展开折叠区
 *   8. 对齐风格切换器、监听 container 尺寸变化
 *   9. 挂载"立即锁定"浮动按钮（如果有解锁的加密大类）
 * ──────────────────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async function() {

    // 1️⃣ 点击空白处关闭风格下拉菜单
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

    // 2️⃣ 检测布局
    currentLayout = detectLayout();

    // 3️⃣ 加密模块启动（尝试自动解锁）
    if (window.EncUnlock) {
        try { await EncUnlock.bootstrap(); } catch (e) { console.warn('EncUnlock bootstrap error:', e); }
    }

    // 4️⃣ 静态大类
    document.getElementById('usb-drive-content').innerHTML = generateStaticGrid(usbDriveData);
    document.getElementById('teaching-content').innerHTML  = generateStaticGrid(teachingData);

    // 5️⃣ 自定义大类（含加密占位）
    injectCustomSections(currentLayout);

    // 6️⃣ 联系方式 / 网络资源 / 视频聚合
    document.getElementById('contact-content').innerHTML   = generateContactGrid();
    document.getElementById('online-ai-content').innerHTML = generateDynamicGrid('ai',    onlineAIData, currentLayout);
    document.getElementById('video-content').innerHTML     = generateDynamicGrid('video', videoData,    currentLayout);

    // 7️⃣ 桌面自动展开折叠区
    if (currentLayout === 'desktop') {
        autoExpandSection('ai');
        autoExpandSection('video');
    }

    // 8️⃣ 对齐风格切换器 + 监听容器尺寸
    alignStyleSwitcher();
    var containerEl = document.querySelector('.container');
    if (typeof ResizeObserver !== 'undefined' && containerEl) {
        new ResizeObserver(function() { alignStyleSwitcher(); }).observe(containerEl);
    }

    // 9️⃣ 挂载"立即锁定"浮动按钮
    if (window.EncUnlock && EncUnlock.mountLockButton) {
        EncUnlock.mountLockButton();
    }

    // 🔟 遮罩点击：关闭当前展开的子卡片浮层
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
 * ════════════════════════════════════════════════════════════════════════════════
 * 布局发生跨档切换（mobile ↔ tablet ↔ desktop）时：
 *   - 关闭已展开的子卡片浮层
 *   - 重新渲染动态网格（可见/折叠的数量会变）
 *   - 重新渲染自定义大类
 *   - 桌面自动展开折叠区
 * ──────────────────────────────────────────────────────────────────────────────── */
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

    // 任何 resize 都重新对齐风格切换器
    requestAnimationFrame(alignStyleSwitcher);
});


/* ════════════════════════════════════════════════════════════════════════════════
 * 【区块 14】Ripple 波纹点击效果
 * ════════════════════════════════════════════════════════════════════════════════
 * 在指定元素被点击时，从点击位置生成一个放大淡出的圆形波纹（Material Design 风格）。
 * 元素自身需在 CSS 里声明 position:relative 和 overflow:hidden 以裁剪波纹边缘。
 * ──────────────────────────────────────────────────────────────────────────────── */
(function initRipple() {
    // 所有支持 ripple 效果的选择器
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

    /** 在 target 内部的点击位置生成一个波纹 span。 */
    function createRipple(e, target) {
        // 已激活的风格选项不需要波纹
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

        // 动画结束后清理 DOM
        setTimeout(function() {
            if (ripple && ripple.parentNode) {
                ripple.parentNode.removeChild(ripple);
            }
        }, 850);
    }

    // 优先使用 PointerEvent（鼠标 + 触摸统一）；否则降级到 mousedown + touchstart
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