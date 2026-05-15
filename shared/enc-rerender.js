/* 🔐 EncUnlock 配套：加密大类重渲染器（通用版，供 index1~5 复用）
 *
 * 页面需挂载：window.__favPageAPI = { getLayout, renderSection, clearExpandedState }
 * ★ 适配新 sections 数组格式
 */
(function() {
    'use strict';

    // ★ 获取所有加密 section（兼容新旧格式）
    function getEncryptedSections() {
        var all = window.__sections || window.sections;
        if (Array.isArray(all)) {
            return all.filter(function(s) { return s && s.encrypted; });
        }
        // 老格式 fallback
        if (typeof customSections !== 'undefined' && Array.isArray(customSections)) {
            return customSections.filter(function(c) { return c && c.encrypted; });
        }
        return [];
    }

    window.rerenderCustomSections = function() {
        var api = window.__favPageAPI;
        if (!api || typeof api.renderSection !== 'function' || typeof api.getLayout !== 'function') {
            location.reload();
            return;
        }

        var encSections = getEncryptedSections();
        if (!encSections.length) return;

        if (typeof api.clearExpandedState === 'function') {
            try { api.clearExpandedState(); } catch (e) {}
        }

        var layout = api.getLayout();

        encSections.forEach(function(cs) {
            if (!cs || !cs.key) return;
            var sectionEl = document.querySelector('.section[data-custom-key="' + cs.key + '"]');
            if (!sectionEl) return;

            var isLocked = window.EncUnlock && EncUnlock.isLocked(cs);

            if (isLocked) {
                sectionEl.classList.add('section-locked-pill');
                sectionEl.innerHTML = '<div id="' + cs.key + '-content"></div>';
                var contentEl = document.getElementById(cs.key + '-content');
                if (contentEl && EncUnlock && typeof EncUnlock.makeLockedPlaceholder === 'function') {
                    contentEl.appendChild(EncUnlock.makeLockedPlaceholder(cs));
                }
            } else {
                sectionEl.classList.remove('section-locked-pill');
                sectionEl.innerHTML =
                    '<h2 class="section-title" id="' + cs.key + '">' +
                    (cs.label || cs.key) +
                    '</h2>' +
                    '<div id="' + cs.key + '-content"></div>';
                api.renderSection(cs, layout);
            }
        });

        var fab = document.getElementById('enc-lock-fab');
        if (window.EncUnlock && !EncUnlock.hasUnlockedEncrypted()) {
            if (fab) fab.remove();
        } else if (window.EncUnlock && typeof EncUnlock.mountLockButton === 'function') {
            EncUnlock.mountLockButton();
        }
    };
})();