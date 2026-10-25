// This function is serialized into an opaque-origin iframe, never executed in
// the app window. All mutation requests are checked again by the host.
export function scriptBridge(initial) {
    let snapshot = initial, sequence = 0;
    const events = new Map(), pending = new Map(), memory = new Map();
    const clone = value => structuredClone(value);
    const post = data => parent.postMessage({ channel: 'st-new-scripts', ...data }, '*');
    const emit = (event, ...args) => { for (const fn of events.get(event) || []) { try { fn(...args); } catch (error) { post({ type: 'notice', text: error.message, error: true }); } } };
    const rpc = (action, payload) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(Error('脚本操作超时')); }, 20000);
        pending.set(id, { resolve, reject, timer }); post({ type: 'request', id, action, payload });
    });
    const get = (object, path, fallback) => {
        const keys = Array.isArray(path) ? path : String(path).replace(/\[(\d+)\]/g, '.$1').split('.');
        let value = object; for (const key of keys) { if (['__proto__', 'prototype', 'constructor'].includes(String(key))) return fallback; value = value?.[key]; }
        return value === undefined ? fallback : value;
    };
    const mvu = options => {
        const target = options?.message_id;
        if (Number.isInteger(target)) { const m = snapshot.chat[target]; return m?.variables?.[m.swipe_id || 0] || {}; }
        for (let i = snapshot.chat.length - 1; i >= 0; i--) { const m = snapshot.chat[i], vars = m.variables?.[m.swipe_id || 0]; if (vars?.stat_data) return vars; }
        return snapshot.mvuSeed || {};
    };
    const messageIndex = target => {
        if (Number.isInteger(target)) return target;
        for (let i = snapshot.chat.length - 1; i >= 0; i--) { const m = snapshot.chat[i]; if (m.variables?.[m.swipe_id || 0]?.stat_data) return i; }
        return snapshot.chat.length - 1;
    };
    const getVariables = options => clone(options?.type === 'chat' ? snapshot.chatVariables : options?.type === 'character' ? snapshot.characterVariables : mvu(options));
    const replaceVariables = (variables, options = {}) => rpc('variables', { type: options.type || 'message', message_id: messageIndex(options.message_id), variables });
    const updateVariablesWith = async (updater, options) => replaceVariables(await updater(getVariables(options)), options);
    const localStorage = { getItem: key => memory.get(String(key)) ?? null, setItem: (key, value) => memory.set(String(key), String(value)), removeItem: key => memory.delete(String(key)), clear: () => memory.clear() };
    try { Object.defineProperty(window, 'localStorage', { value: localStorage }); } catch {}
    const context = { chat: snapshot.chat, chatMetadata: snapshot.chatVariables, name1: snapshot.userName, name2: snapshot.characterName };
    Object.assign(window, {
        _: { get, uniq: values => [...new Set(values)], cloneDeep: clone },
        SillyTavern: { ...context, getContext: () => context },
        Mvu: { getMvuData: options => clone(mvu(options)), replaceMvuData: replaceVariables, updateVariablesWith, events: { VARIABLE_UPDATE_ENDED: 'mvu_update' } },
        getVariables, replaceVariables, updateVariablesWith,
        getWorldbookNames: async () => snapshot.worldbookName ? [snapshot.worldbookName] : [],
        getWorldbook: name => rpc('read-worldbook', { name }),
        replaceWorldbook: (name, entries) => rpc('toggle-worldbook', { name, entries }),
        getLastMessageId: () => snapshot.chat.length - 1,
        getChatMessages: target => { if (target === 'latest' || target === -1) return clone(snapshot.chat.slice(-1)); if (Number.isInteger(Number(target))) return clone(snapshot.chat.slice(Number(target), Number(target) + 1)); throw Error('暂不支持此消息范围格式'); },
        eventOn: (event, callback) => { if (!events.has(event)) events.set(event, new Set()); events.get(event).add(callback); return () => events.get(event)?.delete(callback); },
        eventRemoveListener: (event, callback) => events.get(event)?.delete(callback), eventEmit: emit,
        tavern_events: { MESSAGE_RECEIVED: 'message_received', CHAT_ID_CHANGED: 'chat_changed' },
        toastr: Object.fromEntries(['info', 'success', 'warning', 'error'].map(kind => [kind, text => post({ type: 'notice', text: String(text), error: kind === 'error' })])),
        alert: text => post({ type: 'notice', text: String(text) }),
        __scriptButtons: (id, buttons) => post({ type: 'buttons', id, buttons }),
    });
    // Native compatibility checks expect these functions to exist on window.
    window.appendInexistentScriptButtons = buttons => window.__scriptButtons('shared', buttons);
    window.getButtonEvent = name => 'shared:' + name;
    addEventListener('message', event => {
        if (event.source !== parent || event.data?.channel !== 'st-new-scripts') return;
        const data = event.data;
        if (data.type === 'snapshot') {
            snapshot = data.snapshot; context.chat = snapshot.chat; context.chatMetadata = snapshot.chatVariables;
            window.SillyTavern.chat = snapshot.chat; window.SillyTavern.chatMetadata = snapshot.chatVariables;
            emit('message_received'); emit('mvu_update');
        } else if (data.type === 'button' && typeof data.event === 'string') {
            emit(data.event);
        } else if (data.type === 'response' && pending.has(data.id)) {
            const task = pending.get(data.id); pending.delete(data.id); clearTimeout(task.timer);
            if (data.error) task.reject(Error(data.error)); else task.resolve(data.value);
        }
    });
    addEventListener('error', event => post({ type: 'notice', text: event.message || '脚本执行异常', error: true }));
    addEventListener('unhandledrejection', event => post({ type: 'notice', text: String(event.reason?.message || event.reason || '脚本异步执行异常'), error: true }));
    addEventListener('DOMContentLoaded', () => {
        const placeholder = document.getElementById('script-empty');
        const started = Date.now();
        const inspect = () => {
            if (!placeholder) return;
            const visible = [...document.body.children].some(node => node !== placeholder && !['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName) && node.getBoundingClientRect().height > 1);
            if (placeholder.hidden !== visible) placeholder.hidden = visible;
            const text = Date.now() - started < 1500 ? '正在启动角色卡脚本…' : mvu().stat_data ? '脚本没有生成可视界面。可查看上方脚本状态，或点击“重新启动”。' : '当前聊天还没有 MVU 变量。请检查此角色的变量脚本是否启用，以及关联世界书是否含有 InitVar。';
            if (placeholder.textContent !== text) placeholder.textContent = text;
        };
        new MutationObserver(inspect).observe(document.body, { childList: true, subtree: true, attributes: true }); inspect();
        setTimeout(inspect, 1600);
        post({ type: 'ready' });
    });
}
