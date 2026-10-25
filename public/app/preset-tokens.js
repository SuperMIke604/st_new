import { expand, activateWorlds, copyVariableState } from './engine.js';
import { applyRegex, activeRegexes } from './regex.js';
import { MESSAGE_VARIABLES, messageVariableContext } from './variable-macros.js';
import { databaseSettings, databaseForChat, referenceDatabaseText, sheetText } from './database.js';

function check(signal) { if (signal.aborted) throw new DOMException('预设计数已取消', 'AbortError'); }
const yieldTask = async signal => { check(signal); await new Promise(resolve => setTimeout(resolve, 0)); check(signal); };

// Keep exact counts only; never persist prompt text or approximate token counts.
export class TokenCountCache {
    constructor(maxChars = 2000000, maxEntries = 128) { this.maxChars = maxChars; this.maxEntries = maxEntries; this.entries = new Map(); this.chars = 0; }
    get(key) {
        if (!this.entries.has(key)) return undefined;
        const value = this.entries.get(key); this.entries.delete(key); this.entries.set(key, value); return value;
    }
    set(key, value) {
        if (key.length > this.maxChars) return;
        if (this.entries.has(key)) { this.chars -= key.length; this.entries.delete(key); }
        this.entries.set(key, value); this.chars += key.length;
        while (this.chars > this.maxChars || this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value; this.entries.delete(oldest); this.chars -= oldest.length;
        }
    }
}
const sharedCounts = new TokenCountCache();

