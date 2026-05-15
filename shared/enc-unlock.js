/* ============================================================
   EncUnlock —— 前端加密大类解锁模块（小药丸版 + 立即锁定 + 逐个显示）
   ============================================================ */
(function (global) {
    'use strict';

    const SS_KEY = 'bm_cfg_enc_pwd';
    const SS_REVEAL = 'bm_cfg_enc_reveal';

    // ★ 获取所有加密 section（兼容新旧数据格式）
    function getEncSections() {
        var all = global.__sections || global.sections;
        if (Array.isArray(all)) return all.filter(function(s) { return s && s.encrypted; });
        // 老格式 fallback
        if (Array.isArray(global.customSections)) return global.customSections.filter(function(c) { return c && c.encrypted; });
        return [];
    }

    // -------- Base64 / AES-GCM / PBKDF2 --------
    function b64d(s) { const a = atob(s), u = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) u[i] = a.charCodeAt(i); return u; }
    async function deriveKey(pwd, salt, iter) {
        const base = await crypto.subtle.importKey('raw',
            new TextEncoder().encode(pwd), { name: 'PBKDF2' }, false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
            base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    }
    async function decryptEnc(pwd, enc) {
        const key = await deriveKey(pwd, b64d(enc.salt), enc.iter || 300000);
        const pt = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: b64d(enc.iv) }, key, b64d(enc.data));
        return JSON.parse(new TextDecoder().decode(pt));
    }

    // -------- "已显示"集合（session 级） --------
    function sectionKey(section) {
        return (section && (section.id || section.key || section.name)) || '';
    }
    function getRevealSet() {
        try {
            const raw = sessionStorage.getItem(SS_REVEAL);
            return new Set(raw ? JSON.parse(raw) : []);
        } catch { return new Set(); }
    }
    function saveRevealSet(set) {
        try { sessionStorage.setItem(SS_REVEAL, JSON.stringify([...set])); } catch {}
    }
    function markRevealed(section) {
        const k = sectionKey(section);
        if (!k) return;
        const s = getRevealSet(); s.add(k); saveRevealSet(s);
    }
    function isRevealed(section) {
        return getRevealSet().has(sectionKey(section));
    }
    function clearReveal() {
        try { sessionStorage.removeItem(SS_REVEAL); } catch {}
    }

    // -------- 触发重渲染（优先无刷新，否则刷页） --------
    function triggerRerender() {
        if (typeof window.rerenderCustomSections === 'function') {
            window.rerenderCustomSections();
        } else {
            location.reload();
        }
    }

    // -------- 尝试解锁所有加密大类 --------
    async function unlockAll(pwd) {
        var encSections = getEncSections();
        if (!encSections.length) return { ok: true, n: 0, total: 0 };
        let unlocked = 0, total = 0, anyOk = false;
        for (const c of encSections) {
            if (!c || !c.enc) continue;
            total++;
            try {
                const cards = await decryptEnc(pwd, c.enc);
                c.cards = Array.isArray(cards) ? cards : [];
                c.__unlocked = true;
                delete c.__lockedReason;
                unlocked++; anyOk = true;
            } catch (e) {
                c.__unlocked = false;
                c.__lockedReason = 'wrong-password';
            }
        }
        if (anyOk) { try { sessionStorage.setItem(SS_KEY, pwd); } catch {} }
        return { ok: anyOk || total === 0, n: unlocked, total };
    }

    // -------- 全屏"解密中..."过渡提示 --------
    function showDecryptingOverlay() {
        if (document.getElementById('enc-decrypt-overlay')) return;
        const ov = document.createElement('div');
        ov.id = 'enc-decrypt-overlay';
        ov.className = 'enc-decrypt-overlay';
        ov.innerHTML = `
            <div class="enc-decrypt-card">
                <span class="enc-spinner"></span>
                <span class="enc-decrypt-text">解密中...</span>
            </div>`;
        document.body.appendChild(ov);
    }
    function hideDecryptingOverlay() {
        const ov = document.getElementById('enc-decrypt-overlay');
        if (ov) ov.remove();
    }

    // -------- 启动时自动尝试 --------
    async function bootstrap() {
        var encSections = getEncSections();
        for (const c of encSections) {
            if (c && c.enc) {
                c.__unlocked = false;
                c.cards = [];
            }
        }
        let pwd = null;
        try { pwd = sessionStorage.getItem(SS_KEY); } catch {}
        if (pwd && encSections.some(c => c && c.enc)) {
            showDecryptingOverlay();
            try { await unlockAll(pwd); }
            finally { hideDecryptingOverlay(); }
        }
        return {
            total: encSections.length,
            lockedAfter: encSections.filter(c => c && !c.__unlocked).length
        };
    }

    // -------- 解锁 Modal --------
    function openUnlockModal(onDone) {
        const existed = document.querySelector('.enc-mask');
        if (existed) existed.remove();

        const mask = document.createElement('div');
        mask.className = 'enc-mask';
        mask.innerHTML = `
            <div class="enc-box">
                <h3>🔓 解锁加密内容</h3>
                <p>请输入<b>登录密码</b>解锁。密码只在此 Tab 会话内暂存。</p>
                <input type="password" id="__enc_pwd" autocomplete="current-password" placeholder="登录密码">
                <div class="enc-err" id="__enc_err"></div>
                <div class="enc-actions">
                    <button class="btn-cancel" id="__enc_cancel">取消</button>
                    <button class="btn-ok" id="__enc_ok">解锁</button>
                </div>
            </div>`;
        document.body.appendChild(mask);

        const input = mask.querySelector('#__enc_pwd');
        const errEl = mask.querySelector('#__enc_err');
        setTimeout(() => input.focus(), 30);

        async function confirm() {
            const pwd = input.value;
            if (!pwd) { errEl.textContent = '请输入密码'; return; }
            errEl.innerHTML = '<span class="enc-spinner"></span> 解密中...';
            input.disabled = true;
            mask.querySelector('#__enc_ok').disabled = true;
            mask.querySelector('#__enc_cancel').disabled = true;
            const r = await unlockAll(pwd);
            input.disabled = false;
            mask.querySelector('#__enc_ok').disabled = false;
            mask.querySelector('#__enc_cancel').disabled = false;
            if (r.ok && r.n > 0) {
                mask.remove();
                if (typeof onDone === 'function') onDone(r);
            } else {
                errEl.textContent = '❌ 密码错误';
                input.select();
            }
        }
        mask.querySelector('#__enc_ok').onclick = confirm;
        mask.querySelector('#__enc_cancel').onclick = () => mask.remove();
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') confirm();
            else if (e.key === 'Escape') mask.remove();
        });
    }

    // -------- 小药丸占位 --------
    function makeLockedPlaceholder(section) {
        const wrap = document.createElement('div');
        wrap.className = 'enc-locked-pill-wrap';

        // 序号：在所有加密大类中的位置（仅在 >1 时显示）
        let ordinal = '';
        var encList = getEncSections();
        if (encList.length) {
            if (encList.length > 1) {
                const idx = encList.indexOf(section);
                if (idx >= 0) ordinal = String(idx + 1);
            }
        }

        // 两种状态：已解密未展开 / 完全未解密
        const decrypted = !!section.__unlocked;
        const iconChar  = decrypted ? '🔓' : '🔒';
        const labelText = decrypted ? '_点击显示__' : '（解锁查看）';
        const title     = decrypted ? '密码已解锁，点击展开内容' : '点击输入密码解锁';

        wrap.innerHTML = `
            <button type="button" class="enc-locked-pill" title="${title}">
                <span class="lk-icon">${iconChar}</span>
                <span class="lk-text">${labelText}${ordinal}</span>
            </button>`;

        wrap.querySelector('.enc-locked-pill').onclick = () => {
            if (section.__unlocked) {
                // 已解密 → 仅标记当前这一个展开
                markRevealed(section);
                triggerRerender();
            } else {
                openUnlockModal(() => {
                    // 只展开"触发本次解锁的这一个"，其它保持折叠
                    if (section.__unlocked) markRevealed(section);
                    triggerRerender();
                });
            }
        };
        return wrap;
    }

    // ============================================================
    // 立即锁定
    // ============================================================

    // 是否存在已解锁的加密大类（有密码在 session 中即可显示锁定按钮）
    function hasUnlockedEncrypted() {
        var encSections = getEncSections();
        return encSections.some(c => c && c.__unlocked);
    }

    function lockNow() {
        try { sessionStorage.removeItem(SS_KEY); } catch {}
        clearReveal();
        getEncSections().forEach(c => {
            if (c) {
                c.cards = [];
                c.__unlocked = false;
            }
        });
        triggerRerender();
        // 立即卸载自己：此时已经不存在已解锁的加密大类
        const fab = document.getElementById('enc-lock-fab');
        if (fab) fab.remove();
    }

    let _escBound = false;
    function mountLockButton() {
        const existing = document.getElementById('enc-lock-fab');

        // 不再需要显示按钮 → 如果存在就移除
        if (!hasUnlockedEncrypted()) {
            if (existing) existing.remove();
            return;
        }

        // 需要显示但已存在 → 无需重复创建
        if (existing) return;

        const btn = document.createElement('button');
        btn.id = 'enc-lock-fab';
        btn.className = 'enc-lock-fab';
        btn.type = 'button';
        btn.title = '立即锁定隐私内容（快捷键：Esc）';
        btn.setAttribute('aria-label', '立即锁定隐私内容');
        btn.innerHTML = `
            <span class="lf-icon" aria-hidden="true">🔒</span>
            <span class="lf-text">锁定</span>`;
        btn.addEventListener('click', lockNow);
        document.body.appendChild(btn);

        if (!_escBound) {
            _escBound = true;
            document.addEventListener('keydown', function (e) {
                if (e.key !== 'Escape') return;
                if (document.querySelector('.enc-mask')) return;
                if (document.getElementById('enc-lock-fab')) lockNow();
            });
        }
    }

    global.EncUnlock = {
        bootstrap,
        unlockAll,
        openUnlockModal,
        makeLockedPlaceholder,
        mountLockButton,
        lockNow,
        hasUnlockedEncrypted,
        // ★ 判据变化：是否渲染药丸（= 未解密 或 已解密但未展开）
        isLocked(section) {
            if (!section || !section.encrypted) return false;
            if (!section.__unlocked) return true;
            if (!isRevealed(section)) return true;
            return false;
        },
        clearPassword() {
            try { sessionStorage.removeItem(SS_KEY); } catch {}
            clearReveal();
        }
    };
})(window);