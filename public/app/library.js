export function libraryState(raw = {}) {
    raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const seen = new Set();
    const folders = (Array.isArray(raw.folders) ? raw.folders : []).filter(folder => {
        if (!folder?.id || typeof folder.name !== 'string' || !folder.name || seen.has(folder.id)) return false;
        seen.add(folder.id); return true;
    }).map(folder => ({ ...folder }));
    const assignments = Object.fromEntries(Object.entries(raw.assignments || {}).filter(([, id]) => seen.has(id)));
    return { ...structuredClone(raw), folders, assignments };
}
export function addFolder(raw, id, name) {
    const next = libraryState(raw); name = String(name).trim();
    if (!name || name.length > 40) throw new Error('分类名称需要 1–40 个字符。');
    if (next.folders.some(folder => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('已存在同名分类。');
    if (next.folders.some(folder => folder.id === id)) throw new Error('分类标识重复。');
    next.folders.push({ id, name }); return next;
}
export function renameFolder(raw, id, name) {
    const next = libraryState(raw); name = String(name).trim();
    if (!name || name.length > 40) throw new Error('分类名称需要 1–40 个字符。');
    if (next.folders.some(folder => folder.id !== id && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('已存在同名分类。');
    const folder = next.folders.find(folder => folder.id === id); if (!folder) throw new Error('分类不存在。');
    folder.name = name; return next;
}
export function deleteFolder(raw, id) {
    const next = libraryState(raw); next.folders = next.folders.filter(folder => folder.id !== id);
    next.assignments = Object.fromEntries(Object.entries(next.assignments).filter(([, folder]) => folder !== id));
    return next;
}
export function moveCards(raw, avatars, folder) {
    const next = libraryState(raw);
    if (folder && !next.folders.some(item => item.id === folder)) throw new Error('目标分类不存在。');
    for (const avatar of avatars) {
        if (folder) next.assignments[avatar] = folder; else delete next.assignments[avatar];
    }
    return next;
}
export function filterCards(characters, raw, folder, query = '', sort = 'name') {
    const library = libraryState(raw); query = query.toLocaleLowerCase().trim();
    return characters.filter(card => {
        const category = library.assignments[card.avatar] || '';
        return (folder === 'all' || (folder === 'unfiled' ? !category : category === folder)) && String(card.name).toLocaleLowerCase().includes(query);
    }).sort((a, b) => sort === 'recent' ? (Date.parse(b.create_date) || 0) - (Date.parse(a.create_date) || 0) : String(a.name).localeCompare(String(b.name), 'zh-CN'));
}
