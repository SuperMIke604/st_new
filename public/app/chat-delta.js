export const chatLines = records => records.map(record => JSON.stringify(record));

async function revision(lines) {
    const text = lines.join('\n');
    const bytes = new TextEncoder().encode(text);
    if (globalThis.crypto?.subtle) {
        const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    const { sha256 } = await import('./vendor/sha256.min.js');
    return sha256(bytes);
}

export async function chatDelta(before, after, knownRevision) {
    if (before.length > after.length) return null;
    const patches = [];
    for (let index = 0; index < before.length; index++) {
        if (before[index] === after[index]) continue;
        const old = JSON.parse(before[index]), next = JSON.parse(after[index]);
        const remove = Object.keys(old).filter(key => !Object.hasOwn(next, key));
        const fields = Object.fromEntries(Object.entries(next).filter(([key, value]) =>
            !Object.hasOwn(old, key) || JSON.stringify(old[key]) !== JSON.stringify(value)));
        // The wire format preserves field order when updating a record.
        for (const key of remove) delete old[key];
        if (JSON.stringify({ ...old, ...fields }) !== after[index]) return null;
        patches.push({ index, fields, remove });
    }
    const append = after.slice(before.length).map(line => JSON.parse(line));
    if (patches.length > 500 || append.length > 20) return null;
    const baseRevision = knownRevision ?? revision(before);
    const [base, result] = await Promise.all([baseRevision, patches.length || append.length ? revision(after) : baseRevision]);
    return { base, result, patches, append };
}
