/* ================================================================================
 * shared/xlsx-adapter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * XLSX 双轨适配器（B0 配套）
 *
 * 用途：复用 CsvSchema 的 schema/校验逻辑，把 sections ↔ XLSX 二进制互转。
 * 设计：薄壳，schema 和 row 校验完全委托给 csv-schema.js，本文件只负责：
 *   1) 懒加载 SheetJS（CDN，340KB）
 *   2) sectionsToXlsx(sections, opts)：sections → CSV(via CsvSchema) → workbook → Blob
 *   3) xlsxToRows(arrayBuffer)：xlsx → sheet → rows → CsvSchema.validateRows
 *
 * 依赖：必须先加载 shared/csv-schema.js（window.CsvSchema 必须就位）
 *
 * 加载方式（与 csv-schema 风格一致）：
 *   <script src="shared/csv-schema.js"></script>
 *   <script src="shared/xlsx-adapter.js"></script>
 *   然后通过 window.XlsxAdapter.* 调用。
 *
 * 对外 API：
 *   XlsxAdapter.isLoaded()                    : SheetJS 是否已加载
 *   XlsxAdapter.loadSheetJS() → Promise       : 懒加载 SheetJS（idempotent）
 *   XlsxAdapter.sectionsToXlsx(sections,opts) : 返回 Blob（async）
 *   XlsxAdapter.xlsxToRows(arrayBuffer)       : 返回 { rows,errors,warnings }（async）
 * ================================================================================ */

