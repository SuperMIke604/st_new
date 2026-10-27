import { RecentCharacters } from './home-data.js';
import { createToast } from './toast.js';
import { installMessageEdit } from './message-edit.js';
import { scriptTrees, scriptRows, scriptScopeEnabled, scriptSupport, characterScriptPlan, nativeScriptPlan, usesMvuCompat, latestMvuData, scriptSnapshot, validateScriptTree, saveCharacterScripts, patchScriptScope } from './scripts.js';
import { ScriptRuntime } from './script-runtime.js';
import { patchHelperVariables, patchHelperMessages } from './helper-state.js';
import { initialVariablesFromBook, prepareValidatedMvuSnapshots } from './mvu-compat.js';
import { ScriptSchema } from './script-schema.js';
import { RoleAvatarStore } from './role-avatar-store.js';
import { renderVariableManager, validateVariables, defaultVariableMessage, chatVariableValue, patchChatVariables } from './variable-manager.js';
import { roleWorldEntries, toggleRoleWorldEntries, archiveRoleWorldEntries } from './role-worldbook.js';
import { MESSAGE_VARIABLES, messageVariableContext } from './variable-macros.js';
import { warmHistoryRegex, historyRegexCache } from './history-regex-cache.js';
import { CharacterCatalog } from './character-catalog.js';
import { loadTimings, timingStatusText, timingDetailText, requestFailure } from './load-timings.js';
import { exportDiagnostics, copyDiagnostics } from './diagnostic-export.js';
import { BUILD } from './version.js';
import { PresetSelection } from './preset-selection.js';
import { PresetTokenPreview } from './preset-tokens.js';
import { GenerationPreload, generationDatabaseResources } from './generation-preload.js';
import { manualUpdate } from './update.js';
import { renderDatabasePreview } from './database-preview.js';
import { TavernAPI, readEvents } from './api.js';
import { buildPrompt, fitPrompt, generationBody, activateWorlds, expand } from './engine.js';
import { VirtualChat } from './virtual-chat.js';
import { icon } from './icons.js';
import { installPromptDrag } from './prompt-drag.js';
import { worldDraft, renderWorldEntries } from './world-editor.js';
import { renderGlobalWorldSelect } from './world-select.js';
import { decorateCodeBlocks } from './code-blocks.js';
import { messageMarkdown } from './message-markdown.js';
import { embeddedWorld, importCharacterWorld } from './character-world.js';
import { readingFields, readingSettings, applyReading } from './reading.js';
import { worldSettingsFields, validateWorldSettings } from './world-settings.js';
import { databaseSettings, databaseForChat, storeDatabase, invalidateDatabases, databaseText, referenceDatabaseText, sheetText, fillMessages, parseUpdate, databaseUpdateNotice, sourceHash, validateDatabase } from './database.js';
import { renderDatabasePanel } from './database-ui.js';
import { presetCatalog, presetDraft, promptRows, promptOrder, markerLabels, movePrompt, addPrompt, removePrompt, validatePreset, createPreset, uniquePresetName } from './preset-editor.js';
import { libraryState, addFolder, renameFolder, deleteFolder, moveCards, filterCards } from './library.js';
import { installSelects } from './select.js';
import { normalizeConnection, modelOptions, inheritedConnection, visibleConnectionPassword, connectionProfiles, upsertConnection } from './connection.js';
import { applyRegex, presetRegexes, compileRegex, activeRegexes, scopedRegexes } from './regex.js';
installSelects();

const $ = id => document.getElementById(id);
const notificationRoot = $('notification');
const toast = createToast(notificationRoot, { raise: raiseNotification });
const api = new TavernAPI();
const presetSelection = new PresetSelection(api);
const recentCharacters = new RecentCharacters(api);
const characterCatalog = new CharacterCatalog(api);
async function loadCharacterCatalog(force = false, timing) {
    const finish = (timing || loadTimings).start('读取角色列表', 'data');
    try {
        const characters = await characterCatalog.load({ force, knownAvatar: state.character?.avatar, timing });
        state.characters = characters; finish('success', { itemCount: characters.length }); return characters;
    } catch (error) { finish(error.name === 'AbortError' ? 'cancelled' : 'error', error.name === 'TimeoutError' ? { reason: 'timeout' } : error.reason ? { reason: error.reason } : {}); throw error; }
}
const state = { ready: false, settings: {}, bundle: {}, own: {}, characters: [], character: null, chat: [], header: null, file: '', busy: false, dirty: false, controller: null, preset: {}, worlds: [], saves: Promise.resolve(), error: '' };
const scriptSchema = new ScriptSchema(), roleAvatars = new RoleAvatarStore();
const scriptRuntime = new ScriptRuntime({ notify, applyVariables: applyScriptVariables, worldbook: scriptWorldbook, roleAction: roleScriptAction, helperAction: helperHostAction, onRetry: openScriptWorkspace });
let scriptAutoIdentity = '';
state.startupLoading = true;
let startupPromise = null;
const panelLoads = new WeakMap();
let panelDirty = false;
let variablesSaving = false;
let panelRevision = 0;
let preview = null;
let streamFrame = 0;
let inlineEdit = null;
const sessionKeys = new Map();
let profileStore = { version: 1, activeId: '', profiles: [] };
const copy = value => structuredClone(value);
const safeName = value => String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
// randomUUID is unavailable on plain HTTP LAN origins used by many phones.
function uuid() {
    if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const text = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
function loadingIndicator(text, detail = '', compact = false) {
    const node = el('div', `loading-state${compact ? ' loading-compact' : ''}`);
    node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
    const spinner = el('span', 'loading-spinner'); spinner.setAttribute('aria-hidden', 'true');
    const copy = el('div', 'loading-copy'); copy.append(el('span', 'loading-label', text));
    if (detail) copy.append(el('small', '', detail));
    node.append(spinner, copy); return node;
}
const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
async function loadPanelContent(host, label, render, retry, { retainContent = false } = {}) {
    const revision = panelRevision, token = {}, finish = loadTimings.start(label, 'page');
    const timing = loadTimings.scope(finish.id);
    panelLoads.set(host, token);
    const current = () => panelRevision === revision && panelLoads.get(host) === token;
    const loading = loadingIndicator(`正在加载${label}…`);
    const previous = retainContent ? host.querySelector(':scope > .panel-content') : null;
    if (previous) previous.inert = true;
    if (!retainContent) host.replaceChildren(loading);
    host.setAttribute('aria-busy', 'true');
    let outcome = 'cancelled', content;
    try {
        // Category changes keep the current page visible until its replacement is ready.
        if (!retainContent) await timing.measure(`${label} · 等待加载提示绘制`, 'data', nextPaint);
        if (state.startupLoading) await timing.measure(`${label} · 等待应用初始化`, 'data', () => startupPromise);
        if (!current()) return;
        if (!state.ready) throw new Error(state.startupError || '应用初始化未完成，请刷新后重试。');
        content = el('div', 'panel-content');
        await timing.measure(`${label} · 准备页面内容`, 'data', () => render(content, revision, timing));
        if (!current()) return;
        previous?._dispose?.();
        timing.measureSync(`${label} · 挂载界面`, 'data', () => host.replaceChildren(content));
        await timing.measure(`${label} · 等待内容绘制`, 'data', nextPaint);
        if (current()) { outcome = 'success'; content._onReady?.(); }
    } catch (error) {
        outcome = current() ? 'error' : 'cancelled';
        if (current()) {
            previous?._dispose?.();
            host.replaceChildren(el('p', 'note warning', `${label}加载失败：${error.message}`));
            if (retry) host.append(action('重新加载', retry, 'refresh'));
        }
        if (current()) throw error;
    } finally {
        if (previous && current()) previous.inert = false;
        if (outcome !== 'success') content?._dispose?.();
        loading.remove();
        if (current()) { host.removeAttribute('aria-busy'); panelLoads.delete(host); }
        timing.close(outcome);
        finish(outcome, { metrics: { nodeCount: content?.querySelectorAll?.('*').length || 0, imageCount: content?.querySelectorAll?.('img').length || 0, imagesPending: [...(content?.querySelectorAll?.('img') || [])].filter(img => !img.complete).length } });
    }
}
function action(label, callback, glyph, className = '') {
    const button = el('button', `button ${className}`); button.type = 'button';
    if (glyph) button.append(icon(glyph));
    button.append(el('span', '', label));
    button.addEventListener('click', () => run(callback));
    return button;
}
function inlineEntryActions(summary, buttons, label) {
    const menu = el('span', 'prompt-actions prompt-inline-actions inset-action-menu'); menu.hidden = true;
    menu.id = `entry-actions-${uuid()}`; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', '条目操作');
    menu.append(...buttons);
    menu.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    const more = action('条目操作', () => {
        const expand = menu.hidden, list = summary.closest('.regex-list,.prompt-list');
        for (const other of list.querySelectorAll('.prompt-inline-actions')) other.hidden = true;
        for (const other of list.querySelectorAll('.prompt-actions-toggle')) other.setAttribute('aria-expanded', 'false');
        menu.hidden = !expand; more.setAttribute('aria-expanded', String(expand));
    }, 'more', 'prompt-actions-toggle');
    more.title = '条目操作'; more.setAttribute('aria-label', `${label} 的条目操作`);
    more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-controls', menu.id);
    more.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    for (const button of buttons) { button.title = button.textContent.trim(); button.setAttribute('aria-label', `${button.textContent.trim()} ${label}`); }
    const anchor = el('span', 'prompt-action-anchor'); anchor.append(menu, more); summary.append(anchor);
    summary.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || menu.hidden) return;
        event.preventDefault(); event.stopPropagation(); menu.hidden = true; more.setAttribute('aria-expanded', 'false'); more.focus();
    });
}
function raiseNotification() {
    const notification=notificationRoot;if(notification.hidden)return;
    const panel = [...document.querySelectorAll('dialog[open]')].at(-1) || $('panel');
    const bounds = panel.open ? panel.getBoundingClientRect() : null;
    const owner = panel.open ? panel : document.body;
    // A top-layer popover outside a modal is still inert; keep it inside its dialog.
    if (notification.parentElement !== owner) {
        if (notification.matches(':popover-open')) notification.hidePopover();
        owner.append(notification);
    }
    const viewport = window.visualViewport;
    const width = viewport?.width || innerWidth, left = viewport?.offsetLeft || 0;
    const start = Math.max(left, bounds?.left ?? left), end = Math.min(left + width, bounds?.right ?? left + width);
    const header = panel.open ? panel.querySelector('header') : document.querySelector('.appbar');
    notification.style.left = `${(start + end) / 2}px`;
    notification.style.top = `${Math.max(viewport?.offsetTop || 0, header?.getBoundingClientRect().bottom || 44) + 16}px`;
    notification.style.maxHeight = `${Math.max(0, (viewport?.height || innerHeight) - (parseFloat(notification.style.top) - (viewport?.offsetTop || 0)) - 16)}px`;
    const horizontalInset = width <= 700 ? 24 : 16;
    notification.style.maxWidth = `${Math.max(0, Math.min(480, end - start - horizontalInset * 2))}px`;
    if(typeof notification.showPopover==='function'){
        notification.setAttribute('popover','manual');
        const layer = String(panel.open);
        if(notification.matches(':popover-open') && notification.dataset.panelLayer !== layer) notification.hidePopover();
        notification.dataset.panelLayer = layer;
        if(!notification.matches(':popover-open'))notification.showPopover();
    }
}
function notify(message, type = 'success') { return toast.show(message, type); }
async function run(callback) {
    try { return await callback(); } catch (error) { if (error.name !== 'AbortError') { console.error('[app]', error); notify(error.message || '操作失败', true); } }
}
function status(text, error = false) {
    $('save-status').textContent = text; $('save-status').classList.toggle('error', error);
    if (state.loading) $('chat-loading-label').textContent = text;
}
function assertIdle() { if (variablesSaving) throw new Error('正在保存变量，请稍候。'); if (scriptRuntime.processing) throw new Error('角色脚本正在处理消息，请稍候。'); if (state.loading) throw new Error('正在切换聊天，请稍候。'); if (state.busy) throw new Error('请先停止或等待生成完成。'); }
function assertViewable() { if (state.loading) throw new Error('正在切换聊天，请稍候。'); if (inlineEdit) throw new Error('请先保存或取消正在编辑的消息。'); if (state.dirty && !state.busy) throw new Error('请先保存聊天。'); }
function assertSaved() { assertIdle(); if (inlineEdit) throw new Error('请先保存或取消正在编辑的消息。'); if (state.dirty) throw new Error('当前聊天尚未保存，请先在工具中重试保存。'); }
function settingsOwn(settings) {
    settings.extension_settings ||= {};
    const own = settings.independent_frontend = settings.extension_settings.independent_frontend ||= settings.independent_frontend || {};
    if (presetSelection.name !== null) own.preset = presetSelection.name;
    return own;
}
async function saveOwn(patch) {
    if (Object.hasOwn(patch, 'preset')) {
        await presetSelection.save(patch.preset);
        state.own.preset = presetSelection.name;
        patch = { ...patch }; delete patch.preset;
        if (!Object.keys(patch).length) return;
    }
    state.settings = await api.patchSettings(settings => { Object.assign(settingsOwn(settings), patch); settings.extension_settings.independent_frontend = settings.independent_frontend; });
    state.own = settingsOwn(state.settings);
    if (presetSelection.name !== null) state.own.preset = presetSelection.name;
    api.readCache.clear();
    const persisted = settingsOwn((await api.settings()).settings);
    for (const key of Object.keys(patch)) if (JSON.stringify(persisted[key]) !== JSON.stringify(patch[key])) throw new Error('设置保存后核验失败，请重试。');
}
function persona() {
    const power = state.settings.power_user || {};
    const avatar = state.own.persona || state.settings.user_avatar;
    const info = power.persona_descriptions?.[avatar] || {};
    return { avatar, name: power.personas?.[avatar] || state.settings.username || 'User', description: info.description ?? power.persona_description ?? '' };
}
function connection() {
    return profileStore.profiles.find(profile => profile.id === profileStore.activeId) || inheritedConnection(state.settings);
}
function regexText(text, placement, options = {}) {
    const index = typeof options.depth === 'number' ? state.chat.length - options.depth : state.chat.length;
    return applyRegex(text, activeRegexes({ settings: state.settings, preset: state.preset, character: state.character }), placement, { variables: { [MESSAGE_VARIABLES]: messageVariableContext(state.chat.slice(0, index), state.header?.chat_metadata?.independentMvuSeed), char: state.character?.name || '', user: persona().name, description: state.character?.data?.description || '', persona: persona().description }, ...options });
}
function presets() {
    return presetCatalog(state.bundle);
}
function selectPreset() {
    const selected = presets().find(p => p.name === presetSelection.name);
    state.preset = copy(selected?.data || {});
    state.presetMissing = !selected;
    if (presetSelection.name !== null) state.own.preset = presetSelection.name;
}
function synchronize() {
    if (scriptRuntime.identity && scriptRuntime.identity !== scriptIdentity()) { scriptRuntime.dispose(); scriptSchema.dispose(); }
    if (scriptSchema.identity && scriptSchema.identity !== scriptIdentity()) scriptSchema.dispose();
    if (scriptRuntime.frame) scriptRuntime.refresh(scriptSnapshot(state), scriptIdentity());
    if (!state.character) scriptAutoIdentity = '';
    if (state.ready && state.character && !state.loading && !state.busy && !state.dirty && !inlineEdit && !panelDirty && scriptAutoIdentity !== scriptIdentity()) {
        scriptAutoIdentity = scriptIdentity();
        if (nativeScriptPlan(state.settings, state.character).some(script => script.enabled !== false && scriptSupport(script).supported)) {
            void openScriptWorkspace(false).catch(error => notify(`角色脚本启动失败：${error.message}`, true));
        }
    }

    document.title = 'SillyTavern';
    $('composer').setAttribute('aria-busy', String(!!state.busy));
    $('chat-loading').hidden = !state.loading;
    $('message-list').setAttribute('aria-busy', String(!!state.loading));
    $('send-button').disabled = !state.ready || state.busy || state.loading || !state.character || state.dirty;
    $('stop-button').hidden = !state.busy;
    $('send-button').hidden = state.busy;
    $('message-input').disabled = !state.ready || !state.character;
    $('composer').hidden = !state.character;
    document.body.classList.toggle('home-view', !state.character);
    // Refresh reply controls when a request starts/ends, including after stop.
    list.update(state.chat.length - 1);
}

