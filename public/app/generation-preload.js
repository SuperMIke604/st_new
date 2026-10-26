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
    constructor(build) { this.build = build; this.entries = []; this.timer = null; this.latest = null; this.active = null; this.startedTasks = 0; this.mergedTriggers = 0; this.cancelledTasks = 0; }
    stats() { return { startedTasks: this.startedTasks, mergedTriggers: this.mergedTriggers, cancelledTasks: this.cancelledTasks, activeTasks: this.active ? 1 : 0 }; }
    cancelScheduled(reason = 'preload-cancelled') {
        clearTimeout(this.timer); this.timer = null;
        if (this.latest && !this.latest.done && !this.latest.controller.signal.aborted) { this.latest.controller.abort(reason); this.cancelledTasks++; }
        this.latest = null;
    }
    invalidate() { this.cancelScheduled(); this.entries = []; }
    schedule(task, key = [task]) {
        if (this.latest && !this.latest.controller.signal.aborted && key.length === this.latest.key.length && key.every((value, index) => value === this.latest.key[index])) { this.mergedTriggers++; this.latest.merged++; return; }
        this.cancelScheduled();
        const token = { key, controller: new AbortController(), merged: 0, done: false };
        this.latest = token;
        this.timer = setTimeout(() => {
            this.timer = null;
            const previous = this.active;
            const running = (async () => {
                // A superseded task must leave its next yield before replacement
                // starts; otherwise several scans contend for one cache/thread.
                await previous;
                if (token.controller.signal.aborted) return;
                this.startedTasks++;
                try { const reusable = await task(token.controller.signal, () => ({ mergedTriggers: token.merged })); if (reusable !== true && this.latest === token) this.latest = null; }
                finally { token.done = true; }
            })().catch(() => { if (this.latest === token) this.latest = null; });
            this.active = running;
            void running.finally(() => { if (this.active === running) this.active = null; });
        }, 150);
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
