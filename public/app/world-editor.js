export function worldDraft(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !value.entries || typeof value.entries !== 'object') throw new Error('世界书需要包含有效的 entries 条目。');
    const draft = structuredClone(value);
    if (Array.isArray(draft.entries)) {
        const entries = draft.entries.map((entry, index) => [String(entry?.uid ?? index), entry]);
        if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new Error('世界书包含重复的条目标识。');
        draft.entries = Object.fromEntries(entries);
    }
    if (Object.values(draft.entries).some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry))) throw new Error('世界书条目格式不正确。');
    for (const entry of Object.values(draft.entries)) {
        for (const key of ['key', 'keysecondary', 'keys', 'secondary_keys']) {
            if (entry[key] != null && (!Array.isArray(entry[key]) || entry[key].some(value => typeof value !== 'string'))) throw new Error('世界书关键词必须为文本列表。');
        }
    }
    return draft;
}

export function newWorldEntry(book) {
    let uid = 0;
    while (book.entries[uid] || Object.values(book.entries).some(entry => Number(entry.uid) === uid)) uid++;
    book.entries[uid] = { uid, independentCreatedAt: Date.now(), comment: '新条目', key: [], keysecondary: [], content: '', constant: false, selective: false, selectiveLogic: 0, order: 100, position: 0, disable: false, probability: 100, useProbability: false, depth: 4, role: 0 };
    return String(uid);
}

