// Runs inside the opaque-origin preview. Only the owning message is exposed.
export function htmlCardContext(snapshot) {
    const memory = new Map();
    // UI libraries may probe storage even for a static form. Keep it local to
    // this isolated preview; never grant access to application/browser storage.
    try { Object.defineProperty(window, 'localStorage', { value: {
        getItem: key => memory.get(String(key)) ?? null,
        setItem: (key, value) => memory.set(String(key), String(value)),
        removeItem: key => memory.delete(String(key)), clear: () => memory.clear(),
        key: index => [...memory.keys()][index] ?? null, get length() { return memory.size; },
    } }); } catch {}
    const clone = value => JSON.parse(JSON.stringify(value));
    const helperReady = [];
    let helperLoaded = !snapshot.helper;
    const ready = callback => {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
        else queueMicrotask(callback);
    };
    window.getCurrentMessageId = () => snapshot.messageId;
    window.getChatMessages = id => Number(id) === snapshot.messageId ? [{
        message_id: snapshot.messageId, message: snapshot.message, name: snapshot.name, role: snapshot.role,
    }] : [];
    window.getCurrentBlockIndex = tag => snapshot.blockIndices?.[tag] ?? 0;
    window.getVariables = window.getAllVariables = () => clone(snapshot.variables || {});
    window.waitGlobalInitialized = async name => {
        if (name !== 'Mvu') throw Error(`HTML 展示页不支持等待全局变量 ${name}。`);
        if (!helperLoaded) await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('HTML 助手运行库加载超时。')), 15000);
            helperReady.push(() => { clearTimeout(timer); resolve(); });
        });
    };
    window.errorCatched = fn => function (...args) {
        const report = error => { console.error(error); window.alert(error.message || String(error)); };
        try { return Promise.resolve(fn.apply(this, args)).catch(report); } catch (error) { report(error); }
    };
    const events = new Map();
    window.eventOn = (event, fn) => { if (!events.has(event)) events.set(event, new Set()); events.get(event).add(fn); return () => events.get(event)?.delete(fn); };
    window.Mvu = { events: { VARIABLE_UPDATE_ENDED: 'mvu_update' }, getMvuData: () => clone(snapshot.variables || {}) };
    window._ = { get: (value, path, fallback) => {
        for (const key of String(path).replace(/\[(\d+)\]/g, '.$1').split('.')) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) return fallback;
            value = value?.[key];
        }
        return value === undefined ? fallback : value;
    } };
    // These imported beautifiers use jQuery only for its document-ready shorthand.
    window.$ = window.jQuery = callback => {
        if (typeof callback !== 'function') throw Error('此 HTML 展示页仅支持 $(初始化函数)。');
        if (helperLoaded) ready(callback); else helperReady.push(() => ready(callback));
    };
    let avatars = [];
    const image = name => {
        const row = avatars.find(item => item.键 === name || item.显示名 === name || item.别名?.includes(name));
        return row?.图片 || null;
    };
    window['头像库'] = Object.freeze({ '取图': image, '取主角图': () => image(snapshot.personaName) || image('主角') });
    addEventListener('message', event => {
        if (event.source === parent && event.data?.type === 'tavern-html-variables' && snapshot.helper) {
            snapshot.variables = event.data.variables || {};
            for (const fn of events.get('mvu_update') || []) window.errorCatched(fn)();
            return;
        }
        if (event.source === parent && event.data?.type === 'tavern-html-helper' && snapshot.helper && !helperLoaded) {
            if (event.data.error) { window.alert(event.data.error); return; }
            const script = document.createElement('script'); script.textContent = event.data.jquery; document.head.append(script);
            if (event.data.variables) snapshot.variables = event.data.variables;
            helperLoaded = true;
            helperReady.splice(0).forEach(callback => callback());
            return;
        }
        if (event.source !== parent || event.data?.type !== 'tavern-html-avatars' || !Array.isArray(event.data.records)) return;
        avatars = event.data.records;
        document.dispatchEvent(new CustomEvent('头像库更新'));
        if (document.querySelector('[data-fate-marker]') && typeof window.init === 'function') ready(() => window.init());
    });
    ready(() => {
        // Native parent/frameElement access intentionally remains isolated.
        if (document.querySelector('[data-fate-marker]') && typeof window.getMyIndex === 'function') {
            window.getMyIndex = () => window.getCurrentBlockIndex('fate_ui');
        }
    });
}

export function cardContextScript(snapshot) {
    const json = JSON.stringify(snapshot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return `<script>(${htmlCardContext.toString()})(${json});<\/script>`;
}
