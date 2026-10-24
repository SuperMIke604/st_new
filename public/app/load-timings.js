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
        return (status = 'success', details = {}) => {
            if (finished) return; finished = true;
            entry.durationMs = Math.max(0, Math.round((this.now() - started) * 10) / 10); entry.status = status;
            if (Number.isInteger(details.httpStatus) && details.httpStatus >= 100 && details.httpStatus <= 599) entry.httpStatus = details.httpStatus;
            if (['http-error', 'network', 'timeout', 'aborted', 'navigation', 'compatibility', 'missing-configuration'].includes(details.reason)) entry.reason = details.reason;
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
let leavingPage = false;
globalThis.addEventListener?.('pagehide', () => { leavingPage = true; loadTimings.persist(); });
globalThis.addEventListener?.('pageshow', () => { leavingPage = false; });

export function requestFailure(error, signal, leaving = false) {
    if (error?.name === 'TimeoutError' || (signal?.aborted && signal.reason?.name === 'TimeoutError')) return { status: 'error', reason: 'timeout' };
    if (leaving) return { status: 'interrupted', reason: 'navigation' };
    if (error?.name === 'AbortError' || signal?.aborted) return { status: 'cancelled', reason: 'aborted' };
    return { status: 'error', reason: 'network' };
}
export function timingStatusText(entry) {
    return ({ loading: '加载中', success: '完成', fallback: '兼容回退', partial: '部分失败', error: '失败', cancelled: '已取消', interrupted: '刷新中断' })[entry.status] || entry.status;
}
export function timingDetailText(entry) {
    const http = entry.httpStatus ? `HTTP ${entry.httpStatus}` : '';
    const reasons = {
        compatibility: '可选接口不可用，使用兼容接口',
        'missing-configuration': '配置文件尚不存在，使用初始化流程',
        'http-error': ({ 401: '尚未登录', 403: '认证失败，请刷新后重试', 404: '接口不存在', 429: '请求过于频繁', 500: '服务端处理失败', 503: '服务暂不可用' })[entry.httpStatus] || '接口返回错误状态',
        network: '网络请求失败，未收到 HTTP 响应', timeout: '请求超时', aborted: '请求已取消', navigation: '刷新或离开页面',
    };
    if (entry.reason) return [http, reasons[entry.reason]].filter(Boolean).join(' · ');
    if (entry.status === 'cancelled') return entry.kind === 'page' ? '页面已切换或关闭' : '任务已取消';
    if (entry.status === 'interrupted') return '刷新或离开页面';
    if (entry.status === 'error' && !http) return '旧记录未保存状态码或原因';
    return http;
}

export async function timedFetch(path, options, { fallbackStatuses = [], fallbackReason = 'compatibility' } = {}) {
    // Only the endpoint path is logged: query values and request/response bodies
    // can contain user data, prompts or credentials and never enter this log.
    const label = String(path).split('?')[0];
    const finish = loadTimings.start(label, 'request');
    try {
        const response = await fetch(path, options);
        const fallback = !response.ok && fallbackStatuses.includes(response.status);
        finish(response.ok ? 'success' : fallback ? 'fallback' : 'error', { httpStatus: response.status, ...(!response.ok ? { reason: fallback ? fallbackReason : 'http-error' } : {}) });
        return response;
    } catch (error) {
        const failure = requestFailure(error, options?.signal, leavingPage); finish(failure.status, failure); throw error;
    }
}
