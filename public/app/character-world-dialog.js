import { hasEmbeddedWorld } from './character-world.js';

export function installWorldBindingGesture(button, open) {
    let press, suppressClick = false;
    const cancel = () => {
        clearTimeout(press?.timer);
        press = undefined;
    };
    button.title = '点击查看世界书，长按管理绑定';
    button.setAttribute('aria-description', '长按或按 Shift+F10 管理世界书绑定');
    button.setAttribute('aria-keyshortcuts', 'Shift+F10');
    button.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0) return;
        cancel();
        suppressClick = false;
        if (event.pointerType === 'mouse') {
            // The card itself is draggable. A press on this action belongs to the button.
            event.preventDefault();
            button.focus({ preventScroll: true });
        }
        press = { id: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimeout(() => {
            cancel();
            if (!button.isConnected) return;
            suppressClick = true;
            open();
        }, 500) };
    });
    button.addEventListener('pointermove', event => {
        if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
            cancel();
            suppressClick = true;
        }
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(type, event => { if (press?.id === event.pointerId) cancel(); });
    }
    button.addEventListener('click', event => {
        if (!suppressClick || (!event.pointerType && event.detail === 0)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);
    button.addEventListener('contextmenu', event => {
        event.preventDefault();
        if (!press && event.button === 2 && event.pointerType !== 'touch') open();
    });
    button.addEventListener('keydown', event => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        if (!event.repeat) open();
    });
}

export function showWorldBindingDialog({ panel, trigger, characterName, el, action, load, save }) {
    const dialog = el('dialog', 'compact-dialog world-binding-dialog');
    const heading = el('h2', '', '世界书管理');
    heading.id = 'world-binding-title';
    dialog.setAttribute('aria-labelledby', heading.id);
    const status = el('p', 'note');
    status.id = 'world-binding-status';
    status.setAttribute('role', 'status');
    dialog.setAttribute('aria-describedby', status.id);
    const error = el('p', 'note warning');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const field = el('label', 'field');
    const select = el('select');
    select.setAttribute('aria-label', '绑定的世界书');
    select.dataset.searchable = 'true';
    select.dataset.searchPlaceholder = '搜索世界书…';
    select.dataset.searchLabel = '搜索世界书';
    field.append(el('span', '', '绑定的世界书'), select);
    field.hidden = true;
    const form = el('form');
    const actions = el('div', 'compact-dialog-actions');
    const cancel = action('取消', () => dialog.close());
    cancel.autofocus = true;
    const retry = action('重新加载', () => read());
    retry.hidden = true;
    const submit = el('button', 'button primary', '保存绑定');
    submit.type = 'submit';
    submit.disabled = true;
    actions.append(cancel, retry, submit);
    form.append(heading, status, field, error, actions);
    dialog.append(form);
    let linked = '', embedded = false, saving = false;
    const update = () => {
        const option = select.selectedOptions[0];
        submit.disabled = saving || field.hidden || !option || option.disabled || (select.value === linked && !embedded);
        submit.textContent = !submit.disabled && !select.value ? '解绑' : '保存绑定';
    };
    const showError = message => { error.textContent = message; error.hidden = false; };
    const read = async () => {
        retry.hidden = error.hidden = field.hidden = true;
        status.textContent = `正在读取「${characterName}」的世界书绑定…`;
        update();
        try {
            const { character, worlds } = await load();
            if (!dialog.open) return;
            const card = character.data || character;
            linked = card.extensions?.world || '';
            embedded = !linked && hasEmbeddedWorld(card);
            const add = (value, label, disabled = false) => {
                const option = el('option', '', label);
                option.value = value; option.disabled = disabled; select.append(option);
                return option;
            };
            select.replaceChildren();
            add('', '不绑定世界书');
            for (const book of worlds) add(book.file_id, book.file_id);
            const missing = linked && !worlds.some(book => book.file_id === linked);
            if (missing) add(linked, `${linked}（文件已缺失）`, true);
            const embeddedOption = embedded ? add('', '使用内嵌世界书', true) : null;
            select.value = linked;
            if (embeddedOption) embeddedOption.selected = true;
            const current = linked ? `${linked}${missing ? '（文件已缺失）' : ''}` : embedded ? '内嵌世界书' : '未绑定';
            status.textContent = `「${characterName}」当前绑定：${current}。${worlds.length ? '' : '暂无可选的世界书。'}`;
            field.hidden = false;
            update();
        } catch (failure) {
            if (!dialog.open) return;
            status.textContent = `「${characterName}」的世界书绑定加载失败。`;
            showError(failure.message);
            retry.hidden = false;
        }
    };
    select.addEventListener('change', () => { error.hidden = true; update(); });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (submit.disabled) return;
        const next = select.value;
        saving = select.disabled = cancel.disabled = true;
        submit.disabled = true;
        submit.textContent = '保存中…';
        error.hidden = true;
        try { await save(next); dialog.close(); }
        catch (failure) {
            saving = select.disabled = cancel.disabled = false;
            showError(failure.message);
            update();
        }
    });
    dialog.addEventListener('cancel', event => {
        if (saving) event.preventDefault();
    });
    dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') event.stopPropagation();
    });
    dialog.addEventListener('close', () => {
        dialog.remove();
        if (panel.open && trigger.isConnected) trigger.focus({ preventScroll: true });
    }, { once: true });
    panel.append(dialog);
    dialog.showModal();
    void read();
}