(function() {
    'use strict';

    var SHEETJS_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.mini.min.js';
    var _loadPromise = null;

    function isLoaded() {
        return typeof window.XLSX !== 'undefined' && window.XLSX !== null;
    }

    function loadSheetJS() {
        if (isLoaded()) return Promise.resolve(window.XLSX);
        if (_loadPromise) return _loadPromise;

        _loadPromise = new Promise(function(resolve, reject) {
            var s = document.createElement('script');
            s.src = SHEETJS_CDN;
            s.async = true;
            s.onload = function() {
                if (isLoaded()) resolve(window.XLSX);
                else reject(new Error('SheetJS loaded but window.XLSX not present'));
            };
            s.onerror = function() {
                _loadPromise = null;
                reject(new Error('Failed to load SheetJS from CDN: ' + SHEETJS_CDN));
            };
            document.head.appendChild(s);
        });
        return _loadPromise;
    }

    /* ════════════════════════════════════════════════════════════════════════════
     * sectionsToXlsx: sections → Blob (xlsx)
     * 策略：复用 CsvSchema.sectionsToCSV → 解析回 grid → workbook → blob
     *      这样 schema 的列定义/卡片 → row 的映射只有一份（在 csv-schema 中）。
     * ════════════════════════════════════════════════════════════════════════════ */
    function sectionsToXlsx(sections, opts) {
        if (!window.CsvSchema || typeof window.CsvSchema.sectionsToCSV !== 'function') {
            return Promise.reject(new Error('CsvSchema not loaded'));
        }
        return loadSheetJS().then(function(XLSX) {
            // CSV(含 BOM、CRLF) — SheetJS 完全支持
            var csv = window.CsvSchema.sectionsToCSV(sections, opts || {});
            // 关键：剥除 UTF-8 BOM，否则它会变成 A1 单元格内容的一部分（看起来像前导空格）
            if (csv.charCodeAt(0) === 0xFEFF) csv = csv.slice(1);
            var wb = XLSX.read(csv, { type: 'string', raw: true });
            // SheetJS 自动命名 sheet 为 Sheet1；改成更友好的名字
            var sheetName = 'SmartTools';
            if (wb.SheetNames.length) {
                wb.Sheets[sheetName] = wb.Sheets[wb.SheetNames[0]];
                delete wb.Sheets[wb.SheetNames[0]];
                wb.SheetNames = [sheetName];
            }
            var arrayBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
            return new Blob([arrayBuf], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
        });
    }

    /* ════════════════════════════════════════════════════════════════════════════
     * xlsxToRows: ArrayBuffer → { rows, errors, warnings }
     * 流程：xlsx → workbook → 第一张 sheet → 二维数组(aoa) → rawRows → validateRows
     * ════════════════════════════════════════════════════════════════════════════ */
    function xlsxToRows(arrayBuffer, opts) {
        if (!window.CsvSchema || typeof window.CsvSchema.validateRows !== 'function') {
            return Promise.reject(new Error('CsvSchema.validateRows not available'));
        }
        return loadSheetJS().then(function(XLSX) {
            var wb;
            try { wb = XLSX.read(arrayBuffer, { type: 'array' }); }
            catch (e) { throw new Error('XLSX parse failed: ' + (e.message || e)); }

            if (!wb.SheetNames.length) {
                return { rows: [], errors: [{ line: 0, col: '', msg: 'XLSX has no sheets' }], warnings: [] };
            }

            // 取第一张 sheet（用户可能改了名字，不强制要求叫 SmartTools）
            var sheet = wb.Sheets[wb.SheetNames[0]];
            // 转二维数组：header:1 表示第一行作为字段，但我们手动处理；defval:'' 让空格变空串
            var aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

            // 去掉末尾完全空的行
            while (aoa.length && aoa[aoa.length - 1].every(function(v) { return v === '' || v == null; })) {
                aoa.pop();
            }
            if (!aoa.length) {
                return { rows: [], errors: [], warnings: [] };
            }

            var headers = aoa[0].map(function(h) { return String(h == null ? '' : h).trim(); });

            // 表头校验
            var COLUMNS = window.CsvSchema.COLUMNS;
            var missing = [];
            COLUMNS.forEach(function(c) {
                if (c.required && headers.indexOf(c.col) < 0) missing.push(c.col);
            });
            if (missing.length) {
                return {
                    rows: [],
                    errors: [{ line: 1, col: '', msg: 'Missing required headers: ' + missing.join(', ') }],
                    warnings: []
                };
            }

            // 转成 rawRows
            var rawRows = [];
            for (var i = 1; i < aoa.length; i++) {
                var values = aoa[i];
                if (values.every(function(v) { return v === '' || v == null; })) continue;
                var obj = {};
                for (var j = 0; j < headers.length; j++) {
                    var h = headers[j];
                    if (!h) continue;
                    var v = j < values.length ? values[j] : '';
                    obj[h] = (v == null) ? '' : String(v);
                }
                obj._line = i + 1; // 1-based，第 1 行是表头
                rawRows.push(obj);
            }

            return window.CsvSchema.validateRows(rawRows, opts || {});
        });
    }

    /* ════════════════════════════════════════════════════════════════════════════
     * templateToXlsx: 把 CsvSchema.buildTemplateCSV() 转成 Xlsx Blob
     * 模板文件，不需要 sections 数据。
     * ════════════════════════════════════════════════════════════════════════════ */
    function templateToXlsx() {
        if (!window.CsvSchema || typeof window.CsvSchema.buildTemplateCSV !== 'function') {
            return Promise.reject(new Error('CsvSchema.buildTemplateCSV not available'));
        }
        return loadSheetJS().then(function(XLSX) {
            var csv = window.CsvSchema.buildTemplateCSV();
            if (csv.charCodeAt(0) === 0xFEFF) csv = csv.slice(1); // 同 sectionsToXlsx 剥 BOM
            var wb = XLSX.read(csv, { type: 'string', raw: true });
            var sheetName = 'SmartTools-Template';
            if (wb.SheetNames.length) {
                wb.Sheets[sheetName] = wb.Sheets[wb.SheetNames[0]];
                delete wb.Sheets[wb.SheetNames[0]];
                wb.SheetNames = [sheetName];
            }
            var arrayBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
            return new Blob([arrayBuf], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
        });
    }

    window.XlsxAdapter = {
        isLoaded:        isLoaded,
        loadSheetJS:     loadSheetJS,
        sectionsToXlsx:  sectionsToXlsx,
        xlsxToRows:      xlsxToRows,
        templateToXlsx:  templateToXlsx
    };
})();