function markdown(text) {
    const converter = markdown.converter ||= new globalThis.showdown.Converter({ tables: true, strikethrough: true, simpleLineBreaks: true, literalMidWordUnderscores: true, simplifiedAutoLink: true, openLinksInNewWindow: true, backslashEscapesHTMLTags: true });
    const source = String(text || '');
    return globalThis.DOMPurify.sanitize(messageMarkdown(source, converter), { FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'video', 'audio', 'svg'], FORBID_ATTR: ['style', 'srcset'] });
}
function renderMessage(message, index, existing) {
    const node = existing || el('article', 'message');
    node._message = message;
    node.classList.toggle('from-user', !!message.is_user);
    if (!existing) {
        const header = el('header', 'message-header');
        header.append(el('span', 'message-name'), el('span', 'message-number', `#${index}`));
        if (!message.is_user) {
            const top = el('div', 'message-jumps message-jumps-top'); top.append(action('回到本条底部', () => node.querySelector('.message-jumps-bottom').scrollIntoView({block:'end',behavior:'instant'}), 'down'));
            const bottom = el('div', 'message-jumps message-jumps-bottom'); bottom.append(action('回到本条顶部', () => node.scrollIntoView({block:'start',behavior:'instant'}), 'up')); node.append(top, bottom);
            let touch;
            node.addEventListener('touchstart', event => { if (event.target.closest('button,input,textarea,pre,iframe')) return; const t=event.touches[0]; touch={x:t.clientX,y:t.clientY}; }, {passive:true});
            node.addEventListener('touchend', event => { if (!touch) return; const t=event.changedTouches[0], dx=t.clientX-touch.x, dy=t.clientY-touch.y; touch=null; if (Math.abs(dx)<65 || Math.abs(dx)<Math.abs(dy)*1.5 || index!==state.chat.length-1 || state.busy) return; void run(async () => { assertIdle(); if(state.dirty) await saveChat(); assertSaved(); const message=state.chat[index]; const current=Number(message.swipe_id)||0; const next=current+(dx<0?1:-1); if (next<0) return; if (next>=(message.swipes?.length||1)) { if(dx<0) await generate(true); return; } message.swipe_id=next; message.mes=message.swipes[next]; if(message.swipe_info?.[next]) Object.assign(message,copy(message.swipe_info[next])); invalidateDatabases(state.chat,index); list.update(index); await saveChat(); }); }, {passive:true});
        }
        const jumpTop=node.querySelector('.message-jumps-top'); if(jumpTop) header.append(jumpTop);
        node.prepend(header);
        const content=el('div','message-content'); const bottom=node.querySelector('.message-jumps-bottom'); if(bottom) bottom.before(content); else node.append(content);
        installMessageEdit(node, () => beginMessageEdit(node._message));
    }
    let switches = node.querySelector('.message-swipe-buttons');
    if (!message.is_user && index === state.chat.length - 1) {
        if (!switches) { switches = el('div','message-swipe-buttons');
            for (const [delta,label,glyph] of [[-1,'上一条回复','left'],[1,'下一条回复或重新生成','right']]) switches.append(action(label, async () => { assertIdle(); if(state.dirty) await saveChat(); assertSaved(); const current=state.chat[index]; const next=(Number(current.swipe_id)||0)+delta; if(next<0)return; if(next>=(current.swipes?.length||1)) {await generate(true);return;} current.swipe_id=next;current.mes=current.swipes[next];if(current.swipe_info?.[next])Object.assign(current,copy(current.swipe_info[next]));invalidateDatabases(state.chat,index);list.update(index);await saveChat(); }, glyph)); const bottom=node.querySelector('.message-jumps-bottom'); bottom.append(switches); }
        switches.children[0].disabled = state.busy || state.loading || !(Number(message.swipe_id)>0); switches.children[1].disabled=state.busy || state.loading;
    } else switches?.remove();
    node.querySelector('.message-jumps-bottom')?.classList.toggle('has-swipes', !!node.querySelector('.message-swipe-buttons'));
    let reasoning = node.querySelector('.message-reasoning');
    if (message.extra?.reasoning) {
        if (!reasoning) {
            reasoning = el('details', 'message-reasoning'); reasoning.append(el('summary', '', '思考过程'), el('pre'));
            node.querySelector('.message-content').before(reasoning);
        }
        reasoning.querySelector('pre').textContent = regexText(message.extra.reasoning, 6, { phase: 'display', depth: state.chat.length - index - 1 });
    } else reasoning?.remove();
    node.querySelector('.message-name').textContent = message.name || (message.is_user ? persona().name : state.character?.name || 'Assistant');
    const floor = node.querySelector('.message-number');
    if (!state.busy && node._countedText !== message.mes) {
        node._countedText = message.mes; const source = message.mes;
        floor.textContent = `#${index} · -`;
        if (source?.trim()) void api.post(`/api/tokenizers/openai/count?model=${encodeURIComponent(connection().model)}`, [{role:message.is_user?'user':'assistant',content:source}]).then(result => { if(node._countedText===source) floor.textContent=`#${index} · ${result.token_count || '-'}`; }).catch(()=>{});
    }
    if (inlineEdit?.message === message) {
        if (!node.querySelector('.inline-editor')) {
            const editor = el('div', 'inline-editor');
            const text = el('textarea'); text.value = inlineEdit.text; text.rows = 8; text.setAttribute('aria-label', `修改第 ${index} 楼消息`);
            text.addEventListener('input', () => { inlineEdit.text = text.value; });
            const buttons = el('div', 'inline-edit-buttons');
            buttons.append(action('保存', async () => {
                assertIdle(); if (state.dirty) throw new Error('请先重试保存当前聊天。');
                message.mes = regexText(inlineEdit.text, message.is_user ? 1 : 2, { edit: true, depth: state.chat.length - index - 1 });
                invalidateDatabases(state.chat, index);
                if (Array.isArray(message.swipes)) message.swipes[message.swipe_id || 0] = message.mes;
                inlineEdit = null; list.update(index); await saveChat();
            }, undefined, 'primary'), action('取消', () => { inlineEdit = null; list.update(index); }), action('删除', () => deleteEditedMessage(message), undefined, 'danger'));
            editor.append(text, buttons); node.append(editor);
        }
        node.querySelector('.message-content').hidden = true;
        return node;
    }
    node.querySelector('.inline-editor')?.remove(); node.querySelector('.message-content').hidden = false;
    let waiting = node.querySelector('.message-waiting');
    const pending = state.generation?.reply === message && !message.mes && !message.extra?.reasoning;
    if (pending && !waiting) {
        waiting = loadingIndicator(state.generation.regenerate ? '正在重新生成，等待回复…' : '正在等待回复…', '', true);
        waiting.classList.add('message-waiting'); node.querySelector('.message-content').after(waiting);
    } else if (!pending) waiting?.remove();
    const depth = state.chat.length - index - 1;
    if (node._text !== message.mes || node._preset !== state.preset || node._depth !== depth) {
        const body = node.querySelector('.message-content');
        body.innerHTML = markdown(regexText(message.mes, message.is_user ? 1 : 2, { phase: 'display', depth }));
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, { acceptNode: text => text.parentElement.closest('pre,code,script,style,iframe,.dialogue-quote') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
        const texts = []; while (walker.nextNode()) texts.push(walker.currentNode);
        for (const text of texts) {
            const pattern = /“[^”\n]+”|「[^」\n]+」|『[^』\n]+』|"[^"\n]+"/g;
            const value = text.nodeValue; let match, start = 0; const fragment = document.createDocumentFragment();
            while ((match = pattern.exec(value))) { fragment.append(document.createTextNode(value.slice(start, match.index))); const span = el('span', 'dialogue-quote', match[0]); fragment.append(span); start = pattern.lastIndex; }
            if (start) { fragment.append(document.createTextNode(value.slice(start))); text.replaceWith(fragment); }
        }
        const previewAvatar = state.character?.avatar; let previewAvatars;
        decorateCodeBlocks(body, { icon, notify, messageId: index, message: message.mes, name: message.name, role: message.is_user ? 'user' : 'assistant', personaName: persona().name,
            getAvatars: previewAvatar ? () => previewAvatars ||= roleAvatars.run(previewAvatar, { operation: 'list' }) : undefined,
            edit: () => beginMessageEdit(message), send: text => run(async () => { assertSaved(); if ($('message-input').value.trim()) throw new Error('请先发送或清空输入框中的内容。'); $('message-input').value = text; resizeInput(); await generate(false); }) });
        for (const image of body.querySelectorAll('img')) { image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; }
        for (const link of body.querySelectorAll('a')) link.rel = 'noopener noreferrer';
        node._text = message.mes;
        node._preset = state.preset; node._depth = depth;
    }
    return node;
}
const list = new VirtualChat($('message-list'), renderMessage, range => {
    const viewportLast = list.locate(list.element.scrollTop + list.element.clientHeight);
    $('back-latest').hidden = !state.character || range.total <= 2 || viewportLast >= range.total - 2;
});
$('back-latest').addEventListener('click', () => list.jump(state.chat.length - 1, true));
function welcome() {
    list.setMessages([], { reset: true });
    $('back-latest').hidden = true;
    const welcome = el('div', 'welcome');

    const recent = el('div', 'home-recent'); welcome.append(recent);
    if (state.startupLoading || state.startupError) {
        if (state.startupLoading) {
            const loading = loadingIndicator('正在加载应用');
            loading.id = 'home-startup-loading'; recent.append(loading);
        } else {
            note(recent, `初始化失败：${state.startupError}`, true);
            recent.append(action('重新加载', () => { startupPromise = start(); return startupPromise; }, 'refresh'));
        }
        $('message-list').append(welcome); return;
    }
    const loading = el('div', 'home-loading', '正在加载最近角色…'); loading.setAttribute('role', 'status'); recent.append(loading);
    welcome.append(action('选择角色', () => navigation(), 'card', 'primary'));
    $('composer').hidden = true;
    document.body.classList.add('home-view');
    const recentRequest = state.homeReady ? (homeRecentRequest || loadRecentCharacters()) : null;
    if (state.homeReady) homeRecentRequest = null;
    const drawRecent = chats => {
        if (!recent.isConnected || !Array.isArray(chats)) return;
        recent.replaceChildren(el('h2', '', '最近使用的角色'));
        if (!chats.some(chat => chat.avatar)) recent.append(el('p', 'note', '暂无最近使用的角色，可在下方选择角色。'));
        const grid = el('div', 'home-character-grid'); recent.append(grid);
        const seen = new Set();
        for (const chat of chats) {
            if (!chat.avatar || seen.has(chat.avatar)) continue;
            seen.add(chat.avatar);
            const character = state.characters.find(item => item.avatar === chat.avatar);
            const name = character?.name || chat.characterName || chat.avatar.replace(/\.[^.]+$/, '');
            const card = el('article', 'character-file home-character');
            const cover = action(`进入 ${name} 最新聊天`, () => openCharacter(chat.avatar, { latest: true }), null, 'card-cover');
            cover.disabled = !state.ready;
            cover.setAttribute('aria-label', `进入 ${name} 最新聊天`);
            const portrait = image(chat.avatar, 'avatar', true); portrait.loading = 'lazy'; portrait.alt = name;
            portrait.addEventListener('error', () => { portrait.hidden = true; cover.classList.add('portrait-missing'); }, { once: true }); cover.append(portrait);
            const info = el('div', 'card-info'); info.append(el('h3', '', name));
            card.append(cover, info); grid.append(card);
            if (seen.size === 6) break;
        }
    };
    let cached = null; try { cached = JSON.parse(sessionStorage.getItem(`home-recent:${state.settings.username || 'default'}`) || 'null'); } catch {}
    if (Array.isArray(cached)) drawRecent(cached);
    if (recentRequest) void recentRequest.then(chats => {
        try { sessionStorage.setItem(`home-recent:${state.settings.username || 'default'}`, JSON.stringify(chats.slice(0, 100).map(chat => ({ avatar: chat.avatar, file_name: chat.file_name, characterName: state.characters.find(item => item.avatar === chat.avatar)?.name || chat.characterName })))); } catch {}
        drawRecent(chats);
    }).catch(error => { if (!cached) recent.replaceChildren(el('p', 'note', '最近角色加载失败，请稍后重试')); console.debug(error.message); });
    $('message-list').append(welcome);
}
function clearWelcome() { $('message-list').querySelector('.welcome')?.remove(); }
async function reloadResources() {
    const loaded = await api.bootstrapSettings(); state.settings = loaded.settings; state.bundle = loaded.bundle;
    const legacySelection = { independent_frontend: { preset: state.settings.independent_frontend?.preset }, extension_settings: { independent_frontend: { preset: state.settings.extension_settings?.independent_frontend?.preset } } };
    state.own = settingsOwn(state.settings);
    if (presetSelection.name !== null) state.own.preset = presetSelection.name;
    document.documentElement.dataset.palette = state.own.palette || 'paper';
    try{localStorage.setItem('independent-palette',state.own.palette||'paper');}catch{}
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',(state.own.palette||'paper')==='paper'?'#f3eee4':'#f7f8f4');
    try { const saved = JSON.parse(localStorage.getItem(`independent-reading:${state.settings.username || 'default'}`) || 'null'); if (saved) state.own.reading = readingSettings(saved, true); } catch { /* Use server preferences when local data is unavailable. */ }
    applyReading(state.own.reading);
    await presetSelection.load(legacySelection, presets().map(item => item.name));
    if (presetSelection.name !== null) state.own.preset = presetSelection.name;
    selectPreset(); synchronize();
}
let homeRecentRequest = null;
let connectionInitialization = null;
const loadRecentCharacters = () => recentCharacters.load();
function startupStage(text) {
    state.startupStage = text;
}
async function start() {
    state.startupLoading = true; state.startupError = ''; state.ready = false; state.connectionPending = true;
    const finish = loadTimings.start('全局初始化', 'startup'), pending = [];
    let outcome = 'success';
    welcome();
    try {
        startupStage('正在连接后端…');
        await loadTimings.measure('连接后端', 'startup', () => api.connect());
        homeRecentRequest = loadTimings.measure('首页最近角色', 'startup', loadRecentCharacters);
        homeRecentRequest.catch(() => {}); pending.push(homeRecentRequest);
        state.homeReady = true;
        const connectionsRequest = loadTimings.measure('读取 API 连接', 'startup', () => api.loadConnections());
        connectionsRequest.catch(() => {}); pending.push(connectionsRequest);
        startupStage('正在加载设置和预设…');
        await loadTimings.measure('设置与预设', 'startup', reloadResources);
        startupStage('正在完成 API 连接和最近角色初始化…');
        connectionInitialization = loadTimings.measure('初始化 API 连接', 'startup', () => initializeConnections(connectionsRequest));
        pending.push(connectionInitialization);
        const [recent, connection] = await Promise.allSettled([homeRecentRequest, connectionInitialization]);
        if (recent.status === 'rejected') outcome = 'partial';
        if (connection.status === 'rejected') {
            outcome = 'partial'; state.connectionError = connection.reason.message;
            notify(`连接初始化失败：${connection.reason.message}。请打开 API 面板检查。`, true);
        }
        state.ready = true;
    } catch (error) {
        outcome = 'error'; state.startupError = error.message; throw error;
    } finally {
        await Promise.allSettled(pending);
        state.startupLoading = false; state.connectionPending = false;
        synchronize(); if (!state.character) welcome(); finish(outcome);
    }
}
async function initializeConnections(connectionsRequest) {
    const stored = await connectionsRequest;
    if (stored) profileStore = connectionProfiles(stored);
    else {
        const native = state.settings.oai_settings || {};
        const config = { ...inheritedConnection(state.settings), id: uuid(), name: '默认连接' };
        if (native.reverse_proxy && (!config.url || config.url.replace(/\/+$/, '') === 'https://api.openai.com/v1')) {
            config.source = 'custom'; config.url = native.reverse_proxy;
        }
        if (config.url?.replace(/\/+$/, '') === native.reverse_proxy?.replace(/\/+$/, '') && native.proxy_password) config.proxyPassword ||= native.proxy_password;
        if (config.proxyPassword) {
            const result = await api.post('/api/secrets/write', { key: 'api_key_custom', value: config.proxyPassword, label: config.name });
            if (!result?.id) throw new Error('连接密码保存失败。'); config.secretId = result.id; config.source = 'custom';
        }
        if (config.source === 'custom' && !config.secretId) config.secretId = `no-key-${config.id}`;
        const initial = connectionProfiles({ version: 1, activeId: config.id, profiles: [config] });
        await api.saveConnections(initial); profileStore = initial;
    }
    const active = connection();
    if (active.proxyPassword) {
        const secrets = await api.post('/api/secrets/read') || {};
        const records = secrets.api_key_custom;
        if (!active.secretId || active.secretId.startsWith('no-key-') || !records || (Array.isArray(records) && !records.some(item => item.id === active.secretId))) {
            const result = await api.post('/api/secrets/write', { key: 'api_key_custom', value: active.proxyPassword, label: active.name || '独立前端' });
            if (!result?.id) throw new Error('当前连接密码注册失败。');
            await persistProfiles(upsertConnection(profileStore, { ...active, secretId: result.id }));
        }
    }
    synchronize();

    state.connectionError = ''; status('已连接'); synchronize();
}

function disposePanelWork() {
    $('panel-body').querySelector(':scope > .panel-content')?._dispose?.();
}
function showPanel(title, kicker = '工作空间', className = '') {
    if (variablesSaving) { notify('正在保存变量，请稍候', 'info'); return null; }
    if ($('panel').open && panelDirty && !confirm('放弃未保存的编辑？')) return null;
    disposePanelWork();
    panelDirty = false; panelRevision++;
    $('panel-title').textContent = title; $('panel-kicker').textContent = kicker;
    $('panel').className = className; $('panel-body').replaceChildren(); $('panel-body').removeAttribute('aria-busy');
    if (!$('panel').open) { (matchMedia('(max-width:700px)').matches ? $('panel').show() : $('panel').showModal()); history.pushState({ appPanel: true }, ''); }
    raiseNotification();
    return $('panel-body');
}
function closePanel() {
    if (variablesSaving) { notify('正在保存变量，请稍候', 'info'); return false; }
    if (panelDirty && !confirm('放弃未保存的编辑？')) return false;
    disposePanelWork();
    panelDirty = false; panelRevision++;
    setActiveTopPanel(null);
    $('panel').close();
    if (history.state?.appPanel) history.back();
    return true;
}
function timingPanel() {
    const iconAction = (label, callback, glyph) => {
        const button = action(label, callback, glyph, 'icon-button');
        button.title = label; button.setAttribute('aria-label', label); button.querySelector('span')?.remove();
        return button;
    };
    // Diagnostics have their own dialog and never enter the editable panel or
    // chat lifecycle (dirty flags, save queues, generation controller/history).
    const existing = document.getElementById('timing-dialog');
    if (existing) { existing.querySelector('button')?.focus(); return; }
    const dialog = el('dialog', 'timing-panel'); dialog.id = 'timing-dialog'; dialog.setAttribute('aria-labelledby', 'timing-title');
    const heading = el('div'), title = el('h1', '', '加载日志'); title.id = 'timing-title';
    heading.append(el('small', '', '最近 200 条 · 耗时记录'), title);
    const header = el('header', 'panel-header'), close = iconAction('关闭日志', () => dialog.close(), 'close');
    header.append(heading, close);
    const body = el('div', 'timing-body'); dialog.append(header, body);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    if (matchMedia('(max-width:700px)').matches) dialog.show(); else dialog.showModal();
    const toolbar = el('div', 'timing-toolbar'), container = el('div', 'timing-table-wrap');
    const draw = () => {
        container.replaceChildren();
        const entries = loadTimings.snapshot().reverse();
        if (!entries.length) { note(container, '暂无加载记录。'); return; }
        if (entries.some(entry => entry.status === 'error' && !entry.httpStatus && !entry.reason)) note(container, '部分旧记录未保存错误详情。刷新页面后，新记录会显示状态码和原因。');
        const table = el('table', 'timing-table'), head = el('thead'), row = el('tr');
        for (const label of ['加载项目', '开始时间', '耗时', '状态', '详情']) row.append(el('th', '', label));
        head.append(row); table.append(head); const content = el('tbody');
        for (const entry of entries) {
            const row = el('tr'); row.dataset.status = entry.status;
            row.append(el('td', '', entry.label), el('td', '', new Date(entry.startedAt).toLocaleTimeString()), el('td', '', `${entry.durationMs.toFixed(1)} ms`), el('td', '', timingStatusText(entry)), el('td', '', timingDetailText(entry)));
            content.append(row);
        }
        table.append(content); container.append(table);
    };
    const snapshotText = label => {
        const generationActive = Number(!!state.busy), signalAborted = Number(!!state.controller?.signal.aborted);
        loadTimings.start(label, 'diagnostic')('success', { metrics: { generationActive, signalAborted } });
        return JSON.stringify({ schema: 3, exportedAt: new Date().toISOString(), buildRevision: BUILD.revision, context: { generationActive, signalAborted, visibility: document.visibilityState, generationId: loadTimings.generationId }, preload: generationPreload.stats(), cache: historyRegexCache.capacity(), entries: loadTimings.snapshot() }, null, 2);
    };
    toolbar.append(iconAction('刷新记录', draw, 'refresh'), iconAction('导出日志', () => exportDiagnostics(snapshotText('导出日志快照'), body, () => !!state.busy), 'export'), iconAction('复制日志', async () => {
        await copyDiagnostics(snapshotText('复制日志快照'), body); notify('日志已复制');
    }, 'copy'), iconAction('清空日志', () => { loadTimings.clear(); draw(); }, 'trash'));
    body.append(toolbar);
    body.append(container); draw();
}
function field(parent, label, value = '', { multiline = false, type = 'text', hint = '', options, rows = 5 } = {}) {
    const wrap = el('label', 'field'); wrap.append(el('span', '', label));
    const input = el(options ? 'select' : multiline ? 'textarea' : 'input');
    if (options) for (const [value, label] of options) { const option = el('option', '', label); option.value = value; input.append(option); }
    else if (!multiline) input.type = type;
    if (multiline) input.rows = rows;
    input.value = value ?? ''; wrap.append(input);
    if (hint) wrap.append(el('small', '', hint));
    input.addEventListener('input', () => { panelDirty = true; });
    parent.append(wrap); return input;
}
function note(parent, text, warning = false) { parent.append(el('p', warning ? 'note warning' : 'note', text)); }
const avatarRevisions = new Map();
function image(avatar, type = 'avatar', original = false) {
    const img = el('img', 'avatar'); img.src = original ? `/characters/${encodeURIComponent(avatar)}?v=${avatarRevisions.get(avatar) || 0}` : `/thumbnail?type=${type}&file=${encodeURIComponent(avatar)}`; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; return img;
}
async function navigation() {
    return characterPanel();
}

