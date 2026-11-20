export function changeChatHistory(messages, operation, selected = []) {
    const ids = [...new Set(selected)].sort((a, b) => a - b);
    if (ids.some(id => !Number.isInteger(id) || id < 0 || id >= messages.length)) throw Error('选中的消息楼层已失效。');
    if (!ids.length) throw Error('请先选择消息。');
    const chosen = new Set(ids);
    if (operation === 'hide' || operation === 'show') return { messages: messages.map((message, index) => chosen.has(index) ? { ...message, is_system: operation === 'hide' } : message), start: ids[0] };
    if (operation === 'delete') return { messages: messages.filter((_, index) => !chosen.has(index)), start: ids[0] };
    throw Error('未知的聊天记录操作。');
}

export async function persistChatHistory(api, { avatar, file, header, original, messages, allowMissing = false, check = () => {} }) {
    check();
    const read = () => api.post('/api/chats/get', { avatar_url: avatar, file_name: file }, { signal: AbortSignal.timeout(15000) });
    const before = await read();
    check();
    const beforeHeader = structuredClone(before?.[0]);
    // loadChat initializes this local default before the first ordinary save.
    if (beforeHeader && !Object.hasOwn(beforeHeader, 'mes')) {
        beforeHeader.chat_metadata ||= {};
        if (!beforeHeader.chat_metadata.independentDatabase && header.chat_metadata?.independentDatabase?.autoStart === original.length) beforeHeader.chat_metadata.independentDatabase = { autoStart: original.length };
    }
    if (!(allowMissing && Array.isArray(before) && !before.length) && (!Array.isArray(before) || JSON.stringify(beforeHeader) !== JSON.stringify(header) || JSON.stringify(before.slice(1)) !== JSON.stringify(original))) throw Error('聊天已被其他操作修改，请重新读取聊天。');
    await api.saveChat(avatar, file, structuredClone(header), structuredClone(messages));
    const saved = await read();
    check();
    if (!Array.isArray(saved) || JSON.stringify(saved) !== JSON.stringify([header, ...messages])) throw Error('聊天保存核验失败，请重新读取聊天确认。');
    return saved.slice(1);
}

