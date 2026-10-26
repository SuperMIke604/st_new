// This function is serialized into an opaque-origin iframe, never executed in
// the app window. All mutation requests are checked again by the host.
export function scriptBridge(initial, { externalMvu = false, scriptId = '', scriptButtons = [] } = {}, installHelper) {
    const applicationParent = window.parent;
    let helper;
    const helpers = new Map();
    let snapshot = initial, sequence = 0;
    const events = new Map(), pending = new Map(), memory = new Map();
    const clone = value => structuredClone(value);
    const post = data => applicationParent.postMessage({ channel: 'st-new-scripts', ...data }, '*');
    const emit = async (event, ...args) => { for (const fn of [...events.get(event) || []]) await fn(...args); };
    const rpc = (action, payload, timeout = 20000) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(Error('脚本操作超时')); }, timeout);
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
    const updateSnapshot = value => { snapshot = value; context.chat = value.chat; context.chatMetadata = value.chatVariables; window.SillyTavern.chat = value.chat; window.SillyTavern.chatMetadata = value.chatVariables; for (const item of helpers.values()) item.refresh(value); };
    Object.assign(window, {
        _: { get, uniq: values => [...new Set(values)], cloneDeep: clone },
        SillyTavern: { ...context, getContext: () => context },
        ...(externalMvu ? {} : { Mvu: { getMvuData: options => clone(mvu(options)), replaceMvuData: replaceVariables, updateVariablesWith, events: { VARIABLE_UPDATE_ENDED: 'mvu_update' } } }),
        getVariables, replaceVariables, updateVariablesWith,
        getWorldbookNames: async () => snapshot.worldbookName ? [snapshot.worldbookName] : [],
        getWorldbook: name => rpc('read-worldbook', { name }),
        replaceWorldbook: (name, entries) => rpc('toggle-worldbook', { name, entries }),
        getLastMessageId: () => snapshot.chat.length - 1,
        getChatMessages: target => { const index = target === 'latest' ? snapshot.chat.length - 1 : Number(target); if (!Number.isInteger(index)) throw Error('暂不支持此消息范围格式'); const offset = index < 0 ? snapshot.chat.length + index : index; const message = snapshot.chat[offset]; return message ? [{ ...clone(message), message: message.mes, role: message.is_user ? 'user' : 'assistant', is_hidden: !!message.is_system, data: clone(message.variables?.[message.swipe_id || 0] || {}) }] : []; },
        createChatMessages: () => { throw Error('此调用必须来自已适配的角色脚本。'); }, triggerSlash: () => { throw Error('此调用必须来自已适配的角色脚本。'); },
        __roleCall: async (scriptId, action, payload) => { const result = await rpc('role-action', { scriptId, action, payload }, action === 'slash' ? 600000 : 20000); if (result?.snapshot) updateSnapshot(result.snapshot); return result?.value; },
        eventOn: (event, callback) => { if (!events.has(event)) events.set(event, new Set()); events.get(event).add(callback); return () => events.get(event)?.delete(callback); },
        eventRemoveListener: (event, callback) => events.get(event)?.delete(callback), eventEmit: emit,
        tavern_events: { MESSAGE_RECEIVED: 'message_received', CHAT_ID_CHANGED: 'chat_changed' },
        toastr: Object.fromEntries(['info', 'success', 'warning', 'error'].map(kind => [kind, text => post({ type: 'notice', text: String(text), kind, error: kind === 'error' })])),
        alert: text => post({ type: 'notice', text: String(text) }),
        __scriptButtons: (id, buttons) => post({ type: 'buttons', id, buttons }),
        __scriptReport: post,
    });
    // Native compatibility checks expect these functions to exist on window.
    window.appendInexistentScriptButtons = buttons => window.__scriptButtons('shared', buttons);
    window.getButtonEvent = name => 'shared:' + name;
    if (installHelper) {
        const on = window.eventOn;
        helper = installHelper(initial, { request: rpc, emit, on, update: updateSnapshot, scriptId, buttons: scriptButtons });
        helpers.set(scriptId, helper);
        window.__scriptScope = (id, buttons = []) => {
            if (!helpers.has(id)) helpers.set(id, installHelper(snapshot, { request: rpc, emit, on, update: updateSnapshot, scriptId: id, buttons, expose: false }));
            const role = (action, payload) => window.__roleCall(id, action, payload);
            return { ...helpers.get(id).api,
                getWorldbook: name => helpers.get(id).api.SillyTavern.loadWorldInfo(name).then(book => Object.values(book.entries)),
                replaceWorldbook: (name, entries) => role('replace-worldbook', { name, entries }),
                createChatMessages: (messages, options) => role('create-messages', { messages, options }),
                triggerSlash: command => role('slash', { command }),
                __avatarStore: (operation, args = {}) => role('avatars', { operation, ...args }),
            };
        };
        Object.assign(window, window.__scriptScope(scriptId, scriptButtons));
        if (!externalMvu) {
            window.Mvu.replaceMvuData = (value, options = {}) => window.replaceVariables(value, { type: 'message', ...options });
            window.Mvu.updateVariablesWith = (fn, options = {}) => window.updateVariablesWith(fn, { type: 'message', ...options });
        }
    }
    addEventListener('message', async event => {
        if (event.source !== applicationParent || event.data?.channel !== 'st-new-scripts') return;
        const data = event.data;
        if (data.type === 'snapshot') {
            updateSnapshot(data.snapshot);
            if (!helper && !externalMvu) { try { await emit('message_received'); await emit('mvu_update'); } catch (error) { post({ type: 'notice', text: error.message, error: true }); } }
        } else if (data.type === 'button' && typeof data.event === 'string') {
            try { await emit(data.event); } catch (error) { post({ type: 'notice', text: error.message, error: true }); }
        } else if (data.type === 'helper-event') {
            try {
                await Promise.all([...helpers.values()].map(item => item.idle())); if (data.snapshot) updateSnapshot(data.snapshot);
                await emit(data.event, ...(data.args || []));
                if (!externalMvu && data.event === 'message_received') await emit('mvu_update');
                await Promise.all([...helpers.values()].map(item => item.idle()));
                post({ type: 'helper-event-result', id: data.id });
            } catch (error) { post({ type: 'helper-event-result', id: data.id, error: error.message }); }
        } else if (data.type === 'helper-settings') {
            helper?.openSettings();
        } else if (data.type === 'response' && pending.has(data.id)) {
            const task = pending.get(data.id); pending.delete(data.id); clearTimeout(task.timer);
            if (data.error) task.reject(Error(data.error)); else task.resolve(data.value);
        }
    });
    addEventListener('error', event => post({ type: 'notice', text: event.message || '脚本执行异常', error: true }));
    addEventListener('unhandledrejection', event => post({ type: 'notice', text: String(event.reason?.message || event.reason || '脚本异步执行异常'), error: true }));
    addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key) && event.target.matches('[role="button"][tabindex="0"]')) { event.preventDefault(); event.target.click(); } });
    addEventListener('DOMContentLoaded', () => {
        const placeholder = document.getElementById('script-empty');
        if (initial.pageDisplay) {
            const style = document.createElement('style'); style.textContent = 'html,body{background:transparent!important;overflow:hidden}#script-empty{display:none!important}'; document.head.append(style);
            let scheduled = false, lastLayout = '';
            const measure = () => {
                scheduled = false;
                const roots = [...document.body.children, ...document.documentElement.children].filter(node => node !== placeholder && !['HEAD', 'BODY', 'SCRIPT', 'STYLE', 'LINK'].includes(node.tagName));
                const rects = roots.flatMap(node => {
                    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
                    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0 ? [[rect.x, rect.y, rect.width, rect.height]] : [];
                });
                const layout = JSON.stringify(rects); if (layout !== lastLayout) { lastLayout = layout; post({ type: 'layout', rects }); }
            };
            // A fully clipped iframe may not receive animation frames. Timers also
            // allow the first asynchronously-created floating widget to appear.
            const schedule = () => { if (!scheduled) { scheduled = true; setTimeout(measure, 16); } };
            const resize = new ResizeObserver(schedule);
            const observe = () => {
                for (const node of document.querySelectorAll('[data-edit]:not([role])')) { node.setAttribute('role', 'button'); node.setAttribute('tabindex', '0'); node.setAttribute('aria-label', '编辑' + (node.getAttribute('data-edit-label') || node.getAttribute('data-edit'))); }
                resize.disconnect(); for (const node of [...document.body.children, ...document.documentElement.children]) if (!['HEAD', 'BODY', 'SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)) resize.observe(node); schedule();
            };
            new MutationObserver(observe).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
            addEventListener('resize', schedule); addEventListener('scroll', schedule, true); observe();
        }
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
