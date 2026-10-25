export function roleWorldEntries(book) {
    const positions = ['before_character_definition', 'after_character_definition', 'before_author_note', 'after_author_note', 'at_depth', 'before_example_messages', 'after_example_messages', 'outlet'];
    return Object.entries(book.entries || {}).map(([key, entry]) => ({ ...structuredClone(entry), uid: entry.uid ?? key, name: entry.comment || entry.name || '', enabled: !entry.disable,
        strategy: { type: entry.constant ? 'constant' : entry.vectorized ? 'vectorized' : 'selective', keys: entry.key || [], keys_secondary: { logic: ['and_any', 'not_all', 'not_any', 'and_all'][entry.selectiveLogic || 0], keys: entry.keysecondary || [] }, scan_depth: entry.scanDepth ?? 'same_as_global' },
        position: { type: positions[entry.position || 0], role: ['system', 'user', 'assistant'][entry.role || 0], depth: entry.depth || 0, order: entry.order || 0 }, probability: entry.useProbability ? entry.probability : 100,
        recursion: { prevent_incoming: !!entry.excludeRecursion, prevent_outgoing: !!entry.preventRecursion, delay_until: entry.delayUntilRecursion || null }, effect: { sticky: entry.sticky ?? null, cooldown: entry.cooldown ?? null, delay: entry.delay ?? null }
    }));
}
const archiveFields = entry => Object.fromEntries(['name', 'enabled', 'strategy', 'position', 'content', 'probability', 'recursion', 'effect'].map(key => [key, entry[key]]));
export function archiveRoleWorldEntries(book, requested) {
    if (!Array.isArray(requested) || requested.length > 20000 || JSON.stringify(requested).length > 10000000) throw Error('归档条目格式无效或过大。');
    const originals = new Map(roleWorldEntries(book).map(entry => [String(entry.uid), entry])), seen = new Set(), result = structuredClone(book);
    result.entries ||= {};
    let next = Math.max(-1, ...Object.entries(book.entries || {}).map(([key, entry]) => Number(entry.uid ?? key)).filter(Number.isSafeInteger)) + 1;
    for (const entry of requested) {
        if (!entry || typeof entry !== 'object') throw Error('归档条目无效。');
        const id = entry.uid === undefined ? null : String(entry.uid), original = id === null ? null : originals.get(id);
        if (id !== null && (!original || seen.has(id))) throw Error('归档条目 ID 已变化或重复。');
        if (id !== null) seen.add(id);
        if (original && JSON.stringify(archiveFields(entry)) === JSON.stringify(archiveFields(original))) continue;
        if (!/^(Char_|Script_|Summary_).+/.test(entry.name || '') || original && !/^(Char_|Script_|Summary_).+/.test(original.name)) throw Error('只允许新增或修改当前卡的人设、剧本和总结归档条目。');
        if (typeof entry.content !== 'string' || entry.content.length > 500000 || typeof entry.enabled !== 'boolean') throw Error('归档内容或开关无效。');
        const keys = entry.strategy?.keys || []; if (!Array.isArray(keys) || keys.length > 100 || keys.some(key => typeof key !== 'string' || key.length > 300)) throw Error('归档触发词无效。');
        if (!['constant', 'selective'].includes(entry.strategy?.type) || !['before_character_definition', 'after_character_definition', 'at_depth'].includes(entry.position?.type)) throw Error('暂不支持此归档注入设置。');
        const number = value => { if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('归档注入数值无效。'); return value; };
        if (!original) while (Object.hasOwn(result.entries, String(next)) || originals.has(String(next))) next++;
        const uid = original ? original.uid : next++, key = original ? Object.keys(book.entries).find(key => String(book.entries[key].uid ?? key) === id) : String(uid);
        result.entries[key] = { ...(original ? book.entries[key] : {}), uid, displayIndex: original?.displayIndex ?? Object.keys(result.entries).length, comment: entry.name, disable: !entry.enabled, content: entry.content,
            constant: entry.strategy.type === 'constant', vectorized: false, selective: true, key: [...keys], keysecondary: [], selectiveLogic: 0, scanDepth: entry.strategy.scan_depth === 'same_as_global' ? null : entry.strategy.scan_depth ?? null,
            position: { before_character_definition: 0, after_character_definition: 1, at_depth: 4 }[entry.position.type], role: { system: 0, user: 1, assistant: 2 }[entry.position.role || 'system'] ?? 0, depth: number(entry.position.depth ?? 4), order: number(entry.position.order ?? 100), useProbability: true, probability: number(entry.probability ?? 100),
            excludeRecursion: !!entry.recursion?.prevent_incoming, preventRecursion: !!entry.recursion?.prevent_outgoing, delayUntilRecursion: entry.recursion?.delay_until ?? false, sticky: entry.effect?.sticky ?? null, cooldown: entry.effect?.cooldown ?? null, delay: entry.effect?.delay ?? null };
    }
    if (seen.size !== originals.size) throw Error('不允许通过归档接口删除已有条目。');
    return result;
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