async function openCharacter(avatar, { latest = false } = {}) {
    assertSaved();
    generationPreload.cancelScheduled();
    let loaded = false;
    state.loading = true; synchronize();
    try {
    status('读取角色…');
    // Independent reads share the same wait; commit the session only after its chat loads.
    const [character, chats] = await Promise.all([
        api.post('/api/characters/get', { avatar_url: avatar }),
        api.post('/api/characters/chats', { avatar_url: avatar }),
    ]);
    const timestamp = value => Number(value) || Date.parse(value) || 0;
    const recent = Array.isArray(chats) ? chats.sort((a, b) => timestamp(b.last_mes) - timestamp(a.last_mes)) : [];
    const stored = state.own.lastChats?.[avatar];
    const file = (!latest && stored && recent.find(chat => chat.file_name === stored + '.jsonl') ? stored : recent[0]?.file_name?.replace(/\.jsonl$/, '')) || null;
    await loadChat(file, true, character);
    loaded = true;
    synchronize();
    } finally { state.loading = false; synchronize(); if (loaded) preloadNextGeneration(); }
}
async function loadChat(file, internal = false, character = state.character) {
    if (!internal) assertSaved();
    if (!internal) generationPreload.cancelScheduled();
    let loaded = false;
    if (!internal) { state.loading = true; synchronize(); }
    try {
    status('读取聊天记录…');
    const data = file ? await api.post('/api/chats/get', { avatar_url: character.avatar, file_name: file }) : [];
    if (!Array.isArray(data)) throw new Error('聊天响应格式异常，已保留当前聊天。');
    const hasHeader = data[0] && !Object.hasOwn(data[0], 'mes');
    const header = hasHeader ? copy(data[0]) : { user_name: persona().name, character_name: character.name, create_date: new Date().toISOString(), chat_metadata: { integrity: uuid() } };
    header.chat_metadata ||= {};
    const chat = hasHeader ? data.slice(1) : data.slice();
    const nextFile = file || safeName(`${character.name} - ${new Date().toISOString().replace(/[:.]/g, '-')}-${uuid().slice(0, 6)}`);
    const greeting = character.data?.first_mes ?? character.first_mes;
    if (!chat.length && greeting) chat.push({ name: character.name, is_user: false, is_system: false, send_date: new Date().toISOString(), mes: greeting, extra: {} });
    const databaseMetadata = header.chat_metadata.independentDatabase ||= {};
    databaseMetadata.autoStart ??= chat.length;
    // No await between these assignments: character, identity and contents switch together.
    Object.assign(state, { character, header, chat, file: nextFile });
    clearWelcome(); list.setMessages(state.chat, { reset: true, latest: true });
    $('message-input').value = ''; synchronize(); status('正在保存聊天位置…');
    if (file) await rememberChat(internal ? { lastCharacter: character.avatar } : {});
    else if (internal && state.own.lastCharacter !== character.avatar) await saveOwn({ lastCharacter: character.avatar });
    status('已读取');
    loaded = true;
    } finally { if (!internal) { state.loading = false; synchronize(); if (loaded) preloadNextGeneration(); } }
}
async function rememberChat(patch = {}) {
    try {
        const key = `home-recent:${state.settings.username || 'default'}`;
        const previous = JSON.parse(sessionStorage.getItem(key) || '[]');
        sessionStorage.setItem(key, JSON.stringify([{ avatar: state.character.avatar, file_name: state.file, characterName: state.character.name }, ...previous.filter(item => item.avatar !== state.character.avatar)].slice(0, 100)));
    } catch {}
    recentCharacters.invalidate();
    const lastChats = { ...(state.own.lastChats || {}), [state.character.avatar]: state.file };
    if (state.own.lastChats?.[state.character.avatar] !== state.file) patch = { ...patch, lastChats };
    if (Object.keys(patch).some(key => JSON.stringify(state.own[key]) !== JSON.stringify(patch[key]))) await saveOwn(patch);
}
function saveChat() {
    generationPreload.invalidate();
    if (!state.character) return Promise.resolve();
    const record = loadTimings.measureSync('复制聊天保存快照', 'generation', () => ({ avatar: state.character.avatar, file: state.file, header: copy(state.header), messages: copy(state.chat) }));
    state.dirty = true; status('保存中…'); synchronize();
    const finishQueue = loadTimings.start('等待聊天保存队列', 'generation');
    const task = state.saves.catch(() => {}).then(async () => {
        finishQueue();
        await api.saveChat(record.avatar, record.file, record.header, record.messages);
        state.dirty = false; status('已保存'); synchronize();
    }).catch(error => { state.dirty = true; status('未保存 · 可重试', true); synchronize(); throw error; });
    state.saves = task; return task;
}
async function chatsPanel() {
    if (!state.character) return navigation();
    const body = showPanel('历史聊天', state.character.name); if (!body) return;
    const revision = panelRevision;
    const chats = await api.post('/api/characters/chats', { avatar_url: state.character.avatar });
    if (revision !== panelRevision) return;
    if (!Array.isArray(chats) || !chats.length) { note(body, '还没有已保存的对话。'); return; }
    const items = el('div', 'resource-list'); body.append(items);
    for (const chat of chats.sort((a, b) => (Number(b.last_mes) || Date.parse(b.last_mes) || 0) - (Number(a.last_mes) || Date.parse(a.last_mes) || 0))) {
        const row = action(chat.file_name.replace(/\.jsonl$/, ''), async () => { assertSaved(); if (closePanel()) await loadChat(chat.file_name.replace(/\.jsonl$/, '')); }, 'chat', 'resource-row');
        row.append(el('small', '', `${chat.chat_items || 0} 楼 · ${String(chat.mes || '').slice(0, 100)}`));
        const wrapper = el('div','chat-history-row'), tools = el('div','chat-history-tools'); wrapper.append(row,tools); items.append(wrapper);
        const file = chat.file_name.replace(/\.jsonl$/, ''), avatar=state.character.avatar;
        const read = () => api.post('/api/chats/get',{avatar_url:avatar,file_name:file});
        tools.append(action('导出聊天',async()=>{const data=await read();const url=URL.createObjectURL(new Blob([data.map(item=>JSON.stringify(item)).join('\n')],{type:'application/jsonl'}));const link=el('a');link.href=url;link.download=`${file}.jsonl`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'export'),action('复制聊天',async()=>{assertSaved();const data=await read();const next=`${file}-副本-${Date.now()}`;await api.post('/api/chats/save',{avatar_url:avatar,file_name:next,chat:data});panelDirty=false;await chatsPanel();},'copy'),action('删除聊天',async()=>{assertSaved();if(!confirm(`删除聊天「${file}」？`))return;await api.post('/api/chats/delete',{avatar_url:avatar,chatfile:file});if(state.file===file)await loadChat(null);panelDirty=false;await chatsPanel();},'trash','danger'));
        for(const button of tools.children){button.title=button.textContent;button.setAttribute('aria-label',button.textContent);}

    }
}

async function persistProfiles(next) {
    const valid = connectionProfiles(next); await api.saveConnections(valid); profileStore = valid; state.connectionError = ''; synchronize();
}
async function connectionPanel(profileId = '', draft = null) {
    if (state.connectionPending) await connectionInitialization.catch(() => {});
    const body = showPanel('连接与模型', 'API'); if (!body) return;
    if (!state.ready) { note(body, '正在读取保存的连接，请稍候再打开。'); return; }
    const revision = panelRevision;
    let current = draft || profileStore.profiles.find(item => item.id === profileId) || connection();
    const picker = el('select'); picker.setAttribute('aria-label', '选择 API 连接');
    for (const profile of profileStore.profiles) { const option = el('option', '', profile.name || profile.url); option.value = profile.id; picker.append(option); }
    if (draft) { const option = el('option', '', '新连接（未保存）'); option.value = draft.id; picker.append(option); }
    const profileBar = el('div', 'connection-profile-bar');
    picker.value = current.id; profileBar.append(picker); body.append(profileBar);
    picker.addEventListener('change', () => run(async () => {
        assertIdle(); const next = picker.value;
        if (panelDirty && !confirm('放弃未保存的连接修改并切换？')) { picker.value = current.id; return; }
        const updated = { ...profileStore, activeId: next }; await persistProfiles(updated); panelDirty = false; await connectionPanel(next);
    }));
    const profileTools = el('div', 'connection-profile-tools');
    profileTools.append(action('新建连接', () => connectionPanel('', { id: uuid(), name: '新连接', source: 'custom', url: '', model: '', stream: true, postProcessing: 'merge' }), 'plus'),
        action('复制连接', () => connectionPanel('', { ...copy(current), id: uuid(), name: `${current.name || '连接'}（副本）` }), 'copy'),
        action('删除连接', async () => {
            assertIdle(); if (profileStore.profiles.length <= 1) throw new Error('至少保留一个连接。');
            if (!confirm('删除这个连接配置？不会删除酒馆密钥库里的密钥。')) return;
            const profiles = profileStore.profiles.filter(item => item.id !== current.id);
            await persistProfiles({ version: 1, activeId: profileStore.activeId === current.id ? profiles[0].id : profileStore.activeId, profiles });
            panelDirty = false; await connectionPanel();
        }, 'trash', 'danger'));
    for (const button of profileTools.children) {
        const label = button.querySelector('span').textContent;
        button.title = label; button.setAttribute('aria-label', label);
    }
    profileBar.append(profileTools);
    const profileName = field(body, '连接名称', current.name || '默认连接');
    const url = field(body, 'API 基础地址', current.url || '', { type: 'url' });
    const model = field(body, '模型', current.model || '', { options: [[current.model || '', current.model || '读取列表或输入模型 ID']] });
    model.dataset.searchable = 'true'; model.dataset.allowCustom = 'true';
    const modelRow = el('div', 'connection-model-row'); model.before(modelRow); modelRow.append(model);
    const stream = field(body, '回复方式', current.stream === false ? 'normal' : 'stream', { options: [['stream', '流式 · 边生成边显示'], ['normal', '非流式 · 完整回复后显示']] });
    const postProcessing = field(body, '提示词后处理', current.postProcessing ?? 'merge', { options: [['merge', '合并相同角色的连续发言'], ['', '不处理']] });
    let savedKey = typeof current.proxyPassword === 'string' ? current.proxyPassword : sessionKeys.get(current.secretId) || '';
    const key = field(body, 'API Key', savedKey, { type: 'password' }); key.autocomplete = 'new-password';
    let masked = false;
    key.addEventListener('focus', () => { if (masked) { key.select(); } });
    key.addEventListener('beforeinput', () => { if (masked) { masked = false; key.value = ''; } });
    key.addEventListener('input', () => { if (masked && key.value !== '********') masked = false; });
    const keyWrap = el('div', 'key-input-wrap'); key.before(keyWrap); keyWrap.append(key);
    const eye = action('显示密钥', async () => {
        if (masked) {
            throw new Error('此旧连接只保留了密钥引用。请重新填写一次密码并保存，之后刷新即可查看。');
        }
        const visible = key.type === 'password'; key.type = visible ? 'text' : 'password';
        eye.replaceChildren(icon(visible ? 'eyeOff' : 'eye')); eye.title = visible ? '隐藏密钥' : '显示密钥'; eye.setAttribute('aria-label', eye.title); eye.setAttribute('aria-pressed', String(visible));
    }, 'eye', 'key-toggle'); eye.setAttribute('aria-label', '显示密钥'); eye.title = '显示密钥'; eye.setAttribute('aria-pressed', 'false'); keyWrap.append(eye);
    const secretState = await api.post('/api/secrets/read') || {};
    if (revision !== panelRevision) return;
    if (!savedKey && !key.value) {
        savedKey = visibleConnectionPassword(current, state.settings, secretState);
        if (savedKey) { key.value = savedKey; sessionKeys.set(current.secretId, savedKey); }
    }
    const hasStoredReference = current.secretId && !current.secretId.startsWith('no-key-');
    if (!savedKey && hasStoredReference) { masked = true; key.value = '********'; }
    const enteredKey = () => masked ? '' : key.value.trim();
    url.closest('label').after(key.closest('label'));
    postProcessing.closest('label').after(model.closest('label'));
    const getConnection = () => normalizeConnection({ id: current.id, name: profileName.value.trim(), source: 'custom', url: url.value.trim(), model: model.value.trim(), stream: stream.value === 'stream', postProcessing: postProcessing.value, secretId: current.source === 'custom' ? current.secretId : undefined,
        ...((enteredKey() || current.proxyPassword) ? { proxyPassword: enteredKey() || current.proxyPassword } : {}) });
    const save = async (showNotice = true) => {
        assertIdle(); const value = getConnection();
        if (!value.name) throw new Error('请输入连接名称。');
        if (value.source === 'custom' && current.source === 'openai' && !enteredKey() && current.secretId && !secretState?.api_key_custom) {
            throw new Error('此反代需要切换到兼容模式。旧密钥保存在官方接口下，请在 API Key 中重新填写反代密钥，再读取模型。');
        }
        if (enteredKey() && (enteredKey() !== savedKey || current.source !== 'custom' || enteredKey() !== current.proxyPassword)) {
            const result = await api.post('/api/secrets/write', { key: value.source === 'custom' ? 'api_key_custom' : 'api_key_openai', value: enteredKey(), label: '独立前端' });
            value.secretId = result.id; savedKey = enteredKey(); sessionKeys.set(result.id, savedKey);
            secretState[value.source === 'custom' ? 'api_key_custom' : 'api_key_openai'] = true;
        }
        if (!value.secretId) value.secretId = `no-key-${value.id}`;
        await persistProfiles(upsertConnection(profileStore, value));
        current = value; url.value = value.url;
        if (![...picker.options].some(option => option.value === value.id)) { const option = el('option'); option.value = value.id; picker.append(option); }
        [...picker.options].find(option => option.value === value.id).textContent = value.name; picker.value = value.id;
        panelDirty = false; if (showNotice) notify('连接配置已保存');
    };
    body.append(action('保存连接', save, 'plug', 'primary'));
    const readModels = action('读取模型列表', async () => {
        await save(false);
        const config = getConnection();
        const result = await api.post('/api/backends/chat-completions/status', { chat_completion_source: config.source, custom_url: config.url, secret_id: config.secretId });
        const models = modelOptions(result);
        const previous = model.value; model.replaceChildren();
        if (previous && !models.some(([id]) => id === previous)) models.unshift([previous, previous]);
        for (const [id, label] of models) { const option = el('option', '', label); option.value = id; model.append(option); }
        model.value = previous || models[0][0]; panelDirty = true;
        notify(`已读取 ${models.length} 个模型`);
    }, 'refresh', 'model-refresh');
    readModels.querySelector('span').remove(); readModels.title = '读取模型列表'; readModels.setAttribute('aria-label', '读取模型列表');
    modelRow.append(readModels);
}

async function presetPanel() {
    const host = showPanel('生成预设', '提示词与生成参数', 'preset-panel'); if (!host) return;
    return loadPanelContent(host, '预设', (body, revision) => renderPresetPanel(body, revision), () => presetPanel());
}
async function renderPresetPanel(body, revision) {
    if (state.presetMissing) note(body, '保存的预设已不存在，请重新选择；当前未自动启用其他预设。');
    const available = presets();
    let draft = presetDraft(available.length ? state.preset : createPreset());
    const presetBar = el('div', 'connection-profile-bar preset-profile-bar');
    const select = el('select'); select.setAttribute('aria-label', '当前预设');
    select.dataset.searchable = 'true'; select.dataset.searchPlaceholder = '搜索预设…'; select.dataset.searchLabel = '搜索预设';
    for (const preset of available) { const option = el('option', '', preset.name); option.value = preset.name; select.append(option); }
    if (state.presetMissing) { const missing = el('option', '', '保存的预设不存在，请重新选择'); missing.value = ''; missing.disabled = true; select.prepend(missing); }
    select.value = state.presetMissing ? '' : state.own.preset;
    const presetTools = el('div', 'connection-profile-tools'); presetBar.append(select, presetTools); body.append(presetBar);
    const name = field(body, '预设名称', select.value);
    const parameters = el('div', 'parameter-grid'); body.append(parameters);
    const controls = new Map();
    for (const [key, label, fallback, step] of [['temperature', 'Temperature', 1, .05], ['top_p', 'Top P', 1, .05], ['openai_max_context', '上下文长度', 8192, 1], ['openai_max_tokens', '最大回复 tokens', 512, 1]]) {
        const input = field(parameters, label, draft[key] ?? fallback, { type: 'number' }); input.step = step;
        controls.set(key, { input, fallback });
        if (draft[key] === undefined) draft[key] = fallback;
        input.addEventListener('input', () => { draft[key] = Number(input.value); });
    }
    const heading = el('div', 'section-heading');
    const count = el('span', 'item-count');
    const title = el('div'); title.append(el('h2', '', '提示词条目'), count); heading.append(title);
    const rows = el('div', 'prompt-list');
    const opened = new Set();
    let pageReady = false, tokenPreview;
    body._onReady = () => { pageReady = true; tokenPreview?.start(); };
    body._dispose = () => { pageReady = false; tokenPreview?.dispose(); rows._disposeDrag?.(); };
    const markDirty = () => { panelDirty = true; };
    const updateCount = () => { const order = promptOrder(draft); count.textContent = `${order.length} 个条目 · ${order.filter(item => item.enabled !== false).length} 个启用`; };
    const renderRows = () => {
        rows._disposeDrag?.(); tokenPreview?.dispose();
        tokenPreview = new PresetTokenPreview({ api, model: connection().model, character: state.character, persona: persona(), preset: draft, chat: state.chat, header: state.header, settings: state.settings, databaseConfig: state.own.database, loadBooks: signal => loadBooks({ signal }) });
        rows.replaceChildren(); updateCount();
        for (const { order, prompt, index } of promptRows(draft)) {
            const details = el('details', 'prompt-item'); details.dataset.promptId = prompt.identifier;
            details.open = opened.has(prompt.identifier); details.classList.toggle('prompt-disabled', order.enabled === false);
            details.addEventListener('toggle', () => { if (!details.isConnected) return; if (details.open) { opened.add(prompt.identifier); renderForm(); } else opened.delete(prompt.identifier); });
            const summary = el('summary', 'prompt-summary');
            const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = order.enabled !== false;
            enabled.setAttribute('aria-label', `启用 ${prompt.name || prompt.identifier}`);
            enabled.addEventListener('click', event => event.stopPropagation());
            enabled.addEventListener('change', () => { order.enabled = enabled.checked; details.classList.toggle('prompt-disabled', !enabled.checked); markDirty(); updateCount(); });
            const titleWrap = el('span', 'prompt-title');
            const label = el('span', '', prompt.name || markerLabels[prompt.identifier] || prompt.identifier);
            titleWrap.append(label);
            if (prompt.marker) {
                const marker = el('span', 'prompt-autofill'); marker.title = '自动填充'; marker.setAttribute('role', 'img'); marker.setAttribute('aria-label', '自动填充'); marker.append(icon('autofill')); titleWrap.append(marker);
            }
            const roleLabel = () => ['chatHistory', 'dialogueExamples'].includes(prompt.identifier) && !prompt.independent_role_override ? '原消息角色' : ({ system: '系统', user: '用户', assistant: '助手' }[prompt.role || 'system']);
            const kind = el('small', 'prompt-kind', roleLabel());
            const tokenCount = el('small', 'prompt-token-count', '-');
            let tokenVersion = 0, tokenTimer;
            const updateTokens = async () => {
                const scope = tokenPreview;
                if (scope.signal.aborted || revision !== panelRevision || (pageReady && !tokenCount.isConnected)) return;
                const version = ++tokenVersion;
                tokenCount.textContent = '…'; tokenCount.title = '后台统计 tokens…';
                try {
                    const count = await scope.count(prompt);
                    if (scope.signal.aborted || version !== tokenVersion || !tokenCount.isConnected) return;
                    tokenCount.textContent = Number.isFinite(count) && count > 0 ? String(count) : '-';
                    tokenCount.title = '按当前聊天数据展开宏后的条目计数，含消息封装；最终请求可能受正则与上下文裁剪影响';
                } catch {
                    if (!scope.signal.aborted && version === tokenVersion && tokenCount.isConnected) tokenCount.textContent = '-';
                }
            };
            titleWrap.append(kind);
            summary.append(enabled, titleWrap, tokenCount);
            void updateTokens();
            details.append(summary);
            const content = el('div', 'prompt-form');
            const toolbar = el('span', 'prompt-actions prompt-inline-actions inset-action-menu'); toolbar.hidden = true;
            toolbar.id = `prompt-actions-${uuid()}`; toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', '条目操作');
            toolbar.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
            const more = action('条目操作', () => {
                const expand = toolbar.hidden;
                for (const other of rows.querySelectorAll('.prompt-inline-actions')) other.hidden = true;
                for (const other of rows.querySelectorAll('.prompt-actions-toggle')) other.setAttribute('aria-expanded', 'false');
                toolbar.hidden = !expand; more.setAttribute('aria-expanded', String(expand));
            }, 'more', 'prompt-actions-toggle');
            more.title = '条目操作'; more.setAttribute('aria-label', `${prompt.name || prompt.identifier} 的条目操作`); more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-controls', toolbar.id);
            more.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
            const actionAnchor = el('span', 'prompt-action-anchor'); actionAnchor.append(toolbar, more);
            summary.append(actionAnchor);
            summary.addEventListener('keydown', event => {
                if (event.key !== 'Escape' || toolbar.hidden) return;
                event.preventDefault(); event.stopPropagation(); toolbar.hidden = true; more.setAttribute('aria-expanded', 'false'); more.focus();
            });
            const up = action('上移', () => { movePrompt(draft, prompt.identifier, -1); markDirty(); renderRows(); }, 'up'); up.disabled = index === 0;
            const down = action('下移', () => { movePrompt(draft, prompt.identifier, 1); markDirty(); renderRows(); }, 'down'); down.disabled = index === promptOrder(draft).length - 1;
            toolbar.append(up, down);
            if (!prompt.marker) {
                toolbar.append(action('复制条目', () => {
                    const id = uuid(); addPrompt(draft, id);
                    Object.assign(draft.prompts.find(item => item.identifier === id), copy(prompt), { identifier: id, name: `${prompt.name || '提示词'}（副本）` });
                    opened.add(id); markDirty(); renderRows();
                }, 'copy'));
                toolbar.append(action('删除条目', () => {
                    if (!confirm(`删除提示词「${prompt.name || prompt.identifier}」？保存预设后生效。`)) return;
                    removePrompt(draft, prompt.identifier); markDirty(); renderRows();
                }, 'trash', 'danger'));
            }
            for (const button of toolbar.children) { const text = button.textContent.trim(); button.title = text; button.setAttribute('aria-label', text); }
            let formBuilt = false;
            const renderForm = () => {
                if (formBuilt) return; formBuilt = true;
                const promptName = field(content, '条目名称', prompt.name || prompt.identifier);
                promptName.addEventListener('input', () => { prompt.name = promptName.value; label.textContent = prompt.name || prompt.identifier; });
                const block = ['chatHistory', 'dialogueExamples'].includes(prompt.identifier);
                const roleOptions = [['system', 'System · 系统'], ['user', 'User · 用户'], ['assistant', 'Assistant · 助手']];
                if (block) roleOptions.unshift(['inherit', '保留原消息角色']);
                const role = field(content, '消息角色', block && !prompt.independent_role_override ? 'inherit' : prompt.role || 'system', { options: roleOptions });
                role.addEventListener('change', () => {
                    if (role.value === 'inherit') delete prompt.independent_role_override;
                    else { prompt.role = role.value; if (block) prompt.independent_role_override = true; }
                    kind.textContent = roleLabel();
                });
                if (block) note(content, '默认保留用户与角色各自的发言身份。选择固定角色会将此条目内的全部消息统一为该角色。');
                if (prompt.marker) note(content, `自动填充${markerLabels[prompt.identifier] || prompt.name}。可以调整顺序或开关，内容来自对应的角色、用户设定、世界书或聊天记录。`);
                else {
                    const text = field(content, '提示词内容', prompt.content || '', { multiline: true, rows: 7, hint: '可使用 {{char}}、{{user}} 等已支持的宏。' });
                    text.addEventListener('input', () => { prompt.content = text.value; tokenVersion++; clearTimeout(tokenTimer); tokenTimer = setTimeout(updateTokens, 500); });
                    const injection = el('div', 'parameter-grid');
                    const position = field(injection, '插入位置', Number(prompt.injection_position) || 0, { options: [[0, '按条目顺序'], [1, '插入聊天深度']] });
                    const depth = field(injection, '聊天深度', prompt.injection_depth ?? 0, { type: 'number', hint: '0 表示聊天记录末尾。' }); depth.min = 0; depth.step = 1;
                    depth.addEventListener('input', () => { prompt.injection_depth = Number(depth.value); });
                    const priority = field(injection, '深度内排序', prompt.injection_order ?? 100, { type: 'number' }); priority.step = 1;
                    priority.addEventListener('input', () => { prompt.injection_order = Number(priority.value); });
                    const updateDepthFields = () => {
                        const hidden = Number(position.value) !== 1;
                        depth.closest('.field').hidden = hidden; priority.closest('.field').hidden = hidden;
                    };
                    position.addEventListener('change', () => { prompt.injection_position = Number(position.value); updateDepthFields(); });
                    updateDepthFields();
                    content.append(injection);
                    if (prompt.injection_trigger?.length) note(content, '此条目含生成类型过滤规则，当前编辑会保留该规则；生成引擎暂不支持它。', true);
                }
            };
            if (details.open) renderForm();
            details.append(content); rows.append(details);
        }
        rows._disposeDrag = installPromptDrag(rows, $('panel-body'), identifiers => {
            const order = promptOrder(draft);
            const entries = new Map(order.map(item => [item.identifier, item]));
            if (identifiers.some((id, index) => order[index]?.identifier !== id)) {
                order.splice(0, order.length, ...identifiers.map(id => entries.get(id)));
                markDirty(); renderRows();
            }
        });
        if (pageReady) tokenPreview.start();
    };
    heading.append(action('添加条目', () => {
        const id = uuid(); addPrompt(draft, id); opened.add(id); markDirty(); renderRows();
        const target = [...rows.children].find(node => node.dataset.promptId === id); target?.scrollIntoView({ block: 'nearest' });
    }, 'plus'));
    body.append(heading, rows);

    const loadDraft = (value, title) => {
        draft = presetDraft(value); name.value = title; opened.clear();
        for (const [key, { input, fallback }] of controls) { draft[key] ??= fallback; input.value = draft[key]; }
        renderRows();
    };
    let previousPreset = select.value;
    let draftOnly = false;
    const beginDraft = (data, title) => {
        const next = presetDraft(data);
        for (const option of [...select.options]) if (option.dataset.draft) option.remove();
        const option = el('option', '', `${title}（未保存）`); option.value = `draft-${uuid()}`; option.dataset.draft = 'true'; select.append(option); select.value = option.value;
        previousPreset = option.value; draftOnly = true; deletePreset.disabled = true;
        loadDraft(next, title); panelDirty = true;
    };
    const toolbarButton = (label, callback, glyph, className = '') => {
        const button = action(label, callback, glyph, className); button.title = label; button.setAttribute('aria-label', label); presetTools.append(button); return button;
    };
    toolbarButton('导入预设', async () => {
        if (panelDirty && !confirm('放弃修改并导入其他预设？')) return;
        const file = await pickFile('.json'); if (!file) return;
        const data = JSON.parse(await file.text());
        beginDraft(data, file.name.replace(/\.json$/i, ''));
        notify('预设已载入，保存后生效');
    }, 'import');
    toolbarButton('导出预设', () => {
        const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob); const link = el('a'); link.href = url; link.download = `${safeName(name.value.trim() || '预设')}.json`;
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'export');
    toolbarButton('新增预设', () => {
        if (panelDirty && !confirm('放弃未保存的修改并新建预设？')) return;
        beginDraft(createPreset(), uniquePresetName('新预设', available.map(preset => preset.name)));
    }, 'plus');
    toolbarButton('复制预设', () => beginDraft(copy(draft), uniquePresetName(`${name.value.trim() || '预设'}（副本）`, available.map(preset => preset.name))), 'copy');
    const deletePreset = toolbarButton('删除预设', async () => {
        assertIdle(); if (draftOnly) throw new Error('请先保存新预设。');
        if (available.length <= 1) throw new Error('至少保留一个预设，请先新增其他预设。');
        const target = select.value;
        if (!confirm(`删除预设「${target}」？此操作会删除预设文件。`)) return;
        await api.post('/api/presets/delete', { apiId: 'openai', name: target });
        const next = state.own.preset === target || !available.some(preset => preset.name === state.own.preset) ? available.find(preset => preset.name !== target).name : state.own.preset;
        await saveOwn({ preset: next }); await reloadResources(); list.setMessages(state.chat, { reset: true }); panelDirty = false; notify('预设已删除'); await presetPanel();
    }, 'trash', 'danger');
    select.addEventListener('change', () => run(async () => {
        assertIdle();
        if (panelDirty && !confirm('放弃当前未保存的预设修改并切换？')) { select.value = previousPreset; return; }
        const target = select.value;
        try {
            const selected = available.find(item => item.name === target);
            if (!selected) throw new Error('预设已不存在，请重新选择。');
            presetDraft(selected.data);
            await saveOwn({ preset: target });
        } catch (error) { select.value = previousPreset; throw error; }
        selectPreset(); list.setMessages(state.chat, { reset: true });
        loadDraft(state.preset, target); previousPreset = target; draftOnly = false; deletePreset.disabled = false; panelDirty = false;
        for (const option of [...select.options]) if (option.dataset.draft) option.remove();
        notify('预设已切换');
    }));
    const footer = el('div', 'editor-footer');
    footer.append(action('保存并使用', async () => {
        assertIdle(); const data = validatePreset(draft);
        if (!name.value.trim()) throw new Error('请输入预设名称。');
        const targetName = safeName(name.value.trim());
        if (available.some(p => p.name === targetName) && !confirm('覆盖同名预设？')) return;
        const result = await api.post('/api/presets/save', { apiId: 'openai', name: targetName, preset: data });
        await saveOwn({ preset: result.name }); await reloadResources(); list.setMessages(state.chat, { reset: true }); panelDirty = false; notify('预设已保存'); await presetPanel();
    }, 'edit', 'primary'));
    body.append(footer); renderRows();
    if (!available.length) beginDraft(createPreset(), '新预设');
}

async function regexPanel(scope = 'global', target = '') {
    if (!['global', 'preset', 'character', 'global-script', 'character-script'].includes(scope)) scope = 'global';
    const reuse = $('panel').open && $('panel').classList.contains('regex-panel');
    let host;
    if (reuse) {
        if (panelDirty && !confirm('放弃未保存的修改？')) return;
        panelDirty = false; panelRevision++; host = $('panel-body');
    } else { host = showPanel('正则与脚本', '正则规则 · 全局脚本 · 角色卡脚本', 'regex-panel'); if (!host) return; }
    return loadPanelContent(host, '正则与脚本', (body, revision, timing) => renderRegexPanel(body, revision, scope, target, timing), () => regexPanel(scope, target), { retainContent: reuse });
}
async function renderRegexPanel(body, revision, scope, target, timing) {
    const finishData = timing?.start('正则与脚本 · 准备分类与规则', 'data');
    body.classList.add('regex-panel-content');
    const fresh = { settings: state.settings, bundle: state.bundle }; if (revision !== panelRevision) return;
    const available = presetCatalog(fresh.bundle);
    const tabs = el('nav', 'regex-tabs'); tabs.setAttribute('aria-label', '正则与脚本分类');
    for (const [id, label] of [['global', '全局正则'], ['preset', '预设正则'], ['character', '角色卡正则'], ['global-script', '全局脚本'], ['character-script', '角色卡脚本']]) {
        const button = action(label, () => { if (scope !== id) return regexPanel(id); }, id === 'global' ? 'regex' : id === 'preset' ? 'tools' : 'card');
        button.setAttribute('aria-pressed', String(scope === id)); tabs.append(button);
    }
    body.append(tabs);
    if (scope.endsWith('-script')) { finishData?.('success', { metrics: { scopeCode: scope === 'global-script' ? 4 : 5 } }); await renderScriptManager(body, revision, scope, target, timing); return; }
    let entity = null; let rules = []; let selected = target;
    const chooseTarget = (label, options, value) => {
        const wrap = el('label', 'field'); wrap.append(el('span', '', label)); const select = el('select');
        for (const [value, name] of options) { const option = el('option', '', name); option.value = value; select.append(option); }
        select.value = value; wrap.append(select); body.append(wrap);
        select.addEventListener('change', () => run(async () => {
            const next = select.value; if (panelDirty && !confirm('放弃当前未保存的正则修改？')) { select.value = selected; return; }
            panelDirty = false; await regexPanel(scope, next);
        }));
    };
    if (scope === 'global') {
        rules = copy(scopedRegexes({ settings: fresh.settings }).global);
    } else if (scope === 'preset') {
        selected = available.some(item => item.name === selected) ? selected : available.find(item => item.name === fresh.settings.independent_frontend?.preset)?.name || available[0]?.name;
        entity = available.find(item => item.name === selected);
        chooseTarget('管理的预设', available.map(item => [item.name, item.name]), selected);
        rules = copy(presetRegexes(entity?.data));
    } else {
        await loadCharacterCatalog(false, timing);
        const cards = state.characters; if (revision !== panelRevision) return;
        selected = cards.some(card => card.avatar === selected) ? selected : cards.find(card => card.avatar === state.character?.avatar)?.avatar || cards[0]?.avatar;
        chooseTarget('管理的角色卡', cards.map(card => [card.avatar, card.name]), selected);
        if (selected) entity = cards.find(card => card.avatar === selected);
        if (selected) entity = await api.post('/api/characters/get', { avatar_url: selected }, { timing });
        if (revision !== panelRevision) return;
        rules = copy(scopedRegexes({ character: entity }).character);
    }
    finishData?.('success', { metrics: { ruleCount: rules.length, scopeCode: { global: 1, preset: 2, character: 3 }[scope] } });
    if (scope !== 'global' && !entity) { note(body, '没有可管理的对象，请先创建或导入。'); return; }
    const count = el('p', 'note'); body.append(count);
    const toolbar = el('div', 'regex-toolbar'); body.append(toolbar);
    const rows = el('div', 'regex-list'); body.append(rows);
    body._dispose = () => rows._disposeDrag?.();
    const updateCount = () => { count.textContent = `${rules.length} 条规则 · ${rules.filter(rule => !rule.disabled).length} 条启用`; };
    const dirty = () => { panelDirty = true; updateCount(); };
    const render = () => { updateCount(); const build = () => renderRegexEditor(rows, rules, dirty); return timing ? timing.measureSync('正则与脚本 · 构建正则列表', 'data', build, () => ({ metrics: { ruleCount: rules.length } })) : build(); };
    toolbar.append(action('新建正则', () => {
        rules.push({ id: uuid(), scriptName: '新的正则', findRegex: '', replaceString: '', placement: [2], disabled: false, markdownOnly: false, promptOnly: false, runOnEdit: false, trimStrings: [], minDepth: null, maxDepth: null, substituteRegex: 0 });
        dirty(); render(); rows.lastElementChild.open = true;
    }, 'plus'), action('导入正则', async () => {
        const file = await pickFile('.json'); if (!file) return;
        const value = JSON.parse(await file.text());
        const imported = Array.isArray(value) ? value : Array.isArray(value?.extensions?.regex_scripts) ? value.extensions.regex_scripts : Array.isArray(value?.regex_scripts) ? value.regex_scripts : value?.findRegex !== undefined ? [value] : null;
        if (!imported || imported.some(rule => !rule || typeof rule !== 'object' || Array.isArray(rule))) throw new Error('文件中没有可识别的正则规则。');
        rules.push(...copy(imported).map(rule => ({ ...rule, id: uuid() }))); dirty(); render(); notify(`已载入 ${imported.length} 条规则，保存后生效。`);
    }, 'folder'));
    const footer = el('div', 'editor-footer');
    footer.append(action('保存正则', async () => {
        assertIdle();
        if (scope === 'global') {
            state.settings = await api.patchSettings(settings => { (settings.extension_settings ||= {}).regex = copy(rules); });
            state.own = settingsOwn(state.settings);
    if (presetSelection.name !== null) state.own.preset = presetSelection.name;
        } else if (scope === 'preset') {
            const latest = await api.settings(); const index = latest.bundle.openai_setting_names.indexOf(selected);
            if (index < 0) throw new Error('此预设已不存在，请重新选择。');
            const raw = latest.bundle.openai_settings[index]; const data = typeof raw === 'string' ? JSON.parse(raw) : copy(raw);
            (data.extensions ||= {}).regex_scripts = copy(rules);
            const result = await api.post('/api/presets/save', { apiId: 'openai', name: selected, preset: data });
            if (!result?.name) throw new Error('预设正则保存失败。');
            await reloadResources();
        } else {
            const result = await api.post('/api/characters/merge-attributes', { avatar: selected, data: { extensions: { regex_scripts: copy(rules) } } });
            if (result?.ok !== true) throw new Error('角色卡正则保存失败。');
            if (state.character?.avatar === selected) state.character = await api.post('/api/characters/get', { avatar_url: selected });
        }
        panelDirty = false; list.setMessages(state.chat, { reset: true }); notify('正则已保存');
    }, 'edit', 'primary')); body.append(footer); render();
}

function scriptIdentity() { return `${state.character?.avatar || ''}/${state.file}/${state.header?.chat_metadata?.integrity || ''}`; }
async function helperHostAction(operation, payload, identity) {
    const owner = scriptRuntime.frame, epoch = scriptRuntime.epoch;
    const check = () => {
        if (scriptRuntime.frame !== owner || scriptRuntime.epoch !== epoch) throw Error('脚本环境已关闭或重新启动，结果未写入。');
        if (!state.character || identity !== scriptIdentity() || state.loading) throw Error('聊天已切换，脚本结果未写入。');
        if (state.busy && !scriptRuntime.processing || state.dirty || inlineEdit || panelDirty) throw Error('当前正在生成、编辑或尚未保存，请稍后重试。');
    };
    check();
    if (operation === 'read-worldbook') {
        const permitted = new Set([state.character.data?.extensions?.world, state.character.extensions?.world, ...(state.settings.world_info_settings?.world_info?.globalSelect || [])]);
        if (typeof payload?.name !== 'string' || !permitted.has(payload.name)) throw Error('只允许读取当前角色关联或已启用的世界书。');
        const book = await api.post('/api/worldinfo/get', { name: payload.name }, { signal: AbortSignal.timeout(15000) });
        check(); return { value: roleWorldEntries(book) };
    }
    if (variablesSaving) throw Error('正在保存变量，请稍候。');
    variablesSaving = true;
    try {
        if (['save-variables', 'set-messages', 'save-chat'].includes(operation)) {
            const avatar = state.character.avatar, file = state.file;
            const records = await api.post('/api/chats/get', { avatar_url: avatar, file_name: file }); check();
            const next = operation === 'save-variables' ? patchHelperVariables(records, payload?.changes) : operation === 'save-chat' ? patchHelperMessages(patchHelperVariables(records, payload?.changes), payload?.messages) : patchHelperMessages(records, payload?.messages);
            await api.saveChat(avatar, file, next[0], next.slice(1));
            const verified = await api.post('/api/chats/get', { avatar_url: avatar, file_name: file }); check();
            if (JSON.stringify(verified) !== JSON.stringify(next)) throw Error('脚本聊天保存核验失败，请重新打开聊天。');
            // Preserve message object identities held by generation and MVU.
            state.header = copy(verified[0]);
            const messages = verified.slice(1);
            if (messages.length !== state.chat.length) throw Error('聊天楼层数量已变化，请重新打开聊天。');
            for (let i = 0; i < messages.length; i++) {
                for (const key of Object.keys(state.chat[i])) if (!Object.hasOwn(messages[i], key)) delete state.chat[i][key];
                Object.assign(state.chat[i], copy(messages[i]));
            }
            list.setMessages(state.chat, { latest: list.follow });
        } else if (['save-settings', 'save-globals', 'save-lore-settings', 'save-buttons'].includes(operation)) {
            const value = operation === 'save-buttons' ? validateVariables({ buttons: payload?.value }) : validateVariables(operation === 'save-lore-settings' ? payload?.settings : payload?.value);
            const plan = nativeScriptPlan(state.settings, state.character);
            const caller = plan.find((script, index) => `${script.scope}-${script.id || index}` === payload?.scriptId && script.enabled !== false);
            if (payload?.scriptId && !caller || operation === 'save-buttons' && !caller) throw Error('脚本目标无效或已停用。');
            const legacySettings = !payload?.scriptId || scriptSupport(caller).adapter === 'remote-module';
            await api.patchSettings(settings => {
                check();
                const helper = ((settings.extension_settings ||= {}).independentHelper ||= {});
                if (operation === 'save-buttons') {
                    if (!Array.isArray(value.buttons) || value.buttons.length > 100 || value.buttons.some(item => typeof item?.name !== 'string' || item.name.length > 100 || typeof item.visible !== 'boolean')) throw Error('脚本按钮格式无效。');
                    (helper.scriptButtons ||= {})[payload.scriptId] = copy(value.buttons);
                } else if (operation === 'save-lore-settings') {
                    const numeric = { scan_depth: ['world_info_depth', 1000], context_percentage: ['world_info_budget', 100], budget_cap: ['world_info_budget_cap', 2000000], max_recursion_steps: ['world_info_max_recursion_steps', 1000] };
                    const wi = settings.world_info_settings ||= {};
                    for (const [key, [target, max]] of Object.entries(numeric)) if (value[key] !== undefined) {
                        if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > max) throw Error('世界书设置数值无效。');
                        wi[target] = value[key];
                    }
                    for (const key of ['recursive', 'case_sensitive', 'match_whole_words']) if (value[key] !== undefined) {
                        if (typeof value[key] !== 'boolean') throw Error('世界书开关设置无效。');
                        wi['world_info_' + key] = value[key];
                    }
                    if (value.selected_global_lorebooks !== undefined) throw Error('脚本暂不支持改写全局世界书选择。');
                    helper.loreSettings = { ...(helper.loreSettings || {}), ...copy(value) };
                } else {
                    const current = operation === 'save-settings' ? (legacySettings ? helper.mvu : helper.scriptSettings?.[payload.scriptId]) || {} : settings.extension_settings.variables?.global || {};
                    if (JSON.stringify(current) !== JSON.stringify(payload.base) && JSON.stringify(current) !== JSON.stringify(value)) throw Error('脚本设置或变量已变化，请重新读取。');
                    if (operation === 'save-settings') { if (legacySettings) helper.mvu = copy(value); else (helper.scriptSettings ||= {})[payload.scriptId] = copy(value); }
                    else (settings.extension_settings.variables ||= {}).global = copy(value);
                }
            });
            api.readCache.clear(); const verified = await api.settings(); check();
            const saved = operation === 'save-buttons' ? { buttons: verified.settings.extension_settings?.independentHelper?.scriptButtons?.[payload.scriptId] } : operation === 'save-settings' ? (legacySettings ? verified.settings.extension_settings?.independentHelper?.mvu : verified.settings.extension_settings?.independentHelper?.scriptSettings?.[payload.scriptId]) : operation === 'save-globals' ? verified.settings.extension_settings?.variables?.global : verified.settings.extension_settings?.independentHelper?.loreSettings;
            if (Object.entries(value).some(([key, item]) => JSON.stringify(saved?.[key]) !== JSON.stringify(item))) throw Error('脚本设置保存核验失败。');
            state.settings = verified.settings; state.own = settingsOwn(state.settings);
        } else throw Error('此酒馆助手接口尚未接入。');
        generationPreload.invalidate();
        return { value: true, snapshot: scriptSnapshot(state) };
    } finally { variablesSaving = false; }
}
function variableManagerPanel() {
    assertSaved();
    if (!state.character || !state.header || !state.chat.length) throw Error('请先打开有消息的聊天。');
    const identity = scriptIdentity(), body = showPanel('变量管理器', '角色状态与聊天数据', 'variable-panel'); if (!body) return;
    const revision = panelRevision, avatar = state.character.avatar, file = state.file, targets = new Map();
    const current = () => { if (identity !== scriptIdentity() || revision !== panelRevision) throw Error('聊天或面板已切换，请重新打开变量管理器。'); };
    const read = (scope,index) => {
        if (scope === 'message') targets.set(index,{swipeId:state.chat[index]?.swipe_id || 0,messageText:state.chat[index]?.mes});
        return scope === 'global' ? copy(state.settings.extension_settings?.variables?.global || {}) : chatVariableValue(state.header,state.chat,scope,index);
    };
    renderVariableManager(body, { el, action, messages: state.chat, initialMessage: defaultVariableMessage(state.chat), read, notify,
        dirty: value => { if (revision === panelRevision) { panelDirty = value; synchronize(); } },
        save: async ({scope,messageId,base,value}) => {
            assertSaved(); current(); value = validateVariables(value); variablesSaving = true;
            try {
                if (scope === 'message' && Object.hasOwn(value,'stat_data')) value.stat_data = await normalizeRoleMvu(value.stat_data);
                current();
                if (scope === 'global') {
                    await api.patchSettings(settings => {
                        const existing = settings.extension_settings?.variables?.global || {};
                        if (JSON.stringify(existing) !== JSON.stringify(base) && JSON.stringify(existing) !== JSON.stringify(value)) throw Error('全局变量已被其他页面修改，请重新读取。');
                        ((settings.extension_settings ||= {}).variables ||= {}).global = copy(value);
                    });
                    api.readCache.clear(); const verified = await api.settings();
                    if (JSON.stringify(verified.settings.extension_settings?.variables?.global) !== JSON.stringify(value)) throw Error('全局变量保存核验失败，请重试。');
                    current(); state.settings = verified.settings; state.own = settingsOwn(state.settings);
                } else {
                    const target = targets.get(messageId) || {};
                    const fresh = await api.post('/api/chats/get', { avatar_url: avatar, file_name: file }); current();
                    if (!Array.isArray(fresh)) throw Error('聊天读取失败，变量未写入。');
                    const records = fresh.length ? fresh : [copy(state.header),...copy(state.chat)];
                    const patched = patchChatVariables(records, { scope, messageId, swipeId:target.swipeId, base, value, messageText:target.messageText });
                    await api.saveChat(avatar,file,patched[0],patched.slice(1));
                    const verified = await api.post('/api/chats/get', { avatar_url: avatar, file_name: file });
                    if (!Array.isArray(verified) || JSON.stringify(chatVariableValue(verified[0],verified.slice(1),scope,messageId)) !== JSON.stringify(value)) throw Error('变量保存核验失败，请重新读取。');
                    current();
                    const databaseMetadata = state.header.chat_metadata?.independentDatabase;
                    state.header = copy(verified[0]); state.chat = copy(verified.slice(1));
                    if (databaseMetadata) (state.header.chat_metadata ||= {}).independentDatabase ||= databaseMetadata;
                    list.setMessages(state.chat,{reset:true});
                }
                generationPreload.invalidate(); scriptRuntime.refresh(scriptSnapshot(state),identity); return value;
            } finally { variablesSaving = false; }
        },
    });
}
async function applyScriptVariables(payload, identity) {
    assertSaved();
    if (panelDirty) throw Error('请先保存或取消当前修改。');
    if (!state.character || identity !== scriptIdentity()) throw Error('聊天已切换，脚本结果未写入。');
    if (!payload?.variables || Object.prototype.toString.call(payload.variables) !== '[object Object]' || JSON.stringify(payload.variables).length > 1000000) throw Error('脚本变量格式无效或数据过大。');
    if (payload.type === 'chat') { state.header.chat_metadata ||= {}; state.header.chat_metadata.variables = copy(payload.variables); }
    else if (payload.type === 'message' && Number.isInteger(payload.message_id) && state.chat[payload.message_id]) {
        try { if (payload.variables.stat_data) payload.variables.stat_data = await normalizeRoleMvu(payload.variables.stat_data); }
        catch (error) { scriptRuntime.refresh(scriptSnapshot(state), scriptIdentity()); throw error; }
        assertSaved(); if (panelDirty || identity !== scriptIdentity()) throw Error('聊天或编辑状态已变化，变量未写入。');
        const message = state.chat[payload.message_id]; (message.variables ||= {})[message.swipe_id || 0] = copy(payload.variables);
    } else throw Error('暂不支持此变量写入范围。');
    await saveChat();
}
async function openScriptWorkspace(diagnostics = true) {
    assertViewable(); if (panelDirty) throw Error('请先保存或取消当前修改。');
    if (!state.character) throw Error('请先进入角色卡聊天。');
    const identity = scriptIdentity(); let preparation = '';
    if (usesMvuCompat(state.settings, state.character) && !state.busy && !state.dirty) {
        try { const result = await prepareRoleMvu(); if (result.changed) await saveChat(); preparation = result.message; }
        catch (error) { preparation = `变量准备未完成：${error.message}`; }
    }
    if (identity !== scriptIdentity()) return;
    const scripts = nativeScriptPlan(state.settings, state.character), snapshot = scriptSnapshot(state);
    if (!preparation) preparation = !scripts.length ? '当前没有全局或角色脚本。' : !scripts.some(script => script.enabled) ? '脚本已停用，请到“正则与脚本”启用。' : latestMvuData(snapshot).stat_data ? '已读取当前聊天变量。所有运行脚本共用原生助手接口。' : '原生助手接口已提供；当前聊天还没有 MVU 变量。';
    if (diagnostics && $('panel').open && !closePanel()) return;
    await scriptRuntime.show({ scripts, snapshot, identity, preparation, diagnostics, actions: $('quick-replies') });
}
async function roleWorldbook(name, identity) {
    const current = () => identity === scriptIdentity() && name && name === (state.character?.data || state.character)?.extensions?.world;
    if (!current()) throw Error('只允许读取当前角色关联的世界书。');
    const book = await api.post('/api/worldinfo/get', { name }, { signal: AbortSignal.timeout(15000) });
    if (!current()) throw Error('聊天或关联世界书已切换。');
    return book;
}
async function scriptWorldbook(action, payload, identity) {
    const name = payload?.name;
    if (action === 'toggle-worldbook') { assertSaved(); if (panelDirty) throw Error('请先保存或取消当前修改。'); }
    const book = await roleWorldbook(name, identity);
    if (action === 'read-worldbook') return roleWorldEntries(book);
    if (action !== 'toggle-worldbook') throw Error('不支持的世界书操作。');
    assertSaved(); if (panelDirty || identity !== scriptIdentity()) throw Error('聊天或编辑状态已变化。');
    const updated = toggleRoleWorldEntries(book, payload.entries);
    await api.post('/api/worldinfo/edit', { name, data: updated });
    const verified = await roleWorldbook(name, identity);
    if (Object.entries(updated.entries).some(([key, entry]) => verified.entries?.[key]?.disable !== entry.disable)) throw Error('世界书开关保存核验失败，请重新读取。');
    return true;
}
async function roleScriptAction(action, payload, identity) {
    const check = () => { assertSaved(); if (panelDirty || identity !== scriptIdentity()) throw Error('聊天或编辑状态已变化，请重新打开脚本。'); };
    check();
    if (action === 'avatars') return { value: await roleAvatars.run(state.character.avatar, payload) };
    if (action === 'replace-worldbook') {
        const book = await roleWorldbook(payload?.name, identity); check();
        const updated = archiveRoleWorldEntries(book, payload.entries);
        await api.post('/api/worldinfo/edit', { name: payload.name, data: updated });
        const verified = await roleWorldbook(payload.name, identity);
        if (JSON.stringify(verified.entries) !== JSON.stringify(updated.entries)) throw Error('归档保存核验失败，请重新读取。');
        api.readCache.clear(); generationPreload.invalidate(); return { value: true };
    }
    if ($('message-input').value.trim()) throw Error('请先发送或清空输入框中的内容。');
    if (action === 'create-messages') {
        const messages = payload?.messages, options = payload?.options || {};
        if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== 'user' || typeof messages[0].message !== 'string' || !messages[0].message.trim() || messages[0].message.length > 200000 || options.insert_at !== undefined || options.insert_before !== undefined) throw Error('当前只支持在聊天末尾添加一条用户指令。');
        state.chat.push({ name: persona().name, is_user: true, is_system: false, send_date: new Date().toISOString(), mes: messages[0].message, extra: { independentRoleScript: true } });
        list.setMessages(state.chat, { latest: true }); await saveChat(); return { snapshot: scriptSnapshot(state) };
    }
    const command = payload?.command?.trim();
    if (action !== 'slash') throw Error('不支持此角色脚本操作。');
    if (/^\/trigger(?:\s+await=true)?$/.test(command)) {
        const last = state.chat.at(-1);
        if (!last?.is_user || !last.extra?.independentRoleScript) throw Error('请先添加角色脚本的用户指令。');
        if (last.extra.independentRoleScriptAttempted) throw Error('这条指令已尝试生成，请在聊天中手动重试，避免重复发送。');
        last.extra.independentRoleScriptAttempted = true;
        const result = await generate('retry');
        if (identity !== scriptIdentity()) throw Error('聊天已切换。');
        if (!result?.completed || state.dirty) throw Error('角色脚本生成未完成，请在聊天中检查或重试；不会自动重复发送。');
        return { value: '', snapshot: scriptSnapshot(state) };
    }
    const hide = /^\/hide\s+(\d+)$/.exec(command);
    if (!hide) throw Error('此环境只支持 /trigger 和 /hide 指令。');
    const message = state.chat[Number(hide[1])]; if (!message?.extra?.independentRoleScript || !message.is_user) throw Error('只允许隐藏角色脚本自己创建的指令。');
    message.is_system = true; list.update(Number(hide[1])); await saveChat(); return { value: '', snapshot: scriptSnapshot(state) };
}
async function normalizeRoleMvu(data) {
    const schema = characterScriptPlan(state.settings, state.character).find(script => script.enabled && scriptSupport(script).adapter === 'mvu-schema');
    return schema ? scriptSchema.validate(schema, data, scriptIdentity()) : copy(data);
}
async function prepareRoleMvu(generation = false, rawReply = null) {
    if (!usesMvuCompat(state.settings, state.character)) return { changed: false, message: '此卡未启用 MVU 兼容脚本。' };
    const identity = scriptIdentity(); if (!generation) assertSaved();
    return loadTimings.measure('角色卡 MVU 变量更新', 'generation', async () => {
        let seed = state.header?.chat_metadata?.independentMvuSeed;
        if (!seed) {
            const card = state.character?.data || state.character, name = card?.extensions?.world;
            const book = name ? await roleWorldbook(name, identity) : card?.character_book;
            seed = initialVariablesFromBook(book);
        }
        if (identity !== scriptIdentity()) throw Error('聊天已切换，变量未写入。');
        if (!generation) assertSaved();
        if (generation && state.controller?.signal.aborted) throw new DOMException('变量更新已取消', 'AbortError');
        const prepared = await prepareValidatedMvuSnapshots(state.chat, seed, message => rawReply?.message === message ? rawReply.text : message.mes || '', normalizeRoleMvu);
        if (identity !== scriptIdentity()) throw Error('聊天已切换，变量未写入。');
        let seeded = false;
        if (seed && !state.header.chat_metadata?.independentMvuSeed) { (state.header.chat_metadata ||= {}).independentMvuSeed = copy(seed); seeded = true; }
        prepared.commit();
        return { changed: seeded || prepared.count > 0, message: prepared.data ? 'MVU 变量已就绪：支持初始化、JSONPatch 更新及已启用的 Zod 结构校验。' : '未找到 InitVar 初始变量或已有 MVU 快照，请检查角色关联的世界书。' };
    });
}
async function renderScriptManager(body, revision, scope, target, timing) {
    const kind = scope === 'global-script' ? 'global' : 'character';
    let entity = null, selected = target;
    if (kind === 'character') {
        await loadCharacterCatalog(false, timing); if (revision !== panelRevision) return;
        selected = state.characters.some(card => card.avatar === selected) ? selected : state.characters.find(card => card.avatar === state.character?.avatar)?.avatar || state.characters[0]?.avatar;
        const chooser = el('select'); chooser.setAttribute('aria-label', '管理脚本的角色卡');
        for (const card of state.characters) { const option = el('option', '', card.name); option.value = card.avatar; chooser.append(option); }
        chooser.value = selected || ''; body.append(chooser);
        chooser.addEventListener('change', () => run(async () => {
            if (panelDirty && !confirm('放弃未保存的脚本修改？')) { chooser.value = selected; return; }
            panelDirty = false; await regexPanel(scope, chooser.value);
        }));
        if (!selected) { note(body, '没有可管理的角色卡。'); return; }
        entity = await api.post('/api/characters/get', { avatar_url: selected }, { timing }); if (revision !== panelRevision) return;
    }
    const prepareTree = () => copy(scriptTrees(state.settings, entity)[kind]);
    let tree = timing ? timing.measureSync('正则与脚本 · 准备脚本数据', 'data', prepareTree, value => ({ metrics: { scriptCount: scriptRows(value).length } })) : prepareTree();
    const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = scriptScopeEnabled(state.settings, entity, kind);
    const enabledLabel = el('label', 'check-field'); enabledLabel.append(enabled, el('span', '', kind === 'global' ? '启用全局脚本' : '启用此角色卡的脚本')); body.append(enabledLabel);
    const dirty = () => { panelDirty = true; };
    enabled.addEventListener('change', dirty);
    note(body, kind === 'global' ? '全局脚本只管理和保留，不在本前端执行或适配。' : '进入聊天后自动运行已启用的兼容脚本。逐梦演艺圈已接入变量校验、状态栏与编辑器、头像库、场景开关和人设/剧本/总结归档；原本停用的脚本需自行启用。');
    const toolbar = el('div', 'regex-toolbar'), rows = el('div', 'regex-list'); body.append(toolbar, rows);
    const renderList = () => {
        rows.replaceChildren(); const entries = scriptRows(tree);
        if (!entries.length) { note(rows, '还没有脚本，可新建或导入。'); return; }
        for (const row of entries) {
            const script = row.script, support = kind === 'global' ? { supported: false, reason: '仅管理，不在本前端执行或适配。' } : scriptSupport(script), details = el('details', 'prompt-item');
            details.classList.toggle('prompt-disabled', script.enabled === false);
            const summary = el('summary', 'prompt-summary');
            const toggle = el('input'); toggle.type = 'checkbox'; toggle.checked = script.enabled !== false; toggle.setAttribute('aria-label', `启用脚本 ${script.name || '未命名'}`);
            toggle.addEventListener('click', event => event.stopPropagation()); toggle.addEventListener('change', () => { script.enabled = toggle.checked; details.classList.toggle('prompt-disabled', !toggle.checked); dirty(); });
            const title = el('span', 'prompt-title', script.name || '未命名脚本'); summary.append(toggle, title, el('small', '', kind === 'global' ? '仅管理' : support.supported ? '兼容运行' : '暂不支持')); details.append(summary);
            inlineEntryActions(summary, [action('删除脚本', () => { row.parent.splice(row.index, 1); dirty(); render(); }, 'trash', 'danger')], script.name || '未命名脚本');
            let built = false;
            details.addEventListener('toggle', () => {
                if (!details.open || built) return; built = true;
                const content = el('div', 'prompt-form');
                if (row.folder) note(content, `所在文件夹：${row.folder}${row.enabled ? '' : '（可能被文件夹停用）'}`);
                note(content, support.reason);
                const name = field(content, '脚本名称', script.name || ''); name.addEventListener('input', () => { script.name = name.value; title.textContent = name.value; dirty(); });
                const code = field(content, '脚本代码', script.content || '', { multiline: true, rows: 14 }); code.spellcheck = false;
                code.addEventListener('input', () => { script.content = code.value; dirty(); });
                details.append(content);
            }); rows.append(details);
        }
    };
    const render = () => timing ? timing.measureSync('正则与脚本 · 构建脚本列表', 'data', renderList, () => ({ metrics: { scriptCount: scriptRows(tree).length } })) : renderList();
    toolbar.append(action('新建脚本', () => { tree.push({ type: 'script', id: uuid(), name: '新脚本', enabled: false, content: '', info: '', button: { enabled: false, buttons: [] }, data: {} }); dirty(); render(); rows.lastElementChild.open = true; }, 'plus'), action('导入脚本', async () => {
        const file = await pickFile('.json'); if (!file) return; const value = JSON.parse(await file.text());
        const imported = Array.isArray(value) ? value : Array.isArray(value.scripts) ? value.scripts : value.type === 'script' || value.type === 'folder' ? [value] : value.data?.extensions?.tavern_helper?.scripts;
        validateScriptTree(imported);
        const items = copy(imported); for (const row of scriptRows(items)) row.script.id = uuid(); tree.push(...items); dirty(); render();
    }, 'folder'), action('导出脚本', () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' })); const link = el('a'); link.href = url; link.download = `${kind === 'global' ? '全局' : entity.name || '角色卡'}脚本.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'export'), action('打开当前角色脚本', openScriptWorkspace, 'tools'));
    const footer = el('div', 'editor-footer'); footer.append(action('保存脚本', async () => {
        assertIdle();
        validateScriptTree(tree);
        if (kind === 'global') {
            state.settings = await api.patchSettings(settings => patchScriptScope(settings, 'global', { tree, enabled: enabled.checked })); state.own = settingsOwn(state.settings);
        } else {
            const savedCard = await saveCharacterScripts(api, selected, tree);
            state.settings = await api.patchSettings(settings => patchScriptScope(settings, 'character', { enabled: enabled.checked, avatar: selected, allAvatars: state.characters.map(card => card.avatar) })); state.own = settingsOwn(state.settings);
            if (state.character?.avatar === selected) state.character = savedCard; characterCatalog.invalidate();
        }
        scriptRuntime.dispose(); scriptSchema.dispose(); scriptAutoIdentity = ''; panelDirty = false; synchronize(); notify('脚本已保存，当前角色脚本已自动加载。');
    }, 'edit', 'primary')); body.append(footer); render();
}
function renderRegexEditor(parent, rules, onDirty, opened = new Set()) {
    parent._disposeDrag?.();
    rules.sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled));
    parent.replaceChildren();
        rules.forEach((rule, index) => {
            const row = el('details', 'regex-rule'); row.dataset.promptId = String(index); row.open = opened.has(rule);
            row.classList.toggle('prompt-disabled', !!rule.disabled);
            row.addEventListener('toggle', () => { if (!row.isConnected) return; if (row.open) opened.add(rule); else opened.delete(rule); });
            const summary = el('summary', 'prompt-summary regex-summary');
            const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = !rule.disabled; enabled.setAttribute('aria-label', `启用正则 ${rule.scriptName || index + 1}`);
            enabled.addEventListener('click', event => event.stopPropagation());
            enabled.addEventListener('change', () => { rule.disabled = !enabled.checked; onDirty(); renderRegexEditor(parent, rules, onDirty, opened); });
            const title = el('span', 'prompt-title', rule.scriptName || '未命名正则');
            const toolbar = el('span', 'world-entry-actions regex-title-actions');
            toolbar.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
            summary.append(enabled, title); row.append(summary);
            const render = () => { onDirty(); renderRegexEditor(parent, rules, onDirty, opened); };
            const up = action('上移规则', () => { [rules[index - 1], rules[index]] = [rules[index], rules[index - 1]]; render(); }, 'up'); up.disabled = index === 0 || !!rules[index - 1].disabled !== !!rule.disabled;
            const down = action('下移规则', () => { [rules[index + 1], rules[index]] = [rules[index], rules[index + 1]]; render(); }, 'down'); down.disabled = index === rules.length - 1 || !!rules[index + 1].disabled !== !!rule.disabled;
            toolbar.append(up, down, action('复制规则', () => { rules.splice(index + 1, 0, { ...copy(rule), id: uuid(), scriptName: `${rule.scriptName || '正则'}（副本）` }); render(); }, 'copy'), action('删除规则', () => {
                if (!confirm('从当前范围删除此规则？保存后生效。')) return; rules.splice(index, 1); render();
            }, 'trash', 'danger'));
            for (const button of toolbar.children) { button.title = button.textContent.trim(); button.setAttribute('aria-label', `${button.textContent.trim()} ${rule.scriptName || index + 1}`); }
            inlineEntryActions(summary, [...toolbar.children], rule.scriptName || '未命名正则');
            const toggle = (label, checked, onChange) => {
                const wrap = el('label', 'check-field'); const input = el('input'); input.type = 'checkbox'; input.checked = checked;
                input.addEventListener('change', () => { onChange(input.checked); onDirty(); }); wrap.append(input, el('span', '', label)); row.append(wrap);
            };
            for (const [key, label, multiline] of [['scriptName', '规则名称', false], ['findRegex', '查找正则', true], ['replaceString', '替换内容', true]]) {
                const input = field(row, label, rule[key] || '', { multiline, rows: key === 'replaceString' ? 5 : 2 });
                input.addEventListener('input', () => { rule[key] = input.value; if (key === 'scriptName') title.textContent = input.value || '未命名正则'; });
            }
            const warning = el('p', 'note warning'); row.append(warning);
            const check = () => { try { compileRegex(rule.findRegex); warning.textContent = ''; } catch { warning.textContent = '正则表达式无效，执行时会跳过此规则。'; } }; check();
            row.addEventListener('input', check);
            const trims = field(row, '匹配组中移除的文字（每行一项）', (rule.trimStrings || []).join('\n'), { multiline: true, rows: 2 });
            trims.addEventListener('input', () => { rule.trimStrings = trims.value.split('\n').filter(Boolean); });
            for (const [placement, label] of [[1, '用户输入'], [2, 'AI 回复']]) toggle(`应用于${label}`, (rule.placement || []).map(Number).includes(placement), checked => {
                const values = new Set((rule.placement || []).map(Number)); if (checked) values.add(placement); else values.delete(placement); rule.placement = [...values];
            });
            toggle('仅显示时处理', !!rule.markdownOnly, value => { rule.markdownOnly = value; });
            toggle('仅发送提示词时处理', !!rule.promptOnly, value => { rule.promptOnly = value; });
            toggle('编辑消息时也运行', !!rule.runOnEdit, value => { rule.runOnEdit = value; });
            for (const [key, label] of [['minDepth', '最小深度'], ['maxDepth', '最大深度']]) {
                const input = field(row, label, rule[key] ?? '', { type: 'number', hint: '留空表示不限制；最新消息深度为 0。' }); input.step = 1;
                input.addEventListener('input', () => { rule[key] = input.value === '' ? null : Number(input.value); });
            }
            const substitute = field(row, '查找正则中的宏', rule.substituteRegex ?? 0, { options: [[0, '不替换'], [1, '直接替换'], [2, '转义后替换']] });
            substitute.addEventListener('change', () => { rule.substituteRegex = Number(substitute.value); });
            if ((rule.placement || []).some(value => [0, 3, 4].includes(Number(value)))) note(row, '此规则还包含旧版显示或斜杠命令作用位置；独立聊天页面不执行这些位置。');
            parent.append(row);
        });
    const original = [...rules];
    parent._disposeDrag = installPromptDrag(parent, $('panel-body'), identifiers => {
        const sorted = identifiers.map(id => original[Number(id)]);
        if (sorted.some((rule, index) => rules[index] !== rule)) {
            rules.splice(0, rules.length, ...sorted); onDirty(); renderRegexEditor(parent, rules, onDirty, opened);
        }
    });
}

