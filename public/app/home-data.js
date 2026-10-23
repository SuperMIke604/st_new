// Home requests have their own lifecycle; connection initialization never gates them.
export class RecentCharacters {
    constructor(api) { this.api = api; this.cache = null; this.pending = null; }
    invalidate() { this.cache = null; }
    async load() {
        if (this.cache && Date.now() - this.cache.at < 30000) return this.cache.items;
        if (this.pending) return this.pending;
        this.pending = this.fetch().then(items => {
            if (!Array.isArray(items)) throw Error('最近角色响应格式异常');
            this.cache = { at: Date.now(), items }; return items;
        }).finally(() => { this.pending = null; });
        return this.pending;
    }
    async fetch() {
        try { return await this.api.post('/api/plugins/st-new-updater/recent', {}, { signal: AbortSignal.timeout(10000) }); }
        catch (error) {
            if (error.status !== 404) throw error;
            return this.api.post('/api/chats/recent', { max: 12 }, { signal: AbortSignal.timeout(15000) });
        }
    }
}
