/* ================================================================================
 * shared/note-modal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 卡片注释（comment）模态框 + 轻量 Markdown 渲染 + Markdown 工具栏 + 多主题
 *
 * ★ 本版变更：
 *   - 全页面波纹：点击 .note-body 时,波纹元素(.note-ripple-fullpage)
 *     被 append 到 .note-mask,position: fixed 覆盖整个视口,从点击点扩散。
 *     按钮波纹仍保留本地波纹(.note-ripple)。
 *   - 悬停提示文字:"点击跳转:<具体URL>"(带上 URL)。
 *   - 未持久化保存的状态提示常驻:
 *       · 查看模式下:若 overrides 里存在该卡记录 → footer 里常驻显示提示
 *       · 编辑模式下:status 元素初始就预填这个提示(编辑一进来就能看到)
 *       · 成功同步到服务器后,overrides 被清空 → 下次打开不再出现提示
 *   - 新增对外 API:clearOverrides()(供 config.html 保存完文件后调用)
 *   - ★★ 修复:本地模式下"清空注释(删除)"也必须被记录为 pending。
 *           即使 finalComment 为空字符串,也要写入 overrides(代表"本地已删除、
 *           待同步到文件")。只有"成功同步到服务器"后才走 removeOverride 彻底清除。
 *
 * 行为规则(与 fav-page.js 协同):
 *   1. 点击卡片时:
 *        - 有 comment  → 弹出注释模态框(有 url 时可点击注释空白区打开 url)
 *        - 无 comment  → 直接打开 url
 *   2. 卡片可以只有 comment 而没有 url(纯备忘卡片)
 *   3. 权限判定:sessionStorage['bm_cfg_enc_pwd'] 存在 ⇒ 已解锁 ⇒ 可编辑
 *      ★ 加密分类(meta.encrypted === true)的卡片前端不允许编辑
 *   4. 已解锁用户:
 *        - 有 comment:模态框内出现"编辑"
 *        - 无 comment:卡片右键 / 长按 → 打开编辑器添加
 *
 * 编辑器按钮:
 *   - 只有【返回】【保存】;清空 textarea 再点保存 = 删除注释
 *
 * 主题(对应 index1-5):nebula / notion / stripe / dark / mint
 *
 * 对外 API:
 *   window.NoteModal = { show, openEditor, canEdit, renderMarkdown,
 *                        applyOverrides, getOverrides, clearOverrides };
 * ================================================================================ */
