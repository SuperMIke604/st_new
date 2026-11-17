import { databaseSettings, databaseForChat, referenceDatabaseText, sheetText } from './database.js';
import { prepareDatabaseInjection } from './database-injection.js';

export function prepareDatabaseResources(chat, header, config) {
    const settings = databaseSettings(config);
    const database = databaseForChat(chat, header, settings.template).data;
    const filter = prepareDatabaseInjection(database, settings.template, header);
    const keys = new Set([...Array.from({ length: 20 }, (_, index) => `sheet_${index}`), ...Object.keys(database).filter(key => key.startsWith('sheet_'))]);
    const tabledata = referenceDatabaseText(database, settings);
    const databaseMacros = { tabledata };
    for (const key of keys) databaseMacros[key] = database[key] ? sheetText(database, key, settings.summaryTableMaxEntries || 10) : '';
    if (!filter) return { databaseText: settings.inject ? tabledata : '', databaseMacros };
    return currentChat => {
        const selected = filter(currentChat);
        const databaseText = settings.inject && Object.keys(selected).some(key => key.startsWith('sheet_')) ? referenceDatabaseText(selected, settings) : '';
        const selectedMacros = { ...databaseMacros };
        for (const key of keys) {
            if (selected[key] !== database[key]) selectedMacros[key] = sheetText(selected, key, settings.summaryTableMaxEntries || 10);
        }
        return { databaseText, databaseMacros: selectedMacros };
    };
}

export function generationDatabaseResources(chat, header, config) {
    const prepared = prepareDatabaseResources(chat, header, config);
    return typeof prepared === 'function' ? prepared(chat) : prepared;
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
    get(chat, header, config, { warm = false } = {}) {
        const configKey = JSON.stringify(config || {});
        const { seed, history, blockedKeywords } = header?.chat_metadata?.independentDatabase || {};
        const archives = Array.isArray(history) ? history.map(item => [item, chat[item?.index]]) : [];
        // Ignore a newly typed user turn: database snapshots belong to replies.
        const sources = chat.filter(message => !message.is_user).map(message => [message, message.mes, message.TavernDB_ACU_Data, message.extra?.independentDatabase]);
        const matches = (current, cached) => current.length === cached.length && current.every((source, i) => source.every((value, j) => value === cached[i][j]));
        let entry = this.entries.find(entry => entry.header === header && entry.seed === seed && entry.blockedKeywords === blockedKeywords && entry.configKey === configKey && matches(sources, entry.sources) && matches(archives, entry.archives));
        if (!entry) {
            entry = { header, seed, blockedKeywords, configKey, sources, archives, value: this.build(chat, header, config) };
            this.entries.unshift(entry);
            this.entries.length = Math.min(this.entries.length, 2);
        }
        if (typeof entry.value !== 'function') return entry.value;
        if (!warm) return entry.value(chat);
    }
}
