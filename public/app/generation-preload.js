import { databaseSettings, databaseForChat, referenceDatabaseText, sheetText } from './database.js';

export function generationDatabaseResources(chat, header, config) {
    const settings = databaseSettings(config);
    const database = databaseForChat(chat, header, settings.template).data;
    const tabledata = referenceDatabaseText(database, settings);
    const databaseMacros = { tabledata };
    for (const key of new Set([...Array.from({ length: 20 }, (_, index) => `sheet_${index}`), ...Object.keys(database).filter(key => key.startsWith('sheet_'))])) {
        databaseMacros[key] = database[key] ? sheetText(database, key, settings.summaryTableMaxEntries || 10) : '';
    }
    return { databaseText: settings.inject ? tabledata : '', databaseMacros };
}

// Only deterministic source data is cached. World activation, macros and exact
// context fitting still run with the current input when the user sends.
export class GenerationPreload {
    constructor(build) { this.build = build; this.entries = []; this.timer = null; }
    cancelScheduled() { clearTimeout(this.timer); this.timer = null; }
    invalidate() { this.cancelScheduled(); this.entries = []; }
    schedule(task) {
        this.cancelScheduled();
        this.timer = setTimeout(() => { this.timer = null; void task().catch(() => {}); }, 150);
    }
    get(chat, header, config) {
        const configKey = JSON.stringify(config || {});
        const seed = header?.chat_metadata?.independentDatabase?.seed;
        // Ignore a newly typed user turn: database snapshots belong to replies.
        const sources = chat.filter(message => !message.is_user).map(message => [message, message.mes, message.TavernDB_ACU_Data, message.extra?.independentDatabase]);
        const hit = this.entries.find(entry => entry.header === header && entry.seed === seed && entry.configKey === configKey && entry.sources.length === sources.length && sources.every((source, i) => source.every((value, j) => value === entry.sources[i][j])));
        if (hit) return hit.value;
        const value = this.build(chat, header, config);
        this.entries.unshift({ header, seed, configKey, sources, value });
        this.entries.length = Math.min(this.entries.length, 2);
        return value;
    }
}
