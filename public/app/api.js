import { timedFetch, loadTimings } from './load-timings.js';
import { prepareChatSaveBody } from './chat-save-body.js';
export class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
}

/** All model requests stay behind SillyTavern; API keys never enter browser storage. */
export class TavernAPI {
    constructor() { this.readCache = new Map(); this.csrf = ''; this.saveQueue = Promise.resolve(); }
    async connect() {
        const response = await timedFetch('/csrf-token', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new ApiError('无法连接酒馆，请检查后端是否启动。', response.status);
        this.csrf = (await response.json()).token || '';
    }
    async response(path, data = {}, { signal, form = false, fallbackStatuses = [], serializedBody, contentEncoding, timing } = {}) {
        const response = await timedFetch(path, {
            method: 'POST', credentials: 'same-origin', signal,
            headers: { 'X-CSRF-Token': this.csrf, ...(form ? {} : { 'Content-Type': 'application/json' }), ...(contentEncoding ? { 'Content-Encoding': contentEncoding } : {}) },
            body: form ? data : serializedBody ?? JSON.stringify(data),
        }, { fallbackStatuses, timing });
        if (response.redirected && response.url.includes('/login')) throw new ApiError('请先在原生页面登录，再重新打开 /app/。', 401);
        if (!response.ok) {
            const raw = await response.text();
            let message;
            try { const body = JSON.parse(raw); message = body.message || body.error?.message || body.error; } catch { /* plain HTTP error */ }
            throw new ApiError(typeof message === 'string' ? message : `请求失败（${response.status}）${response.status === 403 ? '，请刷新页面重新认证' : ''}`, response.status);
        }
        return response;
    }
    async post(path, data = {}, options) {
        const catalogRoute = { '/api/characters/all': '/api/plugins/st-new-updater/characters', '/api/worldinfo/list': '/api/plugins/st-new-updater/worlds' }[path];
        if (catalogRoute && !this.missingCatalogRoutes?.has(catalogRoute)) {
            try { return await this.post(catalogRoute, data, { ...options, fallbackStatuses: [404] }); }
            catch (error) {
                if (error.status !== 404) throw error;
                (this.missingCatalogRoutes ||= new Set()).add(catalogRoute);
            }
        }
        const timing = options?.timing, label = String(path).split('?')[0];
        const reads = ['/api/settings/get', '/api/avatars/get', '/api/characters/all', '/api/characters/get', '/api/worldinfo/list', '/api/worldinfo/get', '/api/plugins/st-new-updater/characters', '/api/plugins/st-new-updater/worlds'];
        const cacheable = reads.includes(path) && !options?.signal;
        const key = cacheable ? path + JSON.stringify(data) : null;
        const hit = this.readCache.get(key);
        if (cacheable && hit && hit.expires > Date.now()) {
            const sharedRequest = hit.resolved ? 0 : 1;
            const read = async () => structuredClone(await hit.promise);
            return timing ? timing.measure(`${label} · 复用读取缓存`, 'data', read, () => ({ metrics: { cacheHit: 1, sharedRequest } })) : read();
        }
        if (!cacheable && !path.includes('/tokenizers/') && !path.includes('/generate')) this.readCache.clear();
        const load = async () => {
            const response = await this.response(path, data, options);
            const text = timing ? await timing.measure(`${label} · 接收响应体`, 'data', () => response.text(), value => ({ metrics: { responseChars: value.length } })) : await response.text();
            if (!text) return null;
            const parse = () => { try { return JSON.parse(text); } catch { return text; } };
            return timing ? timing.measureSync(`${label} · 解析响应`, 'data', parse) : parse();
        };
        const promise = load();
        if (cacheable) { const entry = { promise, resolved: false, expires: Date.now() + (path.startsWith('/api/worldinfo/') || path.endsWith('/worlds') ? 60000 : 5000) }; this.readCache.set(key, entry); promise.then(() => { entry.resolved = true; }, () => { if (this.readCache.get(key) === entry) this.readCache.delete(key); }); }
        const value = await promise;
        return timing ? timing.measureSync(`${label} · 复制响应数据`, 'data', () => structuredClone(value)) : structuredClone(value);
    }
    async settings() {
        const bundle = await this.post('/api/settings/get');
        return { bundle, settings: typeof bundle.settings === 'string' ? JSON.parse(bundle.settings) : bundle.settings };
    }
    async bootstrapSettings() {
        try {
            const bundle = await this.post('/api/plugins/st-new-updater/bootstrap', {}, { signal: AbortSignal.timeout(15000), fallbackStatuses: [404] });
            return { bundle, settings: typeof bundle.settings === 'string' ? JSON.parse(bundle.settings) : bundle.settings };
        } catch (error) { if (error.status !== 404) throw error;
            const bundle = await this.post('/api/settings/get', {}, { signal: AbortSignal.timeout(15000) });
            return { bundle, settings: typeof bundle.settings === 'string' ? JSON.parse(bundle.settings) : bundle.settings }; }
    }
    async loadConnections() {
        const response = await timedFetch('/user/files/independent-frontend-connections.json', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) }, { fallbackStatuses: [404], fallbackReason: 'missing-configuration' });
        if (response.status === 404) return null;
        if (!response.ok) throw new ApiError('无法读取连接配置，已停止载入，避免回退地址。', response.status);
        try { return await response.json(); } catch { throw new Error('连接配置文件损坏，请恢复备份，未使用默认地址覆盖。'); }
    }
    async saveConnections(data) {
        const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
        const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
        const result = await this.post('/api/files/upload', { name: 'independent-frontend-connections.json', data: encoded });
        if (!result?.path) throw new Error('连接配置保存失败。');
    }
    async loadPresetSelection() {
        const response = await timedFetch('/user/files/independent-frontend-preset.json', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) }, { fallbackStatuses: [404], fallbackReason: 'missing-configuration' });
        if (response.status === 404) return null;
        if (!response.ok) throw new ApiError('无法读取服务端预设选择，请重试', response.status);
        const value = await response.json();
        if (value?.version !== 1 || typeof value.name !== 'string' || !value.name.trim()) throw Error('服务端预设选择文件损坏，请重新选择并保存预设');
        return value;
    }
    async savePresetSelection(value) {
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        const result = await this.post('/api/files/upload', { name: 'independent-frontend-preset.json', data: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')) });
        if (!result?.path) throw Error('预设选择未保存');
        const saved = await this.loadPresetSelection();
        if (saved?.name !== value.name) throw Error('预设选择保存核验失败，请重试');
    }
    // The native endpoint replaces the entire settings file. Read fresh and patch
    // only owned fields, serializing writes so UI operations cannot race.
    patchSettings(patch) {
        const task = this.saveQueue.catch(() => {}).then(async () => {
            this.readCache.clear();
            const { settings } = await this.settings();
            patch(settings);
            const result = await this.post('/api/settings/save', settings);
            if (result?.result !== 'ok') throw new Error('设置未保存，请重试。');
            return settings;
        });
        this.saveQueue = task;
        return task;
    }
    async saveChat(avatar, file, header, messages) {
        const payload = { avatar_url: avatar, file_name: file, chat: [header, ...messages] };
        const json = loadTimings.measureSync('聊天保存 JSON 序列化', 'generation', () => JSON.stringify(payload));
        const finishCompression = loadTimings.start('准备聊天保存传输', 'generation');
        let prepared;
        try { prepared = await prepareChatSaveBody(json, { compress: this.chatCompression !== false }); finishCompression('success', { metrics: prepared.metrics }); }
        catch (error) { finishCompression('error'); throw error; }
        for (let attempt = 0; ; attempt++) {
            try { const result = await this.post('/api/chats/save', payload, { serializedBody: prepared.body, ...(prepared.metrics.gzip ? { contentEncoding: 'gzip', fallbackStatuses: [415] } : {}) }); if (!result?.ok) throw new Error('聊天保存失败。'); return; }
            catch (error) {
                if (error.status === 415 && prepared.metrics.gzip) {
                    this.chatCompression = false;
                    prepared = { ...prepared, body: prepared.plainBody, metrics: { ...prepared.metrics, gzip: 0, transferBytes: prepared.metrics.payloadBytes, compressionFallback: 1 } };
                    loadTimings.start('聊天保存压缩兼容回退', 'generation')('fallback', { httpStatus: 415, reason: 'compatibility', metrics: prepared.metrics });
                    attempt--; continue;
                }
                if (error.status !== 500 || attempt >= 3) throw error;
                await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
            }
        }
    }
}

/** SSE parser supports fragmented UTF-8, CRLF, multiline events and JSON errors. */
export async function* readEvents(response) {
    if (!response.body) throw new Error('浏览器没有收到回复流。');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let data = [];
    function parse(lines) {
        if (!lines.length) return null;
        const text = lines.join('\n');
        if (text === '[DONE]') return { done: true };
        try { return JSON.parse(text); } catch { throw new Error('模型返回了无法解析的流式数据。'); }
    }
    try {
        while (true) {
            const chunk = await reader.read();
            buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
            let index;
            while ((index = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, index).replace(/\r$/, '');
                buffer = buffer.slice(index + 1);
                if (!line) {
                    const event = parse(data); data = [];
                    if (event?.done) return;
                    if (event) yield event;
                } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
            }
            if (chunk.done) break;
        }
        if (buffer.startsWith('data:')) data.push(buffer.slice(5).trim());
        const last = parse(data);
        if (last && !last.done) yield last;
    } finally { reader.releaseLock(); }
}