async function characterPanel(force = false) {
    const host = showPanel('角色卡', '角色资料库', 'library-panel'); if (!host) return;
    return loadPanelContent(host, '角色卡', (body, revision, timing) => renderCharacterPanel(body, revision, force, timing), () => characterPanel(true));
}
async function renderCharacterPanel(body, revision, force = false, timing) {
    let library = timing ? timing.measureSync('角色卡 · 整理分类数据', 'data', () => libraryState(state.own.characterLibrary)) : libraryState(state.own.characterLibrary);
    await loadCharacterCatalog(force, timing);
    if (revision !== panelRevision) return;
    let folder = 'all'; let mode = 'grid'; let page = 0;
    const selected = new Set();
    const toolbar = el('div', 'library-toolbar');
    const search = el('input', 'library-search'); search.type = 'search'; search.placeholder = '搜索角色名称…'; search.setAttribute('aria-label', '搜索角色');
    const sort = el('select'); sort.setAttribute('aria-label', '角色排序');
    for (const [value, label] of [['name', '名称排序'], ['recent', '最近创建']]) { const option = el('option', '', label); option.value = value; sort.append(option); }
    const create = action('新建角色', () => characterEditor(null), 'plus', 'icon-button');
    const importButton = action('导入角色', () => importCharacter(library.folders.some(item => item.id === folder) ? folder : ''), 'import', 'icon-button');
    for (const [button, label] of [[create, '新建角色'], [importButton, '导入角色']]) { button.querySelector('span').remove(); button.title = label; button.setAttribute('aria-label', label); }
    toolbar.append(search, sort, create, importButton); body.append(toolbar);
    const layout = el('div', 'library-layout');
    const sidebar = el('aside', 'library-folders'); sidebar.setAttribute('aria-label', '角色分类');
    const content = el('section', 'library-main'); content.setAttribute('aria-label', '角色文件');
    const breadcrumb = el('div', 'library-breadcrumb');
    const path = el('span'); const viewButtons = el('div', 'view-buttons');
    const grid = action('网格视图', () => { mode = 'grid'; renderCards(); }, 'grid'); grid.setAttribute('aria-label', '网格视图');
    const listView = action('列表视图', () => { mode = 'list'; renderCards(); }, 'list'); listView.setAttribute('aria-label', '列表视图');
    viewButtons.append(grid, listView); breadcrumb.append(path, viewButtons);
    const bulk = el('div', 'library-bulk');
    const selectAll = el('input'); selectAll.type = 'checkbox'; selectAll.setAttribute('aria-label', '选择当前页全部角色');
    const selectedCount = el('span');
    const destination = el('select'); destination.setAttribute('aria-label', '移动到分类');
    const move = action('移动到分类', async () => {
        if (!selected.size) throw new Error('请先选择角色。');
        await persist(raw => moveCards(raw, [...selected], destination.value)); selected.clear(); renderCards();
    }, 'folder');
    bulk.append(selectAll, selectedCount, destination, move);
    const cards = el('div', 'character-files');
    const pager = el('div', 'library-pager');
    content.append(breadcrumb, cards, pager); layout.append(sidebar, content); body.append(layout);
    const form = el('section', 'folder-form'); form.hidden = true;
    const formTitle = el('h3'); form.append(formTitle);
    const folderName = field(form, '分类名称', '', { hint: '最多 40 个字符。分类只整理列表，不移动或删除角色文件。' }); folderName.maxLength = 40;
    let editingFolder = null;
    form.append(action('保存', async () => {
        const text = folderName.value;
        const existing = library.folders.find(item => item.name.trim().toLocaleLowerCase() === text.trim().toLocaleLowerCase());
        const id = editingFolder || existing?.id || uuid();
        const renaming = !!editingFolder;
        await persist(raw => renaming ? renameFolder(raw, id, text) : libraryState(raw).folders.some(item => item.id === id) ? libraryState(raw) : addFolder(raw, id, text));
        folder = id; form.hidden = true; panelDirty = false; renderFolders(); renderCards(); notify('分类已保存');
    }, null, 'primary'), action('取消', () => { form.hidden = true; panelDirty = false; }));
    body.prepend(form);
    async function persist(transform) {
        state.settings = await api.patchSettings(settings => {
            const own = settingsOwn(settings); own.characterLibrary = transform(own.characterLibrary);
        });
        state.own = state.settings.independent_frontend;
        if (revision !== panelRevision) return;
        library = libraryState(state.own.characterLibrary); if (!['all', 'unfiled'].includes(folder) && !library.folders.some(item => item.id === folder)) folder = 'all'; renderFolders(); renderCards();
    }
    function folderForm(id = null) {
        editingFolder = id; formTitle.textContent = id ? '重命名分类' : '新建分类';
        folderName.value = id ? library.folders.find(item => item.id === id).name : '';
        const targetRow = id ? [...sidebar.querySelectorAll('[data-folder-id]')].find(row => row.dataset.folderId === id) : null;
        if (targetRow) targetRow.append(form); else { const first = sidebar.querySelector('[data-folder-id]'); if (first) sidebar.insertBefore(form, first); else sidebar.append(form); }
        form.hidden = false; form.scrollIntoView({ block: 'nearest' }); folderName.focus();
    }
    function chooseFolder(id) { folder = id; page = 0; selected.clear(); renderFolders(); renderCards(); }
    let folderDragEvents;
    function renderFolders() {
        folderDragEvents?.abort(); folderDragEvents = new AbortController();
        if (sidebar.contains(form)) body.prepend(form); sidebar.replaceChildren();
        const heading = el('div', 'folder-heading'); heading.append(el('h2', '', '分类'), action('新建分类', () => folderForm(), 'plus'));
        sidebar.append(heading);
        const append = (id, label) => {
            const row = el('div', 'folder-row');
            const button = action(label, () => chooseFolder(id), 'folder', 'folder-button'); button.draggable = false;
            button.classList.toggle('active', folder === id); button.setAttribute('aria-pressed', String(folder === id));
            const count = el('small', 'folder-count', String(filterCards(state.characters, library, id).length)); button.append(count); row.append(button);
            if (!['all', 'unfiled'].includes(id)) {
                const rename = action(`重命名 ${label}`, () => folderForm(id), 'edit', 'folder-edit'); rename.title = '重命名分类'; rename.setAttribute('aria-label', `重命名分类 ${label}`);
                const remove = action(`删除 ${label}`, async () => { if (!confirm(`删除分类「${label}」？角色卡将保留并回到未分类。`)) return; await persist(raw => deleteFolder(raw, id)); if (folder === id) chooseFolder('unfiled'); }, 'trash', 'folder-edit danger'); remove.title = '删除分类'; remove.setAttribute('aria-label', `删除分类 ${label}`);
                const menu = el('span', 'folder-inline-menu inset-action-menu'); menu.hidden = true; menu.append(rename, remove);
                menu.id = `folder-actions-${uuid()}`; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', '分类操作');
                const more = action('分类操作', () => {
                    const expand = menu.hidden;
                    for (const other of sidebar.querySelectorAll('.folder-inline-menu')) other.hidden = true;
                    for (const other of sidebar.querySelectorAll('.folder-actions-toggle')) other.setAttribute('aria-expanded', 'false');
                    menu.hidden = !expand; more.setAttribute('aria-expanded', String(expand));
                }, 'more', 'folder-edit folder-actions-toggle');
                more.setAttribute('aria-label', `分类操作 ${label}`); more.title = '分类操作';
                more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-controls', menu.id);
                const actionAnchor = el('span', 'folder-action-anchor'); actionAnchor.append(menu, more); row.append(actionAnchor);
                actionAnchor.addEventListener('keydown', event => {
                    if (event.key !== 'Escape' || menu.hidden) return;
                    event.preventDefault(); event.stopPropagation(); menu.hidden = true; more.setAttribute('aria-expanded', 'false'); more.focus();
                });
                row.dataset.folderId = id;
                let timer, dragging = false, pointer, blockClick = false, startX, startY;
                row.addEventListener('pointerdown', event => {
                    if (event.button !== 0 || !event.target.closest('.folder-button')) return;
                    event.preventDefault(); pointer = event.pointerId; startX = event.clientX; startY = event.clientY;
                    timer = setTimeout(() => { dragging = true; blockClick = true; row.classList.add('prompt-dragging'); }, 420);
                });
                window.addEventListener('pointermove', event => {
                    if (pointer !== event.pointerId) return;
                    if (!dragging) { if (Math.abs(event.clientX-startX)>8 || Math.abs(event.clientY-startY)>8) clearTimeout(timer); return; }
                    const next = [...sidebar.querySelectorAll('[data-folder-id]')].filter(item => item !== row).find(item => { const rect = item.getBoundingClientRect(); return event.clientY < rect.top + rect.height / 2; });
                    if (next) sidebar.insertBefore(row, next); else sidebar.append(row);
                }, { signal: folderDragEvents.signal });
                const finish = event => { if (pointer !== event.pointerId) return; clearTimeout(timer); if (!dragging) { if (row.hasPointerCapture(pointer)) row.releasePointerCapture(pointer); return; } dragging = false; row.classList.remove('prompt-dragging'); if (row.hasPointerCapture(pointer)) row.releasePointerCapture(pointer); if (event.type === 'pointercancel') { renderFolders(); return; } const order = [...sidebar.querySelectorAll('[data-folder-id]')].map(item => item.dataset.folderId); void run(() => persist(raw => { const next = libraryState(raw); next.folders.sort((a,b) => order.indexOf(a.id)-order.indexOf(b.id)); return next; })); };
                window.addEventListener('pointerup', finish, { signal: folderDragEvents.signal }); window.addEventListener('pointercancel', finish, { signal: folderDragEvents.signal });
                row.addEventListener('click', event => { if (blockClick) { blockClick = false; event.preventDefault(); event.stopPropagation(); } }, true);
                row.addEventListener('dragover', event => { event.preventDefault(); row.classList.add('drop-target'); });
                row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
                row.addEventListener('drop', event => {
                    event.preventDefault(); row.classList.remove('drop-target');
                    let values; try { values = JSON.parse(event.dataTransfer.getData('application/x-tavern-cards')); } catch { return; }
                    if (!Array.isArray(values) || !values.every(avatar => state.characters.some(card => card.avatar === avatar))) return;
                    void run(async () => { await persist(raw => moveCards(raw, values, id)); selected.clear(); renderCards(); notify('角色已移动'); });
                });
            }
            sidebar.append(row);
        };
        append('all', '全部角色'); append('unfiled', '未分类');
        for (const item of library.folders) append(item.id, item.name);
        const value = destination.value;
        destination.replaceChildren();
        for (const [id, label] of [['', '未分类'], ...library.folders.map(item => [item.id, item.name])]) { const option = el('option', '', label); option.value = id; destination.append(option); }
        if ([...destination.options].some(option => option.value === value)) destination.value = value;
    }
    function renderCards() { return timing ? timing.measureSync('角色卡 · 构建卡片列表', 'data', renderCardsContent, () => ({ metrics: { renderedItems: cards.children.length } })) : renderCardsContent(); }
    function renderCardsContent() {
        const filter = () => filterCards(state.characters || [], library, folder, search.value, sort.value);
        const found = timing ? timing.measureSync('角色卡 · 筛选与排序', 'data', filter, value => ({ metrics: { totalItems: (state.characters || []).length, renderedItems: value.length } })) : filter();
        const pages = Math.max(1, Math.ceil(found.length / 60)); page = Math.min(page, pages - 1);
        const visible = found.slice(page * 60, (page + 1) * 60);
        path.textContent = `角色卡 / ${folder === 'all' ? '全部角色' : folder === 'unfiled' ? '未分类' : library.folders.find(item => item.id === folder)?.name || ''} · ${found.length}`;
        cards.classList.toggle('list-view', mode === 'list');
        grid.setAttribute('aria-pressed', String(mode === 'grid')); listView.setAttribute('aria-pressed', String(mode === 'list'));
        cards.replaceChildren();
        for (const card of visible) {
            const file = el('article', 'character-file'); file.classList.toggle('selected', selected.has(card.avatar)); file.draggable = true;
            file.classList.toggle('current-character', card.avatar === state.character?.avatar);
            file.addEventListener('dragstart', event => { const values = selected.has(card.avatar) ? [...selected] : [card.avatar]; event.dataTransfer.setData('application/x-tavern-cards', JSON.stringify(values)); event.dataTransfer.effectAllowed = 'move'; });
            const selection = el('input', 'card-selection'); selection.type = 'checkbox'; selection.checked = selected.has(card.avatar); selection.setAttribute('aria-label', `选择角色 ${card.name}`);
            selection.addEventListener('change', () => { if (selection.checked) selected.add(card.avatar); else selected.delete(card.avatar); file.classList.toggle('selected', selection.checked); updateSelection(); });
            const enterChat = async () => { assertSaved(); if (closePanel()) await openCharacter(card.avatar, { latest: true }); };
            const cover = action(`进入 ${card.name} 最新聊天`, enterChat, null, 'card-cover'); cover.append(image(card.avatar, 'avatar', true));
            cover.setAttribute('aria-label', `进入 ${card.name} 最新聊天`); cover.title = '进入最新聊天';
            const info = el('div', 'card-info');
            info.append(el('h3', '', card.name), el('small', 'card-category', library.folders.find(item => item.id === library.assignments[card.avatar])?.name || '未分类'));
            const actions = el('div', 'card-actions');
            actions.append(action('聊天', enterChat, 'chat'), action('编辑', () => characterEditor(card.avatar), 'edit'), action('世界书', () => openCharacterWorld(card.avatar), 'book'));
            actions.append(action('导出', async () => {
                const response = await api.response('/api/characters/export', { avatar_url: card.avatar, format: 'png' });
                const url = URL.createObjectURL(await response.blob()), link = el('a'); link.href = url; link.download = `${safeName(card.name || '角色卡')}.png`;
                document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            }, 'export'), action('复制', async () => {
                assertSaved(); const result = await api.post('/api/characters/duplicate', { avatar_url: card.avatar });
                if (!result?.path) throw new Error('角色卡复制失败。');
                await api.post('/api/characters/merge-attributes', { avatar: result.path, data: { name: `${card.name}（副本）` } });
                await saveOwn({ characterLibrary: moveCards(state.own.characterLibrary, [result.path], library.assignments[card.avatar] || '') });
                characterCatalog.invalidate(); await loadCharacterCatalog(true); panelDirty = false; notify('角色卡已复制'); await characterPanel();
            }, 'copy'), action('删除', async () => {
                assertSaved(); if (!confirm(`删除角色卡「${card.name}」？聊天文件会保留。`)) return;
                const details = card.data ? card : await api.post('/api/characters/get', { avatar_url: card.avatar });
                const linkedWorld = (details.data || details).extensions?.world;
                const deleteWorld = linkedWorld && confirm(`是否同时删除关联世界书「${linkedWorld}」？确定：删除世界书；取消：仅删除角色卡。若其他角色也关联此书，它们会失去该世界书。`);
                await api.post('/api/characters/delete', { avatar_url: card.avatar, delete_chats: false });
                if (deleteWorld) { try { await api.post('/api/worldinfo/delete', { name: linkedWorld }); } catch(error) { notify(`角色卡已删除，世界书删除失败：${error.message}`, true); } }
                state.settings = await api.patchSettings(settings => {
                    const own = settingsOwn(settings); if (deleteWorld) { const wi=settings.world_info_settings?.world_info; if(Array.isArray(wi?.globalSelect))wi.globalSelect=wi.globalSelect.filter(name=>name!==linkedWorld); if(Array.isArray(own.worlds))own.worlds=own.worlds.filter(name=>name!==linkedWorld); } if (own.characterLibrary?.assignments) delete own.characterLibrary.assignments[card.avatar];
                    if (own.lastChats) delete own.lastChats[card.avatar]; if (own.lastCharacter === card.avatar) delete own.lastCharacter;
                }); state.own = state.settings.independent_frontend;
                if (state.character?.avatar === card.avatar) { state.character = null; state.chat = []; state.header = null; state.file = ''; welcome(); synchronize(); }
                characterCatalog.invalidate(); await loadCharacterCatalog(true); panelDirty = false; notify('角色卡已删除'); await characterPanel();
            }, 'trash', 'danger'));
            for (const button of actions.children) { const label = button.textContent.trim(); button.title = label; button.setAttribute('aria-label', `${card.name}：${label}`); }
            if (mode === 'list') {
                const menu = el('span', 'card-action-menu inset-action-menu'); menu.append(...actions.children);
                menu.id = `card-actions-${uuid()}`; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', '角色操作');
                const more = action('角色操作', () => {
                    const expand = !menu.classList.contains('is-open');
                    for (const other of cards.querySelectorAll('.card-action-menu')) other.classList.remove('is-open');
                    for (const other of cards.querySelectorAll('.card-actions-toggle')) other.setAttribute('aria-expanded', 'false');
                    menu.classList.toggle('is-open', expand); more.setAttribute('aria-expanded', String(expand));
                }, 'more', 'card-actions-toggle');
                more.title = '角色操作'; more.setAttribute('aria-label', `${card.name}：角色操作`); more.setAttribute('aria-controls', menu.id); more.setAttribute('aria-expanded', 'false');
                actions.append(menu, more);
                actions.addEventListener('keydown', event => {
                    if (event.key !== 'Escape' || !menu.classList.contains('is-open')) return;
                    event.preventDefault(); event.stopPropagation(); menu.classList.remove('is-open'); more.setAttribute('aria-expanded', 'false'); more.focus();
                });
            }
            file.append(cover, info, actions); cards.append(file);
        }
        if (!found.length) {
            const empty = el('div', 'library-empty'); empty.append(icon('folder'), el('h3', '', search.value ? '没有找到角色' : '这个分类还是空的'), el('p', '', '导入角色，或勾选其他分类中的角色后移动到这里。')); cards.append(empty);
        }
        pager.replaceChildren();
        if (pages > 1) {
            const prev = action('上一页', () => { page--; renderCards(); }, 'up'); prev.disabled = page === 0;
            const next = action('下一页', () => { page++; renderCards(); }, 'down'); next.disabled = page >= pages - 1;
            pager.append(prev, el('span', '', `${page + 1} / ${pages}`), next);
        }
        function updateSelection() {
            selectedCount.textContent = `已选择 ${selected.size} 项`; move.disabled = selected.size === 0;
            selectAll.checked = visible.length > 0 && visible.every(card => selected.has(card.avatar));
            selectAll.indeterminate = !selectAll.checked && visible.some(card => selected.has(card.avatar));
        }
        selectAll.onchange = () => { for (const card of visible) { if (selectAll.checked) selected.add(card.avatar); else selected.delete(card.avatar); } renderCards(); };
        updateSelection();
    }
    search.addEventListener('input', () => { page = 0; renderCards(); });
    sort.addEventListener('change', () => { page = 0; renderCards(); });
    renderFolders(); renderCards();
}

