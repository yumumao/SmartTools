/* 🔐 EncUnlock 配套：自定义大类重渲染器（通用版，供 index1~5 复用）
 *
 * 页面需挂载：window.__favPageAPI = {
 *     getLayout: function() { return currentLayout; },
 *     renderSection: function(cs, layout) { ... },   // 即页面里的 renderCustomSection
 *     clearExpandedState: function() { ... }         // 可选
 * };
 */
(function() {
    'use strict';

    window.rerenderCustomSections = function() {
        var api = window.__favPageAPI;
        if (!api || typeof api.renderSection !== 'function' || typeof api.getLayout !== 'function') {
            location.reload();
            return;
        }
        if (typeof customSections === 'undefined' || !Array.isArray(customSections)) return;

        if (typeof api.clearExpandedState === 'function') {
            try { api.clearExpandedState(); } catch (e) {}
        }

        var layout = api.getLayout();

        customSections.forEach(function(cs) {
            if (!cs || !cs.key) return;
            var sectionEl = document.querySelector('.section[data-custom-key="' + cs.key + '"]');
            if (!sectionEl) return;

            var isLocked = window.EncUnlock && EncUnlock.isLocked(cs);

            if (isLocked) {
                // ★ 锁定态：rerender 自己渲染药丸，不走页面的 renderCustomSection
                sectionEl.classList.add('section-locked-pill');
                sectionEl.innerHTML = '<div id="' + cs.key + '-content"></div>';
                var contentEl = document.getElementById(cs.key + '-content');
                if (contentEl && EncUnlock && typeof EncUnlock.makeLockedPlaceholder === 'function') {
                    contentEl.appendChild(EncUnlock.makeLockedPlaceholder(cs));
                }
            } else {
                // 正常态：交还页面自己渲染
                sectionEl.classList.remove('section-locked-pill');
                sectionEl.innerHTML =
                    '<h2 class="section-title" id="' + cs.key + '">' +
                    (cs.label || cs.key) +
                    '</h2>' +
                    '<div id="' + cs.key + '-content"></div>';
                api.renderSection(cs, layout);
            }
        });

        // 锁定后右下角 FAB 处理：没有已解锁的加密大类就移除
        var fab = document.getElementById('enc-lock-fab');
        if (window.EncUnlock && !EncUnlock.hasUnlockedEncrypted()) {
            if (fab) fab.remove();
        } else if (window.EncUnlock && typeof EncUnlock.mountLockButton === 'function') {
            EncUnlock.mountLockButton();
        }
    };
})();