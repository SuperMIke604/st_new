// A successful HTTP response can still contain a transient empty catalogue.
// Never keep an empty result as a permanently loaded character library.
export class CharacterCatalog {
    constructor(api, { now = Date.now, pause = () => new Promise(resolve => setTimeout(resolve, 200)), timeout = () => AbortSignal.timeout(15000) } = {}) {
        Object.assign(this, { api, now, pause, timeout }); this.cache = null; this.pending = null; this.revision = 0;
    }
    invalidate() { this.cache = null; this.pending = null; this.revision++; }
    async load({ force = false, knownAvatar, timing, allowStale = false } = {}) {
        if (this.pending) return timing ? timing.measure('角色目录 · 等待共享读取', 'data', () => this.pending, () => ({ metrics: { cacheHit: 1, sharedRequest: 1 } })) : this.pending;
        if (!force && this.cache?.items.length && (allowStale || this.now() - this.cache.at < 30000)) {
            timing?.start('角色目录 · 命中内存缓存', 'data')('success', { itemCount: this.cache.items.length, metrics: { cacheHit: 1 } });
            return this.cache.items;
        }
        const revision = this.revision;
        const pending = this.fetch(knownAvatar, timing).then(items => {
            if (revision !== this.revision) throw new DOMException('角色列表已更新，请重新读取。', 'AbortError');
            this.cache = { items, at: this.now() }; return items;
        }).finally(() => { if (this.pending === pending) this.pending = null; });
        this.pending = pending; return pending;
    }
    async read(timing) {
        // A signal bypasses TavernAPI's short-lived response cache, so the
        // empty-result retry is an actual request and every read has a timeout.
        const items = await this.api.post('/api/characters/all', {}, { signal: this.timeout(), timing });
        if (!Array.isArray(items) || items.some(item => !item || typeof item.avatar !== 'string' || !item.avatar || typeof item.name !== 'string' || !item.name)) throw Error('角色列表响应格式异常，请刷新列表重试。');
        return items;
    }
    async fetch(knownAvatar, timing) {
        let items = await this.read(timing);
        if (items.length) return items;
        if (timing) await timing.measure('角色目录 · 空结果重试等待', 'data', () => this.pause()); else await this.pause(); items = await this.read(timing);
        if (!items.length && knownAvatar) {
            let exists = false;
            try {
                const card = await this.api.post('/api/characters/get', { avatar_url: knownAvatar }, { signal: this.timeout(), timing });
                exists = !!(card?.name || card?.data?.name);
            } catch (error) { if (error.status !== 404) throw error; }
            if (exists) {
                // Two empty HTTP 200 responses followed by a valid /get were
                // observed in real logs. A later fresh read recovered all cards.
                if (timing) await timing.measure('角色目录 · 空结果重试等待', 'data', () => this.pause()); else await this.pause(); items = await this.read(timing);
                if (!items.length) throw Object.assign(Error('角色列表暂时返回空数据，但当前角色仍存在。请点击重试读取角色列表。'), { reason: 'empty-character-list' });
            }
        }
        return items;
    }
}
