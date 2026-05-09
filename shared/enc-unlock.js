/* ============================================================
   EncUnlock —— 前端加密大类解锁模块（小药丸版 + 立即锁定）
   ============================================================ */
(function (global) {
    'use strict';

    const SS_KEY = 'bm_cfg_enc_pwd';

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
        const key = await deriveKey(pwd, b64d(enc.salt), enc.iter || 100000);
        const pt = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: b64d(enc.iv) }, key, b64d(enc.data));
        return JSON.parse(new TextDecoder().decode(pt));
    }

    // -------- 尝试解锁所有加密大类 --------
    async function unlockAll(pwd) {
        if (!Array.isArray(global.customSections)) return { ok: true, n: 0, total: 0 };
        let unlocked = 0, total = 0, anyOk = false;
        for (const c of global.customSections) {
            if (!c || !c.encrypted || !c.enc) continue;
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

    // -------- 启动时自动尝试 --------
    async function bootstrap() {
        if (!Array.isArray(global.customSections)) return { total: 0 };
        for (const c of global.customSections) {
            if (c && c.encrypted && c.enc) {
                c.__unlocked = false;
                c.cards = [];
            }
        }
        let pwd = null;
        try { pwd = sessionStorage.getItem(SS_KEY); } catch {}
        if (pwd) await unlockAll(pwd);
        return {
            total: global.customSections.filter(c => c && c.encrypted).length,
            lockedAfter: global.customSections.filter(c => c && c.encrypted && !c.__unlocked).length
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
            errEl.textContent = '解锁中...';
            const r = await unlockAll(pwd);
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
        wrap.innerHTML = `
            <button type="button" class="enc-locked-pill" title="点击输入密码解锁">
                <span class="lk-icon">🔒</span>
                <span class="lk-text">受保护内容 · 点击解锁</span>
            </button>`;
        wrap.querySelector('.enc-locked-pill').onclick = () =>
            openUnlockModal(() => location.reload());
        return wrap;
    }

    // ============================================================
    // ★ 新增：立即锁定功能
    // ============================================================

    // 是否存在已解锁的加密大类
    function hasUnlockedEncrypted() {
        if (!Array.isArray(global.customSections)) return false;
        return global.customSections.some(c => c && c.encrypted && c.__unlocked);
    }

    // 立即锁定：清密码 + 刷新页面
    function lockNow() {
        try { sessionStorage.removeItem(SS_KEY); } catch {}
        // 清内存中的明文（保险起见，即便马上就 reload）
        if (Array.isArray(global.customSections)) {
            global.customSections.forEach(c => {
                if (c && c.encrypted) {
                    c.cards = [];
                    c.__unlocked = false;
                }
            });
        }
        location.reload();
    }

    // 浮动锁定按钮：仅在存在已解锁加密大类时显示
    let _escBound = false;
    function mountLockButton() {
        // 已有就不重复挂载
        if (document.getElementById('enc-lock-fab')) return;
        if (!hasUnlockedEncrypted()) return;

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

        // Esc 快捷键（只绑一次）
        if (!_escBound) {
            _escBound = true;
            document.addEventListener('keydown', function (e) {
                if (e.key !== 'Escape') return;
                // 若当前有解锁 Modal 打开，则 Esc 交给 Modal 处理
                if (document.querySelector('.enc-mask')) return;
                // 仅当锁按钮存在时触发
                if (document.getElementById('enc-lock-fab')) lockNow();
            });
        }
    }

    global.EncUnlock = {
        bootstrap,
        unlockAll,
        openUnlockModal,
        makeLockedPlaceholder,
        mountLockButton,      // ★ 新增
        lockNow,              // ★ 新增（也可由外部直接调用）
        hasUnlockedEncrypted, // ★ 新增
        isLocked(section) { return section && section.encrypted && !section.__unlocked; },
        clearPassword() { try { sessionStorage.removeItem(SS_KEY); } catch {} }
    };
})(window);