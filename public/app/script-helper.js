// Serialized into the opaque script iframe. This implements host APIs, not MVU
// parsing or update rules. Every persistent operation is checked by the app.
// Add supported script APIs here so every script scope receives the same bindings.
export const SCRIPT_API_NAMES = 'SillyTavern,getScriptId,getTavernHelperVersion,getVariables,replaceVariables,updateVariablesWith,insertOrAssignVariables,getChatMessages,setChatMessages,getWorldbookNames,getCharWorldbookNames,getCharLorebooks,getCurrentCharPrimaryLorebook,getLorebookEntries,getLorebookSettings,setLorebookSettings,substitudeMacros,substituteMacros,eventOn,eventOnce,eventEmit,eventWaitOnce,getButtonEvent,getScriptButtons,appendInexistentScriptButtons,replaceScriptButtons,getWorldbook,replaceWorldbook,createChatMessages,triggerSlash,__avatarStore'.split(',');
export function scriptHelper(initial, { request, emit, on, update, scriptId, buttons: configuredButtons = [], expose = true }) {
    const theme = document.createElement('style');
    theme.textContent = `:root{--SmartThemeBodyColor:#403a33;--SmartThemeEmColor:#806b56;--SmartThemeQuoteColor:#805b40;--SmartThemeBlurTintColor:#faf7f0;--SmartThemeChatTintColor:#f3eee4;--SmartThemeBorderColor:#ded4c6;--SmartThemeShadowColor:#0002}#extensions_settings2{color:var(--SmartThemeBodyColor);font:400 14px/1.6 system-ui}#extensions_settings2 [hidden]{display:none!important}#extensions_settings2 .inline-drawer-content{display:flex;flex-direction:column;gap:12px}#extensions_settings2 .inline-drawer-toggle{cursor:pointer}#extensions_settings2 .checkbox_label{display:flex;align-items:center;gap:8px}#extensions_settings2 .flex-container{display:flex;gap:8px;flex-wrap:wrap}#extensions_settings2 .flexFlowColumn{flex-direction:column}#extensions_settings2 .flex1{flex:1}#extensions_settings2 :is(button,.menu_button,select,input.text_pole){box-sizing:border-box;min-height:42px;border:1px solid var(--SmartThemeBorderColor);border-radius:10px;background:var(--SmartThemeBlurTintColor);color:inherit;padding:7px 12px;font:inherit}#extensions_settings2 .menu_button{display:inline-flex;align-items:center;justify-content:center;cursor:pointer}#extensions_settings2 input[type=checkbox]{accent-color:var(--SmartThemeQuoteColor)}#extensions_settings2 label{line-height:1.6}`;
    theme.textContent += '#extensions_settings2 .fa-circle-question::before{content:"?"}#extensions_settings2 .fa-circle-chevron-down::before{content:"⌄"}';
    if (initial.palette === 'moss') theme.textContent += ':root{--SmartThemeBodyColor:#303d31;--SmartThemeEmColor:#64725c;--SmartThemeQuoteColor:#496c53;--SmartThemeBlurTintColor:#f1f3e8;--SmartThemeChatTintColor:#e6eddf;--SmartThemeBorderColor:#c9d1bd}';
    if (expose) document.head.append(theme);
    let snapshot = initial, base = structuredClone(initial), queue = Promise.resolve();
    const clone = value => structuredClone(value);
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const settingsValue = value => value.helperScriptSettings ? value.helperScriptSettings[scriptId] || (value.helperLegacyScriptId === scriptId ? value.helperSettings : {}) || {} : value.helperSettings || {};
    const st = expose ? window.SillyTavern : { ...window.SillyTavern, chat: clone(initial.chat), chatMetadata: clone(initial.chatVariables || {}) }, working = st.chat;
    st.extensionSettings = clone(settingsValue(snapshot));
    let globals = clone(snapshot.helperGlobals || {});
    let buttons = clone(snapshot.helperButtons?.[scriptId] || configuredButtons);
    const publishButtons = () => window.__scriptReport({ type: 'buttons', id: scriptId, buttons: clone(buttons), replace: true });
    const index = target => {
        const value = target === undefined || target === 'latest' ? working.length - 1 : Number(target);
        const result = value < 0 ? working.length + value : value;
        if (!Number.isSafeInteger(result) || result < 0 || result >= working.length) throw Error('消息楼层不存在。');
        return result;
    };
    const transact = operation => { const task = queue.catch(() => {}).then(operation); queue = task; return task; };
    const call = async (operation, payload) => {
        const result = await request('helper', { scriptId, operation, payload });
        if (result?.snapshot) update(result.snapshot);
        return result?.value;
    };
    const changes = () => {
        const result = { changes: [], messages: [] };
        if (!equal(st.chatMetadata || {}, base.chatVariables || {})) result.changes.push({ type: 'chat', base: base.chatVariables || {}, value: clone(st.chatMetadata || {}) });
        for (let i = 0; i < working.length; i++) {
            const previous = base.chat[i];
            if (!previous) throw Error('暂不支持通过 saveChat 插入或删除消息。');
            if (['swipe_id', 'swipes', 'is_user', 'is_system', 'name'].some(key => !equal(working[i][key], previous[key]))) throw Error('saveChat 暂不支持直接修改消息身份或回复结构。');
            if (!equal(working[i].variables || {}, previous.variables || {})) {
                if (previous.variablesAvailable === false) throw Error('此楼层变量超出当前脚本快照，请先切换到该楼层。');
                result.changes.push({ type: 'message', message_id: i, revision: previous.revision, base: previous.variables || {}, value: clone(working[i].variables || {}) });
            }
            if (working[i].mes !== previous.mes) {
                if (previous.textAvailable === false) throw Error('此楼层正文超出当前脚本快照，不能直接覆盖。');
                result.messages.push({ message_id: i, revision: previous.revision, message: working[i].mes, base: previous.variables || {} });
            }
        }
        if (working.length !== base.chat.length) throw Error('暂不支持通过 saveChat 插入或删除消息。');
        return result;
    };
    const saveChat = () => transact(async () => { const batch = changes(); if (batch.changes.length || batch.messages.length) await call('save-chat', batch); });
    const variables = (options = {}) => {
        switch (options.type || 'chat') {
            case 'chat': return st.chatMetadata || {};
            case 'message': { const message = working[index(options.message_id)]; if (message.variablesAvailable === false) throw Error('此楼层变量超出当前脚本快照。'); return message.variables?.[message.swipe_id || 0] || {}; }
            case 'global': return globals;
            case 'character': return snapshot.characterVariables || {};
            default: throw Error('此变量范围尚未接入。');
        }
    };
    const writeVariables = async (value, options = {}) => {
        const type = options.type || 'chat';
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('变量表必须是对象。');
        if (type === 'global') return call('save-globals', { base: clone(globals), value: clone(value) });
        if (!['chat', 'message'].includes(type)) throw Error('此变量写入范围尚未接入。');
        let change;
        if (type === 'chat') change = { type, base: clone(base.chatVariables || {}), value: clone(value) };
        else {
            const id = index(options.message_id), message = working[id], previous = base.chat[id];
            if (previous.variablesAvailable === false) throw Error('此楼层变量超出当前脚本快照，不能覆盖。');
            const next = clone(message.variables || {}); next[message.swipe_id || 0] = clone(value);
            change = { type, message_id: id, revision: previous.revision, base: clone(previous.variables || {}), value: next };
        }
        return call('save-variables', { changes: [change] });
    };
    const replaceVariables = (value, options) => { const next = clone(value); return transact(() => writeVariables(next, options)); };
    const getMessages = (range, options = {}) => {
        let start, end;
        if (typeof range === 'string' && range.includes('-') && !/^-\d+$/.test(range)) {
            const match = /^(-?\d+)-(latest|-?\d+)$/.exec(range); if (!match) throw Error('消息范围格式无效。');
            start = index(match[1]); end = index(match[2]);
        } else start = end = index(range);
        return working.slice(start, end + 1).flatMap((message, offset) => {
            const role = message.is_user ? 'user' : 'assistant';
            if (options.role && options.role !== 'all' && options.role !== role) return [];
            if (message.textAvailable === false || message.variablesAvailable === false) throw Error('请求的楼层超出当前脚本快照，无法提供完整消息数据。');
            if (options.include_swipes && message.swipesAvailable === false) throw Error('此楼层的完整回复分支超出当前脚本快照。');
            return [{ ...clone(message), message_id: start + offset, message: message.mes, role, is_hidden: !!message.is_system, data: clone(message.variables?.[message.swipe_id || 0] || {}),
                ...(options.include_swipes ? { swipes: clone(message.swipes || [message.mes]), swipes_data: (message.swipes || [message.mes]).map((_, i) => clone(message.variables?.[i] || {})) } : {}) }];
        });
    };
    const setMessages = (messages, options = {}) => transact(async () => {
        if (!Array.isArray(messages) || messages.length > 100) throw Error('消息修改批次无效。');
        const patches = messages.map(item => {
            const id = index(item.message_id), previous = base.chat[id];
            if (Object.keys(item).some(key => !['message_id', 'message', 'data', 'swipes_data'].includes(key))) throw Error('此消息修改字段尚未接入。');
            return { ...clone(item), message_id: id, revision: previous.revision, base: clone(previous.variables || {}) };
        });
        return call('set-messages', { messages: patches, refresh: options.refresh || 'affected' });
    });
    const worldNames = () => ({ primary: snapshot.worldbookName || null, additional: [] });
    const readBook = name => call('read-worldbook', { name });
    const loreSettings = () => clone(snapshot.lorebookSettings || { selected_global_lorebooks: [], scan_depth: 2, context_percentage: 25, budget_cap: 0 });
    const macros = text => String(text).replace(/\{\{(char|user)\}\}/gi, (_, name) => name.toLowerCase() === 'char' ? snapshot.characterName : snapshot.userName);
    const eventOn = (event, fn) => {
        const stop = on(event, fn); stop.stop = stop; return stop;
    };
    const eventOnce = (event, fn) => { const stop = eventOn(event, (...args) => { stop(); return fn(...args); }); return stop; };
    const api = {
        getScriptId: () => scriptId,
        // Our independent helper's version. Never claim the installed native
        // TavernHelper version or silently pass a minimum-version check.
        getTavernHelperVersion: async () => '0.1.0',
        getVariables: options => clone(variables(options)), replaceVariables,
        updateVariablesWith: (fn, options) => transact(async () => writeVariables(await fn(clone(variables(options))), options)),
        insertOrAssignVariables: (value, options) => transact(() => writeVariables({ ...clone(variables(options)), ...clone(value) }, options)),
        getChatMessages: getMessages, setChatMessages: setMessages,
        getWorldbookNames: async () => [...new Set([snapshot.worldbookName, ...(snapshot.lorebookSettings?.selected_global_lorebooks || [])].filter(Boolean))],
        getCharWorldbookNames: worldNames, getCharLorebooks: async () => worldNames(),
        getCurrentCharPrimaryLorebook: () => snapshot.worldbookName || null,
        getLorebookEntries: async name => (await readBook(name)).map(entry => ({ ...entry, comment: entry.name, content: entry.content })),
        getLorebookSettings: loreSettings,
        setLorebookSettings: settings => transact(() => call('save-lore-settings', { settings })),
        substitudeMacros: macros, substituteMacros: macros,
        eventOn, eventOnce, eventEmit: emit,
        eventWaitOnce: event => new Promise(resolve => eventOnce(event, (...args) => resolve(args))),
        getButtonEvent: name => scriptId + ':' + name,
        getScriptButtons: () => clone(buttons),
        appendInexistentScriptButtons: additions => { for (const button of additions) if (!buttons.some(item => item.name === button.name)) buttons.push(clone(button)); publishButtons(); },
        replaceScriptButtons: value => {
            if (!Array.isArray(value) || value.length > 100 || value.some(button => typeof button?.name !== 'string' || button.name.length > 100 || typeof button.visible !== 'boolean')) throw Error('脚本按钮格式无效。');
            buttons = clone(value); publishButtons();
            void transact(() => call('save-buttons', { scriptId, value: clone(buttons) })).catch(error => window.toastr.error(error.message));
        },
    };
    if (expose) Object.assign(window, api);
    Object.assign(st, {
        saveChat, getCurrentChatId: () => snapshot.chatId || '',
        getContext: () => st,
        saveSettingsDebounced: () => { const value = clone(st.extensionSettings); void transact(() => call('save-settings', { base: clone(settingsValue(base)), value })).catch(error => window.toastr.error(error.message)); },
        getCharacterCardFields: () => ({ name: snapshot.characterName || '', description: snapshot.characterDescription || '' }),
        loadWorldInfo: async name => ({ entries: Object.fromEntries((await readBook(name)).map(entry => [entry.uid, { ...entry, comment: entry.name }])) }),
        ToolManager: { isToolCallingSupported: () => false },
        eventSource: { on: eventOn, once: eventOnce, removeListener: window.eventRemoveListener, emit },
        event_types: window.tavern_events,
        POPUP_TYPE: { TEXT: 1, INPUT: 2, CONFIRM: 3 }, POPUP_RESULT: { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null },
        callGenericPopup: (content, type, input = '') => new Promise(resolve => {
            const dialog = document.createElement('dialog'), body = document.createElement('div');
            dialog.style.cssText = 'max-width:min(90vw,800px);max-height:80vh;overflow:auto;padding:20px;border:1px solid #c9bcaa;border-radius:12px;background:#f5f0e7;color:#403a33';
            body.innerHTML = String(content); dialog.append(body);
            const field = document.createElement('input'); if (type === 2) { field.value = String(input); dialog.append(field); }
            const finish = value => { dialog.close(); dialog.remove(); resolve(value); };
            const accept = document.createElement('button'); accept.textContent = type === 3 ? '确认' : '关闭'; accept.onclick = () => finish(type === 2 ? field.value : 1); dialog.append(accept);
            if (type === 3 || type === 2) { const cancel = document.createElement('button'); cancel.textContent = '取消'; cancel.onclick = () => finish(null); dialog.append(cancel); }
            dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); }); document.body.append(dialog); dialog.showModal();
        }),
    });
    Object.assign(window.tavern_events, Object.fromEntries(['CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'WORLDINFO_UPDATED', 'CHAT_COMPLETION_SETTINGS_READY', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED'].map(name => [name, name.toLowerCase()])));
    // window.parent is replaceable. Redirect only this iframe's view of parent
    // to its compatibility document; window.top stays cross-origin and blocked.
    if (expose) Object.defineProperty(window, 'parent', { value: window, configurable: false });
    const holder = document.createElement('section'); holder.id = 'tavern_helper'; holder.hidden = true;
    const registration = document.createElement('div'); registration.dataset.scriptId = scriptId; holder.append(registration);
    const panel = document.createElement('section'); panel.id = 'extensions_settings2'; panel.hidden = true;
    if (expose) document.body.append(holder, panel);
    panel.addEventListener('click', event => {
        const toggle = event.target.closest('.inline-drawer-toggle'); if (!toggle || !panel.contains(toggle)) return;
        const content = toggle.nextElementSibling; if (content?.classList.contains('inline-drawer-content')) content.hidden = !content.hidden;
    });
    let settingsDialog;
    return {
        api: { ...api, SillyTavern: st },
        idle: () => queue.catch(() => {}),
        openSettings() {
            if (!settingsDialog) {
                settingsDialog = document.createElement('dialog'); settingsDialog.style.cssText = 'box-sizing:border-box;width:min(92vw,850px);max-height:85vh;overflow:auto;padding:20px;border:1px solid #c9bcaa;border-radius:12px;background:#f5f0e7;color:#403a33';
                const close = document.createElement('button'); close.textContent = '关闭脚本设置'; close.style.cssText = 'min-height:42px;margin-bottom:12px'; close.onclick = () => settingsDialog.close();
                panel.hidden = false; settingsDialog.append(close, panel); document.body.append(settingsDialog);
            }
            if (!settingsDialog.open) settingsDialog.showModal();
        },
        refresh(value) {
            const incoming = clone(value.chat);
            for (let i = 0; i < incoming.length; i++) {
                if (working[i] && working[i].revision === incoming[i].revision) {
                    for (const key of Object.keys(working[i])) if (!Object.hasOwn(incoming[i], key)) delete working[i][key];
                    Object.assign(working[i], incoming[i]);
                }
                else working[i] = incoming[i];
            }
            working.length = incoming.length; st.chat = working;
            st.chatMetadata = clone(value.chatVariables || {}); globals = clone(value.helperGlobals || {});
            st.extensionSettings = clone(settingsValue(value));
            snapshot = value; base = clone(value);
        },
    };
}

export function helperStartup() {
    const pending = new Set(), ready = window.jQuery.fn.ready;
    window.jQuery.fn.ready = function (fn) {
        return ready.call(this, function (...args) {
            const task = Promise.resolve().then(() => fn.apply(this, args));
            pending.add(task);
            // Leave the promise in the set until the startup barrier consumes
            // it, including already-rejected async ready handlers.
            task.catch(() => {});
        });
    };
    window.__helperWaitForStartup = async () => {
        await new Promise(resolve => ready.call(window.jQuery(document), () => setTimeout(resolve, 0)));
        await Promise.all([...pending]);
        if (!window.Mvu || typeof window.Mvu.parseMessage !== 'function') throw Error('原始 MVU 模块尚未完成初始化。');
    };
}
