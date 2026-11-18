import { PresetTokenPreview, TokenCountCache } from './preset-tokens.js';
import { activeRegexes } from './regex.js';
import { BUILD } from './version.js';

const cacheKey = `independent-preset-token-counts-v1:${BUILD.revision}`;
const cacheLifetime = 15 * 60_000;
const cacheLimit = 128;

class SessionTokenCounts {
    constructor() {
        this.entries = new Map();
        try {
            const saved = JSON.parse(sessionStorage.getItem(cacheKey) || '[]');
            for (const [digest, count, expires] of saved.slice(-cacheLimit)) {
                if (typeof digest === 'string' && Number.isFinite(count) && count >= 0 && expires > Date.now()) {
                    this.entries.set(digest, [digest, count, expires]);
                }
            }
        } catch { /* Session storage is optional. */ }
        globalThis.addEventListener?.('pagehide', () => {
            if (this.timer !== undefined) this.flush();
        });
    }
    get(digest) {
        const entry = this.entries.get(digest);
        if (entry && entry[2] > Date.now()) return entry[1];
    }
    set(digest, count) {
        this.entries.delete(digest);
        this.entries.set(digest, [digest, count, Date.now() + cacheLifetime]);
        while (this.entries.size > cacheLimit) this.entries.delete(this.entries.keys().next().value);
        if (this.timer === undefined) this.timer = setTimeout(() => this.flush(), 250);
    }
    flush() {
        clearTimeout(this.timer);
        this.timer = undefined;
        try { sessionStorage.setItem(cacheKey, JSON.stringify([...this.entries.values()])); }
        catch { /* The in-memory cache still works. */ }
    }
}

let sessionCounts;
const tokenizerStartup = new Map();
const literalPreviewCounts = new TokenCountCache();
const contextualPreviewCounts = new WeakMap();

function contextualCounts(options) {
    const { cacheRevision, chat, header, model, persona, character, settings, databaseConfig, preset } = options;
    if (!cacheRevision) return;
    const card = character?.data || character;
    const signature = JSON.stringify([
        model, persona.name, persona.description, character?.name, card?.description, card?.personality, card?.scenario,
        activeRegexes(options), settings?.world_info_settings, databaseConfig,
        Number(databaseConfig?.keywordInjectionTokens) > 0 ? preset : null,
    ]);
    if (signature.length > 2_000_000) return;
    const previous = contextualPreviewCounts.get(chat);
    if (previous?.revision === cacheRevision && previous.header === header && previous.character === character
        && previous.signature === signature && previous.expires > Date.now()) return previous.counts;
    const counts = new TokenCountCache();
    contextualPreviewCounts.set(chat, { revision: cacheRevision, header, character, signature, counts, expires: Date.now() + cacheLifetime });
    return counts;
}

async function countNative(api, path, serializedBody, signal) {
    // SillyTavern can load the same tokenizer twice if cold requests overlap.
    for (let startup; (startup = tokenizerStartup.get(path)); ) {
        await startup;
        signal.throwIfAborted();
    }
    const response = api.post(path, undefined, { signal, serializedBody });
    if (!tokenizerStartup.has(path)) {
        const startup = response.then(result => {
            if (signal.aborted || !Number.isFinite(result?.token_count) || result.token_count < 0) {
                tokenizerStartup.delete(path);
                return;
            }
            tokenizerStartup.set(path, null);
        }, () => tokenizerStartup.delete(path));
        tokenizerStartup.set(path, startup);
    }
    return response;
}

