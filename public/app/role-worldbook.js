export function roleWorldEntries(book) {
    return Object.entries(book.entries || {}).map(([key, entry]) => ({ ...structuredClone(entry), uid: entry.uid ?? key, name: entry.comment || entry.name || '', enabled: !entry.disable }));
}
export function toggleRoleWorldEntries(book, requested) {
    const current = Object.entries(book.entries || {});
    if (!Array.isArray(requested) || requested.length !== current.length || requested.length > 20000) throw Error('世界书条目发生变化，请重新读取。');
    const changes = new Map();
    for (const entry of requested) {
        const id = String(entry?.uid);
        if (changes.has(id) || typeof entry?.enabled !== 'boolean') throw Error('世界书开关格式无效。');
        changes.set(id, entry.enabled);
    }
    const result = structuredClone(book);
    for (const [key, entry] of current) {
        const id = String(entry.uid ?? key); if (!changes.has(id)) throw Error('世界书条目发生变化，请重新读取。');
        result.entries[key].disable = !changes.get(id);
    }
    return result;
}
