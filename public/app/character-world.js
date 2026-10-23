export function embeddedWorld(character) {
    const card = character.data || character, book = card.character_book;
    if (!book?.entries) return null;
    const entries = {};
    for (const [index, entry] of Object.values(book.entries).entries()) {
        let id = String(entry.id ?? index); while (entries[id]) id += '_';
        const ext = entry.extensions || {};
        const converted = { ...structuredClone(entry), ...structuredClone(ext), uid: entry.id ?? index,
            key: entry.keys || entry.key || [], keysecondary: entry.secondary_keys || entry.keysecondary || [],
            comment: entry.comment || entry.name || '', content: entry.content || '', disable: entry.enabled === false || !!entry.disable,
            constant: !!entry.constant, selective: !!entry.selective, order: entry.insertion_order ?? entry.order ?? 100,
            position: ext.position ?? (typeof entry.position === 'number' ? entry.position : entry.position === 'after_char' ? 1 : 0),
            probability: ext.probability ?? 100, useProbability: ext.useProbability ?? true, depth: ext.depth ?? 4, role: ext.role ?? 0 };
        for (const [native, external] of Object.entries({ excludeRecursion: 'exclude_recursion', preventRecursion: 'prevent_recursion', delayUntilRecursion: 'delay_until_recursion', scanDepth: 'scan_depth', caseSensitive: 'case_sensitive', matchWholeWords: 'match_whole_words', ignoreBudget: 'ignore_budget', groupOverride: 'group_override', groupWeight: 'group_weight', matchPersonaDescription: 'match_persona_description', matchCharacterDescription: 'match_character_description', matchCharacterPersonality: 'match_character_personality', matchCharacterDepthPrompt: 'match_character_depth_prompt', matchScenario: 'match_scenario', matchCreatorNotes: 'match_creator_notes' })) {
            if (external in ext) converted[native] = ext[external];
        }
        entries[id] = converted;
    }
    return { name: book.name || `${card.name || '角色'}的世界书`, entries, originalData: structuredClone(book) };
}

export async function importCharacterWorld(api, avatar, safeName) {
    const character = await api.post('/api/characters/get', { avatar_url: avatar });
    const card = character.data || character, book = embeddedWorld(character);
    if (!book) return { character, name: card.extensions?.world || '', imported: false };
    const available = await api.post('/api/worldinfo/list');
    if (card.extensions?.world && available.some(item => item.file_id === card.extensions.world)) return { character, name: card.extensions.world, imported: false };
    const base = safeName(book.name) || '角色世界书'; let name = base, number = 2;
    while (available.some(item => item.file_id === name)) name = `${base} ${number++}`;
    await api.post('/api/worldinfo/edit', { name, data: { ...book, name } });
    await api.post('/api/characters/merge-attributes', { avatar, data: { extensions: { ...card.extensions, world: name } } });
    const updated = await api.post('/api/characters/get', { avatar_url: avatar });
    return { character: updated, name, imported: true };
}
