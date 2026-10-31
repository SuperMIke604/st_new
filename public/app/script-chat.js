// Serialized into the script iframe. This is a local compatibility document,
// never a reference to the application's DOM.
export function scriptChat(initial, request, on, report = () => {}) {
    let snapshot = initial, dialog, root, header, note, output, chat, input, target = null, inline = false, scheduled = false, lastHeight = 0;
    const measure = () => {
        scheduled = false;
        if (!inline || !root) return;
        const height = Math.min(20000, Math.max(100, Math.ceil(Math.max(root.scrollHeight || 0, root.getBoundingClientRect?.().height || 0) + 8)));
        if (height !== lastHeight) { lastHeight = height; report({ type: 'chat-inline-height', height }); }
    };
    const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        if (typeof setTimeout === 'function') setTimeout(measure, 16); else measure();
    };
    const render = () => {
        if (!chat) return;
        const wanted = new Set();
        for (const view of snapshot.scriptMessageViews || []) {
            wanted.add(String(view.id));
            let row = [...chat.children].find(node => node.getAttribute('mesid') === String(view.id));
            if (!row) {
                row = document.createElement('article'); row.className = 'mes'; row.setAttribute('mesid', view.id);
                const body = document.createElement('div'); body.className = 'mes_text'; row.append(body); chat.append(row);
            }
            // Keep form values and script decorations through unrelated saves.
            if (row._source !== view.html) { row.firstElementChild.innerHTML = view.html; row._source = view.html; }
            row.hidden = inline && view.id !== target;
        }
        for (const row of [...chat.children]) if (!wanted.has(row.getAttribute('mesid'))) row.remove();
        schedule();
    };
    const ensure = () => {
        if (!dialog) {
            dialog = document.createElement('dialog'); dialog.id = 'script-chat-dialog';
            dialog.style.cssText = 'box-sizing:border-box;width:min(96vw,960px);max-height:92vh;overflow:auto;border:1px solid var(--SmartThemeBorderColor);border-radius:12px;padding:12px;background:var(--SmartThemeBlurTintColor);color:var(--SmartThemeBodyColor)';
            root = document.createElement('section'); root.id = 'script-chat-root'; root.style.cssText = 'display:flow-root;width:100%;line-height:1.7;overflow-wrap:anywhere';
            const style = document.createElement('style'); style.textContent = '#script-chat-root [hidden]{display:none!important}'; document.head.append(style);
            header = document.createElement('header'); header.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;position:sticky;top:0;z-index:10;background:var(--SmartThemeBlurTintColor);padding:8px';
            const title = document.createElement('strong'); title.textContent = '酒馆伴侣 · 角色界面';
            const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => target === null ? dialog.close() : mount(target); header.append(title, close);
            dialog.addEventListener('cancel', event => { event.preventDefault(); close.onclick(); });
            chat = document.createElement('section'); chat.id = 'chat';
            output = document.createElement('section'); output.hidden = true;
            input = document.createElement('textarea'); input.id = 'send_textarea'; input.setAttribute('aria-label', '角色脚本生成的内容'); input.style.cssText = 'box-sizing:border-box;width:100%;min-height:100px;margin-top:12px';
            input.addEventListener('input', () => { output.hidden = !input.value; schedule(); });
            const fill = document.createElement('button'); fill.textContent = '填入聊天输入框';
            for (const button of [close, fill]) button.style.cssText = 'box-sizing:border-box;min-height:42px;padding:8px 12px;border:1px solid var(--SmartThemeBorderColor);border-radius:10px;background:var(--SmartThemeChatTintColor);color:inherit;font:inherit';
            fill.onclick = async () => {
                fill.disabled = true;
                try { await request('set-draft', { text: input.value }); if (!inline) close.onclick(); }
                catch (error) { window.toastr.error(error.message); }
                finally { fill.disabled = false; }
            };
            note = document.createElement('p'); note.textContent = '二次解析与 AI 帮填使用聊天当前连接；卡内独立 API 地址暂未接入。生成的描述可填回聊天输入框，确认后发送。';
            output.append(input, fill); root.append(header, note, chat, output); dialog.append(root); document.body.append(dialog); render();
            if (typeof ResizeObserver !== 'undefined') new ResizeObserver(schedule).observe(root);
            if (typeof MutationObserver !== 'undefined') new MutationObserver(schedule).observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
            root.addEventListener('toggle', schedule, true);
            if (typeof addEventListener === 'function') addEventListener('resize', schedule);
        }
    };
    const open = () => {
        ensure(); inline = false; header.hidden = false; note.hidden = false; if (root.parentNode !== dialog) dialog.append(root); render();
        report({ type: 'chat-mode', inline: false });
        if (!dialog.open) dialog.showModal();
    };
    const mount = messageId => {
        if (!snapshot.scriptMessageViews?.some(view => view.id === messageId)) return;
        ensure(); target = messageId; inline = true; lastHeight = 0;
        if (dialog.open) dialog.close();
        header.hidden = true; note.hidden = true; if (root.parentNode !== document.body) document.body.append(root); render();
        report({ type: 'chat-mode', inline: true }); schedule();
    };
    // Prepare the document before legacy scripts install their event delegates.
    if (initial.scriptMessageViews) ensure();
    on('script-chat-open', open);
    return { open, mount, refresh(value) { snapshot = value; render(); } };
}
