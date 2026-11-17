export function databaseInjection(table) {
    const config = table?.injection;
    const depth = config?.depth ?? 2;
    const width = table?.content?.[0]?.length ?? 0;
    return {
        mode: config?.mode === 'keyword' ? 'keyword' : 'constant',
        depth: Number.isInteger(depth) && depth >= 0 && depth <= 1000 ? depth : 2,
        maxRows: Number.isSafeInteger(config?.maxRows) && config.maxRows > 0 ? config.maxRows : 0,
        priority: ['high', 'normal', 'low'].includes(config?.priority) ? config.priority : 'normal',
        linkEnabled: config?.linkEnabled === true,
        linkColumn: Number.isInteger(config?.linkColumn) && config.linkColumn > 0 && config.linkColumn < width ? config.linkColumn : 0,
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

function chineseMatchLength(text, runs) {
    let best = 0;
    for (const run of runs) {
        for (let start = 0; start + Math.max(1, best) < run.length; start++) {
            const pair = run[start] + run[start + 1];
            for (let offset = text.indexOf(pair); offset !== -1; offset = text.indexOf(pair, offset + 1)) {
                let length = 2, end = offset + pair.length;
                while (start + length < run.length && text.startsWith(run[start + length], end)) {
                    end += run[start + length].length;
                    length++;
                }
                best = Math.max(best, length);
                if (length === run.length - start) break;
            }
        }
    }
    return best;
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
        const { mode, depth, columns, maxRows, priority, linkEnabled, linkColumn } = databaseInjection(source);
        if (mode !== 'keyword') continue;
        const sourceHeaders = source.content[0];
        const resolveColumn = column => {
            if (headers[column] === sourceHeaders[column]) return column;
            const matches = headers.flatMap((header, index) => index > 0 && header === sourceHeaders[column] ? [index] : []);
            return matches.length === 1 ? matches[0] : -1;
        };
        const snapshotColumns = columns.map(resolveColumn).filter(column => column > 0);
        const linkedColumn = linkEnabled && linkColumn ? resolveColumn(linkColumn) : 0;
        const blocked = new Set(databaseBlockedKeywords(header, key).map(word => word.toLowerCase()));
        const keywordRuns = new Map();
        const rows = table.content.slice(1).map(row => {
            const words = new Set(snapshotColumns.flatMap(column => splitDatabaseKeywords(row[column]).map(word => word.toLowerCase())));
            const keywords = [...words].filter(word => !blocked.has(word));
            for (const word of keywords) {
                if (!keywordRuns.has(word)) keywordRuns.set(word, (word.match(/\p{Script=Han}{2,}/gu) || []).map(run => Array.from(run)));
            }
            return { row, keywords };
        });
        rules.push({ key, table, depth, rows, keywordRuns, maxRows, priority, linkedColumn });
    }

    if (!rules.length) return null;
    return chat => {
        const scanText = new Map();
        const lastIsUser = !!chat.at(-1)?.is_user;
        const direct = rules.map(({ depth, rows, keywordRuns }) => {
            if (!scanText.has(depth)) {
                const text = depth ? chat.slice(-depth).map(message => String(message.mes ?? '').toLowerCase()) : [];
                scanText.set(depth, text);
            }
            const messages = scanText.get(depth);
            const scores = new Map();
            const score = word => {
                if (scores.has(word)) return scores.get(word);
                let exact = false, current = false, currentExact = false, length = 0;
                for (let index = messages.length - 1; index >= 0; index--) {
                    const text = messages[index];
                    const full = text.includes(word);
                    const partial = full ? 0 : chineseMatchLength(text, keywordRuns.get(word));
                    if (lastIsUser && index === messages.length - 1) { current = full || partial > 0; currentExact = full; }
                    exact ||= full;
                    length = Math.max(length, partial);
                }
                const hit = { exact, current, currentExact, length };
                scores.set(word, hit);
                return hit;
            };
            return rows.flatMap(({ row, keywords }, index) => {
                let current = false, currentExact = 0, exact = 0, hits = 0, length = 0;
                for (const word of keywords) {
                    const hit = score(word);
                    if (!hit.exact && !hit.length) continue;
                    current ||= hit.current;
                    currentExact += Number(hit.currentExact);
                    exact += Number(hit.exact);
                    hits++;
                    length = Math.max(length, hit.length);
                }
                return hits ? [{ row, index, current, currentExact, exact, hits, length }] : [];
            }).sort((a, b) => Number(b.current) - Number(a.current) || b.currentExact - a.currentExact ||
                b.exact - a.exact || b.hits - a.hits || b.length - a.length || b.index - a.index);
        });
        // Only rows matched against chat can supply links. Linked results never feed back into this pass.
        const links = new Map();
        rules.forEach(({ key, maxRows, linkedColumn }, index) => {
            if (linkedColumn < 1) return;
            for (const { row, current } of direct[index].slice(0, maxRows || undefined)) {
                for (const term of splitDatabaseKeywords(row[linkedColumn])) {
                    const word = term.toLowerCase();
                    if (!links.has(word)) links.set(word, new Map());
                    const sources = links.get(word);
                    sources.set(key, sources.get(key) || current);
                }
            }
        });
        return rules.map(({ key, table, rows, maxRows, priority }, index) => {
            const matches = direct[index];
            if (!links.size) return { key, table, priority, matched: matches.length, rows: matches.slice(0, maxRows || undefined) };
            const seen = new Set(matches.map(row => row.index));
            const linked = rows.flatMap(({ row, keywords }, rowIndex) => {
                if (seen.has(rowIndex)) return [];
                const sources = keywords.flatMap(word => [...(links.get(word) || [])].filter(([source]) => source !== key));
                return sources.length ? [{ row, index: rowIndex, current: sources.some(([, current]) => current) }] : [];
            }).sort((a, b) => b.index - a.index);
            const ordered = [...matches.filter(row => row.current), ...linked.filter(row => row.current),
                ...matches.filter(row => !row.current), ...linked.filter(row => !row.current)];
            return { key, table, priority, matched: ordered.length, rows: ordered.slice(0, maxRows || undefined) };
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
