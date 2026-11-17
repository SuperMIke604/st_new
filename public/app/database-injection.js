export function databaseInjection(table) {
    const config = table?.injection;
    const depth = config?.depth ?? 2;
    const width = table?.content?.[0]?.length ?? 0;
    return {
        mode: config?.mode === 'keyword' ? 'keyword' : 'constant',
        depth: Number.isInteger(depth) && depth >= 0 && depth <= 1000 ? depth : 2,
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
        const { mode, depth, columns } = databaseInjection(source);
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
        rules.push({ key, table, depth, rows });
    }

    if (!rules.length) return null;
    return chat => {
        const result = { ...database };
        const scanText = new Map();
        for (const { key, table, depth, rows } of rules) {
            if (!scanText.has(depth)) {
                const text = depth ? chat.slice(-depth).map(message => String(message.mes ?? '').toLowerCase()) : [];
                scanText.set(depth, text);
            }
            const messages = scanText.get(depth);
            const matched = rows.filter(({ keywords }) => keywords.some(keyword => messages.some(text => text.includes(keyword))));
            if (matched.length) result[key] = { ...table, content: [table.content[0], ...matched.map(({ row }) => row)] };
            else delete result[key];
        }
        return result;
    };
}
