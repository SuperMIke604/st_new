const storageKey = 'independent-load-timings';
export class LoadTimings {
    constructor({ limit = 200, storage, now = () => performance.now(), date = () => new Date().toISOString(), logger = null } = {}) {
        this.limit = limit; this.storage = storage; this.now = now; this.date = date; this.logger = logger; this.sequence = 0;
        this.entries = []; this.pending = new Map();
        try {
            const saved = JSON.parse(storage?.getItem(storageKey) || '[]');
            if (Array.isArray(saved)) this.entries = saved.filter(entry => entry && typeof entry.label === 'string' && typeof entry.durationMs === 'number').slice(-limit).map(entry => ({ ...entry, status: entry.status === 'loading' ? 'interrupted' : entry.status }));
        } catch { /* Logging must never prevent the application from loading. */ }
        this.sequence = this.entries.reduce((last, entry) => Math.max(last, Number(entry.id) || 0), 0);
    }
    retain(entry) {
        if (!this.entries.includes(entry)) this.entries.push(entry);
        while (this.entries.length > this.limit) { const removed = this.entries.shift(); this.pending.delete(removed); }
    }
    persist() {
        try { this.storage?.setItem(storageKey, JSON.stringify(this.snapshot())); } catch { /* Storage may be unavailable or full. */ }
    }
    start(label, kind = 'page') {
        const entry = { id: ++this.sequence, label, kind, startedAt: this.date(), durationMs: 0, status: 'loading' };
        const started = this.now(); this.pending.set(entry, started);
        this.retain(entry);
        this.persist();
        let finished = false;
        return (status = 'success') => {
            if (finished) return; finished = true;
            entry.durationMs = Math.max(0, Math.round((this.now() - started) * 10) / 10); entry.status = status;
            // Keep a long page/startup total even if many nested requests have
            // already displaced its initial pending record from the ring.
            this.pending.delete(entry); this.retain(entry); this.persist();
            this.logger?.info(`[加载耗时] ${label} · ${entry.durationMs} ms · ${status}`);
        };
    }
    async measure(label, kind, task) {
        const finish = this.start(label, kind);
        try { const result = await task(); finish(); return result; }
        catch (error) { finish(error?.name === 'AbortError' ? 'cancelled' : 'error'); throw error; }
    }
    snapshot() {
        return this.entries.map(entry => ({ ...entry, ...(this.pending.has(entry) ? { durationMs: Math.max(0, Math.round((this.now() - this.pending.get(entry)) * 10) / 10) } : {}) }));
    }
    clear() { this.entries = []; this.pending.clear(); this.persist(); }
}
let storage;
try { storage = globalThis.sessionStorage; } catch { /* Restricted storage. */ }
export const loadTimings = new LoadTimings({ storage, logger: typeof window === 'undefined' ? null : console });
globalThis.addEventListener?.('pagehide', () => loadTimings.persist());

export async function timedFetch(path, options) {
    // Only the endpoint path is logged: query values and request/response bodies
    // can contain user data, prompts or credentials and never enter this log.
    const label = String(path).split('?')[0];
    const finish = loadTimings.start(label, 'request');
    try {
        const response = await fetch(path, options); finish(response.ok ? 'success' : 'error'); return response;
    } catch (error) { finish(error?.name === 'AbortError' ? 'cancelled' : 'error'); throw error; }
}