export class PresetTokenPreview {
    constructor({ api, model, character, persona, preset, chat, header, settings, databaseConfig, loadBooks, cache = sharedCounts, readDatabase, concurrency = 2 }) {
        Object.assign(this, { api, model: model || 'gpt-4', character, persona, preset, header, settings, databaseConfig, loadBooks, cache, concurrency });
        this.chat = [...chat]; this.controller = new AbortController(); this.signal = this.controller.signal;
        this.jobs = []; this.active = 0; this.started = false; this.timer = null; this.pending = new Map(); this.databaseText = new Map();
        this.readDatabase = readDatabase || (() => databaseForChat(this.chat, this.header, databaseSettings(databaseConfig).template).data);
        this.rules = activeRegexes({ settings, preset, character });
    }
    start() { this.started = true; this.pump(); }
    dispose() {
        this.controller.abort(); clearTimeout(this.timer); this.timer = null;
        for (const job of this.jobs.splice(0)) job.reject(new DOMException('预设计数已取消', 'AbortError'));
    }
    pump() {
        if (!this.started || this.signal.aborted || this.timer !== null || !this.jobs.length || this.active >= this.concurrency) return;
        this.timer = setTimeout(() => {
            this.timer = null; if (this.signal.aborted) return;
            const job = this.jobs.shift(); this.active++;
            // One job per browser task lets input/paint run between CPU work.
            Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { this.active--; this.pump(); });
            this.pump();
        }, 0);
    }
    database() {
        check(this.signal);
        return this.databaseValue ||= this.readDatabase();
    }
    databaseMacro(key) {
        if (!this.databaseText.has(key)) {
            const data = this.database();
            this.databaseText.set(key, key === 'tabledata' ? referenceDatabaseText(data, databaseSettings(this.databaseConfig)) : data[key] ? sheetText(data, key, this.databaseConfig?.summaryTableMaxEntries || 10) : '');
        }
        return this.databaseText.get(key);
    }
    variables() {
        const card = this.character?.data || this.character;
        const base = { [MESSAGE_VARIABLES]: messageVariableContext(this.chat, this.header?.chat_metadata?.independentMvuSeed), char: this.character?.name || '', user: this.persona.name, description: card?.description || '', personality: card?.personality || '', scenario: card?.scenario || '', persona: this.persona.description };
        const known = key => key === 'tabledata' || /^sheet_(?:\d|1\d)$/.test(key);
        const custom = key => /^sheet_[\w-]+$/.test(key) && Object.hasOwn(this.database(), key);
        // Database extraction is lazy: {{char}} and {{getvar}} alone must not
        // scan hundreds of messages or serialize every database sheet.
        return new Proxy(base, {
            getOwnPropertyDescriptor: (target, key) => typeof key === 'string' && (known(key) || custom(key)) ? { configurable: true, enumerable: true, get: () => this.databaseMacro(key) } : Reflect.getOwnPropertyDescriptor(target, key),
            get: (target, key) => typeof key === 'string' && (known(key) || custom(key)) ? this.databaseMacro(key) : Reflect.get(target, key),
        });
    }
    worlds() {
        return this.worldsPromise ||= (async () => {
            const books = await this.loadBooks(this.signal); check(this.signal);
            const variables = this.variables();
            const entries = activateWorlds(books, this.chat, this.settings, variables, Math.random, this.rules);
            return { entries, variables };
        })();
    }
    history() {
        return this.historyPromise ||= (async () => {
            const variables = this.variables(), messages = [];
            let sliceStarted = performance.now();
            for (let index = 0; index < this.chat.length; index++) {
                check(this.signal);
                const message = this.chat[index];
                const content = expand(applyRegex(message.mes || '', this.rules, message.is_user ? 1 : 2, { phase: 'prompt', depth: this.chat.length - index - 1, variables }), variables);
                if (content.trim()) messages.push({ role: message.is_user ? 'user' : 'assistant', content });
                if ((index + 1) % 10 === 0 || performance.now() - sliceStarted >= 8) {
                    await yieldTask(this.signal); sliceStarted = performance.now();
                }
            }
            return messages;
        })();
    }
    async messages(prompt) {
        check(this.signal);
        const card = this.character?.data || this.character;
        let value = prompt.content || '';
        if (prompt.marker) {
            const values = { personaDescription: this.persona.description, charDescription: card?.description, charPersonality: card?.personality, scenario: card?.scenario };
            if (['worldInfoBefore', 'worldInfoAfter'].includes(prompt.identifier)) {
                if (!this.character) return null;
                const { entries } = await this.worlds();
                value = entries.filter(entry => entry.position === (prompt.identifier === 'worldInfoBefore' ? 0 : 1)).map(entry => entry.content).join('\n');
            } else if (prompt.identifier === 'chatHistory') {
                return this.character ? this.history() : null;
            } else if (Object.hasOwn(values, prompt.identifier) && values[prompt.identifier] !== undefined) value = values[prompt.identifier] || '';
            else return null;
        }
        if (/{{/.test(value)) {
            const variables = this.variables();
            if (this.character && /{{\s*(?:getvar|setvar)::/i.test(value)) copyVariableState((await this.worlds()).variables, variables);
            value = expand(value, variables);
        }
        check(this.signal);
        return value ? [{ role: prompt.role || 'system', content: value }] : null;
    }
    count(prompt) {
        if (this.signal.aborted) return Promise.reject(new DOMException('预设计数已取消', 'AbortError'));
        const snapshot = { ...prompt };
        const promise = new Promise((resolve, reject) => this.jobs.push({ resolve, reject, run: async () => {
            check(this.signal);
            const messages = await this.messages(snapshot); check(this.signal); if (!messages) return null;
            const key = `${this.model}\n${JSON.stringify(messages)}`, cached = this.cache.get(key);
            if (cached !== undefined) return cached;
            if (!this.pending.has(key)) {
                const request = this.api.post(`/api/tokenizers/openai/count?model=${encodeURIComponent(this.model)}`, messages, { signal: this.signal }).then(result => {
                    check(this.signal);
                    if (!Number.isFinite(result?.token_count) || result.token_count < 0) throw new Error('无法统计预设条目 tokens');
                    this.cache.set(key, result.token_count); return result.token_count;
                }).finally(() => this.pending.delete(key));
                this.pending.set(key, request);
            }
            return this.pending.get(key);
        } }));
        this.pump(); return promise;
    }
}
