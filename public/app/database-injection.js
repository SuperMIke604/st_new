export function databaseInjection(table) {
    const config = table?.injection;
    const depth = config?.depth ?? 2;
    const width = table?.content?.[0]?.length ?? 0;
    return {
        mode: config?.mode === 'keyword' ? 'keyword' : 'constant',
        depth: Number.isInteger(depth) && depth >= 0 && depth <= 1000 ? depth : 2,
        maxRows: Number.isSafeInteger(config?.maxRows) && config.maxRows > 0 ? config.maxRows : 0,
        priority: ['high', 'normal', 'low'].includes(config?.priority) ? config.priority : 'normal',
        columns: [...new Set(Array.isArray(config?.columns) ? config.columns.filter(column => Number.isInteger(column) && column > 0 && column < width) : [])],
    };
}

export function splitDatabaseKeywords(value) {
    const seen = new Set();
    return String(value ?? '').split(/[、,，;；\r\n]+/u).map(word => word.replace(/^[（(［\[【\s]+|[）)］\]】\s]+$/gu, '')).filter(word => {
        const key = word.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function databaseBlockedKeywords(header, key) {
    const words = header?.chat_metadata?.independentDatabase?.blockedKeywords?.[key];
    return Array.isArray(words) ? words.filter(word => typeof word === 'string') : [];
}

export function prepareDatabaseInjection(database, template, header) {
    const rules = [];
    for (const [key, table] of Object.entries(database)) {
        if (!/^sheet_[\w-]+$/.test(key)) continue;
        const headers = table.content[0];
        const candidate = template[key];
        const templateHeaders = candidate?.content?.[0];
        // Existing snapshots may predate the settings or have a different schema.
        const sameTable = templateHeaders && (candidate.name === table.name ||
            (headers.length === templateHeaders.length && headers.every((header, index) => header === templateHeaders[index])));
        const source = sameTable && candidate.injection ? candidate : table;
        const { mode, depth, columns, maxRows, priority } = databaseInjection(source);
        if (mode !== 'keyword') continue;
        const sourceHeaders = source.content[0];
        const snapshotColumns = columns.map(column => {
            if (headers[column] === sourceHeaders[column]) return column;
            const matches = headers.flatMap((header, index) => index > 0 && header === sourceHeaders[column] ? [index] : []);
            return matches.length === 1 ? matches[0] : -1;
        }).filter(column => column > 0);
        const blocked = new Set(databaseBlockedKeywords(header, key).map(word => word.toLowerCase()));
        const rows = table.content.slice(1).map(row => {
            const words = new Set(snapshotColumns.flatMap(column => splitDatabaseKeywords(row[column]).map(word => word.toLowerCase())));
            return { row, keywords: [...words].filter(word => !blocked.has(word)) };
        });
        rules.push({ key, table, depth, rows, maxRows, priority });
    }

    if (!rules.length) return null;
    return chat => {
        const scanText = new Map();
        const latest = chat.at(-1)?.is_user ? String(chat.at(-1).mes ?? '').toLowerCase() : '';
        return rules.map(({ key, table, depth, rows, maxRows, priority }) => {
            if (!scanText.has(depth)) {
                const text = depth ? chat.slice(-depth).map(message => String(message.mes ?? '').toLowerCase()) : [];
                scanText.set(depth, text);
            }
            const messages = scanText.get(depth);
            const matched = rows.flatMap(({ row, keywords }, index) => {
                const hits = keywords.filter(keyword => messages.some(text => text.includes(keyword)));
                return hits.length ? [{ row, index, hits: hits.length, current: hits.some(keyword => latest.includes(keyword)) }] : [];
            }).sort((a, b) => Number(b.current) - Number(a.current) || b.hits - a.hits || b.index - a.index);
            return { key, table, priority, matched: matched.length, rows: maxRows ? matched.slice(0, maxRows) : matched };
        });
    };
}

export function databaseKeywordOrder(matches) {
    const priority = { high: 0, normal: 1, low: 2 };
    const tables = matches.slice().sort((a, b) => priority[a.priority] - priority[b.priority]);
    const order = [];
    const offsets = tables.map(table => {
        if (table.priority !== 'high') return 0;
        const index = table.rows.findIndex(row => !row.current);
        const count = index === -1 ? table.rows.length : index;
        for (let row = 0; row < count; row++) order.push(table.key);
        return count;
    });
    let active = tables.map((table, index) => ({ table, offset: offsets[index] })).filter(({ table, offset }) => offset < table.rows.length);
    while (active.length) {
        for (const item of active) { order.push(item.table.key); item.offset++; }
        active = active.filter(({ table, offset }) => offset < table.rows.length);
    }
    return order;
}