(function(global) {
    'use strict';

    var PWD_KEY   = 'bm_cfg_enc_pwd';
    var LS_NOTES  = 'bm_comment_overrides';
    var CONFIG_HREF = 'config.html';

    /* ───────────────────────── 老数据迁移 ───────────────────────── */
    (function migrateFromSession() {
        try {
            var ss = sessionStorage.getItem(LS_NOTES);
            if (!ss) return;
            var ssData = JSON.parse(ss) || {};
            var lsData = JSON.parse(localStorage.getItem(LS_NOTES) || '{}');
            var merged = Object.assign({}, ssData, lsData);
            localStorage.setItem(LS_NOTES, JSON.stringify(merged));
            sessionStorage.removeItem(LS_NOTES);
        } catch (e) {}
    })();

    /* ───────────────────────── 按钮局部波纹 ───────────────────────── */
    function attachRipple(el) {
        if (!el || el.__rippleAttached) return;
        el.__rippleAttached = true;
        el.addEventListener('mousedown', function(e) {
            if (el.__rippleDisabled) return;
            if (e.button !== 0) return;
            var rect = el.getBoundingClientRect();
            var size = Math.max(rect.width, rect.height) * 2;
            var r = document.createElement('span');
            r.className = 'note-ripple';
            r.style.width  = size + 'px';
            r.style.height = size + 'px';
            r.style.left   = (e.clientX - rect.left - size / 2 + (el.scrollLeft || 0)) + 'px';
            r.style.top    = (e.clientY - rect.top  - size / 2 + (el.scrollTop  || 0)) + 'px';
            el.appendChild(r);
            setTimeout(function() { if (r.parentNode) r.parentNode.removeChild(r); }, 650);
        });
    }

    /* ───────────────────────── ★ 全页面波纹 ─────────────────────────
     * 监听 bodyEl 的 mousedown;波纹元素创建在 container(.note-mask)里,
     * position: fixed 覆盖整个视口,从点击点向全屏扩散。
     * box 的 z-index: 2 会浮在波纹上方,所以波纹视觉上在 box 周围可见。
     * ─────────────────────────────────────────────────────────── */
    function attachFullPageRipple(bodyEl, container) {
        if (!bodyEl || bodyEl.__fullRippleAttached) return;
        bodyEl.__fullRippleAttached = true;
        bodyEl.addEventListener('mousedown', function(e) {
            if (bodyEl.__rippleDisabled) return;
            if (e.button !== 0) return;
            // 点在工具栏/textarea/按钮里时不要触发(理论上 body 在查看模式下不会有这些)
            if (e.target && e.target.closest &&
                e.target.closest('.note-editor, .note-toolbar, .note-btn, .note-tb-btn')) {
                return;
            }
            var vw = window.innerWidth  || document.documentElement.clientWidth;
            var vh = window.innerHeight || document.documentElement.clientHeight;
            // 覆盖整个视口(以最远对角线 * 2 作为 diameter,确保从任意点击点都能铺满)
            var size = Math.sqrt(vw * vw + vh * vh) * 2.2;
            var r = document.createElement('span');
            r.className = 'note-ripple-fullpage';
            r.style.width  = size + 'px';
            r.style.height = size + 'px';
            r.style.left   = (e.clientX - size / 2) + 'px';
            r.style.top    = (e.clientY - size / 2) + 'px';
            container.appendChild(r);
            setTimeout(function() { if (r.parentNode) r.parentNode.removeChild(r); }, 850);
        });
    }

    /* ───────────────────────── 主题检测 ───────────────────────── */
    var FAV_THEME_MAP = {
        'index1.html': 'nebula',
        'index2.html': 'notion',
        'index3.html': 'stripe',
        'index4.html': 'dark',
        'index5.html': 'mint'
    };
    var VALID_THEMES = ['nebula', 'notion', 'stripe', 'dark', 'mint'];

    function detectNoteTheme() {
        try {
            var t = new URLSearchParams(location.search).get('theme');
            if (t && VALID_THEMES.indexOf(t) !== -1) return t;
        } catch (e) {}
        if (global.__FAV_PAGE_ID && FAV_THEME_MAP[global.__FAV_PAGE_ID]) {
            return FAV_THEME_MAP[global.__FAV_PAGE_ID];
        }
        var name = (location.pathname.split('/').pop() || '').toLowerCase();
        if (FAV_THEME_MAP[name]) return FAV_THEME_MAP[name];
        try {
            var ls = localStorage.getItem('fav_last_style');
            if (ls && FAV_THEME_MAP[ls]) return FAV_THEME_MAP[ls];
        } catch (e) {}
        return 'nebula';
    }

    /* ───────────────────────── 权限 ───────────────────────── */
    function canEdit(entry) {
        try {
            if (!sessionStorage.getItem(PWD_KEY)) return false;
        } catch (e) { return false; }
        if (entry && entry.meta && entry.meta.encrypted) return false;
        return true;
    }

    /* ───────────────────────── 在线/本地模式检测 ───────────────────────── */
    var _onlineModeCache = null;
    async function detectOnlineMode() {
        if (_onlineModeCache !== null) return _onlineModeCache;
        try {
            var r = await fetch('/api/check', { credentials: 'same-origin' });
            _onlineModeCache = (r.status !== 404);
        } catch (e) {
            _onlineModeCache = false;
        }
        return _onlineModeCache;
    }

    /* ───────────────────────── meta → /api/comment path ───────────────────────── */
    // ★ 从 sections 数组中查找 section key 对应的下标
    function findSectionIndex(sectionKey) {
        // 优先用 fav-page.js 的 normalizeData 建立的索引映射
        if (window.__sectionIndexMap && window.__sectionIndexMap[sectionKey] != null) {
            return window.__sectionIndexMap[sectionKey];
        }
        // fallback：遍历 sections 数组
        var s = window.__sections || window.sections;
        if (Array.isArray(s)) {
            for (var i = 0; i < s.length; i++) {
                if (s[i] && s[i].key === sectionKey) return i;
            }
        }
        return -1;
    }

    function metaToJsonPath(meta) {
        if (!meta) return null;
        var sk = meta.sectionKey;
        if (!sk) return null;

        // ★ 新格式：path = ['sections', sectionIdx, 'cards', cardIdx, ..., 'comment']
        var sectionIdx = findSectionIndex(sk);
        if (sectionIdx < 0) return null;

        var path;
        if (meta.emailIndex != null) {
            // 邮箱卡片：直接定位到 emailData section 中的第 emailIndex 个卡片
            path = ['sections', sectionIdx, 'cards', meta.emailIndex];
            path.push('comment');
            return path;
        }

        path = ['sections', sectionIdx, 'cards'];
        if (meta.cardIndex == null) return null;
        path.push(meta.cardIndex);
        if (meta.subIndex != null) path.push('subCards', meta.subIndex);
        path.push('comment');
        return path;
    }

    /* ───────────────────────── HTML 转义 ─────────────────────────
     * 注意：& < > 必须转义防止节点注入；" ' 同时转义是为了在被嵌入
     * 属性值时也安全（HTML 实体在文本节点内显示效果相同，无外观差异）。
     */
    function esc(s) {
        return String(s).replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#39;');
    }

    /* ───────────────────────── URL 白名单 ─────────────────────────
     * Markdown 链接 [text](url) 的 url 必须过白名单，防止 javascript: 协议 XSS。
     * 图片 ![alt](src) 的 src 单独走 imgUrl 白名单，允许 data:image/。
     */
    function safeMdUrl(u) {
        var s = String(u || '').trim();
        if (!s) return '';
        if (/^(?:https?:|mailto:|tel:|\/|#|\?)/i.test(s)) return s;
        return '#';
    }
    function safeMdImgUrl(u) {
        var s = String(u || '').trim();
        if (!s) return '';
        if (/^(?:https?:|\/|data:image\/[a-zA-Z+.-]+;)/i.test(s)) return s;
        return '';
    }

    /* ───────────────────────── SVG 安全过滤 ───────────────────────── */
    function sanitizeSVG(raw) {
        if (!raw || typeof raw !== 'string') return '';
        return raw
            .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
            .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
            .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
            .replace(/\bon\w+\s*=\s*[^\s>\/]+/gi, '')
            .replace(/(?:href|xlink:href)\s*=\s*["']\s*javascript:/gi, 'data-removed="javascript-uri"');
    }

    /* ════════════════════════════════════════════════════════════
     * 轻量 Markdown 渲染器(+ 裸 URL 自动识别)
     * ════════════════════════════════════════════════════════════ */
    function renderMarkdown(src) {
        if (!src) return '';
        src = String(src).replace(/\r\n/g, '\n');

        var codeBlocks = [];
        src = src.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, function(_, lang, code) {
            codeBlocks.push('<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>');
            return '\u0000CB' + (codeBlocks.length - 1) + '\u0000';
        });

        var inlineCodes = [];
        src = src.replace(/`([^`\n]+)`/g, function(_, c) {
            inlineCodes.push('<code>' + esc(c) + '</code>');
            return '\u0000IC' + (inlineCodes.length - 1) + '\u0000';
        });

        var lines = src.split('\n');
        var out = [], i = 0;
        while (i < lines.length) {
            var line = lines[i];

            if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

            // ★ 所有用户文本内容统一过 esc()，防止 <img onerror=...> 之类直接拼进 innerHTML。
            //   后续的 markdown 标记替换 (**bold**, [text](url), 裸 URL 等) 在已转义文本上做，
            //   text/alt 在替换器内不再二次 esc（避免 &lt; 被双重转义成 &amp;lt;）。
            var hm = /^(#{1,6})\s+(.*)$/.exec(line);
            if (hm) { out.push('<h' + hm[1].length + '>' + esc(hm[2]) + '</h' + hm[1].length + '>'); i++; continue; }

            if (/^\s*[-*+]\s+/.test(line)) {
                out.push('<ul>');
                while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
                    out.push('<li>' + esc(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>');
                    i++;
                }
                out.push('</ul>'); continue;
            }

            if (/^\s*\d+\.\s+/.test(line)) {
                out.push('<ol>');
                while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
                    out.push('<li>' + esc(lines[i].replace(/^\s*\d+\.\s+/, '')) + '</li>');
                    i++;
                }
                out.push('</ol>'); continue;
            }

            if (/^\s*>\s?/.test(line)) {
                var quote = [];
                while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                    quote.push(esc(lines[i].replace(/^\s*>\s?/, ''))); i++;
                }
                out.push('<blockquote>' + quote.join('<br>') + '</blockquote>'); continue;
            }

            if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length &&
                /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
                var head = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
                i += 2;
                var rows = [];
                while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
                    rows.push(lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|'));
                    i++;
                }
                var t = '<table><thead><tr>';
                head.forEach(function(h) { t += '<th>' + esc(h.trim()) + '</th>'; });
                t += '</tr></thead><tbody>';
                rows.forEach(function(r) {
                    t += '<tr>';
                    r.forEach(function(c) { t += '<td>' + esc(c.trim()) + '</td>'; });
                    t += '</tr>';
                });
                t += '</tbody></table>';
                out.push(t); continue;
            }

            if (line.trim() === '') { i++; continue; }
            var para = [];
            while (i < lines.length && lines[i].trim() !== '' &&
                   !/^(#{1,6})\s+/.test(lines[i]) &&
                   !/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(lines[i]) &&
                   !/^\s*[-*+]\s+/.test(lines[i]) &&
                   !/^\s*\d+\.\s+/.test(lines[i]) &&
                   !/^\s*>\s?/.test(lines[i])) {
                para.push(esc(lines[i])); i++;
            }
            out.push('<p>' + para.join('<br>') + '</p>');
        }

        var html = out.join('\n');

        // ★ 图片/链接：url 必过白名单防 javascript: 协议；
        //   alt/text 已经在上面逐行 esc 过了，这里不能再 esc（会双重转义成 &amp;lt;）。
        //   url 已经经过 esc（因为它出现在段落/标题等文本里），属性值里使用安全。
        html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function(_, alt, src) {
            var safe = safeMdImgUrl(src);
            if (!safe) return alt;  // 不合法的图片协议 → 退化为纯文本(alt 已 esc)
            // 2026-05-23:图片显示尺寸约束(防超大图破坏布局)— max-height 400px,保持宽高比
            return '<img alt="' + alt + '" src="' + safe + '"' +
                   ' style="max-width:100%;max-height:400px;object-fit:contain;display:block;margin:8px auto;border-radius:4px;"' +
                   ' loading="lazy"' +
                   ' onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{textContent:\'🖼 图片加载失败: \'+this.src,style:\'color:#999;font-size:12px;display:inline-block;padding:4px 8px;background:#f5f5f5;border-radius:4px;\'}))">';
        });
        html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function(_, text, url) {
            var safe = safeMdUrl(url);
            return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
        });
        html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        html = html.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

        var aBlocks = [];
        html = html.replace(/<a\s+[^>]*>[\s\S]*?<\/a>/g, function(m) {
            aBlocks.push(m);
            return '\u0000AT' + (aBlocks.length - 1) + '\u0000';
        });
        html = html.replace(
            /(^|[\s(>])((?:https?:\/\/|www\.)[^\s<>"'`)]+)/g,
            function(m, pre, url) {
                var trailing = '';
                var tm = url.match(/[.,;:!?"']+$/);
                if (tm) { trailing = tm[0]; url = url.substring(0, url.length - trailing.length); }
                if (!url) return m;
                var href = url.indexOf('www.') === 0 ? 'http://' + url : url;
                return pre + '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + url + '</a>' + trailing;
            }
        );
        html = html.replace(/\u0000AT(\d+)\u0000/g, function(_, n) { return aBlocks[+n]; });

        html = html.replace(/\u0000IC(\d+)\u0000/g, function(_, n) { return inlineCodes[+n]; });
        html = html.replace(/\u0000CB(\d+)\u0000/g, function(_, n) { return codeBlocks[+n]; });

        return html;
    }

    /* ───────────────────────── 本地持久化 ─────────────────────────
     * ★ 新逻辑:
     *   - saveOverride(key, comment): 总是写入(空字符串也保留),
     *     代表"本地已改(或已删除)、尚未同步到文件"。
     *   - removeOverride(key): 仅在"同步服务器成功"后调用,彻底删掉记录。
     * ─────────────────────────────────────────────────────────── */
    function readOverrides() {
        try { return JSON.parse(localStorage.getItem(LS_NOTES) || '{}'); }
        catch (e) { return {}; }
    }
    function saveOverride(key, comment) {
        if (!key) return;
        try {
            var m = readOverrides();
            // ★ 即使 comment 为空字符串也必须写入:
            //    空串 = "本地已删除 comment,待同步到 data.js / KV"。
            //    旧代码 `if (comment) ... else delete` 会吃掉"删除"这个动作,
            //    导致 config.html 的 banner 和 note-modal 的 pending 提示消失。
            m[key] = comment || '';
            localStorage.setItem(LS_NOTES, JSON.stringify(m));
        } catch (e) {}
    }
    function removeOverride(key) {
        if (!key) return;
        try {
            var m = readOverrides();
            delete m[key];
            localStorage.setItem(LS_NOTES, JSON.stringify(m));
        } catch (e) {}
    }
    function clearAllOverrides() {
        try { localStorage.removeItem(LS_NOTES); } catch (e) {}
    }

    /* ★ 判断某张卡是否存在未同步到文件的本地修改 */
    function getEntryKey(entry) {
        if (!entry) return '';
        return (entry.card && entry.card.id) || (entry.meta && entry.meta.uniqueKey) || '';
    }
    function getPendingRecord(entry) {
        var key = getEntryKey(entry);
        if (!key) return null;
        var ov = readOverrides();
        if (!Object.prototype.hasOwnProperty.call(ov, key)) return null;
        return { key: key, value: ov[key] };  // value 为空字符串代表"删除待同步"
    }

    /* ───────────────────────── 内部工具 ───────────────────────── */
    function getEntry(cardId) {
        var api = window.__favPageAPI;
        return (api && typeof api.getCardById === 'function') ? api.getCardById(cardId) : null;
    }
    function closeCurrent() {
        var m = document.querySelector('.note-mask');
        if (m) m.remove();
    }
    function gotoUrl(card) {
        var rawUrl = card.url || card.descUrl || card.mailto || '';
        if (!rawUrl) return;
        // 协议白名单：拒绝 javascript: 等危险协议
        var s = String(rawUrl).trim();
        var url = /^(?:https?:|mailto:|tel:|\/|#|\?)/i.test(s) ? s : '';
        if (!url) return;
        if (card.isLocal) window.location.href = url;
        else              window.open(url, '_blank', 'noopener,noreferrer');
    }

    /* ★ 统一的"待同步"提示 HTML */
    function buildPendingHTML(pending) {
        var isDelete = !pending.value;
        var link = ' · <a href="' + CONFIG_HREF + '" target="_blank" rel="noopener noreferrer" class="note-config-link">打开 Config 页面 →</a>';
        return (isDelete
            ? '✅ 已在本浏览器删除,请到 Config 页面保存到文件'
            : '✅ 已保存到本浏览器,请到 Config 页面保存到文件') + link;
    }

    /* ════════════════════════════════════════════════════════════
     * Markdown 工具栏辅助函数
     * ════════════════════════════════════════════════════════════ */
    function tbWrap(ta, left, right, placeholder) {
        var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
        var sel = v.substring(s, e);
        var used = sel || (placeholder || '');
        ta.value = v.substring(0, s) + left + used + right + v.substring(e);
        ta.focus();
        var ns = s + left.length;
        ta.setSelectionRange(ns, ns + used.length);
    }
    function tbLinePrefix(ta, prefix) {
        var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
        var ls = v.lastIndexOf('\n', s - 1) + 1;
        var le = v.indexOf('\n', e);
        if (le === -1) le = v.length;
        var block = v.substring(ls, le);
        var lines = block.split('\n');
        var allHave = lines.length > 0 && lines.every(function(l) { return l.indexOf(prefix) === 0; });
        var newLines = allHave
            ? lines.map(function(l) { return l.substring(prefix.length); })
            : lines.map(function(l) { return prefix + l; });
        var newBlock = newLines.join('\n');
        ta.value = v.substring(0, ls) + newBlock + v.substring(le);
        ta.focus();
        ta.setSelectionRange(ls, ls + newBlock.length);
    }
    function tbCodeBlock(ta) {
        var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
        var sel = v.substring(s, e) || '代码';
        var needNlBefore = s > 0 && v.charAt(s - 1) !== '\n';
        var needNlAfter  = v.charAt(e) !== '\n';
        var insert = (needNlBefore ? '\n' : '') + '```\n' + sel + '\n```' + (needNlAfter ? '\n' : '');
        ta.value = v.substring(0, s) + insert + v.substring(e);
        ta.focus();
        var codeStart = s + (needNlBefore ? 1 : 0) + 4;
        ta.setSelectionRange(codeStart, codeStart + sel.length);
    }
    function tbLink(ta) {
        var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
        var sel = v.substring(s, e);
        var text = sel || '链接文字';
        var url  = 'https://';
        var insert = '[' + text + '](' + url + ')';
        ta.value = v.substring(0, s) + insert + v.substring(e);
        ta.focus();
        var urlStart = s + text.length + 3;
        ta.setSelectionRange(urlStart, urlStart + url.length);
    }
    function tbImage(ta) {
        var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
        var sel = v.substring(s, e);
        var alt = sel || '图片说明';
        var url = 'https://';
        var insert = '![' + alt + '](' + url + ')';
        ta.value = v.substring(0, s) + insert + v.substring(e);
        ta.focus();
        var urlStart = s + alt.length + 4;
        ta.setSelectionRange(urlStart, urlStart + url.length);
    }
    function tbHr(ta) {
        var s = ta.selectionStart, v = ta.value;
        var needNlBefore = s > 0 && v.charAt(s - 1) !== '\n';
        var insert = (needNlBefore ? '\n' : '') + '\n---\n\n';
        ta.value = v.substring(0, s) + insert + v.substring(ta.selectionEnd);
        ta.focus();
        var pos = s + insert.length;
        ta.setSelectionRange(pos, pos);
    }

    function buildToolbar(ta) {
        var groups = [
            [
                { label: 'H1', title: '一级标题', run: function(){ tbLinePrefix(ta, '# '); } },
                { label: 'H2', title: '二级标题', run: function(){ tbLinePrefix(ta, '## '); } },
                { label: 'H3', title: '三级标题', run: function(){ tbLinePrefix(ta, '### '); } }
            ],
            [
                { label: 'B', title: '粗体 (Ctrl+B)', cls: 'tb-bold',
                  run: function(){ tbWrap(ta, '**', '**', '加粗文字'); } },
                { label: 'I', title: '斜体 (Ctrl+I)', cls: 'tb-italic',
                  run: function(){ tbWrap(ta, '*', '*', '斜体文字'); } },
                { label: 'S', title: '删除线', cls: 'tb-strike',
                  run: function(){ tbWrap(ta, '~~', '~~', '删除'); } }
            ],
            [
                { label: '❝', title: '引用',     run: function(){ tbLinePrefix(ta, '> '); } },
                { label: '•', title: '无序列表', run: function(){ tbLinePrefix(ta, '- '); } },
                { label: '1.', title: '有序列表', run: function(){ tbLinePrefix(ta, '1. '); } }
            ],
            [
                { label: '</>', title: '行内代码', cls: 'tb-code',
                  run: function(){ tbWrap(ta, '`', '`', 'code'); } },
                { label: '{ }', title: '代码块',   cls: 'tb-code',
                  run: function(){ tbCodeBlock(ta); } }
            ],
            [
                { label: '🔗', title: '链接 (Ctrl+K)', run: function(){ tbLink(ta); } },
                { label: '🖼', title: '图片',         run: function(){ tbImage(ta); } },
                { label: '—', title: '分隔线',       run: function(){ tbHr(ta); } }
            ]
        ];

        var tb = document.createElement('div');
        tb.className = 'note-toolbar';
        tb.setAttribute('role', 'toolbar');

        groups.forEach(function(group, gi) {
            if (gi > 0) {
                var sep = document.createElement('span');
                sep.className = 'note-tb-sep';
                tb.appendChild(sep);
            }
            group.forEach(function(item) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'note-tb-btn' + (item.cls ? ' ' + item.cls : '');
                b.title = item.title;
                b.textContent = item.label;
                b.addEventListener('mousedown', function(e) { e.preventDefault(); });
                b.addEventListener('click', function(e) { e.preventDefault(); item.run(); });
                tb.appendChild(b);
            });
        });

        return tb;
    }

    /* ───────────────────────── 构建模态框 ───────────────────────── */
    function buildModal(entry, opts) {
        var card  = entry.card;
        var url   = card.url || card.descUrl || card.mailto || '';
        var title = card.title || card.content || card.desc || '(无标题)';

        var mask = document.createElement('div');
        mask.className = 'note-mask';
        mask.setAttribute('data-note-theme', detectNoteTheme());

        var iconHtml;
        if (card.iconImg) {
            iconHtml = '<span class="note-icon"><img src="' + esc(card.iconImg) + '" alt=""></span>';
        } else if (card.icon && String(card.icon).charAt(0) === '<') {
            iconHtml = '<span class="note-icon note-icon-svg">' + sanitizeSVG(card.icon) + '</span>';
        } else if (card.icon) {
            iconHtml = '<span class="note-icon">' + esc(card.icon) + '</span>';
        } else {
            iconHtml = '<span class="note-icon">📝</span>';
        }

        var box = document.createElement('div');
        box.className = 'note-box';
        box.innerHTML =
            '<div class="note-header">' +
                iconHtml +
                '<h3 class="note-title" title="' + esc(title) + '">' + esc(title) + '</h3>' +
                '<button class="note-close" aria-label="关闭">✕</button>' +
            '</div>' +
            '<div class="note-body" id="noteBody"></div>' +
            '<div class="note-footer" id="noteFooter"></div>';
        mask.appendChild(box);

        var editable     = canEdit(entry);
        var comment      = card.comment || '';
        var startEditing = !!opts.editing;

        function render() {
            var body   = box.querySelector('#noteBody');
            var footer = box.querySelector('#noteFooter');
            body.innerHTML   = '';
            footer.innerHTML = '';
            body.classList.remove('clickable');
            body.title   = '';
            body.onclick = null;

            var pending = getPendingRecord(entry);

            if (startEditing) {
                /* ═══════════ 编辑模式 ═══════════ */
                body.__rippleDisabled = true;  // 编辑模式禁用 body 波纹

                var ta = document.createElement('textarea');
                ta.className   = 'note-editor';
                ta.placeholder = '支持 Markdown:# 标题 | **粗** *斜* | `code` | ```代码块``` | [文字](url) | - 列表 | > 引用 | --- 分隔线\n\n(清空内容并保存即为删除注释)';
                ta.value       = comment;

                var toolbar = buildToolbar(ta);
                var wrap = document.createElement('div');
                wrap.className = 'note-editor-wrap';
                wrap.appendChild(toolbar);
                wrap.appendChild(ta);
                body.appendChild(wrap);

                setTimeout(function() { ta.focus(); }, 50);

                var status = document.createElement('div');
                status.className = 'note-status';
                // ★ 若已有未同步到文件的本地改动,编辑器一进来就显示这条提示
                if (pending) {
                    status.className = 'note-status pending';
                    status.innerHTML = buildPendingHTML(pending);
                }
                footer.appendChild(status);

                var backBtn = document.createElement('button');
                backBtn.className   = 'note-btn note-btn-secondary';
                backBtn.textContent = '返回';
                backBtn.onclick = function() {
                    if (comment) { startEditing = false; render(); }
                    else          { mask.remove(); }
                };
                footer.appendChild(backBtn);

                var saveBtn = document.createElement('button');
                saveBtn.className   = 'note-btn note-btn-primary';
                saveBtn.textContent = '保存';
                footer.appendChild(saveBtn);

                saveBtn.onclick = function() {
                    var val = ta.value.trim();
                    if (!val && comment) {
                        if (!confirm('注释内容为空,保存将删除该注释。是否继续?')) return;
                    }
                    doSave(ta.value, status, saveBtn, ta);
                };

                ta.addEventListener('keydown', function(e) {
                    var mod = e.ctrlKey || e.metaKey;
                    if (mod && e.key === 'Enter') { e.preventDefault(); saveBtn.click(); return; }
                    if (!mod || e.shiftKey || e.altKey) return;
                    var k = e.key.toLowerCase();
                    if (k === 'b') { e.preventDefault(); tbWrap(ta, '**', '**', '加粗文字'); }
                    else if (k === 'i') { e.preventDefault(); tbWrap(ta, '*', '*', '斜体文字'); }
                    else if (k === 'k') { e.preventDefault(); tbLink(ta); }
                });

            } else {
                /* ═══════════ 查看模式 ═══════════ */
                body.__rippleDisabled = false;
                // ★ 全页面波纹:绑定在 body 上,ripple 元素 append 到 mask
                attachFullPageRipple(body, mask);

                if (comment) {
                    var md = document.createElement('div');
                    md.className = 'note-md';
                    md.innerHTML = renderMarkdown(comment);
                    body.appendChild(md);

                    if (url) {
                        body.classList.add('clickable');
                        // ★ 悬停提示带具体 URL
                        body.title = '点击跳转:' + url;
                        body.onclick = function(e) {
                            if (e.target.closest && e.target.closest('a')) return;
                            gotoUrl(card); mask.remove();
                        };
                    }
                } else {
                    var hint = document.createElement('div');
                    hint.className  = 'note-empty-hint';
                    hint.textContent = editable ? '(该卡片尚无注释,点击"添加注释"创建)'
                                                : '(该卡片尚无注释)';
                    body.appendChild(hint);
                }

                // ★ footer:先放 pending 状态(若有),再放按钮
                if (pending) {
                    var pStat = document.createElement('div');
                    pStat.className = 'note-status pending';
                    pStat.innerHTML = buildPendingHTML(pending);
                    footer.appendChild(pStat);
                }

                if (editable) {
                    var editBtn = document.createElement('button');
                    editBtn.className   = 'note-btn note-btn-primary';
                    editBtn.textContent = comment ? '编辑' : '添加注释';
                    editBtn.onclick = function() { startEditing = true; render(); };
                    footer.appendChild(editBtn);
                } else {
                    var tip = document.createElement('span');
                    tip.className = 'note-readonly-tip';
                    if (entry.meta && entry.meta.encrypted) {
                        tip.innerHTML = '🔒 加密内容请到 Config 页面修改';
                    } else {
                        tip.innerHTML = '🔒 只读(解锁后可编辑)';
                    }
                    footer.appendChild(tip);
                }
            }

            // 所有按钮 attach 局部波纹(__rippleAttached 防重复)
            box.querySelectorAll('.note-btn, .note-tb-btn').forEach(attachRipple);
        }

        /* ═════════════════════════ 保存逻辑 ═════════════════════════ */
        async function doSave(newComment, statusEl, saveBtn, ta) {
            saveBtn && (saveBtn.disabled = true);
            statusEl.className   = 'note-status';
            statusEl.textContent = '保存中...';

            var finalComment = (newComment || '').trim();
            var isDelete     = !finalComment;

            if (!canEdit(entry)) {
                statusEl.className = 'note-status err';
                statusEl.textContent = (entry.meta && entry.meta.encrypted)
                    ? '🔒 加密内容请到 Config 页面修改'
                    : '❌ 未解锁,无法保存';
                saveBtn && (saveBtn.disabled = false);
                return;
            }

            try {
                var savedToServer = false;

                if (typeof window.onNoteSave === 'function') {
                    await window.onNoteSave({
                        card:    card,
                        meta:    entry.meta || {},
                        comment: finalComment
                    });
                    savedToServer = true;
                } else {
                    var online = await detectOnlineMode();
                    if (online) {
                        var path = metaToJsonPath(entry.meta || {});
                        if (!path) throw new Error('无法构造定位路径');
                        var resp = await fetch('/api/comment', {
                            method:      'POST',
                            credentials: 'same-origin',
                            headers:     { 'Content-Type': 'application/json' },
                            body:        JSON.stringify({ path: path, comment: finalComment })
                        });
                        if (resp.status === 401 || resp.status === 403) {
                            throw new Error('未登录(请先到 Config 页面登录)');
                        }
                        if (!resp.ok) {
                            var t = await resp.text().catch(function() { return ''; });
                            throw new Error(t || ('HTTP ' + resp.status));
                        }
                        var json = await resp.json().catch(function() { return {}; });
                        if (json && json.ok === false) {
                            throw new Error(json.error || '服务器保存失败');
                        }
                        savedToServer = true;
                    }
                }

                // 更新内存中的 card
                if (finalComment) card.comment = finalComment;
                else              delete card.comment;

                // localStorage overrides 同步
                // ★ 关键修复:
                //   - 已同步到服务器 → removeOverride 彻底删除记录
                //   - 仅本地保存    → saveOverride(空串也要保留),pending 常驻
                var key = getEntryKey(entry);
                if (savedToServer) {
                    removeOverride(key);
                } else {
                    saveOverride(key, finalComment);
                }

                comment = finalComment;
                updateCardHasNoteBadge(entry);

                /* 状态提示 */
                statusEl.className = 'note-status ok';
                var link = ' · <a href="' + CONFIG_HREF + '" target="_blank" rel="noopener" class="note-config-link">打开 Config 页面 →</a>';
                if (savedToServer) {
                    statusEl.innerHTML = (isDelete ? '✅ 已删除并同步到服务器' : '✅ 已保存并同步到服务器') + link;
                } else {
                    statusEl.className = 'note-status pending';
                    statusEl.innerHTML = (isDelete
                        ? '✅ 已在本浏览器删除,请到 Config 页面保存到文件'
                        : '✅ 已保存到本浏览器,请到 Config 页面保存到文件') + link;
                }

                if (saveBtn) saveBtn.disabled = false;

            } catch (err) {
                statusEl.className   = 'note-status err';
                statusEl.textContent = '❌ 保存失败:' + ((err && err.message) || err);
                saveBtn && (saveBtn.disabled = false);
            }
        }

        box.querySelector('.note-close').onclick = function() { mask.remove(); };
        // ★ 只有"按下时在 mask 上 + 松开时也在 mask 上"才关闭
        // 防止从卡片内按下、拖到外面松开而意外关闭
        var _maskDownOnSelf = false;
        mask.addEventListener('mousedown', function(e) {
            _maskDownOnSelf = (e.target === mask);
        });
        mask.addEventListener('mouseup', function(e) {
            if (_maskDownOnSelf && e.target === mask) mask.remove();
            _maskDownOnSelf = false;
        });

        function escHandler(e) {
            if (e.key === 'Escape' && mask.parentNode) {
                mask.remove();
                document.removeEventListener('keydown', escHandler);
            }
        }
        document.addEventListener('keydown', escHandler);

        document.body.appendChild(mask);
        render();
    }

    /* ───────────────────────── 红点 DOM 同步辅助 ─────────────────────────
     * 把"添加 .has-note 类 + append <span class='note-dot'>"封装在一起，
     * 让红点改用真实 DOM 元素而非 ::after，避免与页面自有伪元素冲突
     * （如 index5 的 .link-card::after hover 绿线）。
     * ─────────────────────────────────────────────────────────── */
    function setHasNote(el, hasNote) {
        if (!el || !el.classList) return;
        if (hasNote) {
            el.classList.add('has-note');
            var has = false;
            for (var i = 0; i < el.children.length; i++) {
                if (el.children[i].classList &&
                    el.children[i].classList.contains('note-dot')) { has = true; break; }
            }
            if (!has) {
                var dot = document.createElement('span');
                dot.className = 'note-dot';
                dot.setAttribute('aria-hidden', 'true');
                el.appendChild(dot);
            }
        } else {
            el.classList.remove('has-note');
            for (var j = el.children.length - 1; j >= 0; j--) {
                var c = el.children[j];
                if (c.classList && c.classList.contains('note-dot')) el.removeChild(c);
            }
        }
    }

    /* ───────────────────────── 更新卡片红点 ───────────────────────── */
    function updateCardHasNoteBadge(entry) {
        var nodes = document.querySelectorAll('[data-card-id]');
        nodes.forEach(function(el) {
            var cid = el.getAttribute('data-card-id');
            var e = getEntry(cid);
            if (!e || e.card !== entry.card) return;
            setHasNote(el, !!e.card.comment);
        });
    }

    /* ════════════════════════════════════════════════════════════
     * applyOverrides
     * ════════════════════════════════════════════════════════════ */
    function applyOverrides() {
        var overrides = readOverrides();
        if (!overrides || !Object.keys(overrides).length) {
            refreshAllBadges();
            return;
        }

        var api = window.__favPageAPI;
        if (!api || typeof api.getCardById !== 'function') return;

        var nodes = document.querySelectorAll('[data-card-id]');
        if (!nodes.length) return;

        var seen = new Set ? new Set() : null;

        nodes.forEach(function(el) {
            var cid = el.getAttribute('data-card-id');
            var entry = api.getCardById(cid);
            if (!entry || !entry.card) return;

            var key = (entry.card && entry.card.id) || (entry.meta && entry.meta.uniqueKey);
            if (key) {
                if (!seen || !seen.has(entry.card)) {
                    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
                        var v = overrides[key];
                        // ★ v 为空串代表"本地已删除,待同步" → 从 card 上移除 comment
                        if (v) entry.card.comment = v;
                        else   delete entry.card.comment;
                    }
                    if (seen) seen.add(entry.card);
                }
            }

            setHasNote(el, !!entry.card.comment);
        });
    }

    function refreshAllBadges() {
        var nodes = document.querySelectorAll('[data-card-id]');
        nodes.forEach(function(el) {
            var entry = getEntry(el.getAttribute('data-card-id'));
            if (!entry || !entry.card) return;
            setHasNote(el, !!entry.card.comment);
        });
    }

    /* ════════════════════════════════════════════════════════════
     * 启动时:等 fav-page.js 渲染完 → 自动 applyOverrides
     * ════════════════════════════════════════════════════════════ */
    var applyDebounceTimer = null;
    function scheduleApply() {
        if (applyDebounceTimer) clearTimeout(applyDebounceTimer);
        applyDebounceTimer = setTimeout(function() {
            applyDebounceTimer = null;
            applyOverrides();
        }, 80);
    }

    function bootApplyObserver() {
        [0, 200, 600, 1500].forEach(function(t) { setTimeout(scheduleApply, t); });

        try {
            var mo = new MutationObserver(function(mutations) {
                var needApply = false;
                for (var i = 0; i < mutations.length; i++) {
                    var m = mutations[i];
                    for (var j = 0; j < m.addedNodes.length; j++) {
                        var n = m.addedNodes[j];
                        if (n.nodeType !== 1) continue;
                        if ((n.hasAttribute && n.hasAttribute('data-card-id')) ||
                            (n.querySelector && n.querySelector('[data-card-id]'))) {
                            needApply = true; break;
                        }
                    }
                    if (needApply) break;
                }
                if (needApply) scheduleApply();
            });
            mo.observe(document.body, { childList: true, subtree: true });
        } catch (e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootApplyObserver);
    } else {
        bootApplyObserver();
    }

    /* ───────────────────────── 对外入口 ───────────────────────── */
    function show(cardId) {
        var entry = getEntry(cardId);
        if (!entry) return;
        closeCurrent();
        buildModal(entry, { editing: false });
    }
    function openEditor(cardId) {
        var entry = getEntry(cardId);
        if (!entry) return;
        if (!canEdit(entry)) { show(cardId); return; }
        closeCurrent();
        buildModal(entry, { editing: true });
    }

    global.NoteModal = {
        show:           show,
        openEditor:     openEditor,
        canEdit:        canEdit,
        renderMarkdown: renderMarkdown,
        applyOverrides: applyOverrides,
        getOverrides:   readOverrides,
        clearOverrides: clearAllOverrides   // ★ 供 config.html 保存后清除
    };

    /* ════════════════════════════════════════════════════════════
     * 右键 / 长按 → 打开编辑器(仅已解锁 + 非加密卡片)
     * ════════════════════════════════════════════════════════════ */
    function findCardId(target) {
        if (!target || !target.closest) return null;
        var el = target.closest('[data-card-id]');
        return el ? el.getAttribute('data-card-id') : null;
    }

    document.addEventListener('contextmenu', function(e) {
        var cid = findCardId(e.target);
        if (!cid) return;
        var entry = getEntry(cid);
        if (!canEdit(entry)) return;
        e.preventDefault();
        openEditor(cid);
    });

    var touchTimer = null;
    document.addEventListener('touchstart', function(e) {
        var cid = findCardId(e.target);
        if (!cid) return;
        var entry = getEntry(cid);
        if (!canEdit(entry)) return;
        touchTimer = setTimeout(function() {
            touchTimer = null;
            openEditor(cid);
        }, 600);
    }, { passive: true });
    ['touchmove', 'touchend', 'touchcancel'].forEach(function(ev) {
        document.addEventListener(ev, function() {
            if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
        }, { passive: true });
    });

})(window);