async function characterEditor(avatar = state.character?.avatar) {
    const body = showPanel(avatar ? '编辑角色卡' : '新建角色', '角色资料'); if (!body) return;
    const revision = panelRevision;
    let editing = null;
    if (avatar) {
        const loading = loadingIndicator('正在读取角色资料…'); body.append(loading); body.setAttribute('aria-busy', 'true');
        try { editing = await api.post('/api/characters/get', { avatar_url: avatar }); }
        finally { loading.remove(); if (revision === panelRevision) body.removeAttribute('aria-busy'); }
    }
    if (revision !== panelRevision) return;
    const card = editing?.data || editing || {};
    if (editing) {
        note(body, `关联世界书：${card.extensions?.world || (card.character_book?.entries ? '内嵌世界书（尚未提取）' : '未关联')}`);
        if (card.extensions?.world || card.character_book?.entries) body.append(action('查看角色世界书', async () => {
            if (panelDirty && !confirm('放弃未保存的角色修改并查看世界书？')) return;
            panelDirty = false; await openCharacterWorld(editing.avatar);
        }, 'book'));
    }
    let avatarFile = null;
    const portrait = el('div', 'character-portrait'); const portraitImage = editing ? image(editing.avatar, 'avatar', true) : el('img'); portraitImage.alt = '角色图片'; portraitImage.hidden = !editing;
    const upload = action('导入图片', async () => {
        const file = await pickFile('image/*'); if (!file) return;
        avatarFile = file; const url = URL.createObjectURL(file); portraitImage.onload = () => URL.revokeObjectURL(url); portraitImage.src = url; portraitImage.hidden = false; upload.classList.add('has-avatar'); panelDirty = true;
    }, 'image', 'persona-avatar-upload'); upload.title = '点击更换图片'; upload.setAttribute('aria-label', '导入角色图片'); upload.classList.toggle('has-avatar', !!editing); upload.prepend(portraitImage); portrait.append(upload); body.prepend(portrait);
    const name = field(body, '名称', card.name || '');
    const folders = libraryState(state.own.characterLibrary);
    const category = field(body, '分类', editing ? folders.assignments[editing.avatar] || '' : '', { options: [['', '未分类'], ...folders.folders.map(folder => [folder.id, folder.name])] });
    const description = field(body, '描述', card.description || '', { multiline: true });
    const first = field(body, '开场白', card.first_mes || '', { multiline: true });
    const footer = el('div', 'persona-editor-actions'); body.append(footer);
    footer.append(action('保存', async () => {
        assertSaved(); if (!name.value.trim()) throw new Error('请输入角色名称。');
        const data = { name: name.value.trim(), description: description.value, first_mes: first.value };
        let savedAvatar;
        if (editing) {
            await api.post('/api/characters/merge-attributes', { avatar: editing.avatar, data });
            if (avatarFile) { const form = new FormData(); form.append('avatar', avatarFile); form.append('avatar_url', editing.avatar); await api.post('/api/characters/edit-avatar', form, { form: true }); avatarRevisions.set(editing.avatar, Date.now()); }
            editing = await api.post('/api/characters/get', { avatar_url: editing.avatar });
            savedAvatar = editing.avatar;
            if (state.character?.avatar === editing.avatar) state.character = editing;
        } else {
            const payload = { ch_name: data.name, description: data.description, first_mes: data.first_mes };
            if (avatarFile) { const form = new FormData(); for (const [key, value] of Object.entries(payload)) form.append(key, value); form.append('avatar', avatarFile); savedAvatar = await api.post('/api/characters/create', form, { form: true }); }
            else savedAvatar = await api.post('/api/characters/create', payload);
            if (typeof savedAvatar !== 'string' || !savedAvatar.endsWith('.png')) throw new Error('创建角色失败。');
            editing = await api.post('/api/characters/get', { avatar_url: savedAvatar });
        }
        state.settings = await api.patchSettings(settings => { const own = settingsOwn(settings); own.characterLibrary = moveCards(own.characterLibrary, [savedAvatar], category.value); }); state.own = state.settings.independent_frontend;
        avatarFile = null;
        characterCatalog.invalidate(); state.characters = [...state.characters.filter(item => item.avatar !== savedAvatar), { ...editing, avatar: savedAvatar }]; panelDirty = false; synchronize(); notify('角色已保存');
        await characterPanel();
    }, 'edit', 'primary'));
    footer.append(action('取消', () => { panelDirty = false; return characterPanel(); }));
}
function pickFile(accept) {
    return new Promise(resolve => {
        const input = document.createElement('input'); input.type = 'file'; input.accept = accept;
        input.addEventListener('change', () => resolve(input.files[0] || null), { once: true });
        input.addEventListener('cancel', () => resolve(null), { once: true }); input.click();
    });
}
async function importCharacter(folderId = '') {
    assertSaved(); const file = await pickFile('.png,.json,.charx,.yaml,.yml'); if (!file) return;
    const data = new FormData(); data.append('avatar', file); data.append('file_type', file.name.split('.').at(-1).toLowerCase());
    const result = await api.post('/api/characters/import', data, { form: true });
    if (!result?.file_name) throw new Error('导入失败，请检查角色卡格式。');
    const avatar = result.file_name.endsWith('.png') ? result.file_name : result.file_name + '.png';
    let worldResult;
    try { worldResult = await importCharacterWorld(api, avatar, safeName); }
    catch (error) { notify(`角色卡已导入，但世界书提取失败：${error.message}。可在世界书页面补导入。`, true); }
    if (folderId) {
        state.settings = await api.patchSettings(settings => { const own = settingsOwn(settings); own.characterLibrary = moveCards(own.characterLibrary, [avatar], folderId); });
        state.own = state.settings.independent_frontend;
    }
    characterCatalog.invalidate(); await loadCharacterCatalog(true); panelDirty = false; closePanel();
    await openCharacter(avatar);
    if (worldResult) notify(worldResult.imported ? `角色卡及世界书「${worldResult.name}」已导入并关联` : '角色卡已导入');
}

function themeDefaultAvatar(img, name) {
    img.addEventListener('load', () => {
        try {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
            const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, 8, 8);
            const colors = [[230,237,223],[234,226,214]];
            const corners = [[0,0],[7,0],[0,7],[7,7]].map(([x,y]) => [...ctx.getImageData(x,y,1,1).data]);
            const generated = colors.some(color => corners.every(pixel => color.every((value,index) => Math.abs(pixel[index]-value) <= 3)));
            img.parentElement.querySelector('.persona-monogram')?.remove(); img.classList.toggle('default-avatar-image', generated);
            if (generated) { const text = el('div', 'persona-monogram', [...(name || '用户')][0]); text.setAttribute('aria-hidden', 'true'); img.parentElement.append(text); }
        } catch { /* Keep the original image when it cannot be inspected. */ }
    });
}
async function personasPanel() {
    const host = showPanel('用户设定', '你在故事中的身份', 'personas-panel'); if (!host) return;
    return loadPanelContent(host, '用户设定', (body, revision) => renderPersonasPanel(body, revision), () => personasPanel());
}
async function renderPersonasPanel(body, revision) {
    const fresh = { settings: state.settings };
    const avatars = Object.keys(state.settings.power_user?.personas || {});
    state.settings = fresh.settings; state.own = settingsOwn(state.settings);
    const power = state.settings.power_user || {};
    const available = [...new Set([...(Array.isArray(avatars) ? avatars : []), ...Object.keys(power.personas || {})])];
    const toolbar = el('div', 'library-toolbar');
    toolbar.style.justifyContent = 'flex-end';
    const add = action('新增用户设定', () => {
        const existing = rows.querySelector('.persona-draft');
        if (existing) { existing.querySelector('input')?.focus(); return; }
        const draft = el('article', 'persona-row persona-draft');
        draft.append(el('h2', 'persona-draft-title', '新增用户设定'));
        const editor = el('div', 'persona-inline-editor'); draft.append(editor); rows.prepend(draft);
        personaEditor(null, editor); editor.querySelector('input')?.focus();
    }, 'plus', 'primary persona-add'); add.title = '新增用户设定'; add.setAttribute('aria-label', '新增用户设定'); toolbar.append(add); body.append(toolbar);
    const rows = el('div', 'persona-list'); rows.setAttribute('role', 'radiogroup'); rows.setAttribute('aria-label', '用户设定'); body.append(rows);
    for (const avatar of available) {
        const name = power.personas?.[avatar] || (avatar === state.settings.user_avatar ? state.settings.username : avatar), data = power.persona_descriptions?.[avatar] || {};
        const row = el('article', 'persona-row'); row.classList.toggle('selected', persona().avatar === avatar);
        const select = action(`选择 ${name}`, async () => { assertIdle(); const oldPersona = state.own.persona; state.own.persona = avatar; for (const item of rows.querySelectorAll('.persona-row')) { const active = item === row; item.classList.toggle('selected', active); item.querySelector('[role=radio]')?.setAttribute('aria-checked', String(active)); item.querySelector('.prompt-kind')?.remove(); if (active) item.querySelector('h2').append(el('small', 'prompt-kind', '当前')); } try { await saveOwn({ persona: avatar }); } catch (error) { state.own.persona = oldPersona; panelDirty = false; await personasPanel(); throw error; } }, null, 'persona-select');
        select.setAttribute('role', 'radio'); select.setAttribute('aria-checked', String(persona().avatar === avatar)); select.setAttribute('aria-label', name);
        const portrait = el('div', 'persona-portrait'), img = el('img'); img.src = `/thumbnail?type=persona&file=${encodeURIComponent(avatar)}&v=${avatarRevisions.get(avatar) || 0}`; img.alt = ''; img.loading = 'lazy'; themeDefaultAvatar(img, name); portrait.append(img);
        const info = el('div', 'persona-info'), heading = el('h2', '', name); if (persona().avatar === avatar) heading.append(el('small', 'prompt-kind', '当前')); info.append(heading, el('p', '', data.description || '暂无描述'));
        select.append(portrait, info);
        const actions = el('div', 'persona-actions'), edit = action('编辑', () => { const existing = row.querySelector('.persona-inline-editor'); if (existing) { existing.remove(); edit.setAttribute('aria-expanded', 'false'); } else { const editor = el('div', 'persona-inline-editor'); row.append(editor); edit.setAttribute('aria-expanded', 'true'); personaEditor(avatar, editor); } }, 'edit'); edit.title = '编辑'; edit.setAttribute('aria-label', `${name}：编辑`); actions.append(edit);
        const duplicate = action('复制', async () => { assertIdle(); const response = await fetch(`/User%20Avatars/${encodeURIComponent(avatar)}?v=${avatarRevisions.get(avatar) || 0}`); if (!response.ok) throw new Error('无法读取头像'); const form = new FormData(); form.append('avatar', await response.blob(), 'persona.png'); form.append('overwrite_name', `persona-${uuid()}.png`); const uploaded = await api.post('/api/avatars/upload', form, { form: true }); if (!uploaded.path) throw new Error('复制头像失败'); state.settings = await api.patchSettings(settings => { const power = settings.power_user ||= {}; (power.personas ||= {})[uploaded.path] = `${name} 副本`; (power.persona_descriptions ||= {})[uploaded.path] = copy(data); }); await personasPanel(); }, 'copy');
        const remove = action('删除', async () => { assertIdle(); if (!confirm(`删除用户设定「${name}」？`)) return; await api.post('/api/avatars/delete', { avatar }); state.settings = await api.patchSettings(settings => { delete settings.power_user?.personas?.[avatar]; delete settings.power_user?.persona_descriptions?.[avatar]; if (settingsOwn(settings).persona === avatar) delete settingsOwn(settings).persona; }); await personasPanel(); }, 'trash', 'danger');
        for (const [button, label] of [[duplicate, '复制'], [remove, '删除']]) { button.title = label; button.setAttribute('aria-label', `${name}：${label}`); actions.append(button); }
        row.append(select, actions); rows.append(row);
    }
    if (!available.length) rows.append(el('p', 'note', '暂无用户设定，点击右上角新增。'));
}

async function personaEditor(avatar = null, inline = null) {
    const body = inline || showPanel(avatar ? '编辑用户设定' : '新增用户设定', '身份资料'); if (!body) return;
    const power = state.settings.power_user || {}, saved = power.persona_descriptions?.[avatar] || {};
    let avatarFile = null;
    const portrait = el('div', 'character-portrait'), img = el('img'); themeDefaultAvatar(img, power.personas?.[avatar] || state.settings.username); img.alt = '用户头像'; img.hidden = !avatar; if (avatar) img.src = `/User%20Avatars/${encodeURIComponent(avatar)}?v=${avatarRevisions.get(avatar) || 0}`;
    const upload = action('导入头像', async () => { const file = await pickFile('image/*'); if (!file) return; avatarFile = file; const url = URL.createObjectURL(file); img.onload = () => URL.revokeObjectURL(url); img.src = url; img.hidden = false; upload.classList.add('has-avatar'); panelDirty = true; }, 'image', 'persona-avatar-upload');
    upload.title = '点击更换头像'; upload.setAttribute('aria-label', '导入头像'); upload.classList.toggle('has-avatar', !!avatar); upload.prepend(img); portrait.append(upload); body.append(portrait);
    const name = field(body, '名称', avatar ? power.personas?.[avatar] || state.settings.username || '' : '');
    const nameError = el('small', 'persona-name-error'); nameError.hidden = true; nameError.id = `persona-name-error-${uuid()}`; nameError.setAttribute('role', 'alert'); name.setAttribute('aria-describedby', nameError.id); name.parentElement.append(nameError);
    name.addEventListener('input', () => { if (name.value.trim()) { nameError.hidden = true; name.removeAttribute('aria-invalid'); } });
    const description = field(body, '描述', saved.description || '', { multiline: true, rows: 8 });
    const footer = el('div', 'persona-editor-actions'); body.append(footer);
    footer.append(action('保存', async () => {
        assertIdle(); if (!name.value.trim()) { nameError.textContent = '请输入名称'; nameError.hidden = false; name.setAttribute('aria-invalid', 'true'); name.focus(); name.scrollIntoView({ block: 'nearest' }); return; }
        if (!avatar || avatarFile) {
            let blob = avatarFile;
            if (!blob) {
                const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; const ctx = canvas.getContext('2d');
                const paper = (state.own.palette || 'paper') === 'paper'; ctx.fillStyle = paper ? '#eae2d6' : '#e6eddf'; ctx.fillRect(0, 0, 256, 256); ctx.fillStyle = paper ? '#805b40' : '#496c53'; ctx.font = '112px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText([...name.value.trim()][0], 128, 132);
                blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('生成头像失败。');
            }
            const form = new FormData(); form.append('avatar', blob, avatarFile?.name || 'persona.png'); form.append('overwrite_name', avatar || `persona-${uuid()}.png`);
            const uploaded = await api.post('/api/avatars/upload', form, { form: true }); if (!uploaded.path) throw new Error('头像保存失败。'); avatar = uploaded.path; avatarRevisions.set(avatar, Date.now()); avatarFile = null;
        }
        state.settings = await api.patchSettings(settings => {
            const power = settings.power_user ||= {}; power.personas ||= {}; power.persona_descriptions ||= {};
            power.personas[avatar] = name.value.trim(); power.persona_descriptions[avatar] = { ...(power.persona_descriptions[avatar] || {}), description: description.value, position: power.persona_descriptions[avatar]?.position ?? 0 };
            settingsOwn(settings).persona = avatar;
        }); state.own = state.settings.independent_frontend; panelDirty = false; notify('用户设定已保存'); await personasPanel();
    }, 'edit', 'primary'));
    footer.append(action('取消', () => { panelDirty = false; if (inline) { const draft = inline.closest('.persona-draft'); if (draft) draft.remove(); else inline.remove(); return; } return personasPanel(); }));
}

