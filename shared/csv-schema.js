/* ================================================================================
 * shared/csv-schema.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CSV 导入导出 schema 与工具库（B0 阶段产出）
 *
 * 用途：把 sections 数组（来自 data.js 或 KV）与 CSV 文本互相转换。
 * 阶段：B0 只产出本文件 + tools/test-csv.html；不动现有任何文件；不加 UI 入口。
 * 后续：B1 在 config.html 加"导出 CSV"按钮；B2 加"导入 CSV"；B3 加模板下载入口。
 *
 * 规则参考：.claude/下一阶段计划.md §3 阶段 B0 v2 实施版（v2-2 ~ v2-5）。
 *
 * 加载方式（不用 ES module，与 fav-page.js / note-modal.js 风格一致）：
 *   <script src="shared/csv-schema.js"></script>
 *   然后通过 window.CsvSchema.* 调用。
 *
 * 对外 API（v2-3 函数签名）：
 *   CsvSchema.COLUMNS           : 15 列元数据数组
 *   CsvSchema.sectionsToCSV(sections, opts)
 *   CsvSchema.csvToSections(text, opts)
 *   CsvSchema.downloadTemplate()
 *   CsvSchema.parseRow(row)
 *   CsvSchema.serializeField(v)
 * ================================================================================ */

