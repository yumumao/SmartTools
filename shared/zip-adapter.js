/* ================================================================================
 * shared/zip-adapter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ZIP 打包适配器(A1-c2 配套)
 *
 * 用途:把若干 (filename, content) 打成 ZIP Blob,供前端下载。
 * 用例:强制删除用户时,把 full.json + cards.csv 打包成单个 .zip 供 admin 下载。
 *
 * 设计:薄壳,只负责
 *   1) 懒加载 JSZip(CDN,~95KB)
 *   2) zipFiles([{ name, content }]) → Promise<Blob>
 *
 * 加载方式(与 xlsx-adapter 风格一致):
 *   <script src="shared/zip-adapter.js"></script>
 *   然后通过 window.ZipAdapter.* 调用。
 *
 * 对外 API:
 *   ZipAdapter.isLoaded()                     : JSZip 是否已加载
 *   ZipAdapter.loadJSZip() → Promise          : 懒加载 JSZip(idempotent)
 *   ZipAdapter.zipFiles(files, opts) → Blob   : files = [{ name, content }];async
 *     content 支持 string / Uint8Array / ArrayBuffer / Blob
 *     opts:可选 { compression: 'STORE' | 'DEFLATE' }(默认 DEFLATE,level 6)
 * ================================================================================ */

(function() {
    'use strict';

    var JSZIP_CDN = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    var _loadPromise = null;

    function isLoaded() {
        return typeof window.JSZip !== 'undefined' && window.JSZip !== null;
    }

    function loadJSZip() {
        if (isLoaded()) return Promise.resolve(window.JSZip);
        if (_loadPromise) return _loadPromise;

        _loadPromise = new Promise(function(resolve, reject) {
            var s = document.createElement('script');
            s.src = JSZIP_CDN;
            s.async = true;
            s.onload = function() {
                if (isLoaded()) resolve(window.JSZip);
                else reject(new Error('JSZip loaded but window.JSZip not present'));
            };
            s.onerror = function() {
                _loadPromise = null;
                reject(new Error('Failed to load JSZip from CDN: ' + JSZIP_CDN));
            };
            document.head.appendChild(s);
        });
        return _loadPromise;
    }

    /* ════════════════════════════════════════════════════════════════════════════
     * zipFiles: [{name, content}] → Blob (application/zip)
     * ════════════════════════════════════════════════════════════════════════════ */
    function zipFiles(files, opts) {
        if (!Array.isArray(files) || files.length === 0) {
            return Promise.reject(new Error('zipFiles: files must be a non-empty array'));
        }
        var options = opts || {};
        var compression = options.compression === 'STORE' ? 'STORE' : 'DEFLATE';

        return loadJSZip().then(function(JSZip) {
            var zip = new JSZip();
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                if (!f || !f.name) continue;
                zip.file(f.name, f.content == null ? '' : f.content);
            }
            return zip.generateAsync({
                type: 'blob',
                mimeType: 'application/zip',
                compression: compression,
                compressionOptions: { level: 6 }
            });
        });
    }

    window.ZipAdapter = {
        isLoaded: isLoaded,
        loadJSZip: loadJSZip,
        zipFiles: zipFiles
    };
})();