async function openCharacterWorld(avatar) {
    assertIdle();
    let character = await api.post('/api/characters/get', { avatar_url: avatar });
    let card = character.data || character;
    if (!card.extensions?.world && !card.character_book?.entries) throw new Error('这个角色没有关联或内嵌世界书。');
    if (card.character_book?.entries) {
        const result = await importCharacterWorld(api, avatar, safeName); character = result.character; card = character.data || character;
        if (state.character?.avatar === avatar) state.character = character;
        if (result.imported) { characterCatalog.invalidate(); await loadCharacterCatalog(true); notify('角色世界书已提取并关联'); }
    } else {
        const available = await api.post('/api/worldinfo/list');
        if (!available.some(book => book.file_id === card.extensions.world)) throw new Error(`找不到角色关联的世界书：${card.extensions.world}。请先导入对应世界书。`);
    }
    await worldsPanel(card.extensions?.world || '', null, character);
}
async function worldsPanel(target = '', initial = null, character = state.character) {
    const host = showPanel('世界书', '背景与记忆'); if (!host) return;
    return loadPanelContent(host, '世界书', (body, revision, timing) => renderWorldPanel(body, revision, target, initial, character, timing), () => worldsPanel(target, initial, character));
}
async function renderWorldPanel(body, revision, target, initial, character, timing) {
    const worlds = await api.post('/api/worldinfo/list', {}, { timing }); if (revision !== panelRevision) return;
    const currentCard = character?.data || character;
    const linked = currentCard?.extensions?.world;
    if (!target && !initial && linked && worlds.some(book => book.file_id === linked)) target = linked;
    const active = state.settings.world_info_settings?.world_info?.globalSelect ?? state.own.worlds ?? [];
    const globals = new Set(active);
    let bookDirty = !!initial;
    const globalSection = el('div', 'global-world-section'); body.append(globalSection);
    const buildSelection = () => renderGlobalWorldSelect(globalSection, worlds, globals, { el, icon, changed: () => { panelDirty = true; } });
    if (timing) timing.measureSync('世界书 · 构建全局选择器', 'data', buildSelection, () => ({ metrics: { totalItems: worlds.length } })); else buildSelection();
    const globalSettings = el('details', 'advanced world-global-settings'); globalSettings.append(el('summary', '', '世界书全局设置'));
    const globalDraft = copy(state.settings.world_info_settings || {}), globalGrid = el('div', 'parameter-grid'); globalSettings.append(globalGrid);
    for (const [key, label, fallback, min, max] of worldSettingsFields) {
        const control = field(globalGrid, label, globalDraft[key] ?? fallback, { type: 'number' }); control.min = min; control.max = max; control.step = 1;
        control.addEventListener('input', () => { globalDraft[key] = control.value === '' ? NaN : Number(control.value); });
    }
    for (const [key, label] of [['world_info_recursive', '启用递归扫描'], ['world_info_case_sensitive', '区分大小写'], ['world_info_match_whole_words', '匹配完整单词']]) {
        const wrap = el('label', 'check-field'), control = el('input'); control.type = 'checkbox'; control.checked = !!globalDraft[key];
        control.addEventListener('change', () => { globalDraft[key] = control.checked; panelDirty = true; }); wrap.append(control, el('span', '', label)); globalSettings.append(wrap);
    }
    globalSection.append(globalSettings);
    const saveGlobals = async () => {
        const config = validateWorldSettings(globalDraft);
        state.settings = await api.patchSettings(settings => {
            const wi = settings.world_info_settings ||= {};
            for (const [key] of worldSettingsFields) if (key in config) wi[key] = config[key];
            for (const key of ['world_info_recursive', 'world_info_case_sensitive', 'world_info_match_whole_words']) if (key in config) wi[key] = config[key];
            (wi.world_info ||= {}).globalSelect = [...globals];
            delete settingsOwn(settings).worlds;
        });
        state.own = state.settings.independent_frontend;
    };
    globalSettings.append(action('保存全局设置', async () => { assertIdle(); await saveGlobals(); panelDirty = bookDirty; notify('世界书全局设置已保存'); }, 'book'));
    body.append(globalSection);
    const bar = el('div', 'connection-profile-bar'); body.append(bar);
    const select = el('select'); select.setAttribute('aria-label', '当前世界书'); select.dataset.searchable = 'true'; select.dataset.searchPlaceholder = '搜索世界书…'; select.dataset.searchLabel = '搜索世界书';
    for (const world of worlds) { const option = el('option', '', world.name); option.value = world.file_id; select.append(option); }
    if (target && worlds.some(world => world.file_id === target)) select.value = target;
    const tools = el('div', 'connection-profile-tools'); bar.append(select, tools);
    let original = initial ? '' : select.value;
    const loadedBook = initial || (original ? await api.post('/api/worldinfo/get', { name: original }, { timing }) : { entries: {} });
    let draft = timing ? timing.measureSync('世界书 · 整理条目数据', 'data', () => worldDraft(loadedBook), value => ({ metrics: { entryCount: Object.keys(value.entries || {}).length } })) : worldDraft(loadedBook);
    if (revision !== panelRevision) return;
    const name = { value: initial ? target : original };
    const entries = el('div', 'world-entry-list'); body.append(entries);
    const dirty = () => { bookDirty = true; panelDirty = true; };
    const render = (target = entries, trace = timing) => {
        const build = () => renderWorldEntries(target, draft, { el, field, action, dirty, icon, countTokens: async text => { const result = await api.post(`/api/tokenizers/openai/count?model=${encodeURIComponent(connection().model)}`, [{ role: 'system', content: text }]); return result.token_count; } });
        return trace ? trace.measureSync('世界书 · 构建条目列表', 'data', build, () => ({ metrics: { entryCount: Object.keys(draft.entries || {}).length } })) : build();
    };
    const button = (label, glyph, callback, className = '') => { const control = action(label, callback, glyph, className); control.title = label; control.setAttribute('aria-label', label); tools.append(control); return control; };
    button('修改世界书名称', 'edit', () => {
        const value = prompt('世界书名称', name.value);
        if (value === null) return;
        if (!value.trim()) { notify('请输入世界书名称', 'warning'); return; }
        name.value = value.trim(); dirty();
        select.options[select.selectedIndex].textContent = `${name.value}（未保存）`;
    });
    button('新增世界书', 'plus', async () => {
        if (panelDirty && !confirm('放弃未保存的修改并新建世界书？')) return;
        panelDirty = false; await worldsPanel(uniquePresetName('新世界书', worlds.map(book => book.file_id)), { entries: {} }, character);
    });
    button('导入世界书', 'import', async () => {
        if (panelDirty && !confirm('放弃未保存的修改并导入世界书？')) return;
        const file = await pickFile('.json'); if (!file) return;
        const value = worldDraft(JSON.parse(await file.text())); panelDirty = false; await worldsPanel(file.name.replace(/\.json$/i, ''), value, character);
    });
    button('导出世界书', 'export', () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
        const link = el('a'); link.href = url; link.download = `${safeName(name.value.trim() || '世界书')}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const remove = button('删除世界书', 'trash', async () => {
        assertIdle(); if (!original) return;
        if (!confirm(`删除世界书「${original}」？关联它的角色或用户设定需要重新选择世界书。`)) return;
        await api.post('/api/worldinfo/delete', { name: original }); globals.delete(original); await saveGlobals();
        panelDirty = false; notify('世界书已删除'); await worldsPanel('', null, character);
    }, 'danger'); remove.disabled = !original;
    if (initial || !worlds.length) {
        const option = el('option', '', `${target || '新世界书'}（未保存）`); option.value = '__draft__'; select.append(option); select.value = '__draft__'; panelDirty = true;
    }
    let previous = select.value, bookRequest = 0;
    select.addEventListener('change', () => run(async () => {
        if (panelDirty && !confirm('放弃未保存的修改并切换世界书？')) { select.value = previous; return; }
        const next = select.value, request = ++bookRequest;
        try {
            await loadPanelContent(entries, '世界书条目', async (content, _revision, trace) => {
                const loaded = await api.post('/api/worldinfo/get', { name: next }, { timing: trace });
                if (request !== bookRequest || revision !== panelRevision) return;
                original = next; name.value = next; draft = trace.measureSync('世界书 · 整理条目数据', 'data', () => worldDraft(loaded)); previous = next; bookDirty = false; panelDirty = false; remove.disabled = false; render(content, trace);
            }, () => worldsPanel(next, null, character));
        } catch (error) { if (request === bookRequest) select.value = previous; throw error; }
    }));
    const footer = el('div', 'editor-footer'); footer.append(action('保存世界书', async () => {
        assertIdle(); if (!name.value.trim()) throw new Error('请输入世界书名称。');
        const targetName = safeName(name.value.trim());
        const current = await api.post('/api/worldinfo/list');
        if (targetName !== original && current.some(book => book.file_id === targetName) && !confirm('覆盖同名世界书？')) return;
        const value = worldDraft(draft); value.name = targetName;
        await api.post('/api/worldinfo/edit', { name: targetName, data: value }); await saveGlobals();
        panelDirty = false; notify('世界书已保存'); await worldsPanel(targetName, null, character);
    }, 'book', 'primary')); body.append(footer); render();
}

async function loadBooks(options) {
    const names = new Set(state.settings.world_info_settings?.world_info?.globalSelect ?? state.own.worlds ?? []);
    const card = state.character.data || state.character;
    if (card.extensions?.world) names.add(card.extensions.world);
    if (persona().world) names.add(persona().world);
    if (names.size) {
        const available = await api.post('/api/worldinfo/list', {}, options);
        const missing = [...names].filter(name => name && !available.some(book => book.file_id === name));
        if (missing.length) throw new Error(`找不到关联世界书：${missing.join('、')}。请检查名称或导入文件。`);
    }
    const books = await Promise.all([...names].filter(Boolean).map(name => api.post('/api/worldinfo/get', { name }, options)));
    // Native imports can materialize the embedded book into a named world.
    // Prefer that editable named world instead of injecting the same book twice.
    if (card.character_book?.entries && !card.extensions?.world) {
        books.push(embeddedWorld(state.character));
    }
    return books;
}
function currentDatabase() {
    const settings = databaseSettings(state.own.database);
    return { settings, ...databaseForChat(state.chat, state.header, settings.template) };
}
async function databaseWorlds(config) {
 const available=await api.post('/api/worldinfo/list');
 const card=state.character?.data||state.character||{};
 const names=new Set([card.extensions?.world,...(state.settings.world_info_settings?.charLore||[]).filter(item=>item.name===card.name).flatMap(item=>item.extraBooks||[])].filter(Boolean));
 const selected=config.source==='manual'?available:available.filter(book=>names.has(book.file_id));
 return Promise.all(selected.map(async book=>({...(await api.post('/api/worldinfo/get',{name:book.file_id})),name:book.file_id})));
}
function databaseConnection(settings) {
 if(settings.apiMode==='tavern'){const profile=profileStore.profiles.find(profile=>profile.id===(settings.tavernProfile||settings.profileId));if(!profile)throw Error('请选择酒馆连接预设');return {...profile};}
 const config=settings.apiConfig;return {source:'custom',url:config.url||'',model:config.model||'',proxyPassword:config.apiKey||'',secretId:'no-key-database',stream:false};
}
async function databaseModels(config) {
 if(!config.url?.trim())throw new Error('请填写 API 基础地址');
 const normalized=normalizeConnection({source:'custom',url:config.url,model:config.model||'model-list',proxyPassword:config.apiKey||''});
 let secretId='no-key-database';if(config.apiKey){const secret=await api.post('/api/secrets/write',{key:'api_key_custom',value:config.apiKey,label:'数据管理'});secretId=secret.id;}
 const result=await api.post('/api/backends/chat-completions/status',{chat_completion_source:'custom',custom_url:normalized.url,secret_id:secretId});return modelOptions(result);
}
function assertDatabaseWritable() {
    if (state.loading) throw new Error('正在切换聊天，请稍候。');
    if (inlineEdit) throw new Error('请先保存或取消正在编辑的消息。');
    if (state.dirty && !state.busy) throw new Error('当前聊天尚未保存，请先重试保存。');
}
function databaseWriteGuard(index) {
    const chat = state.chat, header = state.header, identity = `${state.character?.avatar}/${state.file}`, target = chat[index];
    const hash = sourceHash(chat, index);
    const snapshot = () => JSON.stringify([header.chat_metadata?.independentDatabase?.seed, chat.slice(0, index + 1).map(message => message.TavernDB_ACU_Data)]);
    let original = snapshot();
    return {
        check() {
            assertDatabaseWritable();
            if (state.chat !== chat || state.header !== header || `${state.character?.avatar}/${state.file}` !== identity || chat[index] !== target || sourceHash(chat, index) !== hash || snapshot() !== original)
                throw new Error('聊天或数据库已变化，请重新打开数据库后重试。');
            if (target && state.generation?.reply === target) throw new Error('该楼层正在生成，请选择已完成的楼层。');
        },
        saved() { original = snapshot(); },
    };
}
async function databasePanel(preview = false) {
    assertViewable(); if (!state.character) throw new Error('请先打开一个角色的聊天。');
    const current = currentDatabase();
    const body = showPanel(preview ? '数据预览' : '数据管理', `${state.character.name} · 当前聊天`, 'database-panel'); if (!body) return;
    const identity = `${state.character.avatar}/${state.file}`;
    const chat = state.chat, header = state.header;
    const revision = panelRevision;
    const target = state.chat.findLastIndex(message => !message.is_user && message !== state.generation?.reply);
    const write = databaseWriteGuard(target);
    const sameChat = () => { if (state.chat !== chat || state.header !== header || `${state.character?.avatar}/${state.file}` !== identity) throw new Error('聊天已切换，请重新打开数据库。'); };
    const content = el('div', 'panel-content'); body.append(content);
    renderDatabasePanel(content, {
        worlds: databaseWorlds, models: databaseModels, preview, el, field, action, icon, notify, pickFile, chatName: state.file, chat: state.chat,
        settings: current.settings, data: current.data, legacy: current.legacy, profiles: profileStore?.profiles || [], legacySettings: state.settings.extension_settings?.dataManage,
        history: () => state.header.chat_metadata?.independentDatabase?.history || [],
        dirty: value => { if (revision === panelRevision) panelDirty = value; }, stop: () => state.databaseController?.abort(),
        saveSettings: async value => {
            sameChat(); const enabling = !state.own.database?.auto && value.auto;
            await saveOwn({ database: databaseSettings(value) });
            sameChat();
            if (enabling) { ((state.header.chat_metadata ||= {}).independentDatabase ||= {}).autoStart = state.chat.length; await saveChat(); }
        },
        saveData: async value => { write.check(); sameChat(); storeDatabase(state.chat, state.header, value, target); write.saved(); await saveChat(); await rememberChat(); },
        fill: async (from, to) => { sameChat(); await updateDatabase(from, to); },
    });
}
function databaseProgress(message, controller) {
    const notice=el('div','database-progress'),text=el('span','',message);
    notice.setAttribute('role','status');notice.setAttribute('popover','manual');
    const stop=action('终止',()=>{controller.abort();stop.disabled=true;text.textContent='正在终止填表…';});notice.append(text,stop);document.body.append(notice);
    if(notice.showPopover)notice.showPopover();else $('panel').open?$('panel').append(notice):document.body.append(notice);
    return {update:value=>{text.textContent=value;},close:()=>{if(notice.matches(':popover-open'))notice.hidePopover();notice.remove();}};
}
async function updateDatabase(from, to, automatic = false) {
    assertDatabaseWritable(); if (!state.character) throw new Error('请先打开聊天。');
    if (state.databaseController) throw new Error('数据库正在更新，请等待完成或终止填表。');
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= state.chat.length) throw new Error('请填写有效的起始和结束楼层。');
    const aiIndices=state.chat.map((message,index)=>!message.is_user&&index>=from&&index<=to?index:-1).filter(index=>index>=0);
    if(!aiIndices.length){notify('没有消息需要更新', 'info');return;}
    const rangeStart=from,rangeEnd=to;from=Math.max(0,aiIndices[0]-1);if(from>0&&!state.chat[from].is_user&&state.chat[from-1]?.is_user)from--;to=aiIndices.at(-1);
    const write = databaseWriteGuard(to);
    write.check();
    const current = currentDatabase(), settings = current.settings;
    let config = databaseConnection(settings);
    if (!config) throw new Error('填表连接已删除，请在数据库更新设置中重新选择。');
    config = { ...config, stream: false };
    const preset = { temperature: settings.temperature, top_p: 1, openai_max_tokens: settings.maxTokens, names_behavior: 0 };
    generationBody(config, preset, []);
    const chat = copy(state.chat);
    let result=settings.template;for(let index=aiIndices[0];index>=0;index--)if(!chat[index].is_user&&chat[index].TavernDB_ACU_Data){result=copy(chat[index].TavernDB_ACU_Data);break;}
    let reference = '';
    const controller = new AbortController(); state.databaseController = controller;
    const progress=databaseProgress('正在准备填表数据，请稍候…',controller);
    try {
        if (config.proxyPassword && (!config.secretId || config.secretId.startsWith('no-key-'))) {
            const secret = await api.post('/api/secrets/write', { key: config.source === 'custom' ? 'api_key_custom' : 'api_key_openai', value: config.proxyPassword, label: config.name || '数据库连接' });
            if (!secret.id) throw new Error('数据库连接密钥注册失败。'); config.secretId = secret.id;
            const next = { ...profileStore, profiles: profileStore.profiles.map(profile => profile.id === config.id ? { ...profile, secretId: secret.id } : profile) };
            if(config.id){await api.saveConnections(next); profileStore = next;}
        }
        const worldConfig=settings.worldbookConfig||{source:'character'};const books=await databaseWorlds(worldConfig);reference=books.filter(book=>worldConfig.source!=='manual'||(worldConfig.manualSelection||[]).includes(book.name)).flatMap(book=>Object.entries(book.entries||{}).filter(([id,entry])=>{const enabled=worldConfig.enabledEntries?.[book.name];return Array.isArray(enabled)?enabled.map(String).includes(String(entry.uid??id)):!entry.disable;}).map(([,entry])=>entry.content||'')).join('\n\n');
        let start = from, batches = 0;
        const updateCounts = { operations: 0, tables: 0 };
        while (start <= to) {
            if (controller.signal.aborted) throw new DOMException('填表已停止', 'AbortError');
            let end = to;
            while (end > start && chat[end].is_user) end--;
            if (chat[end].is_user) { end = chat.findIndex((message, index) => index >= start && index <= to && !message.is_user); if (end < start) throw new Error('整理范围内没有角色回复。'); }
            const variables = { char: state.character?.name || '', user: persona().name, description: state.character?.data?.description || '', persona: persona().description, tabledata: referenceDatabaseText(result, settings) };
            for (const [key] of Object.entries(result).filter(([key]) => key.startsWith('sheet_'))) variables[key] = sheetText(result, key);
            const messages = fillMessages({...settings,userName:persona().name}, result, chat, start, end, reference).map(message => ({ ...message, content: expand(message.content, variables) }));

            progress.update(automatic?'正在填表，请稍候…':`正在处理手动更新（${batches+1}/1），楼层 ${rangeStart}–${rangeEnd}…`);
            const response = await api.response('/api/backends/chat-completions/generate', generationBody(config, preset, messages), { signal: controller.signal });
            let text = '';
            if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
                for await (const event of readEvents(response)) { if (event.error) throw new Error(typeof event.error === 'string' ? event.error : event.error.message || '填表失败'); text += event.choices?.[0]?.delta?.content || event.choices?.[0]?.text || ''; }
            } else {
                const value = await response.json(); if (value.error) throw new Error(typeof value.error === 'string' ? value.error : value.error.message || '填表失败');
                text = value.choices?.[0]?.message?.content || value.choices?.[0]?.text || '';
            }
            progress.update('正在解析并应用数据库更新…');result = parseUpdate(text, result, updateCounts); start = end + 1; batches++;
        }
        if (controller.signal.aborted) throw new DOMException('填表已停止', 'AbortError');
        write.check();
        storeDatabase(state.chat, state.header, result, to, { from, to, batches });
        if(settings.autoHideMessages){for(let index=rangeStart===1?0:rangeStart;index<=rangeEnd;index++)state.chat[index].is_system=true;list.setMessages(state.chat,{reset:true});}
        progress.update('正在保存数据库…');await saveChat(); await rememberChat(); notify(databaseUpdateNotice(updateCounts));
    } catch (error) {
        if (error.name === 'AbortError') { notify('填表操作已由用户终止', 'info'); return; }
        notify(`数据库更新失败：${error.message}`,true);throw error;
    } finally { progress.close(); state.databaseController = null; }
}
async function autoUpdateDatabase() {
 try {
  if(!state.own.database?.auto || state.databaseController || state.busy || state.dirty || state.chat.length<2 || state.chat.at(-1)?.is_user || state.chat.at(-1)?.TavernDB_ACU_Data)return;
  const settings=currentDatabase().settings;let recorded=0;for(let index=state.chat.length-1;index>0;index--)if(state.chat[index].TavernDB_ACU_Data){recorded=index;break;}
  const batch=Number(settings.updateBatchSize)||1,skip=Number(settings.autoUpdateFrequency)||0;
  if(state.chat.length-1-recorded<skip+batch)return;
  await updateDatabase(recorded===0?0:recorded+1,Math.min(state.chat.length-1,recorded+batch),true);
 }catch(error){notify(`回复已保存，自动填表失败：${error.message}`,true);}
}
const tokenCounts = new Map();
let tokenCacheBytes = 0;
const generationPreload = new GenerationPreload(generationDatabaseResources);
function preloadNextGeneration() {
    const chat = state.chat, header = state.header, character = state.character;
    const currentChat = () => state.chat === chat && state.header === header && state.character === character && !state.busy && !state.loading && !state.dirty && !panelDirty;
    const key = [chat, header, character, state.settings, state.preset, JSON.stringify(state.own.database || {}), JSON.stringify(activeRegexes({ settings: state.settings, preset: state.preset, character })), ...chat.flatMap(message => [message, message.mes, message.is_user, message.is_system])];
    generationPreload.schedule(async (signal, taskMetrics) => {
        const current = () => !signal.aborted && currentChat();
        if (!character || !current()) return;
        const finish = loadTimings.start('预加载下次生成资料', 'generation');
        try {
            // Warm the normal API cache; sending can share an in-flight read.
            await loadBooks();
            await nextPaint();
            if (!current()) { finish('cancelled', { reason: 'preload-cancelled', metrics: taskMetrics() }); return; }
            generationPreload.get(chat, header, state.own.database);
            await nextPaint();
            if (!current()) { finish('cancelled', { reason: 'preload-cancelled', metrics: taskMetrics() }); return; }
            if (chat.length && !chat.at(-1).is_user) generationPreload.get(chat.slice(0, -1), header, state.own.database);
            const finishWarm = loadTimings.start('后台预热历史正则', 'generation');
            let warmed;
            try { warmed = await warmHistoryRegex(chat, activeRegexes({ settings: state.settings, preset: state.preset, character }), current); finishWarm(warmed?.status || 'success', { metrics: { ...warmed?.metrics, ...taskMetrics() }, ...(warmed?.status === 'cancelled' ? { reason: 'preload-cancelled' } : {}) }); }
            catch (error) { finishWarm(error.name === 'AbortError' ? 'cancelled' : 'error'); throw error; }
            if (warmed?.status === 'cancelled') { finish('cancelled', { reason: 'preload-cancelled', metrics: taskMetrics() }); return; }
            finish('success', { metrics: taskMetrics() });
            return true;
        } catch (error) { finish(error.name === 'AbortError' ? 'cancelled' : 'error'); }
    }, key);
}
async function preparePrompt(chat = state.chat) {
    if (!state.character) throw new Error('请先选择角色。');
    const books = await loadBooks();
    const resources = loadTimings.measureSync('准备资料库文本与表格宏', 'generation', () => generationPreload.get(chat, state.header, state.own.database));
    const input = { character: state.character, persona: persona(), preset: state.preset, chat, settings: state.settings, books, ...resources, mvuSeed: state.header?.chat_metadata?.independentMvuSeed, onBuild: () => loadTimings.start('构建提示词与展开宏', 'generation'), measureBuild: (label, task, details) => loadTimings.measureSync(label, 'generation', task, details) };
    return fitPrompt(input, async messages => {
        const model = connection().model || 'gpt-4';
        const key = model + '\n' + JSON.stringify(messages);
        if (tokenCounts.has(key)) return tokenCounts.get(key);
        const result = await api.post(`/api/tokenizers/openai/count?model=${encodeURIComponent(model)}`, messages, { signal: state.controller?.signal });
        if (!Number.isFinite(result?.token_count)) throw new Error('无法统计上下文 tokens，已停止发送。');
        if (key.length < 2000000) {
            while (tokenCounts.size && (tokenCounts.size >= 24 || tokenCacheBytes + key.length > 4000000)) { const oldest = tokenCounts.keys().next().value; tokenCacheBytes -= oldest.length; tokenCounts.delete(oldest); }
            tokenCounts.set(key, result.token_count); tokenCacheBytes += key.length;
        }
        return result.token_count;
    });
}

async function generate(mode = false) {
    assertIdle(); if (state.dirty) await saveChat(); assertSaved(); if (!state.character) throw new Error('请先选择角色。');
    generationPreload.cancelScheduled();
    if (state.connectionPending) throw new Error('连接正在初始化，请稍候。');
    if (state.connectionError) throw new Error('连接初始化失败，请打开 API 面板检查并保存连接。');
    if (state.presetMissing) throw new Error('保存的预设已不存在，请打开预设面板选择有效预设；不会自动切换到第一个。');
    const regenerate = mode === true;
    const text = $('message-input').value.trim();
    const retry = mode === 'retry' || (!regenerate && !text && !!state.chat.at(-1)?.is_user);
    if (!regenerate && !retry && !text) return;
    if (retry && !state.chat.at(-1)?.is_user) throw new Error('最后一条消息不是待回复的用户消息。');
    if (regenerate && (!state.chat.length || state.chat.at(-1).is_user)) throw new Error('当前没有可重新生成的最后回复。');
    const previousReply = regenerate ? copy(state.chat.at(-1)) : null;
    // Fail local validation before fetching books or running tokenizer requests.
    generationBody(connection(), state.preset, []);
    const user = { name: persona().name, is_user: true, is_system: false, send_date: new Date().toISOString(), mes: regexText(text, 1, { depth: 0 }), extra: {} };
    const requestChat = regenerate ? state.chat.slice(0, -1) : retry ? state.chat : [...state.chat, user];
    const finishGeneration = loadTimings.start(regenerate ? '重新生成' : '发送消息', 'generation');
    state.busy = true; state.generation = { regenerate, reply: null }; state.controller = new AbortController(); synchronize();
    status(regenerate ? '重新生成 · 准备上下文…' : '发送消息 · 准备上下文…');
    let reply = null; let replyIndex = -1; let pendingUser = false; let completed = false;
    let finishFirstText, finishModelResponse;
    try {
        if (nativeScriptPlan(state.settings, state.character).some(script => script.enabled !== false && scriptSupport(script).supported)) {
            if (!scriptRuntime.frame || scriptRuntime.identity !== scriptIdentity()) await loadTimings.measure('初始化助手脚本环境', 'generation', () => openScriptWorkspace(false));
            await loadTimings.measure('助手事件 generation_started', 'generation', () => scriptRuntime.dispatch('generation_started', [regenerate ? 'swipe' : 'normal'], scriptSnapshot(state), scriptIdentity()));
        }
        await loadTimings.measure('准备角色变量', 'generation', () => prepareRoleMvu(true));
        if (!regenerate && !retry && scriptRuntime.helperReady) {
            state.chat.push(user); pendingUser = true; $('message-input').value = ''; resizeInput(); await loadTimings.measure('发送前保存聊天', 'generation', () => saveChat());
            await loadTimings.measure('助手事件 message_sent', 'generation', () => scriptRuntime.dispatch('message_sent', [state.chat.length - 1], scriptSnapshot(state), scriptIdentity()));
        }
        const prepared = await loadTimings.measure('准备生成上下文', 'generation', () => preparePrompt(requestChat));
        const body = loadTimings.measureSync('组装模型请求', 'generation', () => generationBody(connection(), state.preset, prepared.messages));
        if (state.controller.signal.aborted) return;
        if (!regenerate && !retry && !pendingUser) { state.chat.push(user); pendingUser = true; $('message-input').value = ''; resizeInput(); await loadTimings.measure('发送前保存聊天', 'generation', () => saveChat()); }
        if (regenerate) {
            const old = state.chat.at(-1);
            reply = { ...copy(old), mes: '', gen_started: new Date().toISOString(), extra: { ...(old.extra || {}) } };
            delete reply.gen_finished; delete reply.extra.reasoning;
            if (reply.TavernDB_ACU_Data) (reply.extra.independentDatabase ||= {}).stale = true;
            reply.swipes = old.swipes?.length ? [...old.swipes] : [old.mes];
            reply.swipe_info = old.swipe_info ? copy(old.swipe_info) : [{ extra: copy(old.extra || {}) }];
            reply.swipe_id = reply.swipes.length; reply.swipes.push(''); state.chat[state.chat.length - 1] = reply;
        } else { reply = { name: state.character.name, is_user: false, is_system: false, send_date: new Date().toISOString(), mes: '', gen_started: new Date().toISOString(), extra: {} }; state.chat.push(reply); }
        replyIndex = state.chat.length - 1;
        state.generation.reply = reply;
        loadTimings.measureSync('发送前刷新消息列表', 'generation', () => list.setMessages(state.chat, { latest: true })); status(regenerate ? '正在重新生成，等待回复…' : '消息已发送，等待回复…');
        preview = prepared;
        finishFirstText = loadTimings.start('模型请求至首段文本（含思考）', 'generation');
        finishModelResponse = loadTimings.start('模型请求至回复接收完成', 'generation');
        const response = await loadTimings.measure('模型请求至响应头', 'generation', () => api.response('/api/backends/chat-completions/generate', body, { signal: state.controller.signal }));
        if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
            const result = await response.json();
            if (result.error) throw new Error(typeof result.error === 'string' ? result.error : result.error.message || '模型请求失败');
            reply.mes = result.choices?.[0]?.message?.content || result.choices?.[0]?.text || '';
            if (reply.mes) finishFirstText();
        } else {
            for await (const event of readEvents(response)) {
                if (event.error) throw new Error(typeof event.error === 'string' ? event.error : event.error.message || '模型请求失败');
                const delta = event.choices?.[0]?.delta;
                if (delta?.content || delta?.reasoning_content || delta?.reasoning || event.choices?.[0]?.text) finishFirstText();
                if (!reply.mes && !reply.extra.reasoning && (delta?.content || delta?.reasoning_content || delta?.reasoning || event.choices?.[0]?.text)) status(regenerate ? '正在重新生成…' : '正在回复…');
                reply.mes += delta?.content || event.choices?.[0]?.text || '';
                if (delta?.reasoning_content || delta?.reasoning) reply.extra.reasoning = (reply.extra.reasoning || '') + (delta.reasoning_content || delta.reasoning);
                if (!streamFrame) streamFrame = setTimeout(() => { streamFrame = 0; list.update(replyIndex); }, 90);
            }
        }
        if (!reply.mes && !reply.extra.reasoning) throw new Error('模型没有返回文本。');
        completed = true;
        status('回复完成');
    } catch (error) {
        const failure = requestFailure(error, state.controller?.signal);
        finishFirstText?.(failure.status, failure);
        finishModelResponse?.(failure.status, failure);
        if (error.name === 'AbortError') notify('生成已停止，已收到的内容会保存', 'info');
        else { state.error = error.message; notify(error.message, true); }
    } finally {
        finishModelResponse?.(completed ? 'success' : 'cancelled');
        if (streamFrame) { clearTimeout(streamFrame); streamFrame = 0; }
        state.generation = null;
        if (completed && reply && scriptRuntime.helperReady) {
            try {
                if (regenerate) reply.swipes[reply.swipe_id] = reply.mes;
                await loadTimings.measure('助手处理前保存模型原文', 'generation', () => saveChat());
                await loadTimings.measure('助手事件 message_received', 'generation', () => scriptRuntime.dispatch('message_received', [replyIndex], scriptSnapshot(state), scriptIdentity()));
            } catch (error) { notify(`回复已保留，角色脚本处理失败：${error.message}`, true); }
        }
        const rawReplyText = reply?.mes;
        if (reply) {
            reply.mes = regexText(reply.mes, 2, { depth: 0 });
            if (reply.extra?.reasoning) reply.extra.reasoning = regexText(reply.extra.reasoning, 6, { depth: 0 });
            if (!reply.mes && !reply.extra.reasoning) {
                if (regenerate) state.chat[state.chat.length - 1] = previousReply; else state.chat.pop();
            } else {
                reply.gen_finished = new Date().toISOString(); reply.extra.model = connection().model;
                if (regenerate) { reply.swipes[reply.swipe_id] = reply.mes; reply.swipe_info[reply.swipe_id] = { extra: copy(reply.extra), gen_started: reply.gen_started, gen_finished: reply.gen_finished }; }
            }
        }
        if (completed && reply) {
            try { await loadTimings.measure('回复后更新角色变量', 'generation', () => prepareRoleMvu(true, { message: reply, text: rawReplyText })); } catch (error) { notify(`回复已保留，角色变量更新失败：${error.message}`, true); }
        }
        if (reply || pendingUser) {
            try { await loadTimings.measure('回复后保存聊天', 'generation', () => saveChat()); await rememberChat(); } catch (error) { notify(error.message, true); }
            list.setMessages(state.chat, { latest: list.follow });
        }
        state.busy = false; state.controller = null; synchronize();
        if (completed && scriptRuntime.helperReady) {
            try { await loadTimings.measure('助手事件 generation_ended', 'generation', () => scriptRuntime.dispatch('generation_ended', [replyIndex], scriptSnapshot(state), scriptIdentity())); }
            catch (error) { notify(`角色脚本结束事件失败：${error.message}`, true); }
        }
        if (!state.dirty) status(state.error ? '请求未完成' : '已保存');
        finishGeneration(completed ? 'success' : state.error ? 'error' : 'cancelled');
        state.error = '';
        if (completed && !state.dirty) { await autoUpdateDatabase(); preloadNextGeneration(); }
    }
    return { completed };
}

function beginMessageEdit(message) {
    return run(() => {
        if (inlineEdit?.message === message) return;
        assertSaved(); const index = state.chat.indexOf(message); if (index < 0) return;
        inlineEdit = { message, text: message.mes }; list.update(index);
        document.querySelector('.inline-editor textarea')?.focus();
    });
}
async function deleteEditedMessage(message) {
    assertIdle(); if (state.dirty) throw new Error('请先重试保存当前聊天。');
    const index = state.chat.indexOf(message);
    if (index < 0 || inlineEdit?.message !== message) throw new Error('消息已变化，请重新打开编辑。');
    if (!confirm(`删除第 ${index} 楼消息？酒馆会保留聊天备份。`)) return;
    state.chat.splice(index, 1); inlineEdit = null; invalidateDatabases(state.chat, index);
    list.setMessages(state.chat, { reset: true }); await saveChat();
}

function searchPanel() {
    const body = showPanel('查找对话', '全部消息'); if (!body) return;
    const search = field(body, '搜索文字', '', { type: 'search' });
    const floor = field(body, '跳到楼层', '', { type: 'number' }); floor.min = '0'; floor.step = '1';
    body.append(action('跳转', () => {
        const index = Number(floor.value); if (!Number.isInteger(index) || index < 0 || index >= state.chat.length) throw new Error('请输入存在的楼层编号。');
        panelDirty = false; closePanel(); list.jump(index);
    }, 'down'));
    const results = el('div', 'resource-list'); body.append(results);
    let timer;
    search.addEventListener('input', () => {
        panelDirty = false; clearTimeout(timer);
        timer = setTimeout(() => {
            results.replaceChildren(); const query = search.value.trim().toLowerCase(); if (!query) return;
            let count = 0;
            for (let index = state.chat.length - 1; index >= 0 && count < 80; index--) {
                const message = state.chat[index]; const offset = message.mes?.toLowerCase().indexOf(query) ?? -1; if (offset < 0) continue;
                const result = action(`#${index} · ${message.name}`, () => { panelDirty = false; closePanel(); list.jump(index); }, 'search', 'resource-row');
                result.append(el('small', '', message.mes.slice(Math.max(0, offset - 30), offset + 120))); results.append(result); count++;
            }
            if (!count) note(results, '没有找到匹配消息。');
            if (count === 80) note(results, '仅显示最近 80 个结果，请缩小搜索范围。');
        }, 150);
    });
}
function databasePreviewPanel() {
 assertViewable();if(!state.character)throw new Error('请先打开聊天');const current=currentDatabase();const body=showPanel('数据预览',`楼层 ${current.index}`,'database-panel');if(!body)return;
 const revision=panelRevision,write=databaseWriteGuard(current.index);
 let previousData=null;for(let index=current.index-1;index>=0;index--){if(state.chat[index].TavernDB_ACU_Data){previousData=state.chat[index].TavernDB_ACU_Data;break;}}
 renderDatabasePreview(body,{el,field,action,dirty:value=>{if(revision===panelRevision)panelDirty=value;},data:current.data,index:current.index,previousData,settings:current.settings,notify,savePreferences:async patch=>{await saveOwn({database:{...currentDatabase().settings,...patch}});},
 saveData:async value=>{write.check();storeDatabase(state.chat,state.header,value,current.index);write.saved();await saveChat();},
 send:text=>{if(closePanel()){$('message-input').value=text;resizeInput();$('message-input').focus();}}
 });
}
function toolsPanel() {
    const body = showPanel('对话工具', state.character?.name || '连接、预设与阅读'); if (!body) return;
    const grid = el('div', 'nav-grid');

    body.append(action('预览下一次请求的提示词', async () => {
        assertIdle(); const prepared = await preparePrompt();
        const target = showPanel('提示词预览', `${prepared.tokens} tokens · 裁剪 ${prepared.trimmed} 条历史`); if (!target) return;
        note(target, `激活世界书条目 ${prepared.activated.length} 条。上下文统计沿用酒馆 tokenizer；自定义模型应核对 tokenizer 与模型是否一致。`);
        const content = el('pre', 'prompt-preview', JSON.stringify(prepared.messages, null, 2)); target.append(content);
        preview = prepared;
    }, 'chat'));
    if (preview) note(body, `最近一次提示词：${preview.tokens} tokens，${preview.activated.length} 条世界书内容。`);
    if (state.dirty) body.append(action('重试保存当前聊天', saveChat, 'refresh', 'primary'));
    if (state.chat.at(-1)?.is_user) body.append(action('重试最后一条消息的回复', async () => { if (closePanel()) await generate('retry'); }, 'refresh'));
    const enter = field(body, '发送方式', state.own.enterSend === false ? 'button' : 'enter', { options: [['enter', '电脑 Enter 发送，Shift + Enter 换行'], ['button', '只使用发送按钮']] });
    const palette = field(body, '页面配色', state.own.palette || 'paper', { options: [['sage', '鼠尾草绿'], ['paper', '米白纸色']] });
    palette.addEventListener('change', () => { document.documentElement.dataset.palette = palette.value; });
    const rememberReading = value => { const settings = readingSettings(value, true); state.own.reading = settings; try { localStorage.setItem(`independent-reading:${state.settings.username || 'default'}`, JSON.stringify(settings)); } catch { /* Server save remains available. */ } applyReading(settings); };
    const reading = readingSettings(state.own.reading), typography = el('div', 'parameter-grid'); body.append(typography);
    const readingInputs = new Map();
    const values = () => Object.fromEntries([...readingInputs].map(([key, input]) => [key, input.value]));
    for (const [key, label, , min, max, step] of readingFields) {
        const input = field(typography, label, reading[key], { type: 'number' }); input.min = min; input.max = max; input.step = step; readingInputs.set(key, input);
        input.addEventListener('input', () => { if (input.value !== '' && input.validity.valid) rememberReading(values()); });
    }
    const sample = el('div', 'reading-sample'); sample.append(el('p', '', '风从窗边吹来，书页轻轻翻过。文字沿着页面两侧整齐排列，让每一次阅读都从容一些。'), el('p', '', '你可以调整字号、字间距、行间距和段间距，找到适合自己的阅读节奏。')); body.append(sample);
    const footer = el('div', 'editor-footer');
    footer.append(action('恢复默认排版', () => {
        for (const [key, , fallback] of readingFields) readingInputs.get(key).value = fallback;
        rememberReading(values()); panelDirty = true;
    }, 'refresh'), action('保存阅读设置', async () => {
        const reading = readingSettings(values(), true);
        await saveOwn({ enterSend: enter.value === 'enter', palette: palette.value, reading }); rememberReading(reading); document.documentElement.dataset.palette = palette.value; try{localStorage.setItem('independent-palette',palette.value);}catch{} document.querySelector('meta[name="theme-color"]')?.setAttribute('content',palette.value==='paper'?'#f3eee4':'#f7f8f4'); panelDirty = false; notify('阅读设置已保存');
    }, 'tools', 'primary')); body.append(footer);
    note(body, '手机输入框默认回车换行，用发送按钮发送。此页面独立运行，不加载原生前端或第三方扩展。');
    const native = el('a', 'native-link', '打开原生页面'); native.href = '/'; native.target = '_blank'; native.rel = 'noopener'; body.append(native);
}