(function() {
    'use strict';

    /* ════════════════════════════════════════════════════════════════════════════
     * 【1】列定义（v2-2 字段表，2026-05-16 修订：补 content/address/mailto）
     * ════════════════════════════════════════════════════════════════════════════ */
    var COLUMNS = [
        { col: 'section_key',    required: true,  desc: '所属分类 key（6 个内置或 custom_*）' },
        { col: 'card_id',        required: false, desc: '主卡 id；老数据无 id 时留空' },
        { col: 'parent_card_id', required: false, desc: '子卡片归属的父卡 id；主卡留空' },
        { col: 'sub_index',      required: false, desc: '子卡片在父卡 subCards 中的序号（0 起）；主卡留空' },
        { col: 'type',           required: false, desc: 'simple / desc-clickable / expandable；子卡和邮箱卡留空' },
        { col: 'title',          required: false, desc: '卡片或子卡片标题；compact-card 子卡可用 content 代替' },
        { col: 'content',        required: false, desc: 'compact-card 子卡的单行内容文字（与 title 二选一）' },
        { col: 'url',            required: false, desc: '点击跳转 URL' },
        { col: 'desc',           required: false, desc: '纯文本描述' },
        { col: 'descClickable',  required: false, desc: '可点击的描述文字；子卡不用' },
        { col: 'descUrl',        required: false, desc: '可点击描述的跳转 URL；子卡不用' },
        { col: 'icon',           required: false, desc: 'emoji 或单行 SVG' },
        { col: 'iconImg',        required: false, desc: '图标 URL（优先于 icon）' },
        { col: 'isLocal',        required: false, desc: 'true / 空；导入时空 = false' },
        { col: 'address',        required: false, desc: '邮箱卡专用：显示用邮箱地址（如 aabb(AT)cc.cc）' },
        { col: 'mailto',         required: false, desc: '邮箱卡专用：点击行为目标（可以是 http(s) 或 mailto:）' },
        { col: 'comment',        required: false, desc: 'Markdown 注释（多行用 RFC4180 转义）' },
        { col: 'note',           required: false, desc: '子卡专用，compact-card 的额外小字' }
    ];

    var COL_NAMES = COLUMNS.map(function(c) { return c.col; });
    var VALID_TYPES = { 'simple': true, 'desc-clickable': true, 'expandable': true };
    var BOM = '﻿';
    var EOL = '\r\n';

    /* ════════════════════════════════════════════════════════════════════════════
     * 【2】CSV 编码（v2-4：RFC 4180）
     * ════════════════════════════════════════════════════════════════════════════ */

    function serializeField(v) {
        if (v == null) return '';
        var s = String(v);
        if (s === '') return '';
        if (/[",\r\n]/.test(s)) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    function serializeRow(values) {
        return values.map(serializeField).join(',');
    }

    // 单行解析（不含换行）。用于 parseRow 对外 API。
    function parseLine(line) {
        var out = [];
        var i = 0, len = line.length;
        var field = '', inQuotes = false;
        while (i < len) {
            var ch = line.charAt(i);
            if (inQuotes) {
                if (ch === '"') {
                    if (i + 1 < len && line.charAt(i + 1) === '"') {
                        field += '"'; i += 2; continue;
                    }
                    inQuotes = false; i++; continue;
                }
                field += ch; i++;
            } else {
                if (ch === ',') { out.push(field); field = ''; i++; continue; }
                if (ch === '"') {
                    if (field === '') { inQuotes = true; i++; continue; }
                    // 中途遇到 " 当字面量处理（宽松）
                    field += ch; i++; continue;
                }
                field += ch; i++;
            }
        }
        out.push(field);
        return out;
    }

    // 完整 CSV 文本切分成行（处理引号内换行）。
    function splitCSVRows(text) {
        var rows = [];
        var i = 0, len = text.length;
        var field = '', row = [], inQuotes = false;
        while (i < len) {
            var ch = text.charAt(i);
            if (inQuotes) {
                if (ch === '"') {
                    if (i + 1 < len && text.charAt(i + 1) === '"') {
                        field += '"'; i += 2; continue;
                    }
                    inQuotes = false; i++; continue;
                }
                field += ch; i++; continue;
            }
            if (ch === '"') {
                if (field === '') { inQuotes = true; i++; continue; }
                field += ch; i++; continue;
            }
            if (ch === ',') { row.push(field); field = ''; i++; continue; }
            if (ch === '\r') {
                if (i + 1 < len && text.charAt(i + 1) === '\n') i++;
                row.push(field); rows.push(row);
                field = ''; row = []; i++; continue;
            }
            if (ch === '\n') {
                row.push(field); rows.push(row);
                field = ''; row = []; i++; continue;
            }
            field += ch; i++;
        }
        // 收尾
        if (field !== '' || row.length > 0) {
            row.push(field);
            rows.push(row);
        }
        return rows;
    }

    // 把一行的数组与表头对齐成对象
    function rowToObj(headers, values) {
        var obj = {};
        for (var i = 0; i < headers.length; i++) {
            obj[headers[i]] = (i < values.length) ? values[i] : '';
        }
        return obj;
    }

    /* ════════════════════════════════════════════════════════════════════════════
     * 【3】对外:parseRow（单行 CSV → 对象，按 COLUMNS 顺序）
     * ════════════════════════════════════════════════════════════════════════════ */

    function parseRow(row) {
        // 接受字符串（一行 CSV）或已切分好的数组
        var values = Array.isArray(row) ? row : parseLine(String(row || ''));
        return rowToObj(COL_NAMES, values);
    }

    /* ════════════════════════════════════════════════════════════════════════════
     * 【4】sectionsToCSV（v2-5 导出边界）
     * ════════════════════════════════════════════════════════════════════════════ */

    function valOrEmpty(v) {
        if (v === undefined || v === null) return '';
        return v;
    }

    function boolToCSV(v) {
        return (v === true || v === 'true' || v === 1 || v === '1') ? 'true' : '';
    }

    function cardToMainRow(sec, card) {
        return [
            sec.key,
            valOrEmpty(card.id),
            '',                                  // parent_card_id
            '',                                  // sub_index
            valOrEmpty(card.type),
            valOrEmpty(card.title),
            '',                                  // content (主卡不用)
            valOrEmpty(card.url),
            valOrEmpty(card.desc),
            valOrEmpty(card.descClickable),
            valOrEmpty(card.descUrl),
            valOrEmpty(card.icon),
            valOrEmpty(card.iconImg),
            boolToCSV(card.isLocal),
            valOrEmpty(card.address),
            valOrEmpty(card.mailto),
            valOrEmpty(card.comment),
            ''                                   // note (主卡不用)
        ];
    }

    function subCardToRow(sec, parentId, sc, idx) {
        return [
            sec.key,
            '',                                  // card_id (子卡无独立 id)
            valOrEmpty(parentId),
            String(idx),
            '[sub]',                             // type 列对子卡用 [sub] 视觉标记（导入时会被识别并清空）
            valOrEmpty(sc.title),
            valOrEmpty(sc.content),
            valOrEmpty(sc.url),
            valOrEmpty(sc.desc),
            '',                                  // descClickable (子卡不用)
            '',                                  // descUrl (子卡不用)
            valOrEmpty(sc.icon),
            valOrEmpty(sc.iconImg),
            boolToCSV(sc.isLocal),
            '',                                  // address (子卡不用)
            '',                                  // mailto (子卡不用)
            valOrEmpty(sc.comment),
            valOrEmpty(sc.note)
        ];
    }

    function sectionsToCSV(sections, opts) {
        opts = opts || {};
        var includeEncrypted = opts.includeEncrypted === true;

        if (!Array.isArray(sections)) {
            throw new Error('sectionsToCSV: sections must be an array');
        }

        var lines = [serializeRow(COL_NAMES)];

        for (var s = 0; s < sections.length; s++) {
            var sec = sections[s];
            if (!sec || !sec.key) continue;

            // v2-5: 加密 section 处理
            if (sec.encrypted === true) {
                if (!includeEncrypted) continue;
                // 已要求包含但内容未解锁 → 抛错（B0 不做密钥派生）
                // 判定"已解锁"的标志：cards 已经是明文数组（非 enc 字符串结构）
                if (!Array.isArray(sec.cards)) {
                    throw new Error('Encrypted section not unlocked: ' + sec.key);
                }
            }

            var cards = Array.isArray(sec.cards) ? sec.cards : [];
            for (var c = 0; c < cards.length; c++) {
                var card = cards[c];
                if (!card) continue;
                lines.push(serializeRow(cardToMainRow(sec, card)));

                if (card.type === 'expandable' && Array.isArray(card.subCards)) {
                    var pid = card.id || '';
                    for (var k = 0; k < card.subCards.length; k++) {
                        var sc = card.subCards[k];
                        if (!sc) continue;
                        lines.push(serializeRow(subCardToRow(sec, pid, sc, k)));
                    }
                }
            }
        }

        return BOM + lines.join(EOL) + EOL;
    }

    /* ════════════════════════════════════════════════════════════════════════════
     * 【5】csvToSections（v2-5 导入边界，容错不抛异常）
     * ════════════════════════════════════════════════════════════════════════════ */

    function parseBool(v) {
        if (v == null) return false;
        var s = String(v).trim().toLowerCase();
        return s === 'true';   // 仅 true 视为 true，其它（false/0/no/空）一律视为 false
    }

    // 剥除 BOM
    function stripBOM(text) {
        if (text && text.charCodeAt(0) === 0xFEFF) return text.slice(1);
        return text;
    }

    function csvToSections(text, opts) {
        opts = opts || {};
        var strictRequired = opts.strictRequired !== false; // 默认 true

        var errors = [];
        var warnings = [];

        if (text == null || String(text).trim() === '') {
            return { rows: [], errors: errors, warnings: warnings };
        }

        var raw = stripBOM(String(text));
        var grid = splitCSVRows(raw);

        // 去掉末尾空行
        while (grid.length && grid[grid.length - 1].length === 1 && grid[grid.length - 1][0] === '') {
            grid.pop();
        }

        if (grid.length === 0) {
            return { rows: [], errors: errors, warnings: warnings };
        }

        // 表头
        var headers = grid[0].map(function(h) { return String(h || '').trim(); });
        // 验证至少包含必填列
        var missingCols = [];
        COLUMNS.forEach(function(c) {
            if (c.required && headers.indexOf(c.col) < 0) {
                missingCols.push(c.col);
            }
        });
        if (missingCols.length) {
            errors.push({ line: 1, col: '', msg: 'Missing required headers: ' + missingCols.join(', ') });
            return { rows: [], errors: errors, warnings: warnings };
        }

        // 将 grid 转成 rawRows（每行一个 obj，含 _line 表示 1-based 行号）
        var rawRows = [];
        for (var i = 1; i < grid.length; i++) {
            var values = grid[i];
            if (values.length === 1 && values[0] === '') continue;
            if (values.every(function(v) { return v === ''; })) continue;
            var obj = rowToObj(headers, values);
            obj._line = i + 1;
            rawRows.push(obj);
        }

        // 委托给 validateRows
        return validateRows(rawRows, { strictRequired: strictRequired });
    }

    /* ════════════════════════════════════════════════════════════════════════════
     * 【5b】validateRows（独立校验，给 xlsx-adapter 等共享调用）
     * 输入：[{ section_key, card_id, ..., _line }]  raw 行对象数组
     * 输出：{ rows, errors, warnings }  与 csvToSections 完全一致
     * ════════════════════════════════════════════════════════════════════════════ */
    function validateRows(rawRows, opts) {
        opts = opts || {};
        var strictRequired = opts.strictRequired !== false; // 默认 true

        var errors = [];
        var warnings = [];
        var rows = [];

        if (!Array.isArray(rawRows)) {
            return { rows: rows, errors: errors, warnings: warnings };
        }

        // 多余字段剪枝表（按 kind）
        var EXTRA_BY_KIND = {
            sub:     ['descClickable', 'descUrl', 'address', 'mailto'],
            email:   ['descClickable', 'descUrl', 'content', 'note'],
            contact: ['content', 'note', 'address', 'mailto'],
            simple:  ['descClickable', 'descUrl', 'content', 'note', 'address', 'mailto'],
            deskc:   ['content', 'note', 'address', 'mailto'],
            expand:  ['content', 'note', 'address', 'mailto']
        };

        for (var i = 0; i < rawRows.length; i++) {
            var obj = rawRows[i];
            if (!obj || typeof obj !== 'object') continue;
            // 兼容：未提供 _line 时按数组下标 +2（推断为 1-based CSV 行号，跳过表头）
            var lineNo = obj._line || (i + 2);
            obj._line = lineNo;

            // 必填校验
            if (strictRequired) {
                if (!obj.section_key || String(obj.section_key).trim() === '') {
                    errors.push({ line: lineNo, col: 'section_key', msg: 'section_key is required' });
                    continue;
                }
                var hasIdentity = (obj.title && String(obj.title).trim() !== '')
                               || (obj.content && String(obj.content).trim() !== '')
                               || (obj.address && String(obj.address).trim() !== '');
                if (!hasIdentity) {
                    errors.push({ line: lineNo, col: 'title', msg: 'one of title / content / address is required' });
                    continue;
                }
            }

            var isSub = obj.parent_card_id && String(obj.parent_card_id).trim() !== '';
            var secKey = String(obj.section_key).trim();
            var isEmailCard   = (secKey === 'emailData');
            var isContactCard = (secKey === 'contactData');

            if (isSub) {
                var idx = parseInt(obj.sub_index, 10);
                if (isNaN(idx) || idx < 0 || String(idx) !== String(obj.sub_index).trim()) {
                    errors.push({ line: lineNo, col: 'sub_index', msg: 'sub_index must be a non-negative integer for sub-card' });
                    continue;
                }
                obj.sub_index = idx;
                // 子卡 type 应留空或为 [sub] 标记；其它值给 warning 并清空
                var subType = obj.type ? String(obj.type).trim() : '';
                if (subType === '[sub]') {
                    obj.type = '';  // 标记字符串，无副作用清空即可
                } else if (subType !== '') {
                    warnings.push({ line: lineNo, col: 'type', msg: 'sub-card should leave type empty or use [sub]; value ignored' });
                    obj.type = '';
                }
            } else if (isEmailCard) {
                if (obj.type && String(obj.type).trim() !== '') {
                    warnings.push({ line: lineNo, col: 'type', msg: 'emailData card should leave type empty; value ignored' });
                    obj.type = '';
                }
                if (strictRequired && (!obj.address || String(obj.address).trim() === '')) {
                    errors.push({ line: lineNo, col: 'address', msg: 'address is required for emailData card' });
                    continue;
                }
                if (obj.sub_index && String(obj.sub_index).trim() !== '') {
                    warnings.push({ line: lineNo, col: 'sub_index', msg: 'main card should leave sub_index empty; value ignored' });
                    obj.sub_index = '';
                }
            } else if (isContactCard) {
                if (obj.type && String(obj.type).trim() !== '') {
                    warnings.push({ line: lineNo, col: 'type', msg: 'contactData card should leave type empty; value ignored' });
                    obj.type = '';
                }
                if (obj.sub_index && String(obj.sub_index).trim() !== '') {
                    warnings.push({ line: lineNo, col: 'sub_index', msg: 'main card should leave sub_index empty; value ignored' });
                    obj.sub_index = '';
                }
            } else {
                var t = String(obj.type || '').trim();
                if (strictRequired) {
                    if (!t) {
                        errors.push({ line: lineNo, col: 'type', msg: 'type is required for main card' });
                        continue;
                    }
                    if (!VALID_TYPES[t]) {
                        errors.push({ line: lineNo, col: 'type', msg: 'invalid type: ' + t });
                        continue;
                    }
                }
                obj.type = t;
                if (obj.sub_index && String(obj.sub_index).trim() !== '') {
                    warnings.push({ line: lineNo, col: 'sub_index', msg: 'main card should leave sub_index empty; value ignored' });
                    obj.sub_index = '';
                }
            }

            obj.isLocal = parseBool(obj.isLocal);

            // 多余字段剪枝
            var kind;
            if (isSub)                                 kind = 'sub';
            else if (isEmailCard)                      kind = 'email';
            else if (isContactCard)                    kind = 'contact';
            else if (obj.type === 'simple')            kind = 'simple';
            else if (obj.type === 'desc-clickable')    kind = 'deskc';
            else if (obj.type === 'expandable')        kind = 'expand';
            else kind = null;

            if (kind && EXTRA_BY_KIND[kind]) {
                EXTRA_BY_KIND[kind].forEach(function(field) {
                    var v = obj[field];
                    if (v != null && String(v).trim() !== '') {
                        warnings.push({
                            line: lineNo,
                            col: field,
                            msg: 'field "' + field + '" is not used by this card kind (' + kind + '); value cleared'
                        });
                        obj[field] = '';
                    }
                });
            }

            rows.push(obj);
        }

        // 一致性检查：parent_card_id 必须能找到匹配的主卡
        var mainIds = {};
        rows.forEach(function(r) {
            if (!r.parent_card_id && r.card_id) {
                mainIds[r.section_key + '|' + r.card_id] = true;
            }
        });
        rows.forEach(function(r) {
            if (r.parent_card_id) {
                var k = r.section_key + '|' + r.parent_card_id;
                if (!mainIds[k]) {
                    errors.push({
                        line: r._line,
                        col: 'parent_card_id',
                        msg: 'parent_card_id "' + r.parent_card_id + '" not found in section "' + r.section_key + '"'
                    });
                }
            }
        });

        // 重复 card_id 检查
        var seenIds = {};
        rows.forEach(function(r) {
            if (!r.parent_card_id && r.card_id) {
                var k = r.section_key + '|' + r.card_id;
                if (seenIds[k]) {
                    warnings.push({
                        line: r._line,
                        col: 'card_id',
                        msg: 'duplicate card_id "' + r.card_id + '" in section "' + r.section_key + '"; B2 will keep the last one'
                    });
                }
                seenIds[k] = true;
            }
        });

        // 过滤掉 errors 涉及的行
        var errLines = {};
        errors.forEach(function(e) { errLines[e.line] = true; });
        rows = rows.filter(function(r) { return !errLines[r._line]; });

        return { rows: rows, errors: errors, warnings: warnings };
    }

    /* ════════════════════════════════════════════════════════════════════════════
     * 【6】downloadTemplate（B3 也会用到，B0 先实现）
     * ════════════════════════════════════════════════════════════════════════════ */

    // 生成模板 CSV 文本（独立函数，复用给 xlsx-adapter）
    function buildTemplateCSV() {
        var header = serializeRow(COL_NAMES);
        // 列顺序：section_key, card_id, parent_card_id, sub_index, type, title, content,
        //         url, desc, descClickable, descUrl, icon, iconImg, isLocal,
        //         address, mailto, comment, note
        var sample1 = serializeRow([
            'usbDriveData', 'card_sample01', '', '',
            'simple', '示例：在线U盘', '',
            'https://example.com/usb', '云硬盘示例',
            '', '', '💾', '', '',
            '', '',
            '> 这是 Markdown 注释\n支持多行', ''
        ]);
        var sample_desc = serializeRow([
            'teachingData', 'card_sample_desc', '', '',
            'desc-clickable', '示例：desc-clickable 卡', '',
            'https://example.com/main',
            '',
            '主标题跳 main，描述跳 sub', 'https://example.com/sub',
            '📚', '', '',
            '', '', '', ''
        ]);
        var sample2 = serializeRow([
            'onlineAIData', 'card_sample02', '', '',
            'expandable', '示例：AI 工具合集', '',
            'https://example.com/ai', '',
            'AI 工具', 'https://example.com/ai',
            '🧠', '', '',
            '', '', '', ''
        ]);
        var sample2sub1 = serializeRow([
            'onlineAIData', '', 'card_sample02', '0',
            '[sub]', 'DeepSeek', '',
            'https://www.deepseek.com/', '深度求索',
            '', '', '🤿', '', '',
            '', '', '', ''
        ]);
        var sample2sub2 = serializeRow([
            'onlineAIData', '', 'card_sample02', '1',
            '[sub]', '', '紧凑子卡示例链接',
            'https://example.com/compact', '',
            '', '', '🔗', '', '',
            '', '', '', '紧凑卡的小字'
        ]);
        var sample3 = serializeRow([
            'emailData', 'card_sample03', '', '',
            '', '示例邮箱', '',
            'http://example.com', '',
            '', '', '✉️', '', '',
            'example(AT)example.com', 'mailto:example@example.com',
            '', ''
        ]);
        var sample4 = serializeRow([
            'contactData', 'card_sample04', '', '',
            '', '示例联系方式（GitHub）', '',
            'https://github.com/yumumao',
            'GitHub 个人主页',
            '', '',
            '🐙', '', '',
            '', '', '', ''
        ]);

        return BOM + [header, sample1, sample_desc, sample2, sample2sub1, sample2sub2, sample3, sample4].join(EOL) + EOL;
    }

    function downloadTemplate() {
        var content = buildTemplateCSV();
        var blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'smarttools_template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    }

    /* ════════════════════════════════════════════════════════════════════════════
     * 【7】对外挂载
     * ════════════════════════════════════════════════════════════════════════════ */
    window.CsvSchema = {
        COLUMNS:         COLUMNS,
        sectionsToCSV:   sectionsToCSV,
        csvToSections:   csvToSections,
        validateRows:    validateRows,
        downloadTemplate: downloadTemplate,
        buildTemplateCSV: buildTemplateCSV,
        parseRow:        parseRow,
        serializeField:  serializeField
    };
})();
