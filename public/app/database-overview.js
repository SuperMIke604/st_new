import { sheets, validateDatabase } from './database.js';
import { extractDataFromMessage } from './database-reference.js';

// Only inspect the supplied chat and its own retained versions; never fall back to a preset.
export function databaseSummaryHistory(chat = [], history = [], seed) {
    const records = []; let invalid = 0;
    const add = (value, descriptor) => {
        try { records.push({ ...descriptor, data: validateDatabase(value) }); }
        catch { invalid++; }
    };
    for (let index = chat.length - 1; index >= 0; index--) {
        const message = chat[index]; if (message.is_user) continue;
        try {
            const value = extractDataFromMessage(message, { requireMate: true });
            if (!value) continue;
            const meta = message.extra?.independentDatabase || {};
            add(value, { id: `message-${index}`, index, kind: meta.kind, from: meta.from, to: meta.to,
                updatedAt: meta.updatedAt, stale: !!meta.stale, legacy: !message.extra?.independentDatabase });
        } catch { invalid++; }
    }
    for (let offset = history.length - 1; offset >= 0; offset--) {
        const item = history[offset];
        add(item?.data, { id: `archive-${offset}`, index: item?.index, archived: true, updatedAt: item?.updatedAt });
    }
    if (seed) add(seed, { id: 'seed', index: -1, seed: true });
    records.sort((a, b) => (b.index ?? -1) - (a.index ?? -1) || Number(!!a.archived) - Number(!!b.archived));
    return { records, invalid };
}

// Apply only database-owned fields, preserving message text, branches and unrelated metadata.
export async function deleteDatabaseSummaryHistory(chat, header, id, expected, persist) {
    const metadata = header.chat_metadata?.independentDatabase;
    const current = databaseSummaryHistory(chat, metadata?.history || [], metadata?.seed);
    const record = current.records.find(item => item.id === id);
    if (id === 'all' ? JSON.stringify(current) !== JSON.stringify(expected) : !record || JSON.stringify(record) !== JSON.stringify(expected.records.find(item => item.id === id)))
        throw new Error('历史总结数据已变化，请重新打开数据概览后重试。');
    const rollback = [];
    const change = (object, key, value, remove = false) => {
        const had = Object.hasOwn(object, key), previous = object[key];
        rollback.push(() => { if (had) object[key] = previous; else delete object[key]; });
        if (remove) delete object[key]; else object[key] = value;
    };
    const removeMessage = message => {
        change(message, 'TavernDB_ACU_Data', null, true);
        if (!message.extra) change(message, 'extra', {});
        change(message.extra, 'independentDatabase', { ...message.extra.independentDatabase, snapshotDeleted: true });
    };
    try {
        if (id === 'all') {
            for (const message of chat) if (!message.is_user && (message.TavernDB_ACU_Data || extractDataFromMessage(message, { requireMate: true }))) removeMessage(message);
            if (metadata) { change(metadata, 'history', []); change(metadata, 'seed', null, true); }
        } else if (record.archived) change(metadata, 'history', metadata.history.filter((_, index) => index !== Number(id.slice(8))));
        else if (record.seed) change(metadata, 'seed', null, true);
        else removeMessage(chat[record.index]);
        await persist();
    }
    catch (error) { for (const undo of rollback.reverse()) undo(); throw error; }
    return databaseSummaryHistory(chat, header.chat_metadata?.independentDatabase?.history || [], header.chat_metadata?.independentDatabase?.seed);
}