function resizeInput() {
    const input = $('message-input'); input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, innerHeight * .28)}px`;
}
let activeTopPanel = null;
const topPanelButtons = new Map();
function setActiveTopPanel(callback) {
    activeTopPanel = callback;
    for (const [target, button] of topPanelButtons) button.setAttribute('aria-pressed', String(callback === target));
}
$('panel').addEventListener('close', () => { if (!$('panel').open) setActiveTopPanel(null); });
for (const [label, glyph, callback] of [['预设', 'tools', presetPanel], ['API', 'plug', connectionPanel], ['用户设定', 'user', personasPanel], ['世界书', 'book', worldsPanel], ['角色卡', 'card', characterPanel], ['正则与脚本', 'regex', regexPanel]]) {
    const button = action(label, () => {
        if ($('panel').open && activeTopPanel === callback) { closePanel(); return; }
        const revision = panelRevision;
        const result = callback();
        if (panelRevision !== revision) setActiveTopPanel(callback);
        return result;
    }, glyph, 'icon-button top-shortcut');
    button.title = label; button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', 'false'); topPanelButtons.set(callback, button); $('top-actions').append(button);
}
for (const [id, glyph] of [['quick-replies-toggle', 'message'], ['tools-toggle', 'plus'], ['close-panel', 'close'], ['send-button', 'send'], ['stop-button', 'stop']]) $(id).prepend(icon(glyph));
$('tools-toggle').title = '对话工具'; $('tools-toggle').setAttribute('aria-label', '对话工具');
$('tools-toggle').setAttribute('aria-expanded', 'false');
const composerTools = $('composer-tools');
const quickReplies = $('quick-replies'), quickRepliesToggle = $('quick-replies-toggle');
// Keep these menus above page scripts without raising the entire chat history.
document.body.append(composerTools, quickReplies);
function positionComposerMenu(menu, toggle) {
    const rect = toggle.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.bottom = `${Math.max(8, innerHeight - rect.top + 8)}px`;
    menu.style.maxHeight = `${Math.max(60, rect.top - 16)}px`;
}
const closeQuickReplies = () => { quickReplies.hidden = true; quickRepliesToggle.setAttribute('aria-expanded', 'false'); };
quickRepliesToggle.addEventListener('click', () => {
    composerTools.hidden = true; $('tools-toggle').setAttribute('aria-expanded', 'false');
    quickReplies.querySelector('.quick-replies-empty')?.remove();
    if (!scriptRuntime.buttons.size) quickReplies.append(el('p', 'note quick-replies-empty', scriptRuntime.identity ? '当前角色没有可用的快捷回复。' : '当前角色没有快捷回复，或脚本尚未加载。'));
    quickReplies.hidden = !quickReplies.hidden; quickRepliesToggle.setAttribute('aria-expanded', String(!quickReplies.hidden));
    if (!quickReplies.hidden) positionComposerMenu(quickReplies, document.getElementById('tools-toggle'));
});
document.addEventListener('click', event => { if (!quickReplies.contains(event.target) && !quickRepliesToggle.contains(event.target)) closeQuickReplies(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeQuickReplies(); });
for (const [label, glyph, callback] of [['变量管理器', 'tools', variableManagerPanel], ['加载日志', 'history', timingPanel], ['检查更新', 'refresh', () => manualUpdate({ api, notify, guard: () => { assertSaved(); if (panelDirty) throw new Error('请先保存或取消当前编辑。'); } })], ['关闭聊天', 'close', async () => { assertSaved(); state.character = null; state.chat = []; state.header = null; state.file = ''; welcome(); synchronize(); }], ['查找对话', 'search', searchPanel], ['历史聊天', 'history', chatsPanel], ['开启新聊天', 'plus', async () => { assertSaved(); if (!state.character) throw new Error('请先选择角色。'); await loadChat(null); }], ['数据预览', 'database', databasePreviewPanel], ['数据管理', 'tools', () => databasePanel()], ['更多工具', 'tools', toolsPanel]]) {
    composerTools.append(action(label, () => { composerTools.hidden = true; $('tools-toggle').setAttribute('aria-expanded', 'false'); return callback(); }, glyph));
}
$('tools-toggle').addEventListener('click', () => { closeQuickReplies(); composerTools.hidden = !composerTools.hidden; $('tools-toggle').setAttribute('aria-expanded', String(!composerTools.hidden)); if (!composerTools.hidden) positionComposerMenu(composerTools, $('tools-toggle')); });
const repositionComposerMenus = () => { if (!quickReplies.hidden) positionComposerMenu(quickReplies, document.getElementById('tools-toggle')); if (!composerTools.hidden) positionComposerMenu(composerTools, $('tools-toggle')); };
window.addEventListener('resize', repositionComposerMenus); window.visualViewport?.addEventListener('resize', repositionComposerMenus); window.visualViewport?.addEventListener('scroll', repositionComposerMenus);
document.addEventListener('click', event => { if (!composerTools.contains(event.target) && !$('tools-toggle').contains(event.target)) { composerTools.hidden = true; $('tools-toggle').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { composerTools.hidden = true; $('tools-toggle').setAttribute('aria-expanded', 'false'); } });
$('close-panel').addEventListener('click', closePanel);
$('panel').addEventListener('cancel', event => { event.preventDefault(); closePanel(); });
$('panel').addEventListener('click', event => { if (event.target === $('panel')) { const r = $('panel').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closePanel(); } });
window.addEventListener('popstate', () => { if ($('panel').open) { if (variablesSaving) { history.pushState({ appPanel: true }, ''); notify('正在保存变量，请稍候', 'info'); return; } if (panelDirty && !confirm('放弃未保存的编辑？')) { history.pushState({ appPanel: true }, ''); return; } disposePanelWork(); panelDirty = false; panelRevision++; setActiveTopPanel(null); $('panel').close(); } });
$('composer').addEventListener('submit', event => { event.preventDefault(); void run(() => generate(false)); });
composerTools.append(action('脚本面板', () => { composerTools.hidden = true; $('tools-toggle').setAttribute('aria-expanded', 'false'); return openScriptWorkspace(); }, 'tools'));
window.addEventListener('resize', raiseNotification);
window.visualViewport?.addEventListener('resize', raiseNotification);
window.visualViewport?.addEventListener('scroll', raiseNotification);
document.addEventListener('close', raiseNotification, true);
$('message-input').addEventListener('input', resizeInput);
$('message-input').addEventListener('focus', preloadNextGeneration);
$('message-input').addEventListener('input', preloadNextGeneration);
$('message-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && state.own.enterSend !== false && matchMedia('(hover:hover) and (pointer:fine)').matches) { event.preventDefault(); void run(() => generate(false)); }
});
$('stop-button').addEventListener('click', () => state.controller?.abort(new DOMException('user-stop', 'AbortError')));

window.addEventListener('beforeunload', event => { if (state.busy || state.dirty || inlineEdit || panelDirty || $('message-input').value.trim()) { event.preventDefault(); event.returnValue = ''; } });
function resizeViewport() {
    const viewport = window.visualViewport;
    document.documentElement.style.setProperty('--viewport-height', `${viewport?.height || innerHeight}px`);
    document.documentElement.style.setProperty('--viewport-top', `${viewport?.offsetTop || 0}px`);
}
window.visualViewport?.addEventListener('resize', resizeViewport);
window.visualViewport?.addEventListener('scroll', resizeViewport);
window.addEventListener('resize', resizeViewport); resizeViewport(); synchronize();
startupPromise = start();
void run(() => startupPromise);