export function renderWorldEntries(container, book, { el, field, action, dirty, icon, countTokens }) {
    const opened = new Set(); let freshId = null;
    let disposers = [];
    container._dispose = () => { for (const dispose of disposers) dispose(); disposers = []; };
    const sortRows = () => {
        const rows = [...container.querySelectorAll(':scope > .prompt-item')];
        rows.sort((a, b) => (a.dataset.entryId === freshId ? -1 : b.dataset.entryId === freshId ? 1 : 0) || Number(a.classList.contains('prompt-disabled')) - Number(b.classList.contains('prompt-disabled')) || Number(book.entries[b.dataset.entryId].order ?? 100) - Number(book.entries[a.dataset.entryId].order ?? 100) || Number(book.entries[b.dataset.entryId].independentCreatedAt || 0) - Number(book.entries[a.dataset.entryId].independentCreatedAt || 0) || b._originalIndex - a._originalIndex);
        rows.forEach(row => container.append(row));
    };
    const render = () => {
        container._dispose();
        container.replaceChildren();
        const header = el('div', 'section-heading'); header.append(el('h2', '', `条目 · ${Object.keys(book.entries).length}`), action('新增条目', () => { freshId = newWorldEntry(book); opened.add(freshId); dirty(); render(); }, 'plus')); container.append(header);
        for (const [index, [id, entry]] of Object.entries(book.entries).entries()) {
            const row = el('details', 'prompt-item'); row.open = opened.has(id);
            let active = true; disposers.push(() => { active = false; });
            row._originalIndex = index; row.dataset.entryId = id;
            row.addEventListener('toggle', () => { if (!active) return; if (row.open) opened.add(id); else opened.delete(id); });
            const summary = el('summary', 'world-entry-summary world-entry-rich');
            const title = el('span', 'prompt-title', entry.comment || `条目 ${entry.uid ?? id}`);
            const status = el('span', 'world-entry-mode');
            const mode = el('select'); mode.setAttribute('aria-label', `激活方式 ${entry.comment || entry.uid || id}`);
            for (const [value, label] of [['keyword', '关键词'], ['constant', '常驻']]) { const option = el('option', '', label); option.value = value; mode.append(option); }
            mode.value = entry.constant ? 'constant' : 'keyword'; status.append(mode);
            status.addEventListener('click', event => event.stopPropagation());
            status.addEventListener('keydown', event => event.stopPropagation());
            mode.addEventListener('change', () => { entry.constant = mode.value === 'constant'; dirty(); });
            const enabled = el('input', 'world-entry-switch'); enabled.type = 'checkbox'; enabled.setAttribute('role', 'switch'); enabled.setAttribute('aria-label', `启用条目 ${entry.comment || entry.uid || id}`); enabled.checked = !entry.disable && entry.enabled !== false;
            enabled.addEventListener('click', event => event.stopPropagation());
            enabled.addEventListener('change', () => { entry.disable = !enabled.checked; if ('enabled' in entry) entry.enabled = enabled.checked; row.classList.toggle('prompt-disabled', !enabled.checked); dirty(); sortRows(); });
            row.classList.toggle('prompt-disabled', !enabled.checked);
            const chevron = el('span', 'prompt-chevron'); chevron.append(icon('chevron'));
            const actions = el('span', 'world-entry-actions');
            actions.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
            actions.append(action('复制条目', () => {
                const next = newWorldEntry(book), uid = book.entries[next].uid;
                book.entries[next] = { ...structuredClone(entry), uid, independentCreatedAt: Date.now(), comment: `${entry.comment || '条目'}（副本）` };
                dirty(); render();
            }, 'copy'), action('删除条目', () => {
                if (!confirm(`删除条目「${entry.comment || id}」？保存世界书后生效。`)) return;
                delete book.entries[id]; dirty(); render();
            }, 'trash', 'danger'));
            for (const button of actions.children) { button.title = button.textContent.trim(); button.setAttribute('aria-label', `${button.textContent.trim()} ${entry.comment || id}`); }
            const placement = el('span', 'world-entry-placement'); placement.append(status);
            placement.addEventListener('click', event => event.stopPropagation()); placement.addEventListener('keydown', event => event.stopPropagation());
            const orderLabel = el('label', 'world-entry-order'); orderLabel.append(el('span', '', '顺序'));
            const order = el('input'); order.type = 'number'; order.step = 1; order.value = entry.order ?? entry.insertion_order ?? 100; order.setAttribute('aria-label', `插入顺序 ${entry.comment || id}`);
            order.addEventListener('input', () => { if (order.value !== '' && order.validity.valid) { entry.order = Number(order.value); freshId = null; dirty(); } }); orderLabel.append(order); placement.append(orderLabel);
            const positionWrap = el('span', 'world-entry-position');
            const position = el('select'); position.setAttribute('aria-label', `插入位置 ${entry.comment || id}`);
            for (const [value, label] of [[0, '角色描述前'], [1, '角色描述后'], [4, '聊天深度'], [2, '作者注释前'], [3, '作者注释后'], [5, '示例对话前'], [6, '示例对话后'], [7, '输出口']]) { const option = el('option', '', label); option.value = value; position.append(option); }
            position.value = entry.position ?? 0; positionWrap.append(position); placement.append(positionWrap);
            summary.append(enabled, title, actions, chevron, placement); row.append(summary);
            let built = false, updatePosition = () => {}, updateCount = () => {};
            position.addEventListener('change', () => { entry.position = Number(position.value); dirty(); updatePosition(); });
            const buildForm = () => {
                if (built) return; built = true;
                const form = el('div', 'prompt-form'); row.append(form);
                const input = (label, key, fallback, options = {}) => {
                    const control = field(form, label, entry[key] ?? fallback, options);
                    control.addEventListener(options.options ? 'change' : 'input', () => { entry[key] = options.type === 'number' || options.numeric ? Number(control.value) : control.value; dirty(); });
                    return control;
                };
                const name = input('条目名称', 'comment', ''); name.addEventListener('input', () => { title.textContent = name.value || `条目 ${entry.uid ?? id}`; });
                const keys = field(form, '关键词（英文逗号分隔）', (entry.key || entry.keys || []).join(', '));
                keys.addEventListener('input', () => { entry.key = keys.value.split(',').map(text => text.trim()).filter(Boolean); dirty(); });
                for (const [key, label] of [['excludeRecursion', '不可递归'], ['preventRecursion', '防止进一步递归']]) {
                    const wrap = el('label', 'check-field'), check = el('input'); check.type = 'checkbox'; check.checked = !!entry[key]; check.addEventListener('change', () => { entry[key] = check.checked; dirty(); }); wrap.append(check, el('span', '', label)); form.append(wrap);
                }
                const content = input('条目内容', 'content', '', { multiline: true, rows: 7 });
                const counter = el('small', 'world-token-count', 'Token：…'); content.parentElement.append(counter);
                let timer, version = 0, disposed = false;
                disposers.push(() => { disposed = true; version++; clearTimeout(timer); });
                updateCount = async () => { if (disposed || !row.open) return; const current = ++version; if (!content.value) { counter.textContent = 'Token：0'; return; } try { const tokens = await countTokens?.(content.value); if (current === version && counter.isConnected) counter.textContent = Number.isFinite(tokens) ? `Token：${tokens}（含消息封装）` : 'Token：不可用'; } catch { if (current === version) counter.textContent = 'Token：计数失败'; } };
                content.addEventListener('input', () => { version++; clearTimeout(timer); timer = setTimeout(updateCount, 500); });
                const depth = input('聊天深度', 'depth', 4, { type: 'number' }); depth.min = 0;
                const role = input('消息角色', 'role', 0, { options: [[0, '系统'], [1, '用户'], [2, '助手']], numeric: true });
                updatePosition = () => { depth.closest('.field').hidden = role.closest('.field').hidden = Number(position.value) !== 4; }; updatePosition();
            };
            row.addEventListener('toggle', () => { if (active && row.open) { buildForm(); updateCount(); } });
            if (row.open) buildForm();
            container.append(row);
        }
        sortRows();
    };
    render();
}