export class PresetTokenClient {
    constructor(options) {
        this.options = options;
        this.controller = new AbortController();
        this.signal = this.controller.signal;
        this.jobs = new Map();
        this.requests = new Map();
        this.nextJob = 0;
    }
    start() {
        this.started = true;
        this.startPending();
    }
    startPending() {
        if (!this.started || this.signal.aborted || this.worker || this.local || !this.jobs.size) return;
        const { api, loadBooks, cacheRevision, ...options } = this.options;
        try {
            const worker = this.worker = new Worker(new URL('./preset-token-worker.js', import.meta.url), { type: 'module' });
            worker.onmessage = event => { if (this.worker === worker) void this.receive(worker, event.data); };
            worker.onerror = () => this.startLocal();
            worker.onmessageerror = () => this.startLocal();
            worker.postMessage({ type: 'start', options });
            for (const [id, { prompt }] of this.jobs) worker.postMessage({ type: 'count', id, prompt });
        } catch {
            this.startLocal();
        }
    }
    previewCounts() {
        const options = this.options;
        const contextual = contextualCounts(options);
        const card = options.character?.data || options.character;
        const worldMacro = /{{\s*(?:getvar|setvar)::/i;
        const markersUseWorldMacros = [options.persona.description, card?.description, card?.personality, card?.scenario].some(text => worldMacro.test(text || ''));
        const literal = prompt => !prompt.marker && !String(prompt.content || '').includes('{{');
        const cacheFor = prompt => literal(prompt) ? literalPreviewCounts : contextual;
        const key = prompt => JSON.stringify(literal(prompt)
            ? [options.model, prompt.role, prompt.content]
            : [prompt.identifier, prompt.marker, prompt.role, prompt.content]);
        return {
            get: prompt => cacheFor(prompt)?.get(key(prompt)),
            set: (prompt, count) => cacheFor(prompt)?.set(key(prompt), count),
            // External reads and probabilistic activations can change without a local chat save.
            recheck: prompt => !literal(prompt) && !!options.character && (
                ['worldInfoBefore', 'worldInfoAfter'].includes(prompt.identifier)
                || worldMacro.test(prompt.content || '')
                || (prompt.marker && prompt.identifier !== 'chatHistory' && markersUseWorldMacros)
                || Number(options.databaseConfig?.keywordInjectionTokens) > 0
            ),
        };
    }
    startLocal() {
        if (this.signal.aborted || this.local) return;
        this.stopWorker();
        const local = this.local = new PresetTokenPreview(this.options);
        for (const { prompt, resolve, reject } of this.jobs.values()) local.count(prompt).then(resolve, reject);
        this.jobs.clear();
        local.start();
    }
    stopWorker() {
        this.worker?.terminate();
        this.worker = null;
        for (const controller of this.requests.values()) controller.abort();
        this.requests.clear();
    }
    invalidatePromptCounts() {
        this.local?.invalidatePromptCounts();
        this.worker?.postMessage({ type: 'invalidate', preset: this.options.preset });
    }
    dispose() {
        this.controller.abort();
        this.stopWorker();
        this.local?.dispose();
        for (const { reject } of this.jobs.values()) reject(this.signal.reason);
        this.jobs.clear();
        if (sessionCounts?.timer !== undefined) sessionCounts.flush();
    }
    count(prompt) {
        if (this.signal.aborted) return Promise.reject(this.signal.reason);
        if (this.local) return this.local.count(prompt);
        return new Promise((resolve, reject) => {
            const id = ++this.nextJob;
            this.jobs.set(id, { prompt: { ...prompt }, resolve, reject });
            if (this.worker) this.worker.postMessage({ type: 'count', id, prompt });
            else this.startPending();
        });
    }
    async receive(worker, { type, id, path, body, digest, result, error }) {
        if (type === 'counted') {
            const job = this.jobs.get(id);
            if (!job) return;
            this.jobs.delete(id);
            if (error) job.reject(error);
            else job.resolve(result);
            return;
        }
        if (type === 'abort') {
            this.requests.get(id)?.abort();
            return;
        }
        if (type !== 'books' && type !== 'tokenize') return;
        const controller = new AbortController();
        this.requests.set(id, controller);
        try {
            const signal = controller.signal;
            if (type === 'books') result = await this.options.loadBooks(signal);
            else if (type === 'tokenize') {
                const cache = sessionCounts ||= new SessionTokenCounts();
                const count = digest && cache.get(digest);
                if (count !== undefined) result = { token_count: count };
                else {
                    result = await countNative(this.options.api, path, body, signal);
                    signal.throwIfAborted();
                    if (digest && Number.isFinite(result?.token_count) && result.token_count >= 0) cache.set(digest, result.token_count);
                }
            }
            if (this.worker === worker && !signal.aborted) worker.postMessage({ type: 'response', id, result });
        } catch (error) {
            if (this.worker === worker && !controller.signal.aborted) worker.postMessage({ type: 'response', id, error });
        } finally {
            this.requests.delete(id);
        }
    }
}