export function renderDatabaseOverview(body, context) {
    const { el, field, action } = context;
    const snapshot = databaseSummaryHistory(context.chat, context.history?.() || [], context.getSeed ? context.getSeed() : context.seed);
    const { records, invalid } = snapshot;
    const formatTime = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN'); };
    const typeLabel = record => record.archived ? '覆盖前版本' : record.seed ? '聊天初始数据' : record.kind === 'message' ? '消息总结' : record.kind === 'database' ? '数据库总结' : record.legacy ? '旧版总结快照' : '数据库快照';
    const floor = record => Number.isInteger(record.index) && record.index >= 0 ? `#${record.index}` : '聊天初始数据';
    let selected = records[0]?.id, selectedTable = '', page = 0, expanded = false;
    const controls = el('div'), detail = el('div');
    const selectionRow = el('div', 'db-overview-selection');
    body.append(el('p', 'note', [context.characterName, context.chatName].filter(Boolean).join(' · ') || '当前聊天'), controls, detail);
    if (invalid) controls.append(el('p', 'note warning', `${invalid} 份历史数据格式异常，无法展示。`));
    if (!records.length && !invalid) { detail.append(el('p', 'note', '当前聊天暂无已保存的历史总结数据。')); return; }
    controls.append(selectionRow);
    const select = field(selectionRow, '历史总结记录', selected, { options: records.map(record => [record.id, `${floor(record)} · ${typeLabel(record)}${record.updatedAt ? ` · ${formatTime(record.updatedAt)}` : ''}`]) });
    select.dataset.searchable = 'true';
    const remove = async id => {
        if (!confirm(id === 'all' ? '删除当前聊天的全部历史总结、覆盖前版本和初始数据？聊天正文会保留，此操作不可撤销。' : '删除这份总结快照？聊天正文会保留，此操作不可撤销。')) return;
        const buttons = body.querySelectorAll('.db-overview-delete');
        select.disabled = true; for (const button of buttons) button.disabled = true;
        try {
            await context.deleteHistory(id, snapshot);
            if (controls.isConnected === false) return;
            body.replaceChildren(); renderDatabaseOverview(body, context);
            context.notify?.(id === 'all' ? '当前聊天的历史总结数据已删除' : '该总结快照已删除');
        } finally { select.disabled = false; for (const button of buttons) button.disabled = false; }
    };
    const removeAll = action('全部删除', () => remove('all'), 'trash', 'danger db-overview-delete');
    removeAll.setAttribute('aria-label', '删除全部历史总结'); removeAll.title = '删除全部历史总结';
    removeAll.disabled = !context.deleteHistory; selectionRow.append(removeAll);
    if (!records.length) { detail.append(el('p', 'note', '当前聊天暂无可展示的历史总结数据。')); return; }
    const draw = () => {
        detail.replaceChildren();
        const record = records.find(item => item.id === selected), tables = sheets(record.data);
        const count = tables.reduce((sum, [, table]) => sum + table.content.length - 1, 0);
        const status = el('section', 'dm-status-card db-overview-status');
        const heading = el('div', 'db-overview-heading');
        const removeOne = action('删除该条', () => remove(record.id), 'trash', 'icon-button danger db-overview-delete');
        removeOne.setAttribute('aria-label', '删除该条总结快照'); removeOne.title = '删除该条总结快照';
        removeOne.querySelector('span')?.remove(); removeOne.disabled = !context.deleteHistory;
        heading.append(el('h2', '', typeLabel(record)), removeOne);
        status.append(heading, el('p', 'note', `${floor(record)} · ${tables.length} 张表 · ${count} 条记录 · 共保留 ${records.length} 份快照`));
        if (record.updatedAt) status.append(el('p', 'note', `${record.archived ? '归档时间' : '更新时间'}：${formatTime(record.updatedAt)}`));
        if (!record.archived && Number.isInteger(record.from) && Number.isInteger(record.to)) status.append(el('p', 'note', `总结楼层：#${record.from}–#${record.to}`));
        if (record.stale) status.append(el('p', 'note warning', '来源消息已修改，此快照仍保留供查阅。'));
        detail.append(status);
        if (!tables.length) { detail.append(el('p', 'note', '此快照暂无数据表。')); return; }
        if (!tables.some(([key]) => key === selectedTable)) selectedTable = tables[0][0];
        const fixed = el('div', 'reference-preview-fixed db-overview-navigation'), navigation = el('div', 'reference-table-navigation'), tabs = el('nav', 'db-table-tabs');
        tabs.id = 'database-overview-tables'; tabs.dataset.expanded = String(expanded); tabs.setAttribute('aria-label', '历史总结数据表');
        for (const [key, table] of tables) {
            const button = action(`${table.name || key}（${table.content.length - 1}）`, () => { selectedTable = key; page = 0; draw(); });
            button.setAttribute('aria-pressed', String(key === selectedTable)); tabs.append(button);
        }
        const toggle = action(expanded ? '收起表格' : '展开全部表格', () => { expanded = !expanded; draw(); }, 'chevron', 'icon-button');
        toggle.title = expanded ? '收起表格' : '展开全部表格'; toggle.setAttribute('aria-label', toggle.title); toggle.setAttribute('aria-expanded', String(expanded)); toggle.setAttribute('aria-controls', tabs.id); toggle.disabled = tables.length < 2;
        navigation.append(toggle, tabs); fixed.append(navigation); detail.append(fixed);
        const table = record.data[selectedTable], rows = table.content.slice(1), pageCount = Math.max(1, Math.ceil(rows.length / 20));
        page = Math.min(page, pageCount - 1);
        const grid = el('div', 'reference-preview-grid db-overview-grid');
        const fontSize = Number(context.settings?.dpFontSize);
        grid.style.fontSize = fontSize >= 10 && fontSize <= 30 ? `${fontSize}px` : 'var(--type-body-size,14px)';
        for (let index = page * 20; index < Math.min(rows.length, (page + 1) * 20); index++) {
            const values = rows[index], card = el('article', 'reference-preview-card');
            const head = el('header', 'reference-card-head');
            head.append(el('small', '', `#${index + 1}`), el('strong', '', String(values.slice(1).find(value => value && String(value).trim()) || values[0] || `条目 ${index + 1}`)));
            card.append(head);
            for (let column = 1; column < table.content[0].length; column++) {
                const cell = el('div', 'reference-preview-cell');
                cell.append(el('small', '', String(table.content[0][column] || `字段 ${column}`)), el('div', 'reference-cell-value', String(values[column] ?? '') || '空'));
                card.append(cell);
            }
            grid.append(card);
        }
        detail.append(grid);
        if (!rows.length) grid.append(el('p', 'note', '此表暂无记录。'));
        const pager = el('div', 'db-pager');
        const previous = action('上一页', () => { page--; draw(); }); previous.disabled = page === 0;
        const next = action('下一页', () => { page++; draw(); }); next.disabled = page >= pageCount - 1;
        pager.append(previous, el('small', '', `${page + 1} / ${pageCount} · ${rows.length} 条记录`), next); detail.append(pager);
    };
    select.addEventListener('change', () => { selected = select.value; selectedTable = ''; page = 0; draw(); });
    draw();
}
