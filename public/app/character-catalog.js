// A successful HTTP response can still contain a transient empty catalogue.
// Never keep an empty result as a permanently loaded character library.
export class CharacterCatalog {
    constructor(api, { now = Date.now, pause = () => new Promise(resolve => setTimeout(resolve, 200)), timeout = () => AbortSignal.timeout(15000) } = {}) {
        Object.assign(this, { api, now, pause, timeout }); this.cache = null; this.pending = null; this.revision = 0;
    }
    invalidate() { this.cache = null; this.pending = null; this.revision++; }
    async load({ force = false, knownAvatar } = {}) {
        if (this.pending) return this.pending;
        if (!force && this.cache?.items.length && this.now() - this.cache.at < 30000) return this.cache.items;
        const revision = this.revision;
        const pending = this.fetch(knownAvatar).then(items => {
            if (revision !== this.revision) throw new DOMException('角色列表已更新，请重新读取。', 'AbortError');
            this.cache = { items, at: this.now() }; return items;
        }).finally(() => { if (this.pending === pending) this.pending = null; });
        this.pending = pending; return pending;
    }
    async read() {
        // A signal bypasses TavernAPI's short-lived response cache, so the
        // empty-result retry is an actual request and every read has a timeout.
        const items = await this.api.post('/api/characters/all', {}, { signal: this.timeout() });
        if (!Array.isArray(items) || items.some(item => !item || typeof item.avatar !== 'string' || !item.avatar || typeof item.name !== 'string' || !item.name)) throw Error('角色列表响应格式异常，请刷新列表重试。');
        return items;
    }
    async fetch(knownAvatar) {
        let items = await this.read();
        if (items.length) return items;
        await this.pause(); items = await this.read();
        if (!items.length && knownAvatar) {
            let exists = false;
            try {
                const card = await this.api.post('/api/characters/get', { avatar_url: knownAvatar }, { signal: this.timeout() });
                exists = !!(card?.name || card?.data?.name);
            } catch (error) { if (error.status !== 404) throw error; }
            if (exists) throw Error('角色列表暂时返回空数据，但当前角色仍存在。请点击重试读取角色列表。');
        }
        return items;
    }
}