export function renderChatHistoryManager(body, { chat, el, action, notify, dirty: onDirty, save, jump, confirm = globalThis.confirm }) {
    const field = (parent, label, value, { type = 'text' } = {}) => {
        const wrap = el('label', 'field'), input = el('input');
        wrap.append(el('span', '', label));
        input.type = type;
        input.value = value; wrap.append(input); parent.append(wrap); return input;
    };
    let messages = structuredClone(chat), selected = new Set(), changed = false, start = Infinity, page = 0, saving = false;
    const controls = el('fieldset', 'history-controls'); body.append(controls);
    const query = field(controls, '搜索文字', '', { type: 'search' });
    const goToFloor = value => {
        if (changed) throw Error('请先保存或处理未完成的修改再跳转。');
        const id = Number(value);
        if (String(value).trim() === '' || !Number.isInteger(id) || id < 0 || id >= messages.length) throw Error('请输入存在的楼层编号。');
        jump(id);
    };
    const jumpRow = el('div', 'history-jump-row'); controls.append(jumpRow);
    const floor = field(jumpRow, '跳到楼层', '', { type: 'number' }); floor.min = '0'; floor.step = '1';
    const jumpButton = action('跳转到楼层', () => goToFloor(floor.value), 'down'); jumpRow.append(jumpButton);
    floor.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); jumpButton.click(); } });
    const toolbar = el('div', 'regex-toolbar history-toolbar'), count = el('p', 'note'), rows = el('div', 'history-messages'), pager = el('div', 'regex-toolbar history-toolbar');
    controls.append(toolbar, count, rows, pager);
    const footer = el('div', 'editor-footer'); body.append(footer);
    const filtered = () => {
        const value = query.value.trim().toLowerCase();
        const result = [];
        for (let id = messages.length - 1; id >= 0; id--) if (!value || `${id} ${messages[id].name || ''} ${messages[id].mes || ''}`.toLowerCase().includes(value)) result.push(id);
        return result;
    };
    const change = operation => {
        const next = changeChatHistory(messages, operation, [...selected]);
        messages = next.messages; start = Math.min(start, next.start); selected.clear(); changed = true; onDirty(true); render();
    };
    toolbar.append(action('全选结果', () => { selected = new Set(filtered()); render(); }), action('全不选', () => { selected.clear(); render(); }), action('反选', () => { for (const id of filtered()) selected.has(id) ? selected.delete(id) : selected.add(id); render(); }), action('连选', () => {
        const ids = [...selected].sort((a, b) => a - b); if (ids.length !== 2) throw Error('请先选择两条端点消息。');
        for (let id = ids[0]; id <= ids[1]; id++) selected.add(id); render();
    }));
    const mutations = [action('显示', () => change('show')), action('隐藏', () => change('hide')), action('删除', () => {
        if (!selected.size) throw Error('请先选择消息。');
        if (confirm(`删除选中的 ${selected.size} 条消息？点击保存后生效。`)) change('delete');
    }, 'trash', 'danger')]; toolbar.append(...mutations);
    const saveButton = action('保存聊天记录', async () => {
        if (!changed || saving) return;
        saving = true; controls.disabled = true; saveButton.disabled = true;
        try {
            messages = structuredClone(await save(messages, start)); start = Infinity; changed = false; selected.clear(); onDirty(false); notify('聊天记录已保存');
        } finally { saving = false; controls.disabled = false; render(); }
    }, 'edit', 'primary'); footer.append(saveButton);
    const render = () => {
        const ids = filtered(), pages = Math.max(1, Math.ceil(ids.length / 50)); page = Math.min(page, pages - 1);
        count.textContent = `${messages.length} 条消息 · 已选 ${selected.size} 条${changed ? ' · 有未保存修改' : ''}`;
        floor.max = String(messages.length - 1); rows.replaceChildren(); pager.replaceChildren();
        for (const id of ids.slice(page * 50, page * 50 + 50)) {
            const message = messages[id], row = el('div', `history-message${message.is_system ? ' history-message-hidden' : ''}`), label = el('label', 'history-message-label');
            const toggle = el('input'); toggle.type = 'checkbox'; toggle.checked = selected.has(id); toggle.setAttribute('aria-label', `选择第 ${id} 楼`);
            toggle.addEventListener('change', () => { toggle.checked ? selected.add(id) : selected.delete(id); render(); });
            const content = el('span', 'history-message-content'), heading = el('span', 'history-message-heading', `#${id} · ${message.name || (message.is_user ? '用户' : '角色')}${message.is_system ? ' · 已隐藏' : ''}`);
            const source = String(message.mes || '').replace(/\s+/g, ' '), offset = query.value.trim() ? source.toLowerCase().indexOf(query.value.trim().toLowerCase()) : -1;
            const from = Math.max(0, offset - 30), preview = `${from ? '…' : ''}${source.slice(from, from + 180)}`;
            content.append(heading, el('span', 'history-message-preview', preview)); label.append(toggle, content);
            row.append(label, action('跳转', () => goToFloor(id), 'down')); rows.append(row);
        }
        if (!ids.length) rows.append(el('p', 'note', '没有匹配消息。'));
        const previous = action('上一页', () => { page--; render(); }), next = action('下一页', () => { page++; render(); });
        previous.disabled = page === 0; next.disabled = page >= pages - 1; pager.append(previous, el('span', 'note', `${page + 1} / ${pages}`), next);
        for (const button of mutations) button.disabled = !selected.size;
        saveButton.disabled = !changed || saving;
    };
    query.addEventListener('input', () => { page = 0; render(); });
    render();
}
