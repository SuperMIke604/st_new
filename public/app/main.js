import { categorySelect } from './category-select.js';
import { RecentCharacters } from './home-data.js';
import { chatGenerationResponse, findBackgroundGeneration, releaseBackgroundGeneration, usesBackgroundGeneration } from './background-generation.js';
import { chatLines, chatRevision } from './chat-delta.js';
import { renderChatHistoryManager, persistChatHistory } from './chat-history.js';
import { createToast } from './toast.js';
import { installMessageEdit, installMessageEditGuard } from './message-edit.js';
import { scriptTrees, scriptRows, scriptSupport, characterScriptPlan, nativeScriptPlan, usesMvuCompat, inlineScriptMessage, latestMvuData, scriptSnapshot as baseScriptSnapshot, validateScriptTree, saveCharacterScripts, savePresetScripts, patchGlobalScripts } from './scripts.js';
import { ScriptRuntime } from './script-runtime.js';
import { validateExtensionPrompt } from './script-prompts.js';
import { parseScriptCommands, patchScriptWorldFields } from './script-commands.js';
import { deploymentOpeningStat, openingVariableData, openingWorldCommands, sealedOpeningVariables } from './html-opening.js';
import { isReparseMvuData, previousMvuSource, reparseMvuBase } from './html-mvu-reparse.js';
import { helperMessageRevision, patchHelperVariables, patchHelperMessages } from './helper-state.js';
import { initialVariablesFromBook, messageMvuPatch, prepareValidatedMvuSnapshots } from './mvu-compat.js';
import { ScriptSchema } from './script-schema.js';
import { RoleAvatarStore } from './role-avatar-store.js';
import { renderVariableManager, validateVariables, defaultVariableMessage, chatVariableValue, patchChatVariables } from './variable-manager.js';
import { roleWorldEntries, toggleRoleWorldEntries, archiveRoleWorldEntries } from './role-worldbook.js';
import { MESSAGE_VARIABLES, messageVariableContext } from './variable-macros.js';
import { warmHistoryRegex, historyRegexCache } from './history-regex-cache.js';
import { CharacterCatalog } from './character-catalog.js';
import { loadTimings, timingStatusText, timingDetailText, requestFailure } from './load-timings.js';
import { exportDiagnostics, copyDiagnostics } from './diagnostic-export.js';
import { requestLog, showRequestLog } from './request-log.js';
import { BUILD } from './version.js';
import { PresetSelection } from './preset-selection.js';
import { PresetTokenClient } from './preset-token-client.js';
import { GenerationPreload, prepareDatabaseResources } from './generation-preload.js';
import { manualUpdate } from './update.js';
import { renderDatabasePreview } from './database-preview.js';
import { DatabaseWriteError, startDatabaseLog, finishDatabaseLog, retainMalformedDatabaseResponse } from './database-log.js';
import { TavernAPI, readEvents } from './api.js';
import { buildPrompt, fitPrompt, generationBody, activateWorlds, expand } from './engine.js';
import { VirtualChat } from './virtual-chat.js';
import { icon } from './icons.js';
import { installPromptDrag } from './prompt-drag.js';
import { autosizePrompt } from './prompt-autosize.js';
import { worldDraft, renderWorldEntries } from './world-editor.js';
import { renderGlobalWorldSelect } from './world-select.js';
import { decorateCodeBlocks, refreshHtmlVariables } from './code-blocks.js';
import { messageMarkdown, displayNameMacros } from './message-markdown.js';
import { embeddedWorld, hasEmbeddedWorld, importCharacterWorld, saveCharacterWorldBinding } from './character-world.js';
import { installWorldBindingGesture, showWorldBindingDialog } from './character-world-dialog.js';
import { readingFields, readingSettings, applyReading, sendDelaySeconds, maxSendDelay, sendTokenLimit } from './reading.js';
import { worldSettingsFields, validateWorldSettings } from './world-settings.js';
import { databaseSettings, databaseForChat, emptyDatabaseFromTemplate, findDatabaseSnapshot, storeDatabase, invalidateDatabases, databaseText, referenceDatabaseText, sheetText, fillMessages, parseUpdate, databaseUpdateNotice, sourceHash, validateDatabase, DatabaseFormatError, databaseSummaryTriggered, messageSummaryRange } from './database.js';
import { deleteDatabaseSummaryHistory } from './database-overview.js';
import { renderDatabasePanel } from './database-ui.js';
import { presetCatalog, presetDraft, promptRows, promptOrder, markerLabels, movePrompt, addPrompt, removePrompt, validatePreset, createPreset, uniquePresetName } from './preset-editor.js';
import { libraryState, addFolder, renameFolder, deleteFolder, moveCards, filterCards } from './library.js';
import { installSelects } from './select.js';
import { normalizeConnection, modelOptions, inheritedConnection, visibleConnectionPassword, connectionProfiles, upsertConnection } from './connection.js';
import { applyRegex, presetRegexes, compileRegex, activeRegexes, scopedRegexes, saveCharacterRegexes } from './regex.js';
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
function appendManagerTargetPicker(body, label, options, value) {
    const wrap = el('div', 'field');
    const select = el('select'); select.setAttribute('aria-label', label);
    for (const [id, name] of options) { const option = el('option', '', name); option.value = id; select.append(option); }
    select.value = value ?? '';
    wrap.append(select); body.append(wrap);
    return select;
}
function appendManagerCharacterPicker(body, cards, selected, scope) {
    const select = appendManagerTargetPicker(body, '管理的角色卡', cards.map(card => [card.avatar, card.name]), selected);
    select.addEventListener('change', () => run(async () => {
        if (panelDirty && !confirm('放弃未保存的修改？')) { select.value = selected; return; }
        panelDirty = false; await regexPanel(scope, select.value);
    }));
    return select;
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
let streamFrame = 0;
let inlineEdit = null;
let resolvingMessageEdit = false;
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
function iconAction(label, callback, glyph) {
    const button = action(label, callback, glyph, 'icon-button');
    button.title = label;
    button.setAttribute('aria-label', label);
    button.querySelector('span').remove();
    return button;
}
function discloseProfileTools(bar, tools, button, label, groupLabel) {
    const extra = el('div', 'profile-extra-tools');
    extra.id = `profile-tools-${uuid()}`;
    extra.setAttribute('role', 'group');
    extra.setAttribute('aria-label', groupLabel);
    extra.append(...tools.children);
    const more = button(label, () => setExpanded(extra.hidden), 'more');
    more.setAttribute('aria-controls', extra.id);
    const setExpanded = expanded => {
        extra.hidden = !expanded;
        more.setAttribute('aria-expanded', String(expanded));
    };
    setExpanded(false);
    extra.addEventListener('click', event => {
        if (!event.target.closest('button')) return;
        setExpanded(false);
        more.focus();
    });
    const closeOnEscape = event => {
        if (event.key !== 'Escape' || extra.hidden) return;
        event.stopPropagation(); event.preventDefault();
        setExpanded(false); more.focus();
    };
    extra.addEventListener('keydown', closeOnEscape);
    more.addEventListener('keydown', closeOnEscape);
    bar.after(extra);
}
function confirmAction({ title, message, confirmLabel = '确定', cancelLabel = '取消', returnFocus = document.activeElement, signal }) {
    if (signal?.aborted) return Promise.resolve(false);
    const dialog = el('dialog', 'compact-dialog');
    const heading = el('h2', '', title); heading.id = 'action-confirm-title';
    const description = el('p', '', message); description.id = 'action-confirm-description';
    dialog.setAttribute('aria-labelledby', heading.id);
    dialog.setAttribute('aria-describedby', description.id);
    const form = el('form'); form.method = 'dialog';
    const actions = el('div', 'compact-dialog-actions');
    const cancel = el('button', 'button', cancelLabel); cancel.value = 'cancel'; cancel.autofocus = true;
    const confirmButton = el('button', 'button primary', confirmLabel); confirmButton.value = 'confirm';
    actions.append(cancel, confirmButton); form.append(heading, description, actions); dialog.append(form);
    return new Promise(resolve => {
        const abort = () => dialog.close();
        signal?.addEventListener('abort', abort, { once: true });
        dialog.addEventListener('close', () => {
            signal?.removeEventListener('abort', abort);
            dialog.remove(); returnFocus?.focus({ preventScroll: true });
            resolve(dialog.returnValue === 'confirm');
        }, { once: true });
        document.body.append(dialog); dialog.showModal();
    });
}
function editName({ title, label, value = '', message, maxLength, returnFocus, save }) {
    const panel = $('panel');
    const revision = panelRevision;
    const dialog = el('dialog', 'compact-dialog name-dialog');
    const heading = el('h2', '', title); heading.id = 'name-dialog-title';
    dialog.setAttribute('aria-labelledby', heading.id);
    const form = el('form');
    const field = el('div', 'field');
    const input = el('input'); input.type = 'text'; input.value = value; input.autofocus = true;
    if (maxLength) input.maxLength = maxLength;
    input.setAttribute('aria-label', label);
    const error = el('p', 'note warning'); error.id = 'name-dialog-error'; error.hidden = true;
    error.setAttribute('role', 'alert'); input.setAttribute('aria-describedby', error.id);
    field.append(input);
    const actions = el('div', 'compact-dialog-actions');
    const cancel = action('取消', () => dialog.close());
    const submit = el('button', 'button primary', '确定'); submit.type = 'submit';
    actions.append(cancel, submit);
    form.append(heading);
    if (message) {
        const description = el('p', '', message); description.id = 'name-dialog-description';
        dialog.setAttribute('aria-describedby', description.id);
        form.append(description);
    }
    form.append(field, error, actions); dialog.append(form);
    const showError = message => {
        error.textContent = message; error.hidden = false;
        input.setAttribute('aria-invalid', 'true'); input.focus();
    };
    input.addEventListener('input', () => { error.hidden = true; input.removeAttribute('aria-invalid'); });
    let saving = false;
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (saving) return;
        const next = input.value.trim();
        if (!next) { showError(`请输入${label}`); return; }
        saving = input.disabled = submit.disabled = cancel.disabled = true;
        try { await save(next); dialog.close(); }
        catch (failure) {
            saving = input.disabled = submit.disabled = cancel.disabled = false;
            showError(failure.message);
        }
    });
    dialog.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        if (!saving) dialog.close();
    });
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.addEventListener('close', () => {
        dialog.remove();
        if (panel.open && revision === panelRevision) returnFocus?.focus({ preventScroll: true });
    });
    panel.append(dialog); dialog.showModal(); input.select();
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
        if (notification.hidePopover && notification.matches(':popover-open')) notification.hidePopover();
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
function assertIdle({ allowGeneration = false } = {}) { if (state.historySaving || state.databaseHistorySaving) throw new Error('正在保存聊天记录，请稍候。'); if (variablesSaving) throw new Error('正在保存变量，请稍候。'); if (scriptRuntime.processing) throw new Error('角色脚本正在处理消息，请稍候。'); if (state.loading) throw new Error('正在切换聊天，请稍候。'); if (state.busy && !allowGeneration) throw new Error('请先停止或等待生成完成。'); }
function cancelMessageEdit() {
    if (!inlineEdit) return;
    const index = state.chat.indexOf(inlineEdit.message);
    inlineEdit = null;
    if (index >= 0) list.update(index);
}
async function saveMessageEdit(message) {
    assertIdle();
    if (state.dirty) throw new Error('请先重试保存当前聊天。');
    const index = state.chat.indexOf(message);
    if (index < 0 || inlineEdit?.message !== message) throw new Error('消息已变化，请重新打开编辑。');
    message.mes = regexText(inlineEdit.text, message.is_user ? 1 : 2, { edit: true, depth: state.chat.length - index - 1 });
    invalidateDatabases(state.chat, index);
    if (Array.isArray(message.swipes)) message.swipes[message.swipe_id || 0] = message.mes;
    cancelMessageEdit();
    await saveChat();
}

async function resolveMessageEdit() {
    if (resolvingMessageEdit) return false;
    const edit = inlineEdit;
    if (!edit) return true;
    if (edit.text === edit.originalText) {
        cancelMessageEdit();
        return true;
    }

    resolvingMessageEdit = true;
    try {
        const dialog = $('message-edit-confirmation');
        dialog.returnValue = '';
        const closed = new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
        dialog.showModal();
        await closed;
        if (inlineEdit !== edit) return false;
        if (dialog.returnValue === 'save') {
            await saveMessageEdit(edit.message);
        } else if (dialog.returnValue === 'discard') {
            cancelMessageEdit();
        } else {
            document.querySelector('.inline-editor textarea')?.focus({ preventScroll: true });
            return false;
        }
        return true;
    } finally {
        resolvingMessageEdit = false;
    }
}

function afterMessageEdit(callback) {
    return run(async () => { if (await resolveMessageEdit()) return callback(); });
}

installMessageEditGuard(document, () => !!inlineEdit || resolvingMessageEdit, afterMessageEdit);

function assertMessageEditClosed(ErrorType = Error) {
    if (inlineEdit || resolvingMessageEdit) throw new ErrorType('请先处理聊天记录中尚未保存的修改。');
}
function assertViewable() { if (state.loading) throw new Error('正在切换聊天，请稍候。'); assertMessageEditClosed(); if (state.dirty && !state.busy) throw new Error('请先保存聊天。'); }
function assertSaved(options) { assertIdle(options); assertMessageEditClosed(); if (state.dirty) throw new Error('当前聊天尚未保存，请先在工具中重试保存。'); }
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
    const chatPosition = Object.keys(patch).every(key => ['lastCharacter', 'lastChats'].includes(key));
    state.settings = await api.patchSettings(settings => { Object.assign(settingsOwn(settings), patch); settings.extension_settings.independent_frontend = settings.independent_frontend; }, {
        source: chatPosition ? '保存聊天位置设置' : '保存前端偏好设置',
        sharedSetting: Object.hasOwn(patch, 'reading') ? 'reading' : undefined,
    });
    state.own = settingsOwn(state.settings);
    if (presetSelection.name !== null) state.own.preset = presetSelection.name;
    api.readCache.clear();
    const persisted = settingsOwn((await api.settings({ lightweight: true, source: chatPosition ? '核验聊天位置设置' : '核验前端偏好设置' })).settings);
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
    const next = copy(selected?.data || {});
    if (JSON.stringify(scriptTrees({}, null, state.preset).preset) !== JSON.stringify(scriptTrees({}, null, next).preset)) {
        scriptRuntime.dispose(); scriptSchema.dispose(); scriptAutoIdentity = '';
    }
    state.preset = next;
    state.presetMissing = !selected;
    if (presetSelection.name !== null) state.own.preset = presetSelection.name;
}
function setReplyWaiting(label = '') {
    const button = $('stop-button');
    const waiting = Boolean(label);
    button.classList.toggle('is-waiting', waiting);
    button.classList.toggle('send-button', waiting);
    button.classList.toggle('icon-button', !waiting);
    button.setAttribute('aria-label', label ? label + '，停止生成' : '停止生成');
    button.title = label ? label + '，点击停止' : '停止生成';
}

function visibleChatMessages(messages) {
    if (state.generation?.queuedUser) return [...messages, state.generation.queuedUser];
    return state.hiddenReply && messages.at(-1) === state.hiddenReply ? messages.slice(0, -1) : messages;
}

function synchronizeScriptRuntime() {
    if (scriptRuntime.identity && scriptRuntime.identity !== scriptIdentity()) { scriptRuntime.dispose(); scriptSchema.dispose(); }
    if (scriptSchema.identity && scriptSchema.identity !== scriptIdentity()) scriptSchema.dispose();
    // Resource saves also synchronize the UI. Keep the working script snapshot intact during a callback.
    if (scriptRuntime.frame && !scriptRuntime.processing && !scriptRuntime.auxiliaryControllers.size) {
        scriptRuntime.refresh(scriptSnapshot(state), scriptIdentity());
    }
}

function synchronize({ deferScriptRefresh = false } = {}) {
    if (!deferScriptRefresh) synchronizeScriptRuntime();
    if (!state.character) scriptAutoIdentity = '';
    if (state.ready && state.character && !state.loading && !state.busy && !state.historySaving && !state.dirty && !inlineEdit && !hasChatPanelDraft() && scriptAutoIdentity !== scriptIdentity()) {
        scriptAutoIdentity = scriptIdentity();
        if (nativeScriptPlan(state.settings, state.character, state.preset).some(script => script.enabled !== false && scriptSupport(script).supported)) {
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
    const names = JSON.stringify([persona().name, state.character?.name || 'Assistant']);
    if (list.displayNames !== names) { list.displayNames = names; list.setMessages(state.chat); }
    else list.update(state.chat.length - 1);
}

function markdown(text) {
    const converter = markdown.converter ||= new globalThis.showdown.Converter({ tables: true, strikethrough: true, simpleLineBreaks: true, literalMidWordUnderscores: true, simplifiedAutoLink: true, openLinksInNewWindow: true, backslashEscapesHTMLTags: true });
    const source = String(text || '');
    return globalThis.DOMPurify.sanitize(messageMarkdown(source, converter), { FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'video', 'audio', 'svg'], FORBID_ATTR: ['style', 'srcset'] });
}
function messageNumber(message, index, tokens = '-') {
    let text = `#${index} · ${tokens}`;
    const timing = message.swipe_info?.[message.swipe_id || 0] ?? message;
    if (!message.is_user && timing.gen_started && timing.gen_finished) {
        const duration = new Date(timing.gen_finished).getTime() - new Date(timing.gen_started).getTime();
        if (Number.isFinite(duration) && duration >= 0) text += ` · ${Math.round(duration / 1000)}s`;
    }
    return text;
}
function messageAtNode(node) {
    const current = state.chat[Number(node.dataset.index)];
    if (node.isConnected && node._message === current) return current;
}

function renderMessage(message, index, existing) {
    const node = existing || el('article', 'message');
    const names = { user: persona().name, char: state.character?.name || 'Assistant' };
    const queuedUser = state.generation?.queuedUser || state.generation?.pendingDisplayUser;
    const historyLength = queuedUser && list.messages.at(-1) === queuedUser ? list.messages.length - 1 : null;
    const depth = (historyLength !== null && message !== queuedUser ? historyLength : list.messages.length) - index - 1;
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
            node.addEventListener('touchend', event => { if (!touch) return; const t=event.changedTouches[0], dx=t.clientX-touch.x, dy=t.clientY-touch.y; touch=null; if (Math.abs(dx)<65 || Math.abs(dx)<Math.abs(dy)*1.5 || index!==state.chat.length-1 || state.busy || event.target.closest('.inline-editor')) return; void afterMessageEdit(async () => { assertIdle(); if(state.dirty) await saveChat(); assertSaved(); const message=state.chat[index]; const current=Number(message.swipe_id)||0; const next=current+(dx<0?1:-1); if (next<0) return; if (next>=(message.swipes?.length||1)) { if(dx<0 && index !== 0) await generate(true); return; } message.swipe_id=next; message.mes=message.swipes[next]; if(message.swipe_info?.[next]) Object.assign(message,copy(message.swipe_info[next])); invalidateDatabases(state.chat,index); list.update(index); await saveChat(); }); }, {passive:true});
        }
        const jumpTop=node.querySelector('.message-jumps-top'); if(jumpTop) header.append(jumpTop);
        node.prepend(header);
        const content=el('div','message-content'); const bottom=node.querySelector('.message-jumps-bottom'); if(bottom) bottom.before(content); else node.append(content);
        const edges = el('div', 'message-scroll-edges');
        edges.setAttribute('aria-hidden', 'true');
        node.append(edges);
    }
    const visibility = node.querySelector(':scope > .message-visibility');
    if (message.is_system && !visibility) {
        node.querySelector('.message-header').after(el('small', 'message-visibility', '对 AI 隐藏'));
    } else if (!message.is_system) {
        visibility?.remove();
    }
    let switches = node.querySelector('.message-swipe-buttons');
    if (!message.is_user && index === (historyLength ?? state.chat.length) - 1) {
        if (!switches) { switches = el('div','message-swipe-buttons');
            for (const [delta,label,glyph] of [[-1,'上一条回复','left'],[1,'下一条回复或重新生成','right']]) switches.append(action(label, async () => { assertIdle(); if(state.dirty) await saveChat(); assertSaved(); const current=state.chat[index]; const next=(Number(current.swipe_id)||0)+delta; if(next<0)return; if(next>=(current.swipes?.length||1)) {if(index !== 0) await generate(true);return;} current.swipe_id=next;current.mes=current.swipes[next];if(current.swipe_info?.[next])Object.assign(current,copy(current.swipe_info[next]));invalidateDatabases(state.chat,index);list.update(index);await saveChat(); }, glyph)); const bottom=node.querySelector('.message-jumps-bottom'); bottom.append(switches); }
        for (const [i, label] of (index === 0 ? ['上一条开场白', '下一条开场白'] : ['上一条回复', '下一条回复或重新生成']).entries()) { switches.children[i].setAttribute('aria-label', label); switches.children[i].title = label; }
        switches.children[0].disabled = state.busy || state.loading || !(Number(message.swipe_id)>0); switches.children[1].disabled=state.busy || state.loading || (index === 0 && (Number(message.swipe_id)||0) >= (message.swipes?.length||1)-1);
        let count = switches.querySelector('.message-swipe-count');
        if (!count) { count = el('span', 'message-swipe-count'); count.setAttribute('aria-live', 'polite'); switches.append(count); }
        count.style.cssText = 'position:absolute;left:48px;align-self:center;font-size:12px;pointer-events:none';
        count.textContent = `${(Number(message.swipe_id)||0)+1} / ${message.swipes?.length||1}`;
    } else switches?.remove();
    node.querySelector('.message-jumps-bottom')?.classList.toggle('has-swipes', !!node.querySelector('.message-swipe-buttons'));
    let reasoning = node.querySelector('.message-reasoning');
    if (message.extra?.reasoning) {
        if (!reasoning) {
            reasoning = el('details', 'message-reasoning'); reasoning.append(el('summary', '', '思考过程'), el('pre'));
            node.querySelector('.message-content').before(reasoning);
        }
        const reasoningDepth = historyLength === null ? state.chat.length - index - 1 : depth;
        const renderedReasoning = displayNameMacros(regexText(message.extra.reasoning, 6, { phase: 'display', depth: reasoningDepth }), names);
        const reasoningText = reasoning.querySelector('pre');
        if (reasoningText.textContent !== renderedReasoning) reasoningText.textContent = renderedReasoning;
    } else reasoning?.remove();
    node.querySelector('.message-name').textContent = message.name || (message.is_user ? persona().name : state.character?.name || 'Assistant');
    const floor = node.querySelector('.message-number');
    if (!state.busy && node._countedText !== message.mes) {
        node._countedText = message.mes; node._tokenCount = '-'; const source = message.mes;
        if (source?.trim()) void api.post(`/api/tokenizers/openai/count?model=${encodeURIComponent(connection().model)}`, [{role:message.is_user?'user':'assistant',content:source}]).then(result => { if(node._countedText===source) { node._tokenCount = result.token_count ?? '-'; floor.textContent = messageNumber(node._message, index, node._tokenCount); } }).catch(()=>{});
    }
    floor.textContent = messageNumber(message, index, node._countedText === message.mes ? node._tokenCount : '-');
    for (const jumps of node.querySelectorAll('.message-jumps')) jumps.hidden = inlineEdit?.message === message;
    if (inlineEdit?.message === message) {
        if (!node.querySelector('.inline-editor')) {
            const editor = el('div', 'inline-editor');
            const text = el('textarea'); text.value = inlineEdit.text; text.rows = 8; text.setAttribute('aria-label', `修改第 ${index} 楼消息`);
            text.addEventListener('input', () => { inlineEdit.text = text.value; });
            const buttons = el('div', 'inline-edit-buttons');
            buttons.append(action('保存', () => saveMessageEdit(message), undefined, 'primary'), action('取消', cancelMessageEdit), action('删除', () => deleteEditedMessage(message), undefined, 'danger'));
            editor.append(text, buttons); node.append(editor);
        }
        node.querySelector('.message-content').hidden = true;
        return node;
    }
    node.querySelector('.inline-editor')?.remove(); node.querySelector('.message-content').hidden = false;
    const companionMessage = inlineScriptMessage(state.settings, state.character, state.preset, list.messages);
    if (!inlineEdit && index === companionMessage) {
        const body = node.querySelector('.message-content');
        let anchor = body.querySelector('.script-chat-anchor');
        if (!anchor) {
            anchor = el('section', 'script-chat-anchor'); anchor.dataset.messageId = String(index);
            anchor.setAttribute('aria-label', '酒馆伴侣交互卡片'); anchor.textContent = '正在连接酒馆伴侣…';
            body.replaceChildren(anchor); node._text = null;
        }
        queueMicrotask(() => { if (anchor.isConnected) scriptRuntime.bindChat(anchor, index); });
        return node;
    }
    const contentChanged = node._text !== message.mes || node._preset !== state.preset || node._userName !== names.user || node._charName !== names.char;
    const displayText = contentChanged || node._depth !== depth
        ? displayNameMacros(regexText(message.mes, message.is_user ? 1 : 2, { phase: 'display', depth }), names)
        : node._displayText;
    // Keep mounted HTML when a depth change produces the same display text.
    if (contentChanged || node._displayText !== displayText) {
        const body = node.querySelector('.message-content');
        body.innerHTML = markdown(displayText);
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, { acceptNode: text => text.parentElement.closest('pre,code,script,style,iframe,.dialogue-quote') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
        const texts = []; while (walker.nextNode()) texts.push(walker.currentNode);
        for (const text of texts) {
            const pattern = /“[^”\n]+”|「[^」\n]+」|『[^』\n]+』|"[^"\n]+"/g;
            const value = text.nodeValue; let match, start = 0; const fragment = document.createDocumentFragment();
            while ((match = pattern.exec(value))) { fragment.append(document.createTextNode(value.slice(start, match.index))); const span = el('span', 'dialogue-quote', match[0]); fragment.append(span); start = pattern.lastIndex; }
            if (start) { fragment.append(document.createTextNode(value.slice(start))); text.replaceWith(fragment); }
        }
        const previewAvatar = state.character?.avatar, previewIdentity = scriptIdentity(), previewRevision = helperMessageRevision(message); let previewAvatars;
        const previewCheck = () => {
            if (scriptIdentity() !== previewIdentity || state.chat[index] !== message || helperMessageRevision(message) !== previewRevision) throw Error('消息界面已失效，请使用当前页面。');
        };
        decorateCodeBlocks(body, { icon, notify, messageId: index, message: message.mes, name: message.name, role: message.is_user ? 'user' : 'assistant', personaName: persona().name,
            variables: message.variables?.[message.swipe_id || 0] || {},
            swipes: index === 0 && message.mes === (state.character?.data || state.character)?.first_mes && !message.swipes?.length ? [(state.character?.data || state.character).first_mes, ...((state.character?.data || state.character).alternate_greetings || [])] : message.swipes,
            scriptAction: async (operation, payload) => {
                previewCheck();
                if (operation === 'send-opening' || operation === 'send-card-message') {
                    assertSaved();
                    if (message.is_user || (operation === 'send-opening' && index !== 0) || (index === 0 && state.chat.length !== 1)) throw Error('仅可在只有开场白的聊天中发送开局。');
                    const text = payload?.text;
                    if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw Error('卡片指令为空或过大。');
                    if (usesBackgroundGeneration() && pendingBackgroundJob()) throw Error('请先恢复当前聊天的后台回复。');
                    const input = $('message-input');
                    if (input.value.trim()) throw Error('请先发送或清空输入框中的内容。');
                    input.value = text;
                    resizeInput();
                    if (operation === 'send-card-message') return new Promise((resolve, reject) => {
                        let queued = false;
                        const fail = error => {
                            if (queued) { notify(error.message, true); return; }
                            if (input.value === text) { input.value = ''; resizeInput(); }
                            reject(error);
                        };
                        void generate(false, null, { delaySend: true, onQueued: () => { queued = true; resolve(true); } })
                            .then(() => { if (!queued) fail(Error('卡片指令未进入发送队列。')); }, fail);
                    });
                    const result = await generate(false, null, { delaySend: true });
                    if (!result?.completed) throw Error('开局发送未完成，请在聊天中检查待发送内容或重试回复。');
                    return true;
                }
                if ((operation.startsWith('opening-') || operation === 'write-opening-stat') && index === 0 && !message.is_user) return htmlOpeningAction(operation, payload, message, previewIdentity, previewCheck);
                if (operation.startsWith('mvu-') && index > 0 && !message.is_user) return htmlMvuAction(operation, payload, index, message, previewIdentity, previewCheck);
                if (operation === 'slash') return (await roleScriptAction('slash', payload, previewIdentity, previewCheck))?.value;
                if (operation !== 'set-messages' || !Array.isArray(payload?.messages) || payload.messages.length !== 1 || payload.messages[0].message_id !== index) throw Error('消息界面只能修改所属楼层。');
                const patches = payload.messages.map(patch => ({ ...patch, revision: previewRevision, base: copy(message.variables || {}) }));
                return (await helperHostAction('set-messages', { messages: patches }, previewIdentity, previewCheck))?.value;
            },
            getAvatars: previewAvatar ? () => previewAvatars ||= roleAvatars.run(previewAvatar, { operation: 'list' }) : undefined,
            edit: () => { const current = messageAtNode(node); if (current) return beginMessageEdit(current); }, send: text => run(async () => { assertSaved(); if ($('message-input').value.trim()) throw new Error('请先发送或清空输入框中的内容。'); $('message-input').value = text; resizeInput(); await generate(false); }) });
        for (const image of body.querySelectorAll('img')) { image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; }
        for (const link of body.querySelectorAll('a')) link.rel = 'noopener noreferrer';
        node._text = message.mes;
        node._preset = state.preset; node._displayText = displayText;
        node._userName = names.user; node._charName = names.char;
    }
    node._depth = depth;
    refreshHtmlVariables(node, message.variables?.[message.swipe_id || 0]);
    return node;
}
const list = new VirtualChat($('message-list'), renderMessage, range => {
    const viewportLast = list.locate(list.element.scrollTop + list.element.clientHeight);
    $('back-latest').hidden = !state.character || range.total <= 2 || viewportLast >= range.total - 2;
}, visibleChatMessages);
installMessageEdit(list.element, messageAtNode, beginMessageEdit);
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
            if (state.loginRequired) {
                const login = el('a', 'button primary', '登录酒馆'); login.href = './login.html'; recent.append(login);
            } else recent.append(action('重新加载', () => { startupPromise = start(); return startupPromise; }, 'refresh'));
        }
        $('message-list').append(welcome); return;
    }
    const loading = el('div', 'home-loading', '正在加载最近角色…'); loading.setAttribute('role', 'status'); recent.append(loading);
    const actions = el('div', 'welcome-actions');
    actions.append(action('选择角色', () => navigation(), 'card', 'primary'));
    if (state.bundle.account) actions.append(tavernSwitchButton());
    welcome.append(actions);
    $('composer').hidden = true;
    document.body.classList.add('home-view');
    const recentRequest = state.homeReady ? (homeRecentRequest || loadRecentCharacters()) : null;
    if (state.homeReady) homeRecentRequest = null;
    const search = el('input', 'home-character-search'); search.type = 'search'; search.placeholder = '搜索角色卡…'; search.setAttribute('aria-label', '搜索角色卡');
    let recentChats = [];
    let searchRevision = 0;
    search.addEventListener('input', () => {
        const revision = ++searchRevision;
        drawRecent(recentChats);
        if (!search.value.trim()) return;
        void loadCharacterCatalog().then(() => {
            if (revision === searchRevision) drawRecent(recentChats);
        }).catch(error => { if (revision === searchRevision && recent.isConnected) notify(error.message, true); });
    });
    const drawRecent = chats => {
        if (!recent.isConnected || !Array.isArray(chats)) return;
        recentChats = chats;
        if (!recent.contains(search)) recent.replaceChildren(search);
        for (const child of [...recent.children]) if (child !== search) child.remove();
        const query = search.value.trim().toLocaleLowerCase();
        if (!query && !chats.some(chat => chat.avatar)) recent.append(el('p', 'note', '暂无最近使用的角色，可在下方选择角色。'));
        const grid = el('div', query ? 'home-character-grid' : 'home-character-grid home-recent-grid'); recent.append(grid);
        const seen = new Set();
        for (const chat of query ? state.characters.filter(card => card.name?.toLocaleLowerCase().includes(query)) : chats) {
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
            const fallback = el('span', 'home-recent-avatar');
            fallback.setAttribute('aria-hidden', 'true'); fallback.append(icon('user')); cover.append(fallback);
            const summary = el('span', 'home-recent-summary');
            summary.append(el('strong', '', name), el('span', 'note', '继续聊天')); cover.append(summary);
            const info = el('div', 'card-info'); info.append(el('h3', '', name));
            card.append(cover, info); grid.append(card);
            if (!query && seen.size === 6) break;
        }
        if (query && !seen.size) grid.append(el('p', 'note', '没有找到匹配的角色卡。'));
    };
    const cacheKey = homeRecentCacheKey();
    let cached = null; try { if (cacheKey) cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null'); } catch {}
    welcome.addEventListener('character-name-updated', () => drawRecent(recentChats));
    if (Array.isArray(cached)) drawRecent(cached);
    if (recentRequest) void recentRequest.then(chats => {
        try { if (cacheKey) sessionStorage.setItem(cacheKey, JSON.stringify(chats.slice(0, 100).map(chat => ({ avatar: chat.avatar, file_name: chat.file_name, characterName: state.characters.find(item => item.avatar === chat.avatar)?.name || chat.characterName })))); } catch {}
        drawRecent(chats);
    }).catch(error => { if (!cached) recent.replaceChildren(el('p', 'note', '最近角色加载失败，请稍后重试')); console.debug(error.message); });
    $('message-list').append(welcome);
}
function tavernSwitchButton() {
    const button = action('切换密码', switchTavernAccount, 'requestFlow', 'icon-button');
    button.title = '切换密码';
    button.setAttribute('aria-label', button.title);
    button.querySelector('span')?.remove();
    return button;
}
function homeRecentCacheKey() {
    if (state.bundle.displayTavern === 'display') return null;
    return `home-recent:${state.bundle.account || 'local'}:${state.settings.username || 'default'}`;
}
async function switchTavernAccount() {
    assertSaved();
    if (panelDirty) throw new Error('请先保存或取消当前编辑。');
    try { sessionStorage.setItem('st-new-login-handle', state.bundle.account); } catch { /* Login still works. */ }
    location.replace('./login.html?switch=1');
}
function readingStorageKey() {
    return state.bundle.account ? `independent-reading:account:${state.bundle.account}` : `independent-reading:${state.settings.username || 'default'}`;
}
function clearWelcome() { $('message-list').querySelector('.welcome')?.remove(); }
async function reloadResources() {
    const loaded = await api.bootstrapSettings(); state.settings = loaded.settings; state.bundle = loaded.bundle;
    const legacySelection = { independent_frontend: { preset: state.settings.independent_frontend?.preset }, extension_settings: { independent_frontend: { preset: state.settings.extension_settings?.independent_frontend?.preset } } };
    state.own = settingsOwn(state.settings);
    if (presetSelection.name !== null) state.own.preset = presetSelection.name;
    frontendThemes.apply(state.own.palette, true);
    if (!state.own.reading) {
        try {
            const saved = JSON.parse(localStorage.getItem(readingStorageKey()) || 'null');
            if (saved) state.own.reading = readingSettings(saved);
        } catch { /* Use defaults when saved preferences are unavailable. */ }
    }
    applyReading(state.own.reading);
    if ($('message-input').value) resizeInput();
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
    state.loginRequired = false;
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
        outcome = 'error'; state.startupError = error.message;
        state.loginRequired = error.status === 401 || error.status === 403;
        if (state.loginRequired) {
            location.replace('./login.html');
            return;
        }
        throw error;
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
    $('panel').querySelector(':scope > .name-dialog[open]')?.close();
    $('panel').querySelector(':scope > .world-binding-dialog[open]')?.close();
    $('panel-body').querySelector(':scope > .panel-content')?._dispose?.();
}
function panelNavigationBlocked() {
    if (state.historySaving || state.databaseHistorySaving) { notify('正在保存聊天记录，请稍候', 'info'); return true; }
    if (variablesSaving) { notify('正在保存变量，请稍候', 'info'); return true; }
    return false;
}
let confirmingPanelDiscard = false;
async function confirmPanelDiscard(message = '放弃未保存的编辑？') {
    if (confirmingPanelDiscard) return false;
    const revision = panelRevision;
    confirmingPanelDiscard = true;
    try {
        const accepted = await confirmAction({ title: '放弃未保存的编辑', message, confirmLabel: '放弃编辑' });
        return accepted && revision === panelRevision;
    } finally {
        confirmingPanelDiscard = false;
    }
}
async function showPanel(title, kicker = '工作空间', className = '', topPanel) {
    assertMessageEditClosed();
    if (panelNavigationBlocked()) return null;
    if ($('panel').open && panelDirty && (!await confirmPanelDiscard() || panelNavigationBlocked())) return null;
    disposePanelWork();
    panelDirty = false; panelRevision++;
    $('panel-title').textContent = title; $('panel-kicker').textContent = kicker; $('panel-kicker').hidden = !kicker;
    $('panel').className = className; $('panel-body').replaceChildren(); $('panel-body').removeAttribute('aria-busy');
    if (!$('panel').open) { (matchMedia('(max-width:700px)').matches ? $('panel').show() : $('panel').showModal()); history.pushState({ appPanel: true }, ''); }
    if (topPanel) setActiveTopPanel(topPanel);
    raiseNotification();
    return $('panel-body');
}
async function closePanel({ fromHistory = false } = {}) {
    if (panelNavigationBlocked()) return false;
    if (panelDirty && (!await confirmPanelDiscard() || panelNavigationBlocked())) return false;
    disposePanelWork();
    panelDirty = false; panelRevision++;
    setActiveTopPanel(null);
    $('panel').close();
    if (!fromHistory && history.state?.appPanel) history.back();
    return true;
}
function timingPanel() {
    // Diagnostics have their own dialog and never enter the editable panel or
    // chat lifecycle (dirty flags, save queues, generation controller/history).
    const existing = document.getElementById('timing-dialog');
    if (existing) { existing.querySelector('button')?.focus(); return; }
    const dialog = el('dialog', 'timing-panel'); dialog.id = 'timing-dialog'; dialog.setAttribute('aria-labelledby', 'timing-title');
    const heading = el('div'), title = el('h1', '', '加载日志'); title.id = 'timing-title';
    heading.append(title);
    const header = el('header', 'panel-header'), close = iconAction('关闭日志', () => dialog.close(), 'close');
    close.autofocus = true;
    header.append(heading, close);
    const body = el('div', 'timing-body'); dialog.append(header, body);
    dialog.addEventListener('close', () => {
        dialog.remove();
        document.getElementById('tools-toggle')?.focus();
    });
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
            const time = new Date(entry.startedAt);
            const detail = el('td', 'timing-detail');
            const summaryText = timingDetailText(entry);
            if (summaryText) detail.append(el('span', 'timing-detail-summary', summaryText));
            const expanded = el('details', 'timing-detail-disclosure');
            expanded.append(el('summary', '', '详情'), el('time', '', time.toLocaleString()));
            if (summaryText && entry.status !== 'error') expanded.append(el('p', '', summaryText));
            detail.append(expanded);
            row.append(el('td', '', entry.label), el('td', '', time.toLocaleTimeString()), el('td', '', `${entry.durationMs.toFixed(1)} ms`), el('td', 'timing-status', timingStatusText(entry)), detail);
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
function apiKeyField(parent, value) {
    // Give the secret its own form so other fields are not grouped with it for autofill.
    const form = el('form');
    form.autocomplete = 'off';
    form.addEventListener('submit', event => event.preventDefault());
    parent.append(form);
    const input = field(form, 'API Key', value, { type: 'password' });
    const wrapper = el('div', 'field');
    const label = el('label', '', 'API Key');
    input.id = 'connection-api-key'; label.htmlFor = input.id;
    input.parentElement.replaceWith(wrapper); wrapper.append(label, input);
    input.name = 'api-secret';
    input.autocomplete = 'new-password';
    return input;
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
    const finishSwitch = loadTimings.start('切换角色聊天', 'data');
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
    } finally { state.loading = false; synchronize(); finishSwitch(loaded ? 'success' : 'error'); if (loaded) preloadNextGeneration(); }
}
async function loadChat(file, internal = false, character = state.character) {
    if (!internal) assertSaved();
    const finishSwitch = !internal ? loadTimings.start(file ? '切换历史聊天' : '新建聊天', 'data') : null;
    if (!internal) generationPreload.cancelScheduled();
    let loaded = false;
    if (!internal) { state.loading = true; synchronize(); }
    try {
    status('读取聊天记录…');
    const data = file ? await api.post('/api/chats/get', { avatar_url: character.avatar, file_name: file }) : [];
    if (!Array.isArray(data)) throw new Error('聊天响应格式异常，已保留当前聊天。');
    api.rememberChatBase?.(character.avatar, file, data);
    const hasHeader = data[0] && !Object.hasOwn(data[0], 'mes');
    const header = hasHeader ? copy(data[0]) : { user_name: persona().name, character_name: character.name, create_date: new Date().toISOString(), chat_metadata: { integrity: uuid() } };
    header.chat_metadata ||= {};
    const chat = hasHeader ? data.slice(1) : data.slice();
    const nextFile = file || safeName(`${character.name} - ${new Date().toISOString().replace(/[:.]/g, '-')}-${uuid().slice(0, 6)}`);
    const greeting = character.data?.first_mes ?? character.first_mes;
    if (!chat.length) {
        const card = character.data || character;
        const alternatives = Array.isArray(card.alternate_greetings) ? card.alternate_greetings.filter(value => typeof value === 'string') : [];
        const greetings = [greeting || '', ...alternatives];
        if (!greetings[0]) greetings.shift();
        if (greetings.length) {
            const message = { name: character.name, is_user: false, is_system: false, send_date: new Date().toISOString(), mes: greetings[0], extra: {} };
            if (alternatives.length) Object.assign(message, { swipe_id: 0, swipes: greetings, swipe_info: greetings.map(() => ({ send_date: message.send_date, extra: {} })) });
            chat.push(message);
        }
    }
    // Older independent chats stored only the default greeting. Preserve edited greetings and existing branches.
    if (chat.length === 1 && !chat[0].is_user && !chat[0].swipes?.length && chat[0].mes === greeting) {
        const alternatives = (character.data || character).alternate_greetings;
        if (Array.isArray(alternatives) && alternatives.length) {
            chat[0].swipe_id = 0;
            chat[0].swipes = [greeting, ...alternatives.filter(value => typeof value === 'string')];
            chat[0].swipe_info = chat[0].swipes.map(() => ({ send_date: chat[0].send_date, extra: copy(chat[0].extra || {}) }));
        }
    }
    const databaseMetadata = header.chat_metadata.independentDatabase ||= {};
    databaseMetadata.autoStart ??= chat.length;
    // No await between these assignments: character, identity and contents switch together.
    const preserveDraft = state.chatConflict && state.character?.avatar === character.avatar && state.file === nextFile;
    Object.assign(state, { character, header, chat, file: nextFile, chatUnpersisted: !file, chatConflict: '' });
    clearWelcome(); list.setMessages(state.chat, { reset: true, latest: true });
    if (!preserveDraft) $('message-input').value = '';
    synchronize(); status('正在保存聊天位置…');
    if (file) await rememberChat(internal ? { lastCharacter: character.avatar } : {});
    else if (internal && state.own.lastCharacter !== character.avatar) await saveOwn({ lastCharacter: character.avatar });
    status('已读取');
    loaded = true;
    } finally { if (!internal) { state.loading = false; synchronize(); finishSwitch(loaded ? 'success' : 'error'); if (loaded) preloadNextGeneration(); } }
}
async function rememberChat(patch = {}) {
    try {
        const key = homeRecentCacheKey();
        if (key) {
            const previous = JSON.parse(sessionStorage.getItem(key) || '[]');
            sessionStorage.setItem(key, JSON.stringify([{ avatar: state.character.avatar, file_name: state.file, characterName: state.character.name }, ...previous.filter(item => item.avatar !== state.character.avatar)].slice(0, 100)));
        }
    } catch {}
    recentCharacters.invalidate();
    const lastChats = { ...(state.own.lastChats || {}), [state.character.avatar]: state.file };
    if (state.own.lastChats?.[state.character.avatar] !== state.file) patch = { ...patch, lastChats };
    if (Object.keys(patch).some(key => JSON.stringify(state.own[key]) !== JSON.stringify(patch[key]))) await saveOwn(patch);
}
function saveChat({ incremental = false, signal, tailBase } = {}) {
    if (state.chatConflict) return Promise.reject(new Error(state.chatConflict));
    incremental ||= !!state.chatDeltaRetry;
    generationPreload.invalidate();
    if (!state.character) return Promise.resolve();
    const { avatar } = state.character;
    const { file } = state;
    const useDeltaSnapshot = incremental && api.canSaveChatDelta(avatar, file);
    const snapshotTail = () => {
        const tail = state.chat.length;
        if (tail && !state.databaseController && !state.dirty && tailBase?.revision && tailBase === api.chatBase
            && (tailBase.lines.length === tail || tailBase.lines.length === tail + 1)) {
            const lines = tailBase.lines.slice();
            lines[tail] = JSON.stringify(state.chat[tail - 1]);
            return lines;
        }
        return chatLines([state.header, ...state.chat]);
    };
    const record = useDeltaSnapshot
        ? { snapshotLines: loadTimings.measureSync('序列化聊天增量快照', 'generation', snapshotTail) }
        : loadTimings.measureSync('复制聊天保存快照', 'generation', () => ({ header: copy(state.header), messages: copy(state.chat) }));
    state.dirty = true; status('保存中…'); synchronize();
    const finishQueue = loadTimings.start('等待聊天保存队列', 'generation');
    const task = state.saves.catch(() => {}).then(async () => {
        finishQueue();
        await api.saveChat(avatar, file, record.header, record.messages, { incremental, signal, snapshotLines: record.snapshotLines });
        state.chatDeltaRetry = false;
        if (state.character?.avatar === avatar && state.file === file) state.chatUnpersisted = false;
        state.dirty = false; status('已保存'); synchronize();
    }).catch(error => {
        if (incremental && error.status === 409) state.chatConflict = error.message;
        state.chatDeltaRetry = !!error.chatDelta && !state.chatConflict;
        state.dirty = !state.chatConflict;
        status(state.chatConflict || '未保存 · 可重试', true); synchronize(); throw error;
    });
    state.saves = task; return task;
}
async function chatsPanel(initialPage = 0) {
    if (!state.character) return navigation();
    const body = await showPanel('历史聊天', ''); if (!body) return;
    const revision = panelRevision, avatar = state.character.avatar;
    const chats = await api.post('/api/characters/chats', { avatar_url: avatar });
    if (revision !== panelRevision) return;
    if (!Array.isArray(chats) || !chats.length) { note(body, '还没有已保存的对话。'); return; }
    chats.sort((a, b) => (Number(b.last_mes) || Date.parse(b.last_mes) || 0) - (Number(a.last_mes) || Date.parse(a.last_mes) || 0));
    const items = el('div', 'resource-list chat-history-list'); body.append(items);
    const pageSize = 20, pageCount = Math.ceil(chats.length / pageSize);
    let page = Math.min(initialPage, pageCount - 1);
    const pager = el('div', 'library-pager');
    const indicator = el('span', 'note'); indicator.setAttribute('aria-live', 'polite');
    const go = index => { page = index; render(); body.scrollTop = 0; };
    const previous = action('上一页', () => go(page - 1));
    const next = action('下一页', () => go(page + 1));
    if (pageCount > 1) { pager.append(previous, indicator, next); body.append(pager); }
    function render() {
        items.replaceChildren();
        for (const chat of chats.slice(page * pageSize, (page + 1) * pageSize)) renderChat(chat);
        indicator.textContent = `${page + 1} / ${pageCount}`;
        previous.disabled = page === 0;
        next.disabled = page === pageCount - 1;
    }

    function renderChat(chat) {
        const row = action(chat.file_name.replace(/\.jsonl$/, ''), async () => { assertSaved(); if (await closePanel()) await loadChat(chat.file_name.replace(/\.jsonl$/, '')); }, 'chat', 'resource-row');
        const preview = String(chat.mes || '')
            .replace(/(?:```|~~~)[\s\S]*?(?:```|~~~|$)/g, ' ')
            .replace(/<\/?[a-z][^>]*>/gi, ' ')
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/(?:^|\n)\s*(?:#+|>|[-*+])\s+/g, ' ')
            .replace(/\*\*|__|~~|`/g, '')
            .replace(/\s+/g, ' ').trim().slice(0, 100);
        row.append(el('small', '', [`${chat.chat_items || 0} 楼`, preview].filter(Boolean).join(' · ')));
        const wrapper = el('div','chat-history-row'), tools = el('div','chat-history-tools'); wrapper.append(row,tools); items.append(wrapper);
        const file = chat.file_name.replace(/\.jsonl$/, '');
        const read = () => api.post('/api/chats/get', { avatar_url: avatar, file_name: file });
        tools.append(action('导出聊天', async () => {
            const data = await read();
            const url = URL.createObjectURL(new Blob([data.map(item => JSON.stringify(item)).join('\n')], { type: 'application/jsonl' }));
            const link = el('a'); link.href = url; link.download = `${file}.jsonl`; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'export'), action('复制聊天', async () => {
            assertSaved(); const data = await read();
            await api.post('/api/chats/save', { avatar_url: avatar, file_name: `${file}-副本-${Date.now()}`, chat: data });
            if (revision === panelRevision) { panelDirty = false; await chatsPanel(); }
        }, 'copy'), action('删除聊天', async () => {
            assertSaved(); if (!confirm(`删除聊天「${file}」？`)) return;
            await api.post('/api/chats/delete', { avatar_url: avatar, chatfile: file });
            if (state.character?.avatar === avatar && state.file === file) await loadChat(null);
            if (revision === panelRevision) { panelDirty = false; await chatsPanel(page); }
        }, 'trash', 'danger'));
        const label = `${file}的聊天操作`;
        const menu = action(label, () => {
            const open = menu.getAttribute('aria-expanded') === 'true';
            items.querySelectorAll('.chat-history-menu[aria-expanded=true]').forEach(other => other.setAttribute('aria-expanded', 'false'));
            menu.setAttribute('aria-expanded', String(!open));
        }, 'more', 'icon-button chat-history-menu');
        menu.title = label;
        menu.setAttribute('aria-label', label);
        menu.setAttribute('aria-expanded', 'false');
        tools.id = `history-tools-${uuid()}`;
        tools.setAttribute('role', 'group');
        tools.setAttribute('aria-label', label);
        menu.setAttribute('aria-controls', tools.id);
        tools.before(menu);
        for (const button of tools.children) {
            button.title = button.textContent;
            button.setAttribute('aria-label', button.textContent);
        }
        wrapper.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || menu.getAttribute('aria-expanded') !== 'true' || !menu.getClientRects().length) return;
            event.preventDefault();
            event.stopPropagation();
            menu.setAttribute('aria-expanded', 'false');
            menu.focus();
        });

    }
    render();
}

async function persistProfiles(next) {
    const valid = connectionProfiles(next); await api.saveConnections(valid); profileStore = valid; state.connectionError = ''; synchronize();
}
async function connectionPanel(profileId = '', draft = null) {
    if (state.connectionPending) await connectionInitialization.catch(() => {});
    const body = await showPanel('连接与模型', '', '', connectionPanel); if (!body) return;
    if (!state.ready) { note(body, '正在读取保存的连接，请稍候再打开。'); return; }
    const revision = panelRevision;
    let current = draft || profileStore.profiles.find(item => item.id === profileId) || connection();
    const picker = el('select'); picker.setAttribute('aria-label', '选择 API 连接');
    for (const profile of profileStore.profiles) { const option = el('option', '', profile.name || profile.url); option.value = profile.id; picker.append(option); }
    let profileName = current.name || '默认连接';
    if (draft) { const option = el('option', '', `${profileName}（未保存）`); option.value = current.id; picker.append(option); }
    if (draft) { const option = el('option', '', '新连接（未保存）'); option.value = draft.id; picker.append(option); }
    const profileBar = el('div', 'connection-profile-bar connection-settings-bar');
    picker.value = current.id; profileBar.append(picker); body.append(profileBar);
    picker.addEventListener('change', () => run(async () => {
        const next = picker.value; picker.value = current.id;
        if (next === current.id) return;
        assertIdle();
        if (panelDirty && !await confirmPanelDiscard('放弃未保存的连接修改并切换？')) return;
        if (revision !== panelRevision) return;
        assertIdle();
        picker.disabled = true;
        try {
            await persistProfiles({ ...profileStore, activeId: next });
            if (revision === panelRevision) { panelDirty = false; await connectionPanel(next); }
        } finally {
            picker.disabled = false;
        }
    }));
    const profileTools = el('div', 'connection-profile-tools');
    const profileActions = el('div', 'profile-extra-tools');
    profileActions.id = 'connection-profile-actions'; profileActions.hidden = true;
    profileActions.setAttribute('role', 'group'); profileActions.setAttribute('aria-label', '连接操作');
    const more = action('连接操作', () => { more.focus(); setActionsOpen(profileActions.hidden); }, 'more');
    more.title = '连接操作'; more.setAttribute('aria-label', more.title);
    more.setAttribute('aria-controls', profileActions.id);
    more.setAttribute('aria-expanded', 'false');
    const setActionsOpen = open => {
        profileActions.hidden = !open;
        more.setAttribute('aria-expanded', String(open));
    };
    profileActions.append(action('修改名称', () => editName({ title: '修改连接名称', label: '连接名称', value: profileName, returnFocus: more, save: next => {
        if (next === profileName) return;
        profileName = next; panelDirty = true;
        picker.selectedOptions[0].textContent = `${next}（未保存）`;
    } }), 'edit'), action('新建连接', () => connectionPanel('', { id: uuid(), name: '新连接', source: 'custom', url: '', model: '', stream: true, postProcessing: 'merge' }), 'plus'),
        action('复制连接', () => connectionPanel('', { ...copy(current), id: uuid(), name: `${current.name || '连接'}（副本）` }), 'copy'),
        action('删除连接', async () => {
            assertIdle(); if (profileStore.profiles.length <= 1) throw new Error('至少保留一个连接。');
            if (!confirm('删除这个连接配置？不会删除酒馆密钥库里的密钥。')) return;
            const profiles = profileStore.profiles.filter(item => item.id !== current.id);
            await persistProfiles({ version: 1, activeId: profileStore.activeId === current.id ? profiles[0].id : profileStore.activeId, profiles });
            panelDirty = false; await connectionPanel();
        }, 'trash', 'danger'));
    for (const button of profileActions.children) {
        const label = button.querySelector('span').textContent;
        button.title = label; button.setAttribute('aria-label', label);
        button.addEventListener('click', () => { if (!profileActions.hidden) { setActionsOpen(false); more.focus(); } }, { capture: true });
    }
    const closeActionsOnEscape = event => {
        if (event.key !== 'Escape' || profileActions.hidden) return;
        event.preventDefault(); event.stopPropagation(); setActionsOpen(false); more.focus();
    };
    profileTools.addEventListener('keydown', closeActionsOnEscape);
    profileActions.addEventListener('keydown', closeActionsOnEscape);
    profileTools.append(more);
    profileBar.append(profileTools);
    profileBar.after(profileActions);
    const url = field(body, 'API 基础地址', current.url || '', { type: 'url' });
    const model = field(body, '模型', current.model || '', { options: [[current.model || '', current.model || '读取列表或输入模型 ID']] });
    model.dataset.searchable = 'true'; model.dataset.allowCustom = 'true';
    const modelRow = el('div', 'connection-model-row'); model.before(modelRow); modelRow.append(model);
    const stream = field(body, '回复方式', current.stream === false ? 'normal' : 'stream', { options: [['stream', '流式 · 边生成边显示'], ['normal', '非流式 · 完整回复后显示']] });
    const postProcessing = field(body, '提示词后处理', current.postProcessing ?? 'merge', { options: [['merge', '合并相同角色的连续发言'], ['', '不处理']] });
    let savedKey = typeof current.proxyPassword === 'string' ? current.proxyPassword : sessionKeys.get(current.secretId) || '';
    const key = apiKeyField(body, savedKey);
    url.closest('label').after(key.form);
    let masked = false;
    const enteredKey = () => masked ? '' : key.value.trim();
    key.addEventListener('focus', () => { if (masked) { key.select(); } });
    key.addEventListener('beforeinput', () => { if (masked) { masked = false; key.value = ''; } });
    key.addEventListener('input', () => { if (masked && key.value !== '********') masked = false; });
    const keyWrap = el('div', 'connection-key-row'); key.before(keyWrap); keyWrap.append(key);
    const eye = action('显示密钥', async () => {
        if (masked) {
            throw new Error('此旧连接只保留了密钥引用。请重新填写一次密码并保存，之后刷新即可查看。');
        }
        const visible = key.type === 'password'; key.type = visible ? 'text' : 'password';
        eye.replaceChildren(icon(visible ? 'eyeOff' : 'eye')); eye.title = visible ? '隐藏密钥' : '显示密钥'; eye.setAttribute('aria-label', eye.title); eye.setAttribute('aria-pressed', String(visible));
    }, 'eye', 'icon-button'); eye.querySelector('span').remove(); eye.setAttribute('aria-label', '显示密钥'); eye.title = '显示密钥'; eye.setAttribute('aria-pressed', 'false');
    const copyKey = action('复制密钥', async () => {
        if (masked) { notify('旧连接仅保留密钥引用，无法复制。请重新填写密钥。', 'info'); return; }
        const value = enteredKey();
        if (!value) { notify('没有可复制的 API Key', 'info'); return; }
        try { await copyDiagnostics(value, key.form); }
        catch { notify('复制失败，请检查浏览器的剪贴板权限', true); return; }
        notify('API Key 已复制');
    }, 'copy', 'icon-button');
    copyKey.querySelector('span').remove(); copyKey.title = '复制密钥'; copyKey.setAttribute('aria-label', copyKey.title);
    keyWrap.append(eye, copyKey);
    const secretState = await api.post('/api/secrets/read') || {};
    if (revision !== panelRevision) return;
    if (!savedKey && !key.value) {
        savedKey = visibleConnectionPassword(current, state.settings, secretState);
        if (savedKey) { key.value = savedKey; sessionKeys.set(current.secretId, savedKey); }
    }
    const hasStoredReference = current.secretId && !current.secretId.startsWith('no-key-');
    if (!savedKey && !key.value && hasStoredReference) { masked = true; key.value = '********'; }
    postProcessing.closest('label').after(model.closest('label'));
    const getConnection = () => normalizeConnection({ id: current.id, name: profileName.trim(), source: 'custom', url: url.value.trim(), model: model.value.trim(), stream: stream.value === 'stream', postProcessing: postProcessing.value, secretId: current.source === 'custom' ? current.secretId : undefined,
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
    const footer = el('div', 'editor-footer');
    footer.append(action('保存连接', save, 'plug', 'primary')); body.append(footer);
    const readModels = action('读取模型列表', async () => {
        await save(false);
        const config = getConnection();
        const models = await readConnectionModels(config);
        const previous = model.value; model.replaceChildren();
        if (previous && !models.some(([id]) => id === previous)) models.unshift([previous, previous]);
        for (const [id, label] of models) { const option = el('option', '', label); option.value = id; model.append(option); }
        model.value = previous || models[0][0]; panelDirty = true;
        notify(`已读取 ${models.length} 个模型`);
    }, 'refresh', 'model-refresh');
    readModels.querySelector('span').remove(); readModels.title = '读取模型列表'; readModels.setAttribute('aria-label', '读取模型列表');
    modelRow.append(readModels);
}

const presetParametersStorageKey = 'independent-preset-parameters-collapsed';
let presetParametersCollapsed = false;
try { presetParametersCollapsed = sessionStorage.getItem(presetParametersStorageKey) === 'true'; } catch { /* Keep the preference in memory. */ }

async function presetPanel() {
    const host = await showPanel('生成预设', '', 'preset-panel', presetPanel); if (!host) return;
    return loadPanelContent(host, '预设', (body, revision) => renderPresetPanel(body, revision), () => presetPanel());
}
async function renderPresetPanel(body, revision) {
    const ivory = document.documentElement.dataset.palette === 'ivory-cards';
    const preferenceKey = ivory ? 'ivory-cards-preset-parameters-collapsed' : presetParametersStorageKey;
    let collapsed = presetParametersCollapsed;
    if (ivory) {
        collapsed = matchMedia('(max-width: 700px)').matches;
        try {
            const saved = sessionStorage.getItem(preferenceKey);
            if (saved !== null) collapsed = saved === 'true';
        } catch { /* Use the viewport default. */ }
    }
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
    let name = select.value;
    const renamePreset = returnFocus => editName({ title: '修改预设名称', label: '预设名称', value: name, returnFocus, save: next => {
        if (next === name) return;
        name = next; panelDirty = true;
        if (select.selectedOptions[0]) select.selectedOptions[0].textContent = `${next}（未保存）`;
    } });
    const parameters = el('div', 'parameter-grid preset-parameters');
    parameters.id = `preset-parameters-${uuid()}`;
    const rememberParameters = value => {
        collapsed = value;
        if (!ivory) presetParametersCollapsed = collapsed;
        try { sessionStorage.setItem(preferenceKey, String(collapsed)); } catch { /* Use the in-memory state. */ }
    };
    if (ivory) {
        const group = el('details', 'advanced world-global-settings');
        group.open = !collapsed;
        group.append(el('summary', 'preset-parameters-toggle', '生成参数'), parameters);
        group.addEventListener('toggle', () => rememberParameters(!group.open));
        body.append(group);
    } else {
        const parameterToggle = action('收起生成参数', () => {
            rememberParameters(!collapsed);
            updateParameterToggle();
        }, null, 'icon-button preset-parameters-toggle');
        const updateParameterToggle = () => {
            parameters.hidden = collapsed;
            const label = collapsed ? '展开生成参数' : '收起生成参数';
            parameterToggle.replaceChildren(icon('chevron'));
            parameterToggle.title = label;
            parameterToggle.setAttribute('aria-label', label);
            parameterToggle.setAttribute('aria-expanded', String(!collapsed));
        };
        parameterToggle.setAttribute('aria-controls', parameters.id);
        updateParameterToggle();
        const nameRow = el('div', 'preset-name-row');
        const rename = action('编辑名称', () => renamePreset(rename), 'edit');
        nameRow.append(rename, parameterToggle); body.append(nameRow, parameters);
    }
    const controls = new Map();
    let refreshPresetTokens = () => {};
    for (const [key, label, fallback, step] of [['temperature', 'Temperature', 1, .05], ['top_p', 'Top P', 1, .05], ['openai_max_context', '上下文长度', 8192, 1], ['openai_max_tokens', '最大回复 tokens', 512, 1]]) {
        const input = field(parameters, label, draft[key] ?? fallback, { type: 'number' }); input.step = step;
        controls.set(key, { input, fallback });
        if (draft[key] === undefined) draft[key] = fallback;
        input.addEventListener('input', () => { draft[key] = Number(input.value); refreshPresetTokens(); });
    }
    const heading = el('div', 'section-heading preset-prompt-heading');
    heading.append(el('h2', '', '提示词条目'));
    const stats = el('div', 'preset-prompt-stats item-count');
    const count = el('span', 'item-count');
    const totalTokens = el('span', 'preset-token-total');
    const totalLabel = '当前启用条目的预览 token 合计';
    stats.append(count, totalTokens);
    const rows = el('div', 'prompt-list');
    const opened = new Set();
    let pageReady = false, tokenPreview, tokenTimer, tokenSummaryVersion = 0;
    const promptSizes = [];
    body._onReady = () => { pageReady = true; tokenPreview?.start(); };
    body._dispose = () => { pageReady = false; clearTimeout(tokenTimer); tokenPreview?.dispose(); rows._disposeDrag?.(); for(const dispose of promptSizes.splice(0))dispose(); };
    const markDirty = () => { panelDirty = true; };
    const updateCount = () => { const order = promptOrder(draft); count.textContent = `${order.length} 个条目 · ${order.filter(item => item.enabled !== false).length} 个启用`; };
    const renderRows = () => {
        clearTimeout(tokenTimer);
        for(const dispose of promptSizes.splice(0))dispose();
        rows._disposeDrag?.(); tokenPreview?.dispose();
        const cacheRevision = !state.busy && !state.dirty && !state.loading && !state.chatConflict && !variablesSaving
            ? api.chatBase || state.header || api : null;
        tokenPreview = new PresetTokenClient({ api, model: connection().model, character: state.character, persona: persona(), preset: draft, chat: state.chat, header: state.header, settings: state.settings, databaseConfig: state.own.database, cacheRevision, loadBooks: signal => loadBooks({ signal }) });
        const tokenUpdates = [];
        const showTotal = values => { totalTokens.textContent = `${values.reduce((sum, value) => sum + value, 0)} Tokens`; };
        const countRows = async () => {
            const scope = tokenPreview;
            const version = ++tokenSummaryVersion;
            totalTokens.title = totalLabel;
            const results = scope.previewCounts();
            const enabledCounts = [], previousCounts = [];
            let refreshing = false;
            for (const { order, prompt, updateTokens } of tokenUpdates) {
                const snapshot = { ...prompt };
                const previous = results.get(snapshot);
                const recount = previous === undefined || results.recheck(snapshot);
                const result = updateTokens(previous, recount, version, count => results.set(snapshot, count));
                if (order.enabled !== false) {
                    previousCounts.push(previous);
                    enabledCounts.push(result);
                    refreshing ||= recount;
                }
            }
            if (previousCounts.every(value => value !== undefined)) {
                showTotal(previousCounts);
                if (refreshing) totalTokens.title = '上次统计的启用条目合计，正在重新核对';
            } else totalTokens.textContent = ivory ? 'Tokens 统计中' : '…';
            const values = await Promise.all(enabledCounts);
            if (scope.signal.aborted || version !== tokenSummaryVersion || revision !== panelRevision) return;
            totalTokens.title = totalLabel;
            if (values.some(value => value === undefined)) {
                totalTokens.textContent = ivory ? 'Tokens 暂不可用' : '—';
                totalTokens.title = '有启用条目未能完成 token 统计';
                return;
            }
            showTotal(values);
        };
        refreshPresetTokens = () => {
            tokenSummaryVersion++;
            totalTokens.textContent = ivory ? 'Tokens 统计中' : '…';
            totalTokens.title = totalLabel;
            clearTimeout(tokenTimer);
            tokenTimer = setTimeout(() => {
                tokenPreview.invalidatePromptCounts();
                void countRows();
            }, 500);
        };
        rows.replaceChildren(); updateCount();
        for (const { order, prompt, index } of promptRows(draft)) {
            const details = el('details', 'prompt-item'); details.dataset.promptId = prompt.identifier;
            details.open = opened.has(prompt.identifier); details.classList.toggle('prompt-disabled', order.enabled === false);
            details.addEventListener('toggle', () => { if (!details.isConnected) return; if (details.open) { opened.add(prompt.identifier); renderForm(); } else opened.delete(prompt.identifier); });
            const summary = el('summary', 'prompt-summary');
            const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = order.enabled !== false;
            enabled.setAttribute('aria-label', `启用 ${prompt.name || prompt.identifier}`);
            enabled.addEventListener('click', event => event.stopPropagation());
            enabled.addEventListener('change', () => { order.enabled = enabled.checked; details.classList.toggle('prompt-disabled', !enabled.checked); markDirty(); updateCount(); refreshPresetTokens(); });
            const titleWrap = el('span', 'prompt-title');
            const label = el('span', '', prompt.name || markerLabels[prompt.identifier] || prompt.identifier);
            titleWrap.append(label);
            if (prompt.marker) {
                const marker = el('span', 'prompt-autofill'); marker.title = '自动填充'; marker.setAttribute('role', 'img'); marker.setAttribute('aria-label', '自动填充'); marker.append(icon('components')); titleWrap.append(marker);
            }
            const roleLabel = () => ['chatHistory', 'dialogueExamples'].includes(prompt.identifier) && !prompt.independent_role_override ? '原消息角色' : ({ system: '系统', user: '用户', assistant: '助手' }[prompt.role || 'system']);
            const kind = el('small', 'prompt-kind', roleLabel());
            const tokenCount = el('small', 'prompt-token-count', '-');
            const tokenTitle = '按当前聊天和资料库注入预算展开后的条目计数，包含条目正文与消息封装';
            const showCount = count => { tokenCount.textContent = count > 0 ? String(count) : '-'; tokenCount.title = tokenTitle; };
            let tokenVersion = 0;
            const updateTokens = async (previous, recount, summaryVersion, cacheCount) => {
                const scope = tokenPreview;
                if (scope.signal.aborted || revision !== panelRevision || (pageReady && !tokenCount.isConnected)) return;
                const version = ++tokenVersion;
                const current = () => !scope.signal.aborted && revision === panelRevision && version === tokenVersion
                    && summaryVersion === tokenSummaryVersion && tokenCount.isConnected;
                if (previous !== undefined) {
                    showCount(previous);
                    if (!recount) return previous;
                    tokenCount.title = '上次统计结果，正在重新核对';
                } else {
                    tokenCount.textContent = '统计中';
                    tokenCount.title = '后台统计 tokens…';
                }
                try {
                    const count = (await scope.count(prompt)) ?? 0;
                    if (!current()) return;
                    showCount(count);
                    cacheCount(count);
                    return count;
                } catch (error) {
                    if (!current()) return;
                    const timedOut = error?.name === 'TimeoutError';
                    const status = timedOut ? '超时' : '失败';
                    tokenCount.textContent = ivory ? '计数' + status : status;
                    tokenCount.title = timedOut ? 'token 统计请求超时' : '无法统计 tokens';
                }
            };
            titleWrap.append(kind);
            summary.append(enabled, titleWrap, tokenCount);
            tokenUpdates.push({ order, prompt, updateTokens });
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
            if (!prompt.marker) summary.append(actionAnchor);
            summary.addEventListener('keydown', event => {
                if (event.key !== 'Escape' || toolbar.hidden) return;
                event.preventDefault(); event.stopPropagation(); toolbar.hidden = true; more.setAttribute('aria-expanded', 'false'); more.focus();
            });
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
                    refreshPresetTokens();
                });
                if (block) note(content, '默认保留用户与角色各自的发言身份。选择固定角色会将此条目内的全部消息统一为该角色。');
                if (prompt.marker) note(content, `自动填充${markerLabels[prompt.identifier] || prompt.name}。可以调整顺序或开关，内容来自对应的角色、用户设定、世界书或聊天记录。`);
                else {
                    const text = field(content, '提示词内容', prompt.content || '', { multiline: true, rows: 7, hint: '可使用 {{char}}、{{user}} 等已支持的宏。' });
                    promptSizes.push(autosizePrompt(text));
                    text.addEventListener('input', () => { prompt.content = text.value; tokenVersion++; refreshPresetTokens(); });
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
        void countRows();
        if (pageReady) tokenPreview.start();
    };
    const addEntry = action('添加条目', () => {
        const id = uuid(); addPrompt(draft, id); opened.add(id); markDirty(); renderRows();
        const target = [...rows.children].find(node => node.dataset.promptId === id); target?.scrollIntoView({ block: 'nearest' });
    }, 'plus');
    addEntry.title = '添加条目'; addEntry.setAttribute('aria-label', '添加条目');
    heading.append(addEntry);
    body.append(heading, stats, rows);

    const loadDraft = (value, title) => {
        draft = presetDraft(value); name = title; opened.clear();
        for (const [key, { input, fallback }] of controls) { draft[key] ??= fallback; input.value = draft[key]; }
        renderRows();
    };
    let previousPreset = select.value;
    let draftOnly = false;
    const restorePresetLabel = () => {
        if (!available.some(item => item.name === previousPreset)) return;
        const option = [...select.options].find(item => item.value === previousPreset);
        if (option) option.textContent = previousPreset;
    };
    const beginDraft = (data, title) => {
        const next = presetDraft(data);
        restorePresetLabel();
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
        if (data?.extensions?.tavern_helper?.scripts !== undefined) validateScriptTree(data.extensions.tavern_helper.scripts);
        beginDraft(data, file.name.replace(/\.json$/i, ''));
        const count = scriptRows(scriptTrees({}, null, data).preset).length;
        notify(count ? `预设及 ${count} 个预设脚本已载入，保存后生效` : '预设已载入，保存后生效');
    }, 'import');
    toolbarButton('导出预设', () => {
        const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob); const link = el('a'); link.href = url; link.download = `${safeName(name.trim() || '预设')}.json`;
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'export');
    const nameNewPreset = (title, suggestedName, data, trigger, message) => editName({
        title, label: '预设名称', value: uniquePresetName(suggestedName, available.map(preset => preset.name)), message,
        returnFocus: presetTools.querySelector('[aria-expanded]') || trigger,
        save: next => beginDraft(data, next),
    });
    const addPreset = toolbarButton('新增预设', () => nameNewPreset('新增预设', '新预设', createPreset(), addPreset,
        panelDirty ? '确认后将放弃当前未保存的预设修改。' : ''), 'plus');
    const copyPreset = toolbarButton('复制预设', () => nameNewPreset('复制预设', `${name.trim() || '预设'}（副本）`, copy(draft), copyPreset), 'copy');
    const deletePreset = toolbarButton('删除预设', async () => {
        assertIdle(); if (draftOnly) throw new Error('请先保存新预设。');
        if (available.length <= 1) throw new Error('至少保留一个预设，请先新增其他预设。');
        const target = select.value;
        if (!confirm(`删除预设「${target}」？此操作会删除预设文件。`)) return;
        await api.post('/api/presets/delete', { apiId: 'openai', name: target });
        const next = state.own.preset === target || !available.some(preset => preset.name === state.own.preset) ? available.find(preset => preset.name !== target).name : state.own.preset;
        await saveOwn({ preset: next }); await reloadResources(); list.setMessages(state.chat, { reset: true }); panelDirty = false; notify('预设已删除'); await presetPanel();
    }, 'trash', 'danger');
    if (ivory) {
        const rename = toolbarButton('编辑名称', () => renamePreset(presetTools.querySelector('[aria-expanded]')), 'edit');
        presetTools.prepend(rename);
        discloseProfileTools(presetBar, presetTools, toolbarButton, '更多预设操作', '预设管理');
    }
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
        restorePresetLabel(); selectPreset(); list.setMessages(state.chat, { reset: true });
        draftOnly = false; loadDraft(state.preset, target); previousPreset = target; deletePreset.disabled = false; panelDirty = false;
        for (const option of [...select.options]) if (option.dataset.draft) option.remove();
        notify('预设已切换');
    }));
    const footer = el('div', 'editor-footer');
    const savePreset = action('保存并使用', async () => {
        assertIdle(); const data = validatePreset(draft);
        if (!name.trim()) throw new Error('请输入预设名称。');
        const targetName = safeName(name.trim());
        if (available.some(p => p.name === targetName) && !await confirmAction({
            title: '覆盖预设', message: `已存在名为「${targetName}」的预设，是否覆盖？`, confirmLabel: '覆盖', returnFocus: savePreset,
        })) return;
        if (revision !== panelRevision) return;
        assertIdle();
        savePreset.disabled = true;
        try {
            const result = await api.post('/api/presets/save', { apiId: 'openai', name: targetName, preset: data });
            await saveOwn({ preset: result.name }); await reloadResources(); list.setMessages(state.chat, { reset: true }); panelDirty = false; notify('预设已保存'); await presetPanel();
        } finally {
            savePreset.disabled = false;
        }
    }, 'edit', 'primary');
    footer.append(savePreset);
    body.append(footer); renderRows();
    if (!available.length) beginDraft(createPreset(), '新预设');
}

async function regexPanel(scope = 'global', target = '') {
    if (!['global', 'preset', 'character', 'global-script', 'preset-script', 'character-script'].includes(scope)) scope = 'global';
    const reuse = $('panel').open && $('panel').classList.contains('regex-panel');
    let host;
    if (reuse) {
        if (panelDirty && !confirm('放弃未保存的修改？')) return;
        panelDirty = false; panelRevision++; host = $('panel-body');
    } else { host = await showPanel('正则与脚本', '', 'regex-panel', regexPanel); if (!host) return; }
    return loadPanelContent(host, '正则与脚本', (body, revision, timing) => renderRegexPanel(body, revision, scope, target, timing), () => regexPanel(scope, target), { retainContent: reuse });
}
async function renderRegexPanel(body, revision, scope, target, timing) {
    const finishData = timing?.start('正则与脚本 · 准备分类与规则', 'data');
    body.classList.add('regex-panel-content');
    const fresh = { settings: state.settings, bundle: state.bundle }; if (revision !== panelRevision) return;
    const available = presetCatalog(fresh.bundle);
    const scopes = [['global', '全局正则'], ['preset', '预设正则'], ['character', '角色卡正则'], ['global-script', '全局脚本'], ['preset-script', '预设脚本'], ['character-script', '角色卡脚本']];
    const tabs = el('nav', 'regex-tabs desktop-category'); tabs.setAttribute('aria-label', '正则与脚本分类');
    for (const [id, label] of scopes) {
        const button = action(label, () => { if (scope !== id) return regexPanel(id); }, id === 'global' ? 'regex' : id === 'preset' || id === 'preset-script' ? 'tools' : 'card');
        button.setAttribute('aria-pressed', String(scope === id)); tabs.append(button);
    }
    const picker = categorySelect(el, '正则与脚本分类', scopes, scope, (id, select) => {
        select.value = scope; // Keep the current category if switching is cancelled.
        return run(() => regexPanel(id));
    });
    picker.classList.add('regex-category');
    body.append(tabs, picker);
    if (scope.endsWith('-script')) {
        const manager = el('div', 'script-manager'); body.append(manager);
        finishData?.('success', { metrics: { scopeCode: scope === 'global-script' ? 4 : scope === 'preset-script' ? 6 : 5 } }); await renderScriptManager(manager, revision, scope, target, timing); return;
    }
    let entity = null; let rules = []; let selected = target;
    const chooseTarget = (label, options, value) => {
        const select = appendManagerTargetPicker(body, label, options, value);
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
        const cards = await loadCharacterCatalog(false, timing); if (revision !== panelRevision) return;
        selected = cards.some(card => card.avatar === selected) ? selected : cards.find(card => card.avatar === state.character?.avatar)?.avatar || cards[0]?.avatar;
        appendManagerCharacterPicker(body, cards, selected, scope);
        if (selected) entity = cards.find(card => card.avatar === selected);
        if (selected) entity = await api.post('/api/characters/get', { avatar_url: selected }, { timing });
        if (revision !== panelRevision) return;
        rules = copy(scopedRegexes({ character: entity }).character);
    }
    finishData?.('success', { metrics: { ruleCount: rules.length, scopeCode: { global: 1, preset: 2, character: 3 }[scope] } });
    if (scope !== 'global' && !entity) { note(body, '没有可管理的对象，请先创建或导入。'); return; }
    const count = el('p', 'note regex-rule-count');
    const toolbar = el('div', 'regex-toolbar'); toolbar.append(count); body.append(toolbar);
    const rows = el('div', 'regex-list'); body.append(rows);
    body._dispose = () => rows._disposeDrag?.();
    const updateCount = () => { count.textContent = `${rules.length} 条规则 · ${rules.filter(rule => !rule.disabled).length} 条启用`; };
    const dirty = () => { panelDirty = true; updateCount(); };
    const render = () => { updateCount(); const build = () => renderRegexEditor(rows, rules, dirty); return timing ? timing.measureSync('正则与脚本 · 构建正则列表', 'data', build, () => ({ metrics: { ruleCount: rules.length } })) : build(); };
    const addRule = action('新建正则', () => {
        rules.push({ id: uuid(), scriptName: '新的正则', findRegex: '', replaceString: '', placement: [2], disabled: false, markdownOnly: false, promptOnly: false, runOnEdit: false, trimStrings: [], minDepth: null, maxDepth: null, substituteRegex: 0 });
        dirty(); render(); rows.lastElementChild.open = true;
    }, 'plus', 'icon-button');
    const importRules = action('导入正则', async () => {
        const file = await pickFile('.json'); if (!file) return;
        const value = JSON.parse(await file.text());
        const imported = Array.isArray(value) ? value : Array.isArray(value?.extensions?.regex_scripts) ? value.extensions.regex_scripts : Array.isArray(value?.regex_scripts) ? value.regex_scripts : value?.findRegex !== undefined ? [value] : null;
        if (!imported || imported.some(rule => !rule || typeof rule !== 'object' || Array.isArray(rule))) throw new Error('文件中没有可识别的正则规则。');
        rules.push(...copy(imported).map(rule => ({ ...rule, id: uuid() }))); dirty(); render(); notify(`已载入 ${imported.length} 条规则，保存后生效。`);
    }, 'import', 'icon-button');
    for (const button of [addRule, importRules]) {
        const label = button.textContent;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.querySelector('span').remove();
        toolbar.append(button);
    }
    const footer = el('div', 'editor-footer');
    footer.append(action('保存正则', async () => {
        assertIdle();
        if (scope === 'global') {
            state.settings = await api.patchSettings(settings => { (settings.extension_settings ||= {}).regex = copy(rules); }, { sharedSetting: 'regex' });
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
            const savedCard = await saveCharacterRegexes(api, selected, rules);
            if (state.character?.avatar === selected) state.character = savedCard;
        }
        panelDirty = false; list.setMessages(state.chat, { reset: true }); notify('正则已保存');
    }, 'edit', 'primary')); body.append(footer); render();
}

function scriptSnapshot(value) {
    const snapshot = baseScriptSnapshot(value);
    if (nativeScriptPlan(value.settings, value.character, value.preset).some(script => script.enabled !== false && ['role-chat', 'role-engine'].includes(scriptSupport(script).adapter))) {
        const cache = scriptSnapshot.views ||= new Map();
        snapshot.scriptMessageViews = snapshot.chat.flatMap((message, id) => {
            if (!message.textAvailable || message.is_user || (id !== 0 && id < snapshot.chat.length - 6)) return [];
            const text = displayNameMacros(regexText(message.mes, 2, { phase: 'display', depth: snapshot.chat.length - id - 1 }), { char: snapshot.characterName, user: snapshot.userName });
            let html = cache.get(text);
            if (html === undefined) {
                html = globalThis.DOMPurify.sanitize(text.replace(/^\s*```(?:html)?\s*$/gm, ''), { FORCE_BODY: true, ADD_TAGS: ['style'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base'], FORBID_ATTR: ['srcdoc'], ALLOW_DATA_ATTR: true });
                if (cache.size >= 12) cache.delete(cache.keys().next().value);
                cache.set(text, html);
            }
            return [{ id, html }];
        });
    }
    return snapshot;
}
function scriptIdentity() { return `${state.character?.avatar || ''}/${state.file}/${state.header?.chat_metadata?.integrity || ''}/${encodeURIComponent(presetSelection.name || '')}`; }
function hasChatPanelDraft() {
    return panelDirty && $('panel').matches('.variable-panel, .chat-history-panel, .database-panel');
}
async function helperHostAction(operation, payload, identity, externalCheck = null) {
    const owner = scriptRuntime.frame, epoch = scriptRuntime.epoch;
    const replyEvent = state.replyScriptEvent;
    const check = () => {
        replyEvent?.signal.throwIfAborted();
        if (externalCheck) externalCheck();
        else {
            if (scriptRuntime.frame !== owner || scriptRuntime.epoch !== epoch) throw Error('脚本环境已关闭或重新启动，结果未写入。');
            if (scriptRuntime.statusRows && scriptRuntime.statusRows.get(payload?.scriptId)?.dataset?.active !== 'true') throw Error('调用脚本已停用或失效。');
        }
        if (!state.character || identity !== scriptIdentity() || state.loading) throw Error('聊天已切换，脚本结果未写入。');
        if (state.chatConflict) throw Error(state.chatConflict);
        if (state.busy && (externalCheck || !scriptRuntime.processing) || state.dirty || inlineEdit || hasChatPanelDraft() || state.historySaving || state.databaseHistorySaving) throw Error('当前正在生成、编辑或尚未保存，请稍后重试。');
    };
    check();
    if (operation === 'set-extension-prompt') {
        const prompt = validateExtensionPrompt(payload), key = payload.scriptId + ':' + prompt.name;
        if (!prompt.content) scriptRuntime.extensionPrompts.delete(key);
        else {
            if (!scriptRuntime.extensionPrompts.has(key) && scriptRuntime.extensionPrompts.size >= 100) throw Error('脚本提示词数量过多。');
            scriptRuntime.extensionPrompts.set(key, prompt);
        }
        return { value: true };
    }
    if (operation === 'set-draft') {
        if (state.busy || typeof payload?.text !== 'string' || !payload.text.trim() || payload.text.length > 100000) throw Error('当前不能填入内容，或内容为空、过大。');
        if ($('message-input').value.trim() && $('message-input').value !== payload.text && (typeof payload.base !== 'string' || $('message-input').value !== payload.base)) throw Error('聊天输入框已有草稿，请先发送或清空。');
        $('message-input').value = payload.text; resizeInput(); $('message-input').focus();
        return { value: true };
    }
    if (operation === 'refresh-message') {
        if (!Number.isSafeInteger(payload?.message_id) || !state.chat[payload.message_id]) throw Error('消息楼层不存在。');
        list.setMessages(state.chat, { reset: true });
        return { value: true, snapshot: scriptSnapshot(state) };
    }
    if (operation === 'generate-raw') {
        const options = payload?.options;
        if (!options || typeof options.prompt !== 'string' || !options.prompt.trim() || options.prompt.length > 500000 || (options.systemPrompt !== undefined && (typeof options.systemPrompt !== 'string' || options.systemPrompt.length > 100000)) || Object.keys(options).some(key => !['prompt', 'systemPrompt', 'quietToLoud'].includes(key))) throw Error('原始生成参数无效；使用当前连接，仅接受 prompt、systemPrompt 和 quietToLoud。');
        const controller = new AbortController(), target = state.chat.at(-1), length = state.chat.length, revision = target ? helperMessageRevision(target) : '';
        controller.scriptId = payload.scriptId;
        if (scriptRuntime.auxiliaryControllers.size) throw Error('已有脚本解析请求进行中，请稍候。');
        scriptRuntime.auxiliaryControllers.add(controller);
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000), ...(state.controller ? [state.controller.signal] : [])]);
        let finishRequest, text = '';
        try {
            const messages = [...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []), { role: 'user', content: options.prompt }];
            const body = generationBody({ ...connection(), stream: false }, state.preset, messages);
            finishRequest = requestLog.start('script', body, signal, api);
            const response = await api.response('/api/backends/chat-completions/generate', body, { signal });
            if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
                for await (const event of readEvents(response)) {
                    if (event.error) throw Error('脚本解析模型返回错误。');
                    text += event.choices?.[0]?.delta?.content || event.choices?.[0]?.text || '';
                    if (text.length > 500000) throw Error('脚本解析结果过大。');
                }
            } else {
                const result = await response.json();
                if (result.error) throw Error('脚本解析模型返回错误。');
                text = result.choices?.[0]?.message?.content || result.choices?.[0]?.text || '';
            }
            finishRequest?.(null, text);
            check();
            if (state.chat.length !== length || state.chat.at(-1) !== target || (target && helperMessageRevision(target) !== revision)) throw Error('解析期间消息或回复分支已变化，结果未应用。');
            if (signal.aborted) throw Error('脚本解析已停止。');
            if (typeof text !== 'string' || !text.trim() || text.length > 500000) throw Error('脚本解析结果为空或过大。');
            return { value: text };
        } catch (error) {
            finishRequest?.(error, text);
            throw error;
        } finally { scriptRuntime.auxiliaryControllers.delete(controller); }
    }
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
            const patch = records => operation === 'save-variables' ? patchHelperVariables(records, payload?.changes)
                : operation === 'save-chat' ? patchHelperMessages(records, payload?.messages, { changes: payload?.changes ?? null })
                    : patchHelperMessages(records, payload?.messages, { greetings: [(state.character.data || state.character).first_mes, ...((state.character.data || state.character).alternate_greetings || [])].filter(value => typeof value === 'string') });
            let verified;
            const timing = replyEvent?.timing;
            const signal = replyEvent?.signal;
            const onWrite = replyEvent ? () => { replyEvent.writePending = true; } : undefined;
            const applyPatch = records => timing
                ? timing.measureSync('助手校验聊天变更', 'generation', () => patch(records))
                : patch(records);
            const deferPaint = state.generation?.dispatchingMessageSent || replyEvent;
            const checkpoint = replyEvent || (state.generation?.dispatchingMessageSent ? state.generation : null);
            if (deferPaint && api.canSaveChatDelta?.(avatar, file)) {
                const records = [state.header, ...state.chat];
                const next = applyPatch(records);
                const base = checkpoint?.chatBase;
                // The lifecycle began with a confirmed save. Helper patches
                // return new records for changed targets and share the rest.
                const snapshotLines = !state.databaseController && base?.revision && base === api.chatBase && base.lines.length === records.length
                    ? next.map((item, index) => item === records[index] ? base.lines[index] : JSON.stringify(item))
                    : undefined;
                try {
                    if (await api.trySaveChatDelta(avatar, file, next, signal, { timing, onWrite, snapshotLines, skipUnchanged: !!snapshotLines })) { check(); verified = next; }
                } catch (error) {
                    if (error.chatDelta) state.chatConflict = error.status === 409 ? error.message : '无法确认脚本写入结果，请重新打开聊天后再发送。';
                    else if (replyEvent?.writePending) state.chatConflict ||= '无法确认脚本写入结果，请重新打开聊天后再发送。';
                    throw error;
                } finally {
                    if (replyEvent) replyEvent.writePending = false;
                }
            }
            if (!verified) {
                const saveNative = async () => {
                    const readChat = () => api.post('/api/chats/get', { avatar_url: avatar, file_name: file }, { signal, timing });
                    let fresh = await readChat(); check();
                    // The native endpoint can create a missing character chat directory on its first read.
                    if (state.chatUnpersisted && fresh && !Array.isArray(fresh) && typeof fresh === 'object' && !Object.keys(fresh).length) {
                        fresh = await readChat(); check();
                    }
                    // Only the first write of a new session may seed an absent file.
                    const records = state.chatUnpersisted && Array.isArray(fresh) && !fresh.length ? [state.header, ...state.chat] : fresh;
                    const next = applyPatch(records);
                    try {
                        await api.saveChat(avatar, file, next[0], next.slice(1), { signal, timing, onWrite });
                        check(); state.chatUnpersisted = false;
                        const saved = await api.post('/api/chats/get', { avatar_url: avatar, file_name: file }, { signal, timing }); check();
                        if (JSON.stringify(saved) !== JSON.stringify(next)) throw Error('脚本聊天保存核验失败，请重新打开聊天。');
                        return saved;
                    } catch (error) {
                        if (replyEvent?.writePending) state.chatConflict ||= '无法确认脚本写入结果，请重新打开聊天后再发送。';
                        throw error;
                    } finally {
                        if (replyEvent) replyEvent.writePending = false;
                    }
                };
                verified = timing ? await timing.measure('助手整段聊天保存与回读', 'generation', saveNative) : await saveNative();
            }
            // Preserve message object identities held by generation and MVU.
            const messages = verified.slice(1);
            if (messages.length !== state.chat.length) throw Error('聊天楼层数量已变化，请重新打开聊天。');
            state.header = verified[0];
            for (let i = 0; i < messages.length; i++) {
                if (messages[i] === state.chat[i]) continue;
                for (const key of Object.keys(state.chat[i])) if (!Object.hasOwn(messages[i], key)) delete state.chat[i][key];
                Object.assign(state.chat[i], messages[i]);
            }
            if (checkpoint) checkpoint.chatBase = api.chatBase;
            if (!deferPaint) list.setMessages(state.chat, { latest: list.follow });
        } else if (['save-settings', 'save-globals', 'save-lore-settings', 'save-buttons'].includes(operation)) {
            const value = operation === 'save-buttons' ? validateVariables({ buttons: payload?.value }) : validateVariables(operation === 'save-lore-settings' ? payload?.settings : payload?.value);
            const plan = nativeScriptPlan(state.settings, state.character, state.preset);
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
            }, { source: ({ 'save-buttons': '保存脚本按钮设置', 'save-settings': '保存脚本设置', 'save-globals': '保存脚本全局变量', 'save-lore-settings': '保存脚本世界书设置' })[operation] });
            api.readCache.clear(); const verified = await api.settings({ lightweight: true, source: '核验脚本设置或全局变量' }); check();
            const saved = operation === 'save-buttons' ? { buttons: verified.settings.extension_settings?.independentHelper?.scriptButtons?.[payload.scriptId] } : operation === 'save-settings' ? (legacySettings ? verified.settings.extension_settings?.independentHelper?.mvu : verified.settings.extension_settings?.independentHelper?.scriptSettings?.[payload.scriptId]) : operation === 'save-globals' ? verified.settings.extension_settings?.variables?.global : verified.settings.extension_settings?.independentHelper?.loreSettings;
            if (Object.entries(value).some(([key, item]) => JSON.stringify(saved?.[key]) !== JSON.stringify(item))) throw Error('脚本设置保存核验失败。');
            state.settings = verified.settings; state.own = settingsOwn(state.settings);
        } else throw Error('此酒馆伴侣接口尚未接入。');
        generationPreload.invalidate();
        return { value: true, snapshot: scriptSnapshot(state) };
    } finally { variablesSaving = false; }
}
async function variableManagerPanel() {
    assertSaved();
    if (!state.character || !state.header || !state.chat.length) throw Error('请先打开有消息的聊天。');
    const identity = scriptIdentity(), body = await showPanel('变量管理器', '', 'variable-panel'); if (!body) return;
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
                    api.readCache.clear(); const verified = await api.settings({ lightweight: true, source: '核验全局变量' });
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
    if (hasChatPanelDraft()) throw Error('请先保存或取消当前修改。');
    if (!state.character || identity !== scriptIdentity()) throw Error('聊天已切换，脚本结果未写入。');
    if (!payload?.variables || Object.prototype.toString.call(payload.variables) !== '[object Object]' || JSON.stringify(payload.variables).length > 1000000) throw Error('脚本变量格式无效或数据过大。');
    if (payload.type === 'chat') { state.header.chat_metadata ||= {}; state.header.chat_metadata.variables = copy(payload.variables); }
    else if (payload.type === 'message' && Number.isInteger(payload.message_id) && state.chat[payload.message_id]) {
        try { if (payload.variables.stat_data) payload.variables.stat_data = await normalizeRoleMvu(payload.variables.stat_data); }
        catch (error) { scriptRuntime.refresh(scriptSnapshot(state), scriptIdentity()); throw error; }
        assertSaved(); if (hasChatPanelDraft() || identity !== scriptIdentity()) throw Error('聊天或编辑状态已变化，变量未写入。');
        const message = state.chat[payload.message_id]; (message.variables ||= {})[message.swipe_id || 0] = copy(payload.variables);
    } else throw Error('暂不支持此变量写入范围。');
    await saveChat();
}
async function openScriptWorkspace(diagnostics = true) {
    assertViewable(); if (hasChatPanelDraft()) throw Error('请先保存或取消当前修改。');
    if (!state.character) throw Error('请先进入角色卡聊天。');
    const identity = scriptIdentity(); let preparation = '';
    if (usesMvuCompat(state.settings, state.character) && !state.busy && !state.dirty) {
        try { const result = await prepareRoleMvu(); if (result.changed) await saveChat(); preparation = result.message; }
        catch (error) { preparation = `变量准备未完成：${error.message}`; }
    }
    if (identity !== scriptIdentity()) return;
    const scripts = nativeScriptPlan(state.settings, state.character, state.preset), snapshot = scriptSnapshot(state);
    if (!preparation) preparation = !scripts.length ? '当前没有全局、预设或角色脚本。' : !scripts.some(script => script.enabled) ? '脚本已停用，请到“正则与脚本”启用。' : latestMvuData(snapshot).stat_data ? '已读取当前聊天变量。所有运行脚本共用酒馆伴侣接口。' : '酒馆伴侣接口已提供；当前聊天还没有 MVU 变量。';
    if (diagnostics && $('panel').open && !await closePanel()) return;
    await scriptRuntime.show({ scripts, snapshot, identity, preparation, diagnostics, actions: $('quick-replies') });
    const anchor = document.querySelector('.script-chat-anchor');
    if (anchor?.isConnected) scriptRuntime.bindChat(anchor, Number(anchor.dataset.messageId));
}
async function roleWorldbook(name, identity) {
    const current = () => identity === scriptIdentity() && name && name === (state.character?.data || state.character)?.extensions?.world;
    if (!current()) throw Error('只允许读取当前角色关联的世界书。');
    const book = await api.post('/api/worldinfo/get', { name }, { signal: AbortSignal.timeout(15000) });
    if (!current()) throw Error('聊天或关联世界书已切换。');
    return book;
}
function queueScriptWorldFields(run) {
    const pending = (roleScriptAction.worldFields || Promise.resolve()).catch(() => {}).then(run);
    roleScriptAction.worldFields = pending;
    return pending;
}
async function saveScriptWorldFields(name, book, updated, identity, check) {
    const latest = await roleWorldbook(name, identity); check();
    if (JSON.stringify(latest) !== JSON.stringify(book)) throw Error('世界书已被其他操作修改，请重新读取。');
    await api.post('/api/worldinfo/edit', { name, data: updated }); check();
    const verified = await roleWorldbook(name, identity); check();
    if (JSON.stringify(verified.entries) !== JSON.stringify(updated.entries)) throw Error('世界书字段保存核验失败。');
    api.readCache.clear(); generationPreload.invalidate();
}
async function htmlOpeningAction(operation, payload, message, identity, previewCheck) {
    const check = (savingVariables = false) => {
        previewCheck();
        if (savingVariables) assertMessageEditClosed();
        else assertSaved();
        if (panelDirty || state.chat.length !== 1) throw Error('请在只有开场白的新聊天中确认开局。');
    };
    const { text, entries, variables } = payload || {};
    if (operation === 'opening-seal-state') {
        check();
        return copy(message.variables?.[message.swipe_id || 0] || {});
    }
    if (operation === 'opening-draft') return (await helperHostAction('set-draft', { text }, identity, check)).value;
    const checkDraft = () => {
        check();
        if ($('message-input').value.trim() && $('message-input').value !== text) throw Error('聊天输入框已有草稿，请先发送或清空。');
    };
    const saveOpening = async (base, value) => {
        checkDraft();
        await helperHostAction('save-variables', { changes: [{ type: 'message', message_id: 0, revision: helperMessageRevision(message), base, value }] }, identity, () => check(true));
        scriptRuntime.refresh(scriptSnapshot(state), identity);
    };
    if (operation === 'write-opening-stat') {
        checkDraft();
        const base = copy(message.variables || {}), swipe = message.swipe_id || 0, current = base[swipe] || {};
        const initial = current.stat_data || await roleMvuSeed(identity);
        if (!initial) throw Error('找不到当前角色的 InitVar 或开场白变量。');
        const stat_data = await normalizeRoleMvu(deploymentOpeningStat(initial, payload?.fields));
        const value = copy(base); value[swipe] = { ...current, stat_data };
        await saveOpening(base, value);
        return true;
    }
    if (operation === 'opening-seal') {
        checkDraft();
        if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw Error('开局命牒为空或过大。');
        const base = copy(message.variables || {}), swipe = message.swipe_id || 0, current = base[swipe] || {};
        if (current.stat_data?._开局已创建 === true) {
            if (current._赤孽开局命牒 !== text) throw Error('当前开场白已经落契，请使用已保存的命牒。');
        } else {
            const data = validateVariables(payload.data);
            if (data.stat_data?._开局已创建 !== true || data.schema?.type !== 'object' || data._赤孽开局命牒 !== text) throw Error('开局变量或命牒格式无效。');
            if (JSON.stringify(current) !== JSON.stringify(payload.base)) throw Error('开局变量刚刚更新，请重新确认命盘。');
            const value = copy(base); value[swipe] = data;
            await saveOpening(base, value);
        }
        return (await helperHostAction('set-draft', { text }, identity, checkDraft)).value;
    }
    if (operation !== 'opening-confirm' && operation !== 'opening-worldbook') throw Error('不支持此开局操作。');
    const confirm = operation === 'opening-confirm';
    return queueScriptWorldFields(async () => {
        check();
        if (confirm) {
            checkDraft();
            if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw Error('开场指令为空或过大。');
            if (!Array.isArray(variables) || !variables.length) throw Error('开局变量格式无效。');
        }
        const name = (state.character.data || state.character).extensions?.world;
        const book = await roleWorldbook(name, identity); check();
        const commands = openingWorldCommands(book, entries);
        if (confirm) {
            const base = copy(message.variables || {}), swipe = message.swipe_id || 0;
            const value = copy(base), current = value[swipe] || {};
            const prefix = entries.join('|') + '#', previous = current.stat_data?.环境与剧情?.开局激活;
            const marker = ['环境与剧情.开局激活', typeof previous === 'string' && previous.startsWith(prefix) ? previous : prefix + Date.now()];
            value[swipe] = { ...current, stat_data: openingVariableData(current.stat_data || {}, [...variables, marker]) };
            if (JSON.stringify(base) !== JSON.stringify(value)) await saveOpening(base, value);
        }
        if (commands.length) await saveScriptWorldFields(name, book, patchScriptWorldFields(book, commands), identity, check);
        if (!confirm) return commands.length;
        await helperHostAction('set-draft', { text }, identity, checkDraft);
        return { variables: variables.length, turned: commands.length };
    });
}
async function htmlMvuAction(operation, payload, index, message, identity, previewCheck) {
    previewCheck();
    const previous = previousMvuSource(state.chat, index);
    if (operation === 'mvu-previous') return previous ? validateVariables(reparseMvuBase(previous.data)) : null;
    if (operation !== 'mvu-reparse') throw Error('不支持此 MVU 操作。');
    assertSaved();
    if (hasChatPanelDraft()) throw Error('请先保存或取消当前修改。');
    const text = payload?.text;
    if (typeof text !== 'string' || text.length > 500000 || !/<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable\s*>/i.test(text)) throw Error('本层缺少完整的变量更新指令，或指令过大。');
    if (!/<UpdateVariable\b[^>]*>(?:(?!<\/UpdateVariable>).)*<JSONPatch\b/is.test(text)) throw Error('变量更新指令缺少 JSONPatch。');
    let operations;
    try { operations = messageMvuPatch(text); }
    catch (error) { throw Error('JSONPatch 格式无效：' + error.message); }
    if (operations.length > 500 || operations.some(op => !op || typeof op.op !== 'string' || typeof op.path !== 'string' || (op.path !== '' && !op.path.startsWith('/')))) throw Error('JSONPatch 操作或路径格式无效。');
    if (!previous) throw Error('未找到可承接的前层变量快照。');
    const base = validateVariables(reparseMvuBase(previous.data));
    if (JSON.stringify(base) !== JSON.stringify(payload.base)) throw Error('前层变量已更新，请重新重填。');
    const previousVariables = copy(previous.message.variables), previousRevision = helperMessageRevision(previous.message);
    const currentVariables = copy(message.variables || {}), swipe = message.swipe_id || 0;
    const check = () => {
        previewCheck();
        if (state.chat[previous.id] !== previous.message || helperMessageRevision(previous.message) !== previousRevision ||
            JSON.stringify(previous.message.variables) !== JSON.stringify(previousVariables) ||
            JSON.stringify(message.variables || {}) !== JSON.stringify(currentVariables)) throw Error('变量或回复分支已变化，请重新重填。');
    };
    const parsed = await scriptRuntime.parseMvu(text, base, identity);
    check();
    if (!isReparseMvuData(parsed)) throw Error('MVU 未返回有效的变量结果，请检查更新指令。');
    const data = validateVariables({ ...currentVariables[swipe], ...parsed });
    if (JSON.stringify(data) === JSON.stringify(currentVariables[swipe])) return { data, changed: false };
    const value = copy(currentVariables); value[swipe] = data;
    await helperHostAction('save-variables', { changes: [
        { type: 'message', message_id: previous.id, revision: previousRevision, base: previousVariables, value: previousVariables },
        { type: 'message', message_id: index, revision: helperMessageRevision(message), base: currentVariables, value },
    ] }, identity, check);
    scriptRuntime.refresh(scriptSnapshot(state), identity);
    return { data, changed: true };
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
async function roleScriptAction(action, payload, identity, externalCheck = null) {
    if (typeof externalCheck !== 'function') externalCheck = null;
    const check = () => { externalCheck?.(); assertSaved(); if (panelDirty || identity !== scriptIdentity()) throw Error('聊天或编辑状态已变化，请重新打开脚本。'); };
    check();
    if (action === 'slash' && !/^\/(?:trigger(?:\s+await=true)?|hide\s+\d+)$/.test(payload?.command?.trim() || '')) {
        const commands = parseScriptCommands(payload?.command), macro = text => String(text).replace(/\{\{\s*(user|char)\s*\}\}/gi, (_, key) => key.toLowerCase() === 'user' ? persona().name : state.character.name);
        if (commands[0].type === 'setinput') return helperHostAction('set-draft', { scriptId: payload.scriptId, text: macro(commands[0].text) }, identity, externalCheck);
        if (commands.length > 1 && commands[0].type === 'setvar') {
            if ($('message-input').value.trim()) throw Error('请先发送或清空输入框中的内容。');
            const sendCommand = commands.at(-2);
            const text = sendCommand.literal ? sendCommand.text : macro(sendCommand.text);
            const last = state.chat.at(-1);
            if (last?.is_user && last.extra?.independentRoleScript && last.mes === text) throw Error('这条指令已经添加，请在聊天中检查或重试。');
            const base = state.header?.chat_metadata?.variables || {};
            const values = Object.fromEntries(commands.slice(0, -2).map(command => [command.key, command.value]));
            const message = await appendRoleUserMessage(text, [{ type: 'chat', base, value: { ...base, ...values } }]);
            if (state.chat.at(-1) !== message) throw Error('聊天最后一条消息已变化，请在聊天中检查或重试。');
            return roleScriptAction('slash', { command: '/trigger' }, identity, externalCheck);
        }
        if (['getvar', 'setvar'].includes(commands[0].type)) {
            const command = commands[0], base = copy(state.header?.chat_metadata?.variables || {});
            if (command.type === 'getvar') return { value: typeof base[command.key] === 'string' ? base[command.key] : JSON.stringify(base[command.key] ?? '') };
            return helperHostAction('save-variables', { scriptId: payload.scriptId, changes: [{ type: 'chat', base, value: { ...base, [command.key]: command.value } }] }, identity, externalCheck);
        }
        if (commands[0].type.endsWith('entryfield')) {
            const run = async () => {
                check();
                const name = commands[0].name, book = await roleWorldbook(name, identity); check();
                const updated = patchScriptWorldFields(book, commands);
                if (commands.some(command => command.type === 'setentryfield')) {
                    await saveScriptWorldFields(name, book, updated, identity, check);
                }
                const last = commands.at(-1), entry = Object.entries(updated.entries).find(([key, entry]) => String(entry.uid ?? key) === String(last.uid))?.[1];
                return { value: last.type === 'getentryfield' ? (Array.isArray(entry[last.field]) ? JSON.stringify(entry[last.field]) : String(entry[last.field] ?? '')) : '', worldbook: { name, entries: updated.entries } };
            };
            return queueScriptWorldFields(run);
        }
        let result = { value: '' };
        for (const command of commands) {
            check();
            if (command.type === 'echo') { notify(macro(command.text).slice(0, 1000), command.kind); continue; }
            if (command.type === 'send') result = await roleScriptAction('create-messages', { messages: [{ role: 'user', message: macro(command.text) }] }, identity, externalCheck);
            if (command.type === 'trigger') result = await roleScriptAction('slash', { command: '/trigger' }, identity, externalCheck);
            if (command.type === 'sendas') {
                if (macro(command.name) !== state.character.name || $('message-input').value.trim()) throw Error('只允许当前角色的显示消息，且输入框须为空。');
                state.chat.push({ name: state.character.name, is_user: false, is_system: false, mes: macro(command.text), send_date: new Date().toISOString(), extra: { independentRoleScript: true } });
                await saveChat(); list.setMessages(state.chat, { latest: true }); result = { value: '', snapshot: scriptSnapshot(state) };
            }
        }
        return result;
    }
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
        if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== 'user' || options.insert_at !== undefined || options.insert_before !== undefined) throw Error('当前只支持在聊天末尾添加一条用户指令。');
        await appendRoleUserMessage(messages[0].message);
        return { snapshot: scriptSnapshot(state) };
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
async function appendRoleUserMessage(text, changes = null) {
    if (typeof text !== 'string' || !text.trim() || text.length > 200000) throw Error('当前只支持在聊天末尾添加一条用户指令。');
    if (changes && state.chatConflict) throw Error(state.chatConflict);
    if (changes) [state.header] = patchHelperVariables([state.header], changes);
    const message = { name: persona().name, is_user: true, is_system: false, send_date: new Date().toISOString(), mes: text, extra: { independentRoleScript: true } };
    state.chat.push(message);
    list.setMessages(state.chat, { latest: true });
    if (changes) await saveChat({ incremental: true });
    else await saveChat();
    return message;
}
async function normalizeRoleMvu(data) {
    const schema = characterScriptPlan(state.settings, state.character).find(script => script.enabled && scriptSupport(script).adapter === 'mvu-schema');
    return schema ? scriptSchema.validate(schema, data, scriptIdentity()) : copy(data);
}
async function roleMvuSeed(identity) {
    const seed = state.header?.chat_metadata?.independentMvuSeed;
    if (seed) return seed;
    const card = state.character?.data || state.character, name = card?.extensions?.world;
    const book = name ? await roleWorldbook(name, identity) : hasEmbeddedWorld(card) ? card.character_book : null;
    return initialVariablesFromBook(book);
}
async function prepareRoleMvu(generation = false, rawReply = null) {
    if (!usesMvuCompat(state.settings, state.character)) return { changed: false, message: '此卡未启用 MVU 兼容脚本。' };
    const identity = scriptIdentity(); if (!generation) assertSaved();
    return loadTimings.measure('角色卡 MVU 变量更新', 'generation', async () => {
        const seed = await roleMvuSeed(identity);
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
function downloadJson(value, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = el('a'); link.href = url; link.download = `${safeName(name)}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function renderScriptManager(body, revision, scope, target, timing) {
    const kind = scope === 'global-script' ? 'global' : scope === 'preset-script' ? 'preset' : 'character';
    let entity = null, selected = target;
    if (kind === 'character') {
        const cards = await loadCharacterCatalog(false, timing); if (revision !== panelRevision) return;
        selected = cards.some(card => card.avatar === selected) ? selected : cards.find(card => card.avatar === state.character?.avatar)?.avatar || cards[0]?.avatar;
        appendManagerCharacterPicker(body, cards, selected, scope);
        if (!selected) { note(body, '没有可管理的角色卡。'); return; }
        entity = await api.post('/api/characters/get', { avatar_url: selected }, { timing }); if (revision !== panelRevision) return;
    }
    if (kind === 'preset') {
        const available = presets();
        selected = available.some(item => item.name === selected) ? selected : available.find(item => item.name === state.own.preset)?.name || available[0]?.name;
        entity = available.find(item => item.name === selected);
        if (!entity) { note(body, '没有可管理的预设，请先创建或导入。'); return; }
        const select = appendManagerTargetPicker(body, '管理的预设', available.map(item => [item.name, item.name]), selected);
        select.addEventListener('change', () => run(async () => {
            if (panelDirty && !confirm('放弃当前未保存的脚本修改？')) { select.value = selected; return; }
            panelDirty = false; await regexPanel(scope, select.value);
        }));
        note(body, '脚本随所属预设保存，仅在使用该预设的聊天中运行。导入预设时会一并载入其中的脚本。');
    }
    const prepareTree = () => copy(scriptTrees(state.settings, kind === 'character' ? entity : null, kind === 'preset' ? entity.data : null)[kind]);
    let tree = timing ? timing.measureSync('正则与脚本 · 准备脚本数据', 'data', prepareTree, value => ({ metrics: { scriptCount: scriptRows(value).length } })) : prepareTree();
    const dirty = () => { panelDirty = true; };
    const toolbar = el('div', 'regex-toolbar'), rows = el('div', 'regex-list'); body.append(toolbar, rows);
    const renderList = () => {
        rows.replaceChildren(); const entries = scriptRows(tree);
        if (!entries.length) { note(rows, '还没有脚本，可新建或导入。'); return; }
        for (const row of entries) {
            const script = row.script, support = scriptSupport(script), details = el('details', 'prompt-item');
            details.classList.toggle('prompt-disabled', script.enabled === false);
            const summary = el('summary', 'prompt-summary');
            const toggle = el('input'); toggle.type = 'checkbox'; toggle.checked = script.enabled !== false; toggle.setAttribute('aria-label', `启用脚本 ${script.name || '未命名'}`);
            toggle.addEventListener('click', event => event.stopPropagation()); toggle.addEventListener('change', () => { script.enabled = toggle.checked; details.classList.toggle('prompt-disabled', !toggle.checked); dirty(); });
            const title = el('span', 'prompt-title', script.name || '未命名脚本'); summary.append(toggle, title, el('small', '', support.supported ? '兼容运行' : '暂不支持')); details.append(summary);
            inlineEntryActions(summary, [
                action('导出此脚本', () => downloadJson([script], String(script.name || '').trim() || '未命名脚本'), 'export'),
                action('删除脚本', () => { row.parent.splice(row.index, 1); dirty(); render(); }, 'trash', 'danger'),
            ], script.name || '未命名脚本');
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
    toolbar.append(iconAction('新建脚本', () => { tree.push({ type: 'script', id: uuid(), name: '新脚本', enabled: false, content: '', info: '', button: { enabled: false, buttons: [] }, data: {} }); dirty(); render(); rows.lastElementChild.open = true; }, 'plus'), iconAction('导入脚本', async () => {
        const file = await pickFile('.json'); if (!file) return; const value = JSON.parse(await file.text());
        const imported = Array.isArray(value) ? value : Array.isArray(value.scripts) ? value.scripts : value.type === 'script' || value.type === 'folder' ? [value] : value.extensions?.tavern_helper?.scripts ?? value.data?.extensions?.tavern_helper?.scripts;
        validateScriptTree(imported);
        const items = copy(imported); for (const row of scriptRows(items)) row.script.id = uuid(); tree.push(...items); dirty(); render();
    }, 'import'), iconAction('导出脚本', () => downloadJson(tree, `${kind === 'global' ? '全局' : entity.name || '角色卡'}脚本`), 'export'));
    const footer = el('div', 'editor-footer'); footer.append(action('保存脚本', async () => {
        assertIdle();
        validateScriptTree(tree);
        if (kind === 'global') {
            state.settings = await api.patchSettings(settings => patchGlobalScripts(settings, tree), { sharedSetting: 'scripts' }); state.own = settingsOwn(state.settings);
        } else if (kind === 'preset') {
            await savePresetScripts(api, selected, tree);
            await reloadResources();
        } else {
            const savedCard = await saveCharacterScripts(api, selected, tree);
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
            toolbar.append(action('复制规则', () => { rules.splice(index + 1, 0, { ...copy(rule), id: uuid(), scriptName: `${rule.scriptName || '正则'}（副本）` }); render(); }, 'copy'), action('导出规则', () => {
                downloadJson(rule.findRegex === undefined ? [rule] : rule, String(rule.scriptName || '').trim() || '未命名正则');
            }, 'export'), action('删除规则', () => {
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
    if (state.bundle.displayTavern === 'display') {
        const host = await showPanel('展示版角色卡', '', 'library-panel', characterPanel); if (!host) return;
        return loadPanelContent(host, '展示版角色卡', renderDisplayCharacterPanel, characterPanel);
    }
    const host = await showPanel('角色卡', '', 'library-panel', characterPanel); if (!host) return;
    return loadPanelContent(host, '角色卡', (body, revision, timing) => renderCharacterPanel(body, revision, force, timing), () => characterPanel(true));
}
async function renderDisplayCharacterPanel(body, revision, timing) {
    const characters = await loadCharacterCatalog(true, timing);
    if (revision !== panelRevision) return;
    const search = el('input', 'library-search'); search.type = 'search'; search.placeholder = '搜索角色名称…'; search.setAttribute('aria-label', '搜索角色');
    const toolbar = el('div', 'library-toolbar'); toolbar.append(search);
    const cards = el('div', 'character-files display-character-files'); body.append(toolbar, cards);
    const render = () => {
        cards.replaceChildren();
        const query = search.value.trim().toLocaleLowerCase();
        for (const card of characters.filter(card => card.name.toLocaleLowerCase().includes(query))) {
            const file = el('article', 'character-file');
            const cover = action(`进入 ${card.name} 最新聊天`, async () => { assertSaved(); if (await closePanel()) await openCharacter(card.avatar, { latest: true }); }, null, 'card-cover');
            cover.setAttribute('aria-label', `进入 ${card.name} 最新聊天`); cover.append(image(card.avatar, 'avatar', true));
            const info = el('div', 'card-info'); info.append(el('h3', '', card.name));
            file.append(cover, info); cards.append(file);
        }
        if (!cards.children.length) note(cards, characters.length ? '没有找到匹配的角色卡。' : '原版还没有选择展示的角色卡。');
    };
    search.addEventListener('input', render); render();
}
async function renderCharacterPanel(body, revision, force = false, timing) {
    let library = timing ? timing.measureSync('角色卡 · 整理分类数据', 'data', () => libraryState(state.own.characterLibrary)) : libraryState(state.own.characterLibrary);
    await loadCharacterCatalog(force, timing);
    if (revision !== panelRevision) return;
    const currentAvatar = state.character?.avatar;
    let folder = (currentAvatar && library.assignments[currentAvatar]) || 'unfiled';
    let mode = 'grid'; let page = 0;
    const selected = new Set();
    const toolbar = el('div', 'library-toolbar');
    const search = el('input', 'library-search'); search.type = 'search'; search.placeholder = '搜索角色名称…'; search.setAttribute('aria-label', '搜索角色');
    const sort = el('select'); sort.setAttribute('aria-label', '角色排序');
    for (const [value, label] of [['name', '名称排序'], ['recent', '最近创建']]) { const option = el('option', '', label); option.value = value; sort.append(option); }
    const sticky = el('div', 'character-library-sticky');
    const tools = el('div', 'character-library-tools'); tools.id = `character-library-tools-${uuid()}`; tools.hidden = true;
    tools.setAttribute('role', 'group'); tools.setAttribute('aria-label', '角色卡工具');
    const setToolsOpen = open => { tools.hidden = !open; more.setAttribute('aria-expanded', String(open)); };
    const more = action('更多角色卡操作', () => setToolsOpen(tools.hidden), 'more', 'icon-button');
    more.title = '更多角色卡操作'; more.setAttribute('aria-label', more.title);
    more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-controls', tools.id);
    const create = action('新建角色', () => { setToolsOpen(false); return characterEditor(null); }, 'plus', 'icon-button');
    const importButton = action('导入角色', () => { setToolsOpen(false); more.focus(); return importCharacter(); }, 'import', 'icon-button');
    const createFolder = action('新建分类', () => { setToolsOpen(false); editFolder(null, more); }, 'folderPlus', 'icon-button');
    for (const button of [more, create, importButton, createFolder]) {
        button.title = button.textContent.trim();
        button.setAttribute('aria-label', button.title);
        button.querySelector('span').remove();
    }
    sticky.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || tools.hidden || (!tools.contains(event.target) && event.target !== more)) return;
        event.preventDefault(); event.stopPropagation(); setToolsOpen(false); more.focus();
    });
    toolbar.append(search, more);
    tools.append(sort, create, importButton, createFolder);
    const sidebar = el('aside', 'character-library-categories'); sidebar.setAttribute('aria-label', '角色分类');
    const categoryRow = el('div', 'character-library-category-row');
    const category = el('select'); category.setAttribute('aria-label', '角色分类');
    category.addEventListener('change', () => {
        const id = category.value;
        chooseFolder(library.folders.find(item => String(item.id) === id)?.id ?? 'unfiled');
    });
    const folderTabs = el('div', 'character-library-folder-manager'); folderTabs.hidden = true;
    folderTabs.id = `library-folder-manager-${uuid()}`;
    const folderToggle = action('管理分类', () => {
        folderTabs.hidden = !folderTabs.hidden;
        folderToggle.setAttribute('aria-expanded', String(!folderTabs.hidden));
    }, 'more', 'icon-button');
    folderToggle.querySelector('span').remove();
    folderToggle.title = '管理分类'; folderToggle.setAttribute('aria-label', folderToggle.title);
    folderToggle.setAttribute('aria-controls', folderTabs.id); folderToggle.setAttribute('aria-expanded', 'false');
    categoryRow.append(category, folderToggle); sidebar.append(categoryRow, folderTabs);
    sticky.append(toolbar, tools, sidebar); body.append(sticky);
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
    content.append(breadcrumb, cards, pager);
    body.append(content);
    async function persist(transform) {
        state.settings = await api.patchSettings(settings => {
            const own = settingsOwn(settings); own.characterLibrary = transform(own.characterLibrary);
        });
        state.own = state.settings.independent_frontend;
        if (revision !== panelRevision) return;
        library = libraryState(state.own.characterLibrary); if (!['all', 'unfiled'].includes(folder) && !library.folders.some(item => item.id === folder)) folder = 'unfiled'; renderFolders(); renderCards();
    }
    function editFolder(id, returnFocus) {
        const value = library.folders.find(item => item.id === id)?.name || '';
        editName({ title: id ? '修改分类名称' : '新建分类', label: '分类名称', value, maxLength: 40, returnFocus, save: async text => {
            if (id && text === value) return;
            const existing = library.folders.find(item => item.name.trim().toLocaleLowerCase() === text.toLocaleLowerCase());
            const target = id || existing?.id || uuid();
            await persist(raw => {
                if (id) return renameFolder(raw, target, text);
                const next = libraryState(raw);
                return next.folders.some(item => item.id === target) ? next : addFolder(raw, target, text);
            });
            if (revision !== panelRevision) return;
            chooseFolder(target); notify('分类已保存');
        } });
    }
    function chooseFolder(id) { folder = id; page = 0; selected.clear(); renderFolders(); renderCards(); }
    function renderFolders() {
        const options = [['unfiled', '未分类'], ...library.folders.map(item => [item.id, item.name])];
        category.replaceChildren(...options.map(([id, label]) => {
            const total = filterCards(state.characters, library, id).length;
            const option = el('option', '', `${label}（${total}）`);
            option.value = id;
            return option;
        }));
        category.value = folder;
        category.disabled = options.length < 2;
        folderToggle.disabled = !library.folders.length;
        if (folderToggle.disabled) { folderTabs.hidden = true; folderToggle.setAttribute('aria-expanded', 'false'); }
        folderTabs.replaceChildren();
        for (const { id, name: label } of library.folders) {
            const row = el('div', 'folder-row');
            const button = action(label, () => chooseFolder(id), 'folder', 'folder-button'); button.draggable = false;
            button.classList.toggle('active', folder === id); button.setAttribute('aria-pressed', String(folder === id));
            const count = el('small', 'folder-count', String(filterCards(state.characters, library, id).length));
            button.append(count); row.append(button);
            const rename = action(`重命名 ${label}`, () => { folderTabs.hidden = true; folderToggle.setAttribute('aria-expanded', 'false'); editFolder(id, folderToggle); }, 'edit', 'folder-edit'); rename.title = '重命名分类'; rename.setAttribute('aria-label', `重命名分类 ${label}`);
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
            row.addEventListener('dragover', event => { event.preventDefault(); row.classList.add('drop-target'); });
            row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
            row.addEventListener('drop', event => {
                event.preventDefault(); row.classList.remove('drop-target');
                let values; try { values = JSON.parse(event.dataTransfer.getData('application/x-tavern-cards')); } catch { return; }
                if (!Array.isArray(values) || !values.every(avatar => state.characters.some(card => card.avatar === avatar))) return;
                void run(async () => { await persist(raw => moveCards(raw, values, id)); selected.clear(); renderCards(); notify('角色已移动'); });
            });
            folderTabs.append(row);
        }
        const value = destination.value;
        destination.replaceChildren();
        for (const [id, label] of [['', '未分类'], ...library.folders.map(item => [item.id, item.name])]) { const option = el('option', '', label); option.value = id; destination.append(option); }
        if ([...destination.options].some(option => option.value === value)) destination.value = value;
    }
    function renderCards() { return timing ? timing.measureSync('角色卡 · 构建卡片列表', 'data', renderCardsContent, () => ({ metrics: { renderedItems: cards.children.length } })) : renderCardsContent(); }
    function renderCardsContent() {
        const searching = !!search.value.trim();
        const filter = () => filterCards(state.characters || [], library, searching ? 'all' : folder, search.value, sort.value);
        const found = timing ? timing.measureSync('角色卡 · 筛选与排序', 'data', filter, value => ({ metrics: { totalItems: (state.characters || []).length, renderedItems: value.length } })) : filter();
        const currentIndex = found.findIndex(card => card.avatar === currentAvatar);
        if (currentIndex > 0) found.unshift(...found.splice(currentIndex, 1));
        const pages = Math.max(1, Math.ceil(found.length / 60)); page = Math.min(page, pages - 1);
        const visible = found.slice(page * 60, (page + 1) * 60);
        path.textContent = `角色卡 / ${searching ? '全部分类搜索' : folder === 'unfiled' ? '未分类' : library.folders.find(item => item.id === folder)?.name || ''} · ${found.length}`;
        cards.classList.toggle('list-view', mode === 'list');
        grid.setAttribute('aria-pressed', String(mode === 'grid')); listView.setAttribute('aria-pressed', String(mode === 'list'));
        cards.replaceChildren();
        for (const card of visible) {
            const file = el('article', 'character-file'); file.classList.toggle('selected', selected.has(card.avatar)); file.draggable = true;
            file.classList.toggle('current-character', card.avatar === currentAvatar);
            file.addEventListener('dragstart', event => { const values = selected.has(card.avatar) ? [...selected] : [card.avatar]; event.dataTransfer.setData('application/x-tavern-cards', JSON.stringify(values)); event.dataTransfer.effectAllowed = 'move'; });
            const selection = el('input', 'card-selection'); selection.type = 'checkbox'; selection.checked = selected.has(card.avatar); selection.setAttribute('aria-label', `选择角色 ${card.name}`);
            selection.addEventListener('change', () => { if (selection.checked) selected.add(card.avatar); else selected.delete(card.avatar); file.classList.toggle('selected', selection.checked); updateSelection(); });
            const enterChat = async () => { assertSaved(); if (await closePanel()) await openCharacter(card.avatar, { latest: true }); };
            const cover = action(`进入 ${card.name} 最新聊天`, enterChat, null, 'card-cover'); cover.append(image(card.avatar, 'avatar', true));
            cover.setAttribute('aria-label', `进入 ${card.name} 最新聊天`); cover.title = '进入最新聊天';
            const info = el('div', 'card-info');
            info.append(el('h3', '', card.name), el('small', 'card-category', library.folders.find(item => item.id === library.assignments[card.avatar])?.name || '未分类'));
            const actions = el('div', 'card-actions');
            const world = action('世界书', () => openCharacterWorld(card.avatar), 'book', 'card-world-action');
            installWorldBindingGesture(world, () => run(() => manageCharacterWorld(card, world)));
            actions.append(action('聊天', enterChat, 'chat'), action('编辑', () => characterEditor(card.avatar), 'edit'), world);
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
                if (state.bundle.displayTavern === 'owner') {
                    try { await api.post('/api/plugins/st-new-updater/display-card', { avatar: card.avatar, enabled: false }); }
                    catch (error) { notify(`原版角色卡已删除，撤下展示失败：${error.message}`, true); }
                }
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

async function renderDisplayCardControl(container, avatar) {
    const route = '/api/plugins/st-new-updater/display-card';
    const status = el('p', 'note', '正在读取展示状态…'); status.setAttribute('role', 'status');
    const controls = el('div', 'persona-editor-actions');
    container.append(status, controls);
    const refresh = async (enabled, announce = false) => {
        const current = await api.post(route, { avatar, enabled });
        status.textContent = current.enabled ? '已在展示版展示' : current.available ? '未在展示版展示' : '设置展示密码后，即可选择要展示的角色卡。';
        controls.replaceChildren();
        const change = (label, value, glyph) => action(label, async () => {
            assertSaved();
            if (panelDirty) throw new Error('请先保存角色卡，再更新展示设置。');
            if (value && !current.enabled && !confirm('向展示版共享这张角色卡及卡内嵌内容？')) return;
            for (const button of controls.children) button.disabled = true;
            try { await refresh(value, true); }
            finally { for (const button of controls.children) button.disabled = false; }
        }, glyph);
        if (current.enabled) controls.append(change('撤下展示', false, 'eyeOff'));
        if (current.available) controls.append(change(current.enabled ? '更新展示副本' : '在展示版展示', true, 'eye'));
        else controls.append(action('设置展示密码', displayPasswordPanel));
        if (announce) notify(enabled ? '展示版角色卡已保存' : '角色卡已从展示版撤下');
    };
    try { await refresh(); }
    catch (error) {
        status.textContent = `展示状态读取失败：${error.message}`;
        controls.append(action('重试', () => { container.replaceChildren(); return renderDisplayCardControl(container, avatar); }, 'refresh'));
    }
}

async function displayPasswordPanel() {
    const body = await showPanel('展示密码', ''); if (!body) return;
    if (state.bundle.displayTavern !== 'owner' && !state.bundle.needsPrimaryPassword) {
        note(body, '当前运行的酒馆未启用展示密码功能。请确认 Termux 已加载新版更新插件，再重启酒馆。', true);
        return;
    }
    note(body, `登录时仍填写用户名 ${state.bundle.account}。填写原版密码进入原版，填写展示密码进入展示版。`);
    const form = el('form'); form.method = 'post'; body.append(form);
    let primary;
    if (state.bundle.needsPrimaryPassword) {
        primary = field(form, '新原版密码', '', { type: 'password' });
        primary.required = true;
        primary.autocomplete = 'new-password';
    }
    const password = field(form, '新展示密码', '', { type: 'password' });
    password.required = true;
    password.autocomplete = 'new-password';
    const save = el('button', 'button primary', '保存展示密码'); save.type = 'submit'; form.append(save);
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (save.disabled) return;
        save.disabled = true;
        void run(async () => {
            try {
                if (!password.value.trim()) throw Error('请输入展示密码。');
                if (primary) {
                    if (!primary.value.trim()) throw Error('请输入原版密码。');
                    if (primary.value.normalize() === password.value.normalize()) throw Error('两个密码必须不同。');
                    await api.post('/api/users/change-password', { handle: state.bundle.account, oldPassword: '', newPassword: primary.value });
                    primary.value = '';
                    primary.parentElement.hidden = true;
                    primary.disabled = true;
                    primary = null;
                    state.bundle.needsPrimaryPassword = false;
                    state.bundle.displayTavern = 'owner';
                }
                await api.post('/api/plugins/st-new-updater/display-password', { password: password.value });
                password.value = '';
                panelDirty = false;
                notify('展示密码已保存');
                await closePanel();
            } finally { save.disabled = false; }
        });
    });
}

async function characterEditor(avatar = state.character?.avatar) {
    const body = await showPanel(avatar ? '编辑角色卡' : '新建角色', '角色资料'); if (!body) return;
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
        note(body, `关联世界书：${card.extensions?.world || (hasEmbeddedWorld(card) ? '内嵌世界书（尚未提取）' : '未关联')}`);
        if (card.extensions?.world || hasEmbeddedWorld(card)) body.append(action('查看角色世界书', async () => {
            if (panelDirty && !confirm('放弃未保存的角色修改并查看世界书？')) return;
            panelDirty = false; await openCharacterWorld(editing.avatar);
        }, 'book'));
        if (state.bundle.displayTavern === 'owner') {
            const display = el('section'); display.setAttribute('aria-label', '展示版'); body.append(display);
            void renderDisplayCardControl(display, avatar);
        }
    }
    let avatarFile = null;
    const portrait = el('div', 'character-portrait'); const portraitImage = editing ? image(editing.avatar, 'avatar', true) : el('img'); portraitImage.alt = '角色图片'; portraitImage.hidden = !editing;
    const upload = action('导入图片', async () => {
        const file = await pickFile('image/*'); if (!file) return;
        avatarFile = file; const url = URL.createObjectURL(file); portraitImage.onload = () => URL.revokeObjectURL(url); portraitImage.src = url; portraitImage.hidden = false; upload.classList.add('has-avatar'); panelDirty = true;
    }, 'import', 'persona-avatar-upload'); upload.title = '点击更换图片'; upload.setAttribute('aria-label', '导入角色图片'); upload.classList.toggle('has-avatar', !!editing); upload.prepend(portraitImage); portrait.append(upload); body.prepend(portrait);
    const name = field(body, '名称', card.name || '');
    const folders = libraryState(state.own.characterLibrary);
    const category = field(body, '分类', editing ? folders.assignments[editing.avatar] || '' : '', { options: [['', '未分类'], ...folders.folders.map(folder => [folder.id, folder.name])] });
    const description = field(body, '描述', card.description || '', { multiline: true });
    const first = field(body, '开场白', card.first_mes || '', { multiline: true });
    const alternatives = el('div', 'alternate-greetings'); body.append(alternatives);
    const greetingInputs = [];
    function addGreeting(value = '') {
        const row = el('div'); alternatives.append(row);
        const input = field(row, '备用开场白', value, { multiline: true });
        greetingInputs.push(input);
        row.append(action('删除此开场白', () => { greetingInputs.splice(greetingInputs.indexOf(input), 1); row.remove(); panelDirty = true; }, 'trash', 'danger'));
    }
    for (const value of Array.isArray(card.alternate_greetings) ? card.alternate_greetings : []) addGreeting(value);
    body.append(action('添加备用开场白', () => { addGreeting(); panelDirty = true; }, 'plus'));
    const footer = el('div', 'editor-footer'); body.append(footer);
    footer.append(action('保存', async () => {
        assertSaved(); if (!name.value.trim()) throw new Error('请输入角色名称。');
        const data = { name: name.value.trim(), description: description.value, first_mes: first.value, alternate_greetings: greetingInputs.map(input => input.value) };
        let savedAvatar;
        if (editing) {
            await api.post('/api/characters/merge-attributes', { avatar: editing.avatar, ...data, data });
            if (avatarFile) { const form = new FormData(); form.append('avatar', avatarFile); form.append('avatar_url', editing.avatar); await api.post('/api/characters/edit-avatar', form, { form: true }); avatarRevisions.set(editing.avatar, Date.now()); }
            editing = await api.post('/api/characters/get', { avatar_url: editing.avatar });
            if (editing.name !== data.name) throw Error('角色名称保存后核验失败，请重新打开角色卡再试。');
            savedAvatar = editing.avatar;
            if (state.character?.avatar === editing.avatar) state.character = editing;
        } else {
            const payload = { ch_name: data.name, description: data.description, first_mes: data.first_mes };
            if (avatarFile) { const form = new FormData(); for (const [key, value] of Object.entries(payload)) form.append(key, value); form.append('avatar', avatarFile); savedAvatar = await api.post('/api/characters/create', form, { form: true }); }
            else savedAvatar = await api.post('/api/characters/create', payload);
            if (typeof savedAvatar !== 'string' || !savedAvatar.endsWith('.png')) throw new Error('创建角色失败。');
            await api.post('/api/characters/merge-attributes', { avatar: savedAvatar, data: { alternate_greetings: data.alternate_greetings } });
            editing = await api.post('/api/characters/get', { avatar_url: savedAvatar });
        }
        state.settings = await api.patchSettings(settings => { const own = settingsOwn(settings); own.characterLibrary = moveCards(own.characterLibrary, [savedAvatar], category.value); }); state.own = state.settings.independent_frontend;
        avatarFile = null;
        characterCatalog.invalidate(); state.characters = [...state.characters.filter(item => item.avatar !== savedAvatar), { ...editing, avatar: savedAvatar }];
        const recentKey = homeRecentCacheKey();
        if (recentKey) try {
            const recent = JSON.parse(sessionStorage.getItem(recentKey) || 'null');
            if (Array.isArray(recent)) sessionStorage.setItem(recentKey, JSON.stringify(recent.map(chat => chat.avatar === savedAvatar ? { ...chat, characterName: editing.name } : chat)));
        } catch { /* The live home list still uses the saved card. */ }
        $('message-list').querySelector('.welcome')?.dispatchEvent(new Event('character-name-updated'));
        panelDirty = false; synchronize(); notify('角色已保存');
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
async function importCharacter() {
    assertSaved(); const file = await pickFile('.png,.json,.charx,.yaml,.yml'); if (!file) return;
    const data = new FormData(); data.append('avatar', file); data.append('file_type', file.name.split('.').at(-1).toLowerCase());
    const result = await api.post('/api/characters/import', data, { form: true });
    if (!result?.file_name) throw new Error('导入失败，请检查角色卡格式。');
    const avatar = result.file_name.endsWith('.png') ? result.file_name : result.file_name + '.png';
    let worldResult;
    try { worldResult = await importCharacterWorld(api, avatar, safeName); }
    catch (error) { notify(`角色卡已导入，但世界书提取失败：${error.message}。可在世界书页面补导入。`, true); }
    if (Object.hasOwn(libraryState(state.own.characterLibrary).assignments, avatar)) {
        state.settings = await api.patchSettings(settings => {
            const own = settingsOwn(settings);
            own.characterLibrary = moveCards(own.characterLibrary, [avatar], '');
        });
        state.own = settingsOwn(state.settings);
    }
    characterCatalog.invalidate(); await loadCharacterCatalog(true); panelDirty = false; await closePanel();
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
    const host = await showPanel('用户设定', '', 'personas-panel', personasPanel); if (!host) return;
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
    const add = action('新增用户设定', () => personaEditor(), 'plus', 'primary persona-add');
    add.title = '新增用户设定'; add.setAttribute('aria-label', '新增用户设定'); toolbar.append(add); body.append(toolbar);
    const rows = el('div', 'persona-list'); rows.setAttribute('role', 'radiogroup'); rows.setAttribute('aria-label', '用户设定'); body.append(rows);
    for (const avatar of available) {
        const name = power.personas?.[avatar] || (avatar === state.settings.user_avatar ? state.settings.username : avatar), data = power.persona_descriptions?.[avatar] || {};
        const row = el('article', 'persona-row');
        const select = action(`选择 ${name}`, async () => { assertIdle(); const oldPersona = state.own.persona; state.own.persona = avatar; for (const item of rows.querySelectorAll('.persona-row')) { const active = item === row; item.querySelector('[role=radio]')?.setAttribute('aria-checked', String(active)); item.querySelector('.prompt-kind')?.remove(); if (active) item.querySelector('h2').append(el('small', 'prompt-kind', '当前')); } try { await saveOwn({ persona: avatar }); } catch (error) { state.own.persona = oldPersona; panelDirty = false; await personasPanel(); throw error; } }, null, 'persona-select');
        select.setAttribute('role', 'radio'); select.setAttribute('aria-checked', String(persona().avatar === avatar)); select.setAttribute('aria-label', name);
        const portrait = el('div', 'persona-portrait'), img = el('img'); img.src = `/thumbnail?type=persona&file=${encodeURIComponent(avatar)}&v=${avatarRevisions.get(avatar) || 0}`; img.alt = ''; img.loading = 'lazy'; themeDefaultAvatar(img, name); portrait.append(img);
        const info = el('div', 'persona-info'), heading = el('h2', '', name); if (persona().avatar === avatar) heading.append(el('small', 'prompt-kind', '当前')); info.append(heading, el('p', '', data.description || '暂无描述'));
        select.append(portrait, info);
        const actions = el('div', 'persona-actions'), edit = action('编辑', () => personaEditor(avatar), 'edit');
        edit.title = '编辑'; edit.setAttribute('aria-label', `${name}：编辑`); actions.append(edit);
        const duplicate = action('复制', async () => { assertIdle(); const response = await fetch(`/User%20Avatars/${encodeURIComponent(avatar)}?v=${avatarRevisions.get(avatar) || 0}`); if (!response.ok) throw new Error('无法读取头像'); const form = new FormData(); form.append('avatar', await response.blob(), 'persona.png'); form.append('overwrite_name', `persona-${uuid()}.png`); const uploaded = await api.post('/api/avatars/upload', form, { form: true }); if (!uploaded.path) throw new Error('复制头像失败'); state.settings = await api.patchSettings(settings => { const power = settings.power_user ||= {}; (power.personas ||= {})[uploaded.path] = `${name} 副本`; (power.persona_descriptions ||= {})[uploaded.path] = copy(data); }); await personasPanel(); }, 'copy');
        const remove = action('删除', async () => { assertIdle(); if (!confirm(`删除用户设定「${name}」？`)) return; await api.post('/api/avatars/delete', { avatar }); state.settings = await api.patchSettings(settings => { delete settings.power_user?.personas?.[avatar]; delete settings.power_user?.persona_descriptions?.[avatar]; if (settingsOwn(settings).persona === avatar) delete settingsOwn(settings).persona; }); await personasPanel(); }, 'trash', 'danger');
        for (const [button, label] of [[duplicate, '复制'], [remove, '删除']]) { button.title = label; button.setAttribute('aria-label', `${name}：${label}`); actions.append(button); }
        row.append(select, actions); rows.append(row);
    }
    if (!available.length) rows.append(el('p', 'note', '暂无用户设定，点击右上角新增。'));
}

async function personaEditor(avatar = null) {
    const body = await showPanel(avatar ? '编辑用户设定' : '新增用户设定', '身份资料'); if (!body) return;
    const power = state.settings.power_user || {}, saved = power.persona_descriptions?.[avatar] || {};
    let avatarFile = null;
    const portrait = el('div', 'character-portrait'), img = el('img'); themeDefaultAvatar(img, power.personas?.[avatar] || state.settings.username); img.alt = '用户头像'; img.hidden = !avatar; if (avatar) img.src = `/User%20Avatars/${encodeURIComponent(avatar)}?v=${avatarRevisions.get(avatar) || 0}`;
    const upload = action('导入头像', async () => { const file = await pickFile('image/*'); if (!file) return; avatarFile = file; const url = URL.createObjectURL(file); img.onload = () => URL.revokeObjectURL(url); img.src = url; img.hidden = false; upload.classList.add('has-avatar'); panelDirty = true; }, 'import', 'persona-avatar-upload');
    upload.title = '点击更换头像'; upload.setAttribute('aria-label', '导入头像'); upload.classList.toggle('has-avatar', !!avatar); upload.prepend(img); portrait.append(upload); body.append(portrait);
    const name = field(body, '名称', avatar ? power.personas?.[avatar] || state.settings.username || '' : '');
    const nameError = el('small', 'persona-name-error'); nameError.hidden = true; nameError.id = `persona-name-error-${uuid()}`; nameError.setAttribute('role', 'alert'); name.setAttribute('aria-describedby', nameError.id); name.parentElement.append(nameError);
    name.addEventListener('input', () => { if (name.value.trim()) { nameError.hidden = true; name.removeAttribute('aria-invalid'); } });
    const description = field(body, '描述', saved.description || '', { multiline: true, rows: 8 });
    const footer = el('div', 'editor-footer'); body.append(footer);
    footer.append(action('保存', async () => {
        assertIdle(); if (!name.value.trim()) { nameError.textContent = '请输入名称'; nameError.hidden = false; name.setAttribute('aria-invalid', 'true'); name.focus(); name.scrollIntoView({ block: 'nearest' }); return; }
        if (!avatar || avatarFile) {
            let blob = avatarFile;
            if (!blob) {
                const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; const ctx = canvas.getContext('2d');
                const theme = getComputedStyle(document.documentElement);
                ctx.fillStyle = theme.getPropertyValue('--soft').trim();
                ctx.fillRect(0, 0, 256, 256);
                ctx.fillStyle = theme.getPropertyValue('--green').trim(); ctx.font = '112px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText([...name.value.trim()][0], 128, 132);
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
    footer.append(action('取消', () => { panelDirty = false; return personasPanel(); }));
    if (!avatar) name.focus();
}

function manageCharacterWorld(card, trigger) {
    const panel = $('panel');
    if (panel.querySelector(':scope > .world-binding-dialog[open]')) return;
    const { avatar } = card;
    const fresh = () => ({ signal: AbortSignal.timeout(15000) });
    let disableEmbedded = false;
    showWorldBindingDialog({
        panel, trigger, characterName: card.name, el, action,
        load: async () => {
            const [character, worlds] = await Promise.all([
                api.post('/api/characters/get', { avatar_url: avatar }, fresh()),
                api.post('/api/worldinfo/list', {}, fresh()),
            ]);
            disableEmbedded = hasEmbeddedWorld(character.data || character);
            return { character, worlds };
        },
        save: async name => {
            if (name) {
                const worlds = await api.post('/api/worldinfo/list', {}, fresh());
                if (!worlds.some(book => book.file_id === name)) throw new Error('这本世界书已不存在，请重新打开弹窗后选择。');
            }
            assertIdle();
            const character = await saveCharacterWorldBinding(api, avatar, name, { disableEmbedded: !name && disableEmbedded });
            if (state.character?.avatar === avatar) {
                state.character = character;
                generationPreload.invalidate();
                synchronizeScriptRuntime();
            }
            notify(name ? '世界书绑定已保存' : '世界书已解绑');
        },
    });
}

async function openCharacterWorld(avatar) {
    assertIdle();
    let character = await api.post('/api/characters/get', { avatar_url: avatar });
    let card = character.data || character;
    if (!card.extensions?.world && !hasEmbeddedWorld(card)) throw new Error('这个角色没有关联世界书。长按世界书按钮可以绑定。');
    if (hasEmbeddedWorld(card)) {
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
    const host = await showPanel('世界书', '', '', worldsPanel); if (!host) return;
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
    let editVersion = 0;
    const markDirty = () => { editVersion++; panelDirty = true; };
    const globalSection = el('div', 'global-world-section'); body.append(globalSection);
    const buildSelection = () => renderGlobalWorldSelect(globalSection, worlds, globals, { el, icon, changed: markDirty });
    if (timing) timing.measureSync('世界书 · 构建全局选择器', 'data', buildSelection, () => ({ metrics: { totalItems: worlds.length } })); else buildSelection();
    const globalSettings = el('details', 'advanced world-global-settings'); globalSettings.append(el('summary', '', '世界书全局设置'));
    const globalDraft = copy(state.settings.world_info_settings || {}), globalGrid = el('div', 'parameter-grid'); globalSettings.append(globalGrid);
    for (const [key, label, fallback, min, max] of worldSettingsFields) {
        const control = field(globalGrid, label, globalDraft[key] ?? fallback, { type: 'number' }); control.min = min; control.max = max; control.step = 1;
        control.addEventListener('input', () => { globalDraft[key] = control.value === '' ? NaN : Number(control.value); markDirty(); });
    }
    for (const [key, label] of [['world_info_recursive', '启用递归扫描'], ['world_info_case_sensitive', '区分大小写'], ['world_info_match_whole_words', '匹配完整单词']]) {
        const wrap = el('label', 'check-field'), control = el('input'); control.type = 'checkbox'; control.checked = !!globalDraft[key];
        control.addEventListener('change', () => { globalDraft[key] = control.checked; markDirty(); }); wrap.append(control, el('span', '', label)); globalSettings.append(wrap);
    }
    globalSection.append(globalSettings);
    const saveGlobals = async (config = validateWorldSettings(globalDraft), selection = [...globals]) => {
        state.settings = await api.patchSettings(settings => {
            const wi = settings.world_info_settings ||= {};
            for (const [key] of worldSettingsFields) if (key in config) wi[key] = config[key];
            for (const key of ['world_info_recursive', 'world_info_case_sensitive', 'world_info_match_whole_words']) if (key in config) wi[key] = config[key];
            (wi.world_info ||= {}).globalSelect = selection;
            delete settingsOwn(settings).worlds;
        });
        state.own = state.settings.independent_frontend;
    };
    const ivory = document.documentElement.dataset.palette === 'ivory-cards';
    const bar = el('div', 'connection-profile-bar');
    if (ivory) {
        const toolbar = el('div', 'world-book-toolbar');
        toolbar.append(bar); body.append(toolbar);
    } else body.append(bar);
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
    body._dispose = () => { entries._dispose?.(); entries.querySelector(':scope > .panel-content')?._dispose?.(); };
    const dirty = () => { bookDirty = true; markDirty(); };
    const render = (target = entries, trace = timing) => {
        const build = () => renderWorldEntries(target, draft, { el, field, action, dirty, icon, countTokens: async text => { const result = await api.post(`/api/tokenizers/openai/count?model=${encodeURIComponent(connection().model)}`, [{ role: 'system', content: text }]); return result.token_count; } });
        return trace ? trace.measureSync('世界书 · 构建条目列表', 'data', build, () => ({ metrics: { entryCount: Object.keys(draft.entries || {}).length } })) : build();
    };
    const button = (label, callback, glyph, className = '') => { const control = action(label, callback, glyph, className); control.title = label; control.setAttribute('aria-label', label); tools.append(control); return control; };
    const rename = button('修改世界书名称', () => editName({ title: '修改世界书名称', label: '世界书名称', value: name.value,
        returnFocus: tools.querySelector('[aria-expanded]') || rename, save: value => {
            if (value === name.value) return;
            name.value = value; dirty();
            select.options[select.selectedIndex].textContent = `${value}（未保存）`;
        } }), 'edit');
    let draftOption;
    const selectWorldDraft = title => {
        if (!draftOption) {
            draftOption = el('option'); draftOption.value = '__draft__'; select.append(draftOption);
        }
        draftOption.textContent = `${title}（未保存）`;
        select.value = draftOption.value;
    };
    const nameNewWorld = (title, suggestedName, data, trigger, message) => editName({
        title, label: '世界书名称', value: uniquePresetName(suggestedName, worlds.map(book => book.file_id)), message,
        returnFocus: tools.querySelector('[aria-expanded]') || trigger,
        save: next => {
            bookRequest++;
            panelLoads.delete(entries); entries.removeAttribute('aria-busy');
            body._dispose();
            draft = data; original = ''; savedBookName = undefined; name.value = next;
            selectWorldDraft(next); previous = select.value;
            remove.disabled = true; copyWorld.disabled = false;
            dirty(); render(entries, null);
        },
    });
    const addWorld = button('新增世界书', () => nameNewWorld('新增世界书', '新世界书', { entries: {} }, addWorld,
        bookDirty ? '确认后将放弃当前世界书未保存的修改。' : ''), 'plus');
    const copyWorld = button('复制世界书', () => nameNewWorld('复制世界书', `${name.value.trim() || '世界书'}（副本）`, worldDraft(draft), copyWorld), 'copy');
    copyWorld.disabled = !original && !initial;
    button('导入世界书', async () => {
        if (panelDirty && !confirm('放弃未保存的修改并导入世界书？')) return;
        const file = await pickFile('.json'); if (!file) return;
        const value = worldDraft(JSON.parse(await file.text())); panelDirty = false; await worldsPanel(file.name.replace(/\.json$/i, ''), value, character);
    }, 'import');
    button('导出世界书', () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
        const link = el('a'); link.href = url; link.download = `${safeName(name.value.trim() || '世界书')}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'export');
    const remove = button('删除世界书', async () => {
        assertIdle(); if (!original) return;
        if (!confirm(`删除世界书「${original}」？关联它的角色或用户设定需要重新选择世界书。`)) return;
        await api.post('/api/worldinfo/delete', { name: original }); globals.delete(original); await saveGlobals();
        panelDirty = false; notify('世界书已删除'); await worldsPanel('', null, character);
    }, 'trash', 'danger'); remove.disabled = !original;
    if (ivory) discloseProfileTools(bar, tools, button, '更多世界书操作', '世界书管理');
    if (initial || !worlds.length) {
        selectWorldDraft(target || '新世界书'); panelDirty = true;
    }
    let previous = select.value, bookRequest = 0;
    let savedBookName;
    select.addEventListener('change', () => run(async () => {
        if (panelDirty && !confirm('放弃未保存的修改并切换世界书？')) { select.value = previous; return; }
        const next = select.value, request = ++bookRequest;
        try {
            body._dispose();
            await loadPanelContent(entries, '世界书条目', async (content, _revision, trace) => {
                const loaded = await api.post('/api/worldinfo/get', { name: next }, { timing: trace });
                if (request !== bookRequest || revision !== panelRevision) return;
                original = next; name.value = next; draft = trace.measureSync('世界书 · 整理条目数据', 'data', () => worldDraft(loaded)); previous = next; bookDirty = false; panelDirty = false; remove.disabled = false; render(content, trace);
                draftOption?.remove(); draftOption = undefined;
                savedBookName = undefined;
            }, () => worldsPanel(next, null, character));
        } catch (error) { if (request === bookRequest) select.value = previous; throw error; }
    }));
    const footer = el('div', 'editor-footer');
    const saveButton = action('保存世界书', async () => {
        assertIdle();
        const config = validateWorldSettings(globalDraft);
        const selection = [...globals];
        const version = editVersion;
        const request = bookRequest;
        saveButton.disabled = true;
        try {
            if (bookDirty) {
                if (!name.value.trim()) throw new Error('请输入世界书名称。');
                const targetName = safeName(name.value.trim());
                const value = worldDraft(draft); value.name = targetName;
                if (targetName !== original && targetName !== savedBookName) {
                    const current = await api.post('/api/worldinfo/list');
                    if (revision !== panelRevision || request !== bookRequest || version !== editVersion) return;
                    if (current.some(book => book.file_id === targetName) && !await confirmAction({
                        title: '覆盖世界书', message: `已存在名为「${targetName}」的世界书，是否覆盖？`, confirmLabel: '覆盖',
                        returnFocus: null,
                    })) { saveButton.disabled = false; saveButton.focus({ preventScroll: true }); return; }
                    if (revision !== panelRevision || request !== bookRequest || version !== editVersion) return;
                }
                await api.post('/api/worldinfo/edit', { name: targetName, data: value });
                if (request === bookRequest) {
                    savedBookName = targetName;
                    if (version === editVersion) bookDirty = false;
                }
            }
            await saveGlobals(config, selection);
            if (revision !== panelRevision || request !== bookRequest || version !== editVersion) return;
            panelDirty = false;
            notify(savedBookName ? '世界书和全局设置已保存' : '世界书全局设置已保存');
            if (savedBookName) await worldsPanel(savedBookName, null, character);
        } finally {
            saveButton.disabled = false;
        }
    }, 'book', 'primary');
    footer.append(saveButton); body.append(footer); render();
}

async function loadBooks(options) {
    const names = new Set(state.settings.world_info_settings?.world_info?.globalSelect ?? state.own.worlds ?? []);
    const card = state.character.data || state.character;
    const linked = card.extensions?.world;
    if (linked) names.add(linked);
    if (persona().world) names.add(persona().world);
    if (names.size) {
        const available = await api.post('/api/worldinfo/list', {}, options);
        if (state.bundle.displayTavern === 'display' && linked && !available.some(book => book.file_id === linked)) names.delete(linked);
        const missing = [...names].filter(name => name && !available.some(book => book.file_id === name));
        if (missing.length) throw new Error(`找不到关联世界书：${missing.join('、')}。请检查名称或导入文件。`);
    }
    const books = await Promise.all([...names].filter(Boolean).map(name => api.post('/api/worldinfo/get', { name }, options)));
    // Native imports can materialize the embedded book into a named world.
    // Prefer that editable named world instead of injecting the same book twice.
    if (hasEmbeddedWorld(card) && !names.has(linked)) {
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
    if (settings.apiMode === 'tavern') {
        const profile = profileStore?.profiles.find(item => item.id === (settings.tavernProfile || settings.profileId));
        if (!profile) throw Error('请选择主 API 渠道');
        const model = Object.hasOwn(settings.tavernModels || {}, profile.id) ? settings.tavernModels[profile.id] : profile.model;
        return { ...profile, model };
    }
 const config=settings.apiConfig;return {source:'custom',url:config.url||'',model:config.model||'',proxyPassword:config.apiKey||'',secretId:'no-key-database',stream:false};
}
async function readConnectionModels(config) {
    const result = await api.post('/api/backends/chat-completions/status', { chat_completion_source: config.source, custom_url: config.url, secret_id: config.secretId });
    return modelOptions(result);
}
async function databaseModels(config) {
 if(!config.url?.trim())throw new Error('请填写 API 基础地址');
 const normalized=normalizeConnection({source:'custom',url:config.url,model:config.model||'model-list',proxyPassword:config.apiKey||''});
 let secretId='no-key-database';if(config.apiKey){const secret=await api.post('/api/secrets/write',{key:'api_key_custom',value:config.apiKey,label:'数据管理'});secretId=secret.id;}
 return readConnectionModels({ ...normalized, secretId });
}
function assertDatabaseWritable() {
    if (state.historySaving) throw new DatabaseWriteError('正在保存聊天记录，请稍候。');
    if (state.databaseHistorySaving) throw new DatabaseWriteError('正在保存历史总结删除，请稍候。');
    if (state.loading) throw new DatabaseWriteError('正在切换聊天，请稍候。');
    assertMessageEditClosed(DatabaseWriteError);
    if (state.dirty && !state.busy) throw new DatabaseWriteError('当前聊天尚未保存，请先重试保存。');
}
function databaseWriteGuard(index, { allowReload = false } = {}) {
    const chat = state.chat, header = state.header, identity = `${state.character?.avatar}/${state.file}`, target = chat[index];
    const source = messages => allowReload
        ? JSON.stringify(messages.slice(0, index + 1).map(message => [
            !!message.is_user, message.name, message.mes || message.message || '', message.send_date, message.swipe_id ?? 0,
        ]))
        : sourceHash(messages, index);
    const originalSource = source(chat);
    const integrity = header.chat_metadata?.integrity;
    const createdAt = header.create_date;
    const snapshot = () => {
        const { seed, history } = state.header.chat_metadata?.independentDatabase || {};
        const archives = Array.isArray(history) ? history.filter(item => item?.index >= 0 && item.index <= index) : [];
        return JSON.stringify([
            seed, archives,
            state.chat.slice(0, index + 1).map(message => [
                message.TavernDB_ACU_Data,
                allowReload ? message.extra?.independentDatabase : message.extra?.independentDatabase?.snapshotDeleted,
            ]),
        ]);
    };
    let original = snapshot();
    return {
        check() {
            assertDatabaseWritable();
            const changed = '聊天或数据库已变化，请重新打开数据库后重试。';
            if (`${state.character?.avatar}/${state.file}` !== identity)
                throw new DatabaseWriteError(changed, '当前聊天已切换');
            if (!allowReload && (state.chat !== chat || state.header !== header))
                throw new DatabaseWriteError(changed, '当前聊天记录或元数据已被替换');
            if (allowReload && variablesSaving)
                throw new DatabaseWriteError('正在保存变量，请稍候。');
            if (allowReload && (!state.header || state.header.chat_metadata?.integrity !== integrity || state.header.create_date !== createdAt))
                throw new DatabaseWriteError(changed, '当前聊天文件的标识已变化');
            const currentTarget = state.chat[index];
            if ((currentTarget !== target && (!allowReload || state.chat === chat)) || (target && !currentTarget)) {
                const reason = currentTarget && state.generation?.reply === currentTarget
                    ? '目标楼层已替换且正在生成' : '目标楼层已替换、移动或删除';
                throw new DatabaseWriteError(changed, reason);
            }
            if (currentTarget && state.generation?.reply === currentTarget)
                throw new DatabaseWriteError('该楼层正在生成，请选择已完成的楼层。', '目标楼层正在生成');
            if (source(state.chat) !== originalSource)
                throw new DatabaseWriteError(changed, '目标楼层或之前的消息已变化');
            if (snapshot() !== original)
                throw new DatabaseWriteError(changed, '写入所依据的数据库快照已变化');
        },
        saved() { original = snapshot(); },
    };
}
async function databasePanel() {
    assertViewable(); if (!state.character) throw new Error('请先打开一个角色的聊天。');
    const current = currentDatabase();
    const body = await showPanel('数据管理', '', 'database-panel'); if (!body) return;
    const identity = `${state.character.avatar}/${state.file}`;
    const chat = state.chat, header = state.header;
    const revision = panelRevision;
    const sameChat = () => { if (state.chat !== chat || state.header !== header || `${state.character?.avatar}/${state.file}` !== identity) throw new Error('聊天已切换，请重新打开数据库。'); };
    const content = el('div', 'panel-content'); body.append(content);
    renderDatabasePanel(content, {
        worlds: databaseWorlds, models: databaseModels, profileModels: profile => readConnectionModels(profile), el, field, apiKeyField, action, icon, notify, pickFile, editName, discloseProfileTools,
        chat, seed: header.chat_metadata?.independentDatabase?.seed,
        settings: current.settings, data: current.data, profiles: profileStore?.profiles || [],
        history: () => header.chat_metadata?.independentDatabase?.history || [],
        getSeed: () => header.chat_metadata?.independentDatabase?.seed,
        deleteHistory: async (ids, expected) => {
            sameChat(); assertDatabaseWritable();
            if (state.databaseController || state.busy) throw new Error('请等待生成或数据库更新完成后再删除历史总结。');
            assertIdle();
            state.databaseHistorySaving = true;
            let saveAttempt;
            try {
                return await deleteDatabaseSummaryHistory(chat, header, ids, expected, () => {
                    const task = saveChat();
                    saveAttempt = state.saves;
                    return task;
                });
            } catch (error) {
                if (saveAttempt && saveAttempt === state.saves) {
                    state.dirty = false;
                    status('数据概览未保存', true);
                    synchronize();
                }
                throw error;
            }
            finally { state.databaseHistorySaving = false; }
        },
        dirty: value => { if (revision === panelRevision) panelDirty = value; }, stop: () => state.databaseController?.abort(),
        saveSettings: async value => {
            sameChat(); const enabling = !state.own.database?.auto && value.auto;
            await saveOwn({ database: databaseSettings(value) });
            sameChat();
            if (enabling) { ((state.header.chat_metadata ||= {}).independentDatabase ||= {}).autoStart = state.chat.length; await saveChat(); }
        },
        fill: async (from, to) => { sameChat(); await updateDatabase(from, to); },
        summarize: async () => { sameChat(); await updateDatabase(0, 0, false, 'database'); },
        countDatabaseTokens: async () => { sameChat(); const latest=currentDatabase(); return databaseTokenCount(latest.data, latest.settings); },
        latest: () => { sameChat(); return currentDatabase(); },
        isUpdating: () => !!state.databaseController,
        isGenerating: () => state.busy,
    });
}
function databaseProgress(message, controller) {
    const notice = el('div', 'database-progress'), text = el('span', '', message);
    notice.setAttribute('role', 'status');
    notice.setAttribute('popover', 'manual');
    const stop = action('终止', () => {
        controller.abort(); stop.disabled = true; text.textContent = '正在终止填表…';
    });
    notice.append(text, stop);
    const panel = $('panel');
    (notice.showPopover || !panel.open ? document.body : panel).append(notice);

    const appbar = document.querySelector('.appbar'), actions = $('top-actions'), viewport = window.visualViewport;
    const position = () => {
        const toolbar = document.documentElement.dataset.palette === 'ivory-cards' ? actions : appbar;
        notice.style.top = `${Math.max(viewport?.offsetTop ?? 0, toolbar.getBoundingClientRect().bottom) + 16}px`;
    };
    const observer = new ResizeObserver(position);
    observer.observe(appbar);
    observer.observe(actions);
    viewport?.addEventListener('resize', position);
    viewport?.addEventListener('scroll', position);
    position();
    notice.showPopover?.();
    return {
        update: value => { text.textContent = value; },
        close: () => {
            observer.disconnect();
            viewport?.removeEventListener('resize', position);
            viewport?.removeEventListener('scroll', position);
            if (notice.matches(':popover-open')) notice.hidePopover();
            notice.remove();
        },
    };
}
async function databaseTokenCount(data, settings) {
    const model = databaseConnection(settings).model || 'gpt-4';
    const result = await api.post(`/api/tokenizers/openai/count?model=${encodeURIComponent(model)}`, [{ role: 'system', content: referenceDatabaseText(data, settings) }]);
    if (!Number.isFinite(result?.token_count) || result.token_count < 0) throw new Error('无法统计数据库 Token，请稍后重试。');
    return result.token_count;
}
async function updateDatabase(from, to, automatic = false, kind = 'message') {
    const log = startDatabaseLog(automatic, kind);
    try {
        const updated = await runDatabaseUpdate(from, to, automatic, kind, log);
        finishDatabaseLog(log, updated ? '成功' : log.status === '已终止' ? '已终止' : '已跳过');
        return updated;
    } catch (error) {
        finishDatabaseLog(log, '失败', error);
        throw error;
    }
}
async function runDatabaseUpdate(from, to, automatic, kind, log) {
    assertDatabaseWritable(); if (!state.character) throw new Error('请先打开聊天。');
    if (state.databaseController) throw new Error('数据库正在更新，请等待完成或终止填表。');
    const summarizing = kind === 'database';
    const current = currentDatabase(), settings = current.settings;
    if (summarizing) {
        to = current.index >= 0 ? current.index : state.chat.findLastIndex(message => !message.is_user && message !== state.generation?.reply);
        from = to;
    }
    log.from = from; log.to = to;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= state.chat.length) throw new Error('请填写有效的起始和结束楼层。');
    const aiIndices=state.chat.map((message,index)=>!message.is_user&&index>=from&&index<=to?index:-1).filter(index=>index>=0);
    if(!aiIndices.length){log.reason='选定范围内没有角色回复';notify('没有消息需要更新', 'info');return false;}
    const rangeStart=from,rangeEnd=to;if(!summarizing){from=Math.max(0,aiIndices[0]-1);if(from>0&&!state.chat[from].is_user&&state.chat[from-1]?.is_user)from--;}to=aiIndices.at(-1);
    log.stage = '校验目标楼层与快照';
    const write = databaseWriteGuard(to, { allowReload: true });
    write.check();
    log.stage = '校验填表连接';
    let config = databaseConnection(settings);
    if (!config) throw new Error('填表连接已删除，请在数据库更新设置中重新选择。');
    config = { ...config, stream: false };
    const preset = { temperature: settings.temperature, top_p: 1, openai_max_tokens: settings.maxTokens, names_behavior: 0 };
    generationBody(config, preset, []);
    log.stage = '准备填表数据';
    const chat = copy(state.chat);
    const baseline = summarizing ? current : findDatabaseSnapshot(chat, state.header, { through: aiIndices[0], structuredOnly: true });
    let result = baseline?.data ? copy(baseline.data) : emptyDatabaseFromTemplate(settings.template);
    const sourceDatabase = summarizing ? JSON.stringify(current.data) : null;
    const previousMeta = current.meta;
    let reference = '', lastResponse, finishRequest, requestText;
    const controller = new AbortController(); state.databaseController = controller;
    const progress=databaseProgress('正在准备填表数据，请稍候…',controller);
    try {
        if (config.proxyPassword && (!config.secretId || config.secretId.startsWith('no-key-'))) {
            log.stage = '注册连接密钥';
            const secret = await api.post('/api/secrets/write', { key: config.source === 'custom' ? 'api_key_custom' : 'api_key_openai', value: config.proxyPassword, label: config.name || '数据库连接' });
            if (!secret.id) throw new Error('数据库连接密钥注册失败。'); config.secretId = secret.id;
            const next = { ...profileStore, profiles: profileStore.profiles.map(profile => profile.id === config.id ? { ...profile, secretId: secret.id } : profile) };
            if(config.id){await api.saveConnections(next); profileStore = next;}
        }
        log.stage = '读取世界书参考';
        const worldConfig=settings.worldbookConfig||{source:'character'};const books=await databaseWorlds(worldConfig);reference=books.filter(book=>worldConfig.source!=='manual'||(worldConfig.manualSelection||[]).includes(book.name)).flatMap(book=>Object.entries(book.entries||{}).filter(([id,entry])=>{const enabled=worldConfig.enabledEntries?.[book.name];return Array.isArray(enabled)?enabled.map(String).includes(String(entry.uid??id)):!entry.disable;}).map(([,entry])=>entry.content||'')).join('\n\n');
        let start = from, batches = 0;
        const updateCounts = { operations: 0, tables: 0 };
        while (start <= to) {
            if (controller.signal.aborted) throw new DOMException('填表已停止', 'AbortError');
            Object.assign(log, { stage: '构建填表请求', batch: batches + 1, httpStatus: undefined,
                format: undefined, responseChars: undefined, finishReason: undefined, parser: undefined });
            let end = to;
            while (end > start && chat[end].is_user) end--;
            if (chat[end].is_user) { end = chat.findIndex((message, index) => index >= start && index <= to && !message.is_user); if (end < start) throw new Error('整理范围内没有角色回复。'); }
            const variables = { char: state.character?.name || '', user: persona().name, description: state.character?.data?.description || '', persona: persona().description, tabledata: referenceDatabaseText(result, settings) };
            for (const [key] of Object.entries(result).filter(([key]) => key.startsWith('sheet_'))) variables[key] = sheetText(result, key);
            const partialTables = new Set();
            const messages = fillMessages({...settings,userName:persona().name}, result, summarizing ? [] : chat, start, end, reference, kind, partialTables).map(message => ({ ...message, content: expand(message.content, variables) }));

            progress.update(summarizing?'正在总结最新数据库…':automatic?'正在总结消息，请稍候…':`正在总结消息，楼层 ${rangeStart}–${rangeEnd}…`);
            log.stage = '请求模型';
            const request = generationBody(config, preset, messages);
            requestText = '';
            finishRequest = requestLog.start('database', request, controller.signal, api);
            const response = await chatGenerationResponse(api, request, controller.signal);
            log.stage = '读取模型响应'; log.httpStatus = response.status;
            let responseBody;
            const readChoice = value => {
                if (value?.error) {
                    log.reason = '模型接口在响应体中返回错误';
                    const message = typeof value.error === 'string' ? value.error : value.error.message || value.message;
                    throw new Error(typeof message === 'string' ? message : '填表失败');
                }
                const choice = value?.choices?.[0];
                if (['stop', 'length', 'content_filter', 'tool_calls', 'function_call'].includes(choice?.finish_reason)) log.finishReason = choice.finish_reason;
                return choice;
            };
            if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
                log.format = 'SSE';
                const onMalformed = raw => {
                    log.reason = '模型接口返回了无法解析的 SSE 数据';
                    retainMalformedDatabaseResponse(log, 'SSE 事件数据', raw);
                };
                for await (const event of readEvents(response, onMalformed)) { const choice = readChoice(event); requestText += choice?.delta?.content || choice?.text || ''; }
            } else {
                log.format = '非流式';
                responseBody = await response.text();
                let value;
                try { value = JSON.parse(responseBody); }
                catch (error) {
                    retainMalformedDatabaseResponse(log, 'HTTP 响应体', responseBody);
                    throw error;
                }
                const choice = readChoice(value);
                requestText = choice?.message?.content || choice?.text || '';
            }
            controller.signal.throwIfAborted();
            const text = requestText;
            finishRequest?.(null, text);
            lastResponse = typeof text === 'string' && (text || responseBody === undefined)
                ? { source: '模型回复', text } : { source: 'HTTP 响应体', text: responseBody };
            log.stage = '解析并应用更新';
            if (typeof text === 'string') log.responseChars = text.length;
            log.parser = {};
            progress.update('正在解析并应用数据库更新…');
            result = parseUpdate(text, result, updateCounts, log.parser, partialTables);
            Object.assign(log, updateCounts);
            start = end + 1; batches++;
        }
        if (controller.signal.aborted) throw new DOMException('填表已停止', 'AbortError');
        log.stage = '复核聊天与快照';
        write.check();
        if (summarizing) {
            const latest = currentDatabase();
            const changed = '最新数据库已变化，请重新总结。';
            if (latest.index !== current.index)
                throw new DatabaseWriteError(changed, '最新数据库快照所在楼层已变化');
            if (JSON.stringify(latest.data) !== sourceDatabase)
                throw new DatabaseWriteError(changed, '最新数据库内容已变化');
        }
        const metadata = summarizing ? { kind, messageSummaryTo: previousMeta?.messageSummaryTo ?? previousMeta?.to ?? current.index, batches } : { kind, from: rangeStart, to, batches };
        log.stage = '校验并写入快照';
        storeDatabase(state.chat, state.header, result, to, metadata);
        if (!summarizing && settings.hideAfterMessageSummary) {
            for (let index = Math.max(rangeStart, from); index <= to; index++) {
                const message = state.chat[index];
                if (message.is_system) continue;
                message.is_system = true;
                list.update(index);
            }
        }
        log.stage = '保存聊天';
        progress.update('正在保存数据库…');await saveChat();
        log.stage = '保存最近聊天设置';
        await rememberChat(); notify(databaseUpdateNotice(updateCounts));
        log.stage = '更新完成';
        return true;
    } catch (error) {
        finishRequest?.(error, requestText);
        if (error.name === 'AbortError') { log.status = '已终止'; notify('填表操作已由用户终止', 'info'); return false; }
        if (log.stage === '解析并应用更新' || (log.stage === '校验并写入快照' && error instanceof DatabaseFormatError)) {
            retainMalformedDatabaseResponse(log, lastResponse.source, lastResponse.text);
        }
        notifyGeneration(`数据库更新失败：${error.message}`, true);
        throw error;
    } finally {
        progress.close();
        state.databaseController = null;
    }
}
async function autoUpdateDatabase() {
 let checkStage, checkIndex;
 try {
  if(state.databaseController || state.busy || state.dirty || state.loading || !state.character || !state.chat.length || state.chat.at(-1)?.is_user)return;
  const settings=currentDatabase().settings;
  if(settings.auto){const range=messageSummaryRange(state.chat,settings,state.header);if(range&&await updateDatabase(range.from,range.to,true)===false)return;}
  if(!settings.databaseSummaryAuto || state.databaseController || state.busy || state.dirty)return;
  const current=currentDatabase();
  if(current.index<0 || current.meta?.kind==='database')return;
  checkIndex=current.index; checkStage='检查自动总结快照';
  const write=databaseWriteGuard(current.index, { allowReload: true });write.check();
  checkStage='统计自动总结 Token';
  const tokens=!databaseSummaryTriggered(settings,current.data,0)&&settings.databaseSummaryTokens>0?await databaseTokenCount(current.data,settings):0;
  checkStage='复核自动总结快照';
  write.check();
  checkStage=undefined;
  if(databaseSummaryTriggered(settings,current.data,tokens))await updateDatabase(0,0,true,'database');
 }catch(error){
  if(checkStage){
   const log=startDatabaseLog(true,'database');
   Object.assign(log,{stage:checkStage,from:checkIndex,to:checkIndex});
   finishDatabaseLog(log,'失败',error);
  }
  notify(`回复已保存，自动填表失败：${error.message}`,true);
 }
}
const tokenCounts = { entries: new Map(), chars: 0, maxEntries: 24, maxChars: 4000000 };
const worldTokenCounts = { entries: new Map(), chars: 0, maxEntries: 32, maxChars: 1000000 };
let lastBudgetHints;
const generationPreload = new GenerationPreload(prepareDatabaseResources);
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
            generationPreload.get(chat, header, state.own.database, { warm: true });
            await nextPaint();
            if (!current()) { finish('cancelled', { reason: 'preload-cancelled', metrics: taskMetrics() }); return; }
            if (chat.length && !chat.at(-1).is_user) generationPreload.get(chat.slice(0, -1), header, state.own.database, { warm: true });
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
async function preparePrompt(chat = state.chat, useBudgetHints = false) {
    if (!state.character) throw new Error('请先选择角色。');
    const books = await loadBooks();
    const resources = loadTimings.measureSync('准备资料库文本与表格宏', 'generation', () => generationPreload.get(chat, state.header, state.own.database));
    const model = connection().model || 'gpt-4';
    const budgetKey = JSON.stringify([scriptIdentity(), model, state.preset.openai_max_context, state.preset.openai_max_tokens, resources.databaseKeywordBudget]);
    const budgetHints = useBudgetHints ? (lastBudgetHints?.key === budgetKey ? { ...lastBudgetHints } : { key: budgetKey }) : undefined;
    const signal = state.controller?.signal;
    const input = {
        character: state.character, persona: persona(), preset: state.preset, chat, settings: state.settings, books, ...resources,
        extensionPrompts: [...scriptRuntime.extensionPrompts.values()],
        mvuSeed: state.header?.chat_metadata?.independentMvuSeed,
        onBuild: () => loadTimings.start('构建提示词与展开宏', 'generation'),
        measureBuild: (label, task, details) => loadTimings.measureSync(label, 'generation', task, details),
        measureKeywordBudget: task => loadTimings.measure('拟合资料库关键词预算', 'generation', task),
        budgetHints,
    };
    const result = await fitPrompt(input, async (messages, category) => {
        signal?.throwIfAborted();
        const cache = category === 'world' ? worldTokenCounts : tokenCounts;
        const { entries } = cache;
        const serializedBody = JSON.stringify(messages);
        const key = model + '\n' + serializedBody;
        if (entries.has(key)) return entries.get(key);
        const result = await api.post(`/api/tokenizers/openai/count?model=${encodeURIComponent(model)}`, messages, { signal, serializedBody });
        if (!Number.isFinite(result?.token_count)) throw new Error('无法统计上下文 tokens，已停止发送。');
        if (key.length < cache.maxChars / 2 && !entries.has(key)) {
            while (entries.size && (entries.size >= cache.maxEntries || cache.chars + key.length > cache.maxChars)) {
                const oldest = entries.keys().next().value;
                cache.chars -= oldest.length;
                entries.delete(oldest);
            }
            entries.set(key, result.token_count);
            cache.chars += key.length;
        }
        return result.token_count;
    });
    if (budgetHints) lastBudgetHints = budgetHints;
    return result;
}

function waitForPageVisibility() {
    if (!document.hidden) return Promise.resolve();
    return new Promise(resolve => {
        const onVisibility = () => {
            if (document.hidden) return;
            document.removeEventListener('visibilitychange', onVisibility);
            resolve();
        };
        document.addEventListener('visibilitychange', onVisibility);
    });
}

function notifyGeneration(message, type) {
    if (!document.hidden) return notify(message, type);
    void waitForPageVisibility().then(() => notify(message, type));
}

function waitForReplyScriptVisibility() {
    status('等待页面恢复可见 · 角色脚本待处理…');
    return loadTimings.measure('助手等待页面恢复可见', 'generation', waitForPageVisibility);
}

function backgroundJobKey() {
    return `st-new-background-generation:${state.settings.username || 'default'}`;
}
function pendingBackgroundJob() {
    try {
        const job = JSON.parse(localStorage.getItem(backgroundJobKey()));
        if (job && /^[a-f0-9]{32}$/.test(job.id) && typeof job.avatar === 'string'
            && typeof job.file === 'string' && /^[a-f0-9]{64}$/.test(job.base)) return job;
    } catch {}
    return null;
}
function forgetBackgroundJob(job) {
    if (pendingBackgroundJob()?.id !== job.id) return;
    try { localStorage.removeItem(backgroundJobKey()); } catch {}
}
function acknowledgeBackgroundJob(job) {
    forgetBackgroundJob(job);
    void releaseBackgroundGeneration(api, job.id).catch(() => {});
}
async function resumeBackgroundChat({ discover = false } = {}) {
    const job = pendingBackgroundJob() || (discover ? await findBackgroundGeneration(api) : null);
    if (!job) return;
    assertSaved();
    const character = state.character?.avatar === job.avatar ? state.character
        : await api.post('/api/characters/get', { avatar_url: job.avatar });
    if (state.character !== character || state.file !== job.file) await loadChat(job.file, false, character);
    await generate(false, job);
}

async function waitToSend(controller, seconds) {
    const { signal } = controller;
    signal.throwIfAborted();
    const onPageHide = () => controller.abort(new DOMException('pagehide', 'AbortError'));
    window.addEventListener('pagehide', onPageHide);
    let timer, onAbort, releaseNativeDelay;
    try {
        await new Promise((resolve, reject) => {
            onAbort = () => reject(signal.reason);
            signal.addEventListener('abort', onAbort, { once: true });
            timer = setTimeout(resolve, seconds * 1000);
            releaseNativeDelay = window.stNewAndroidSendDelay?.(seconds * 1000, resolve);
        });
        signal.throwIfAborted();
        return releaseNativeDelay;
    } catch (error) {
        releaseNativeDelay?.();
        throw error;
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        window.removeEventListener('pagehide', onPageHide);
    }
}

async function outgoingContextTokens(request, prepared, model, signal) {
    if (!request.custom_prompt_post_processing && request.model === model
        && JSON.stringify(request.messages) === JSON.stringify(prepared.messages)) return prepared.tokens;
    const countSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    try {
        const messages = request.custom_prompt_post_processing ? await api.processPrompt(request, countSignal) : request.messages;
        if (Array.isArray(messages)) {
            const result = await api.post(`/api/tokenizers/openai/count?model=${encodeURIComponent(request.model)}`, messages, { signal: countSignal });
            return result?.token_count;
        }
    } catch {
        signal.throwIfAborted();
    }
}

async function generate(mode = false, recovery = null, { delaySend = false, onQueued, confirmContext = false } = {}) {
    assertIdle(); if (state.chatConflict) throw new Error(state.chatConflict);
    if (state.dirty) await saveChat(); assertSaved(); if (!state.character) throw new Error('请先选择角色。');
    if (!recovery && usesBackgroundGeneration() && pendingBackgroundJob()) return resumeBackgroundChat();
    generationPreload.cancelScheduled();
    if (!recovery) {
        if (state.connectionPending) throw new Error('连接正在初始化，请稍候。');
        if (state.connectionError) throw new Error('连接初始化失败，请打开 API 面板检查并保存连接。');
        if (state.presetMissing) throw new Error('保存的预设已不存在，请打开预设面板选择有效预设；不会自动切换到第一个。');
    }
    const regenerate = recovery ? recovery.regenerate === true : mode === true;
    const input = $('message-input');
    const draft = input.value;
    const text = draft.trim();
    const retry = !!recovery || mode === 'retry' || (!regenerate && !text && !!state.chat.at(-1)?.is_user);
    if (!regenerate && !retry && !text) return;
    if (!regenerate && retry && !recovery && !state.chat.at(-1)?.is_user) throw new Error('最后一条消息不是待回复的用户消息。');
    if (regenerate && !recovery && (!state.chat.length || state.chat.at(-1).is_user)) throw new Error('当前没有可重新生成的最后回复。');
    const previousReply = regenerate ? copy(state.chat.at(-1)) : null;
    // Fail local validation before fetching books or running tokenizer requests.
    if (!recovery) generationBody(connection(), state.preset, []);
    const sendStarted = loadTimings.now();
    const finishGeneration = loadTimings.start(regenerate ? '重新生成' : '发送消息', 'generation');
    const sendDelay = delaySend ? sendDelaySeconds(state.own.reading?.sendDelay) : 0;
    const contextLimit = confirmContext && !recovery ? sendTokenLimit(state.own.reading?.sendTokenLimit) : 0;
    let contextDeclined = false;
    const showQueuedUser = delaySend && !regenerate && !retry;
    let waitingToSend = sendDelay > 0;
    let releaseNativeDelay;
    state.busy = true; state.generation = { regenerate, reply: null }; state.controller = new AbortController();
    let user, reply = null; let replyIndex = -1; let pendingUser = false; let userSaved = false; let completed = false;
    let finishFirstText, finishModelResponse, finishRequest;
    let requestStarted, replyReceived, userCardMountedMs;
    let backgroundJob = recovery;
    let resumeLater = false;
    let userSaveBase, rawReplyBase;
    const backgroundSaveSignal = () => backgroundJob ? AbortSignal.timeout(30000) : undefined;
    const acknowledgeReply = () => {
        if (!backgroundJob) return;
        acknowledgeBackgroundJob(backgroundJob);
        backgroundJob = null;
    };
    const appendUser = () => {
        state.chat.push(user);
        pendingUser = true;
        if (state.generation.queuedUser) state.generation.queuedUser = null;
        else { input.value = ''; resizeInput(); }
    };
    const persistUser = async () => {
        appendUser();
        await loadTimings.measure('发送前保存聊天', 'generation', () => saveChat({ incremental: true }));
        userSaved = true;
        userSaveBase = api.chatBase;
    };
    try {
        synchronize({ deferScriptRefresh: delaySend });
        status(regenerate ? '重新生成 · 准备上下文…' : '发送消息 · 准备上下文…');
        user = recovery ? null : { name: persona().name, is_user: true, is_system: false, send_date: new Date().toISOString(), mes: regexText(text, 1, { depth: 0 }), extra: {} };
        const openingVariables = !regenerate && !retry ? sealedOpeningVariables(state.chat, text) : null;
        if (user && openingVariables) user.variables = { 0: openingVariables };
        const requestChat = regenerate ? state.chat.slice(0, -1) : retry ? state.chat : [...state.chat, user];
        setReplyWaiting(recovery ? '正在恢复后台回复' : '正在准备发送');
        if (showQueuedUser) {
            // Show the card without changing the chat snapshot seen by generation_started.
            loadTimings.measureSync('挂载待发送消息卡片', 'generation', () => {
                state.generation.queuedUser = user;
                if (waitingToSend) state.generation.pendingDisplayUser = user;
                input.value = ''; resizeInput();
                list.setMessages(state.chat, { latest: true, appendPreview: true });
            });
            userCardMountedMs = loadTimings.now() - sendStarted;
            onQueued?.();
            if (!document.hidden) {
                const finishPaint = loadTimings.start('待发送消息卡片至下一次绘制机会', 'generation');
                void nextPaint().then(() => finishPaint(document.hidden ? 'cancelled' : 'success'));
            }
        }
        if (waitingToSend) {
            releaseNativeDelay = await loadTimings.measure(`等待发送（${sendDelay} 秒）`, 'generation', () => waitToSend(state.controller, sendDelay));
            waitingToSend = false;
        }
        if (delaySend) synchronizeScriptRuntime();
        if (regenerate) {
            state.hiddenReply = state.chat.at(-1);
            list.setMessages(state.chat, { latest: list.follow });
        }
        let prepared, body;
        if (recovery) {
            const base = api.chatBase;
            if (base?.avatar !== recovery.avatar || base.file !== recovery.file
                || await chatRevision(base.lines) !== recovery.base) {
                acknowledgeReply();
                if (recovery.started && state.chat.some(message => message.gen_started === recovery.started && !message.is_user)) return;
                throw new Error('聊天记录已变动，已跳过后台回复恢复。');
            }
            if (nativeScriptPlan(state.settings, state.character, state.preset).some(script => script.enabled !== false && scriptSupport(script).supported)
                && (!scriptRuntime.frame || scriptRuntime.identity !== scriptIdentity())) {
                try { await openScriptWorkspace(false); }
                catch (error) { notifyGeneration(`恢复回复时无法初始化角色脚本：${error.message}`, true); }
            }
        } else {
            if (nativeScriptPlan(state.settings, state.character, state.preset).some(script => script.enabled !== false && scriptSupport(script).supported)) {
                if (!scriptRuntime.frame || scriptRuntime.identity !== scriptIdentity()) await loadTimings.measure('初始化助手脚本环境', 'generation', () => openScriptWorkspace(false));
                await loadTimings.measure('助手事件 generation_started', 'generation', () => scriptRuntime.dispatch('generation_started', [regenerate ? 'swipe' : 'normal'], scriptSnapshot(state), scriptIdentity()));
            }
            await loadTimings.measure('准备角色变量', 'generation', () => prepareRoleMvu(true));
            if (!regenerate && !retry && scriptRuntime.helperReady) {
                await persistUser();
                state.generation.dispatchingMessageSent = true;
                state.generation.chatBase = userSaveBase;
                try {
                    await loadTimings.measure('助手事件 message_sent', 'generation', () => scriptRuntime.dispatch('message_sent', [state.chat.length - 1], scriptSnapshot(state), scriptIdentity()));
                } finally {
                    userSaveBase = state.generation.chatBase;
                    state.generation.dispatchingMessageSent = false;
                }
                if (state.chatConflict) throw new Error(state.chatConflict);
            }
            prepared = await loadTimings.measure('准备生成上下文', 'generation', () => preparePrompt(requestChat, true));
            body = loadTimings.measureSync('组装模型请求', 'generation', () => generationBody(connection(), state.preset, prepared.messages));
            if (state.controller.signal.aborted) return;
            if (!contextLimit && !regenerate && !retry && !pendingUser) await persistUser();
            if (state.controller.signal.aborted) return;
            if (!contextLimit && usesBackgroundGeneration() && state.chatUnpersisted) await saveChat();
        }
        if (state.controller.signal.aborted) {
            if (recovery) throw state.controller.signal.reason;
            return;
        }
        const addReply = () => {
            if (regenerate) {
                const old = state.chat.at(-1);
                reply = { ...copy(old), mes: '', gen_started: new Date().toISOString(), extra: { ...(old.extra || {}) } };
                delete reply.gen_finished; delete reply.extra.reasoning;
                if (reply.TavernDB_ACU_Data) (reply.extra.independentDatabase ||= {}).stale = true;
                reply.swipes = old.swipes?.length ? [...old.swipes] : [old.mes];
                reply.swipe_info = old.swipe_info ? copy(old.swipe_info) : [{ extra: copy(old.extra || {}) }];
                reply.swipe_id = reply.swipes.length; reply.swipes.push(''); state.chat[state.chat.length - 1] = reply;
            } else { reply = { name: state.character.name, is_user: false, is_system: false, send_date: new Date().toISOString(), mes: '', gen_started: new Date().toISOString(), extra: {} }; state.chat.push(reply); }
            if (recovery?.started) reply.gen_started = recovery.started;
            replyIndex = state.chat.length - 1;
            state.generation.reply = reply;
            state.hiddenReply = reply;
        };
        if (!contextLimit) addReply();
        const controller = state.controller;
        const markWaitingForReply = () => {
            loadTimings.measureSync('请求期间刷新消息列表', 'generation', () => list.setMessages(state.chat, { latest: !showQueuedUser }));
            status(recovery ? '正在恢复后台回复…' : regenerate ? '正在重新生成，等待回复…' : '消息已发送，等待回复…');
        };
        const startModelTimers = () => {
            finishFirstText = loadTimings.start('模型请求至首段文本（含思考）', 'generation');
            finishModelResponse = loadTimings.start('模型请求至回复接收完成', 'generation');
        };
        const fetchReply = async (request, signal) => {
            if (contextLimit) {
                const count = await loadTimings.measure('统计发送上下文 Token', 'generation', () => outgoingContextTokens(request, prepared, body.model, signal));
                signal.throwIfAborted();
                const counted = Number.isSafeInteger(count) && count > 0;
                if (!counted || count > contextLimit) {
                    releaseNativeDelay?.();
                    releaseNativeDelay = undefined;
                    setReplyWaiting('等待确认发送');
                    status('等待确认发送…');
                    const accepted = await confirmAction({
                        title: counted ? '发送上下文超过确认阈值' : '无法统计发送上下文 Token',
                        message: counted ? `本次发送的上下文为 ${count} Token，超过设定的 ${contextLimit} Token。要继续发送吗？` : '暂时无法统计本次发送的上下文。要继续发送吗？',
                        confirmLabel: '继续发送', cancelLabel: '取消发送', returnFocus: input, signal,
                    });
                    signal.throwIfAborted();
                    if (!accepted) {
                        contextDeclined = true;
                        throw new DOMException('context-confirmation-declined', 'AbortError');
                    }
                }
                if (!regenerate && !retry && !pendingUser) await persistUser();
                if (usesBackgroundGeneration() && state.chatUnpersisted) await saveChat();
                signal.throwIfAborted();
                addReply();
            }
            const base = api.chatBase;
            if (usesBackgroundGeneration() && base?.avatar === state.character.avatar && base.file === state.file) {
                const job = {
                    id: crypto.randomUUID().replaceAll('-', ''), avatar: base.avatar, file: base.file,
                    base: base.revision ?? await chatRevision(base.lines), regenerate, started: reply.gen_started,
                };
                signal.throwIfAborted();
                backgroundJob = job;
                try { localStorage.setItem(backgroundJobKey(), JSON.stringify(job)); }
                catch { /* The backend can rediscover the job on startup. */ }
            }
            const keywordRows = requestLog.enabled && prepared?.databaseKeywordRows?.length
                && (request.messages === body.messages || JSON.stringify(request.messages) === JSON.stringify(body.messages))
                ? prepared.databaseKeywordRows : undefined;
            finishRequest = requestLog.start('chat', request, signal, api, keywordRows, keywordRows && prepared.databaseKeywordMacros);
            requestStarted ??= loadTimings.now();
            setReplyWaiting('正在等待回复');
            if (contextLimit) startModelTimers();
            const response = chatGenerationResponse(api, request, signal, {
                id: backgroundJob?.id,
                recovery: backgroundJob,
                onStarted: releaseNativeDelay,
                onFallback: () => {
                    if (backgroundJob) forgetBackgroundJob(backgroundJob);
                    backgroundJob = null;
                },
            });
            if (contextLimit) {
                try { markWaitingForReply(); }
                catch (error) {
                    controller.abort();
                    void response.catch(() => {});
                    throw error;
                }
            }
            return response;
        };
        let requestedStream;
        if (!contextLimit) startModelTimers();
        const pendingResponse = loadTimings.measure('模型请求至响应头', 'generation', () => recovery
            ? chatGenerationResponse(api, null, controller.signal, { id: recovery.id, resume: true })
            : scriptRuntime.generate(body, {
                signal: controller.signal,
                identity: scriptIdentity(),
                generationType: regenerate ? 'swipe' : 'normal',
                fetch: (request, signal) => {
                    requestedStream = Number(request.stream === true);
                    return fetchReply(request, signal);
                },
            }), response => ({ metrics: {
            requestedStream,
            streamResponse: Number((response.headers.get('content-type') || '').includes('text/event-stream')),
        } }));
        try {
            if (!contextLimit) markWaitingForReply();
        } catch (error) {
            controller.abort();
            void pendingResponse.catch(() => {});
            throw error;
        }
        const response = await pendingResponse;
        releaseNativeDelay?.();
        let responseReasoning;
        if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
            const result = await response.json();
            if (result.error) throw new Error(typeof result.error === 'string' ? result.error : result.error.message || '模型请求失败');
            reply.mes = result.choices?.[0]?.message?.content || result.choices?.[0]?.text || '';
            responseReasoning = result.choices?.[0]?.message?.reasoning_content || result.choices?.[0]?.message?.reasoning;
            if (reply.mes) finishFirstText();
        } else {
            for await (const event of readEvents(response)) {
                if (event.error) throw new Error(typeof event.error === 'string' ? event.error : event.error.message || '模型请求失败');
                const delta = event.choices?.[0]?.delta;
                if (delta?.content || delta?.reasoning_content || delta?.reasoning || event.choices?.[0]?.text) finishFirstText();
                if (!reply.mes && !reply.extra.reasoning && (delta?.content || delta?.reasoning_content || delta?.reasoning || event.choices?.[0]?.text)) status(regenerate ? '正在重新生成…' : '正在回复…');
                reply.mes += delta?.content || event.choices?.[0]?.text || '';
                if (delta?.reasoning_content || delta?.reasoning) reply.extra.reasoning = (reply.extra.reasoning || '') + (delta.reasoning_content || delta.reasoning);
                if (state.hiddenReply && (reply.mes || reply.extra.reasoning)) {
                    state.hiddenReply = null;
                    setReplyWaiting();
                    list.setMessages(state.chat, { latest: list.follow });
                } else if (!state.hiddenReply && !streamFrame) {
                    streamFrame = setTimeout(() => { streamFrame = 0; list.update(replyIndex); }, 90);
                }
            }
        }
        if (!reply.mes && !reply.extra.reasoning) throw new Error('模型没有返回文本。');
        replyReceived = loadTimings.now();
        finishRequest?.(null, reply.mes, reply.extra.reasoning || responseReasoning);
        completed = true;
        status('回复完成');
    } catch (error) {
        finishRequest?.(error, reply?.mes, reply?.extra?.reasoning);
        resumeLater = !!backgroundJob && !!error.resumeBackground;
        if (resumeLater && reply) {
            if (regenerate) state.chat[replyIndex] = previousReply;
            else state.chat.pop();
            reply = null;
            list.setMessages(state.chat, { latest: list.follow });
        }
        const failure = requestFailure(error, state.controller?.signal);
        finishFirstText?.(failure.status, failure);
        finishModelResponse?.(failure.status, failure);
        if (error.name === 'AbortError') {
            if (!contextDeclined && error.message !== 'pagehide') notifyGeneration(waitingToSend ? '发送已取消' : '生成已停止，已收到的内容会保存', 'info');
        }
        else {
            state.error = resumeLater ? '暂时无法读取后台回复，点击发送可继续恢复' : error.message;
            notifyGeneration(state.error, true);
        }
    } finally {
        releaseNativeDelay?.();
        if (!completed) {
            state.hiddenReply = null;
            setReplyWaiting();
        }
        finishModelResponse?.(completed ? 'success' : 'cancelled');
        if (streamFrame) { clearTimeout(streamFrame); streamFrame = 0; }
        if (contextDeclined && state.generation.queuedUser) {
            state.generation.queuedUser = null;
            input.value = input.value ? `${draft}\n\n${input.value}` : draft;
            resizeInput();
            list.setMessages(state.chat, { latest: list.follow });
        }
        if (state.generation.queuedUser) appendUser();
        state.generation = null;
        let rawSaved = false;
        if (completed && reply && (backgroundJob || scriptRuntime.helperReady)) {
            try {
                if (regenerate) reply.swipes[reply.swipe_id] = reply.mes;
                await loadTimings.measure('助手处理前保存模型原文', 'generation', () => saveChat({
                    incremental: true, signal: backgroundSaveSignal(), tailBase: userSaveBase,
                }));
                rawSaved = true;
                rawReplyBase = api.chatBase;
                acknowledgeReply();
            } catch (error) { notifyGeneration(error.message, true); }
        }
        if (completed && reply && scriptRuntime.helperReady && rawSaved) {
            try {
                if (document.visibilityState !== 'visible') await waitForReplyScriptVisibility();
                const finish = loadTimings.start('助手事件 message_received', 'generation');
                const timing = loadTimings.scope(finish.id), controller = new AbortController();
                const event = { timing, signal: controller.signal, writePending: false, chatBase: rawReplyBase };
                state.replyScriptEvent = event;
                try {
                    const snapshot = timing.measureSync('助手准备回复快照', 'generation', () => scriptSnapshot(state));
                    await timing.measure('助手等待回复回调', 'generation', () => scriptRuntime.dispatch('message_received', [replyIndex], snapshot, scriptIdentity()));
                    finish();
                } catch (error) {
                    finish('error', error.name === 'TimeoutError' ? { reason: 'timeout' } : {});
                    throw error;
                } finally {
                    // A timed-out callback can leave an HTTP write in flight.
                    if (event.writePending) state.chatConflict ||= '无法确认脚本写入结果，请重新打开聊天后再发送。';
                    controller.abort();
                    timing.close('cancelled');
                    rawReplyBase = event.chatBase;
                    state.replyScriptEvent = null;
                }
            } catch (error) { notifyGeneration(`回复已保留，角色脚本处理失败：${error.message}`, true); }
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
            const beforeMvu = rawReplyBase;
            rawReplyBase = undefined;
            try {
                const mvu = await loadTimings.measure('回复后更新角色变量', 'generation', () => prepareRoleMvu(true, { message: reply, text: rawReplyText }));
                if (mvu?.changed === false && state.chat.at(-1) === reply) rawReplyBase = beforeMvu;
            } catch (error) { notify(`回复已保留，角色变量更新失败：${error.message}`, true); }
        }
        if (reply || pendingUser) {
            if (!state.chatConflict) {
                try {
                    if (reply || !userSaved) await loadTimings.measure('回复后保存聊天', 'generation', () => saveChat({
                        incremental: true, signal: backgroundSaveSignal(), tailBase: rawReplyBase,
                    }));
                    if (!resumeLater) acknowledgeReply();
                    await rememberChat();
                } catch (error) { notifyGeneration(error.message, true); }
            }
            if (state.chatConflict && !userSaved && state.chat.at(-1) === user) {
                state.chat.pop();
                input.value = input.value ? `${draft}\n\n${input.value}` : draft;
                resizeInput();
            }
        }
        if (reply || pendingUser || regenerate) {
            state.hiddenReply = null;
            setReplyWaiting();
            const showReplyTop = completed && state.chat.at(-1) === reply;
            list.setMessages(state.chat, { latest: showReplyTop ? 'top' : list.follow });
        }
        if (!reply && !resumeLater && backgroundJob) acknowledgeReply();
        if (completed && scriptRuntime.helperReady && document.visibilityState !== 'visible') await waitForReplyScriptVisibility();
        state.busy = false; state.controller = null; synchronize();
        if (completed && scriptRuntime.helperReady) {
            try { await loadTimings.measure('助手事件 generation_ended', 'generation', () => scriptRuntime.dispatch('generation_ended', [replyIndex], scriptSnapshot(state), scriptIdentity())); }
            catch (error) { notify(`角色脚本结束事件失败：${error.message}`, true); }
        }
        if (state.chatConflict) status(state.chatConflict, true);
        else if (!state.dirty) status(state.error ? `请求未完成 · ${state.error}` : '已保存', Boolean(state.error));
        finishGeneration(completed ? 'success' : state.error ? 'error' : 'cancelled', { metrics: {
            preSendMs: requestStarted === undefined ? undefined : requestStarted - sendStarted,
            userCardMountedMs,
            postReplyMs: replyReceived === undefined ? undefined : loadTimings.now() - replyReceived,
        } });
        state.error = '';
        if (completed && !state.dirty && !state.chatConflict) { await autoUpdateDatabase(); preloadNextGeneration(); }
    }
    return { completed };
}

function beginMessageEdit(message) {
    if (inlineEdit?.message === message) return;
    return afterMessageEdit(() => {
        assertSaved(); const index = state.chat.indexOf(message); if (index < 0) return;
        const originalText = String(message.mes ?? '').replace(/\r\n?/g, '\n');
        inlineEdit = { message, text: originalText, originalText }; list.update(index);
        list.nodes.get(index)?.querySelector('.inline-editor textarea')?.focus();
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

async function chatHistoryPanel() {
    assertSaved(); if (!state.character) throw Error('请先打开聊天。');
    const body = await showPanel('聊天记录管理', '', 'chat-history-panel'); if (!body) return;
    const revision = panelRevision, identity = scriptIdentity(), source = state.chat;
    let original = copy(source), header = copy(state.header);
    renderChatHistoryManager(body, {
        chat: original, el, action, notify,
        dirty: value => { if (revision === panelRevision) { const previous = panelDirty; panelDirty = value; if (previous && !value) synchronize(); } },
        jump: async id => { assertSaved(); if (identity !== scriptIdentity()) throw Error('聊天已切换。'); if (await closePanel()) list.jump(id); },
        save: async (messages, start) => {
            assertSaved();
            if (state.databaseController) throw Error('请等待数据库更新完成后再保存聊天记录。');
            const check = () => {
                if (revision !== panelRevision || identity !== scriptIdentity() || JSON.stringify(state.chat) !== JSON.stringify(original) || JSON.stringify(state.header) !== JSON.stringify(header)) throw Error('当前聊天已变化，请重新打开聊天记录管理。');
            };
            check(); state.historySaving = true;
            try {
                const next = copy(messages); invalidateDatabases(next, start);
                await state.saves;
                const saved = await persistChatHistory(api, { avatar: state.character.avatar, file: state.file, header, original, messages: next, allowMissing: !!state.chatUnpersisted, check });
                state.chat = saved; state.chatUnpersisted = false; original = copy(saved); header = copy(state.header);
                generationPreload.invalidate(); scriptAutoIdentity = ''; scriptRuntime.dispose(); scriptSchema.dispose();
                list.setMessages(state.chat, { reset: true }); status('已保存'); synchronize();
                return saved;
            } finally { state.historySaving = false; }
        },
    });
}
async function databasePreviewPanel() {
 assertViewable();if(!state.character)throw new Error('请先打开聊天');const body=await showPanel('数据预览','','database-panel');if(!body)return;const current=currentDatabase();
 const revision=panelRevision,write=databaseWriteGuard(current.index);
 const previousData = findDatabaseSnapshot(state.chat, state.header, { through: current.index - 1, structuredOnly: true })?.data ?? null;
 renderDatabasePreview(body,{el,field,action,dirty:value=>{if(revision===panelRevision)panelDirty=value;},data:current.data,index:current.index,archived:current.archived,previousData,settings:current.settings,notify,savePreferences:async patch=>{await saveOwn({database:{...currentDatabase().settings,...patch}});},
 saveData:async value=>{write.check();storeDatabase(state.chat,state.header,value,current.index,current.archived?current.meta:undefined);write.saved();await saveChat();},
 send:async text=>{if(await closePanel()){$('message-input').value=text;resizeInput();$('message-input').focus();}}
 });
}
const readingSettingsTitle = '阅读设置';
async function toolsPanel() {
    const body = await showPanel(readingSettingsTitle, '', 'reading-tools-panel'); if (!body) return;
    if (state.chat.at(-1)?.is_user) body.append(action('重试最后一条消息的回复', async () => { if (await closePanel()) await generate('retry'); }, 'refresh'));
    const enter = field(body, '发送方式', state.own.enterSend === false ? 'button' : 'enter', { options: [['enter', '电脑 Enter 发送，Shift + Enter 换行'], ['button', '只使用发送按钮']] });
    const delay = field(body, '发送延迟（秒）', sendDelaySeconds(state.own.reading?.sendDelay), { type: 'number', hint: '默认 5 秒，设为 0 立即开始发送。等待期间可以停止发送。' });
    delay.min = 0; delay.max = maxSendDelay; delay.step = 1; delay.required = true;
    const tokenLimit = field(body, '发送确认阈值（Token）', sendTokenLimit(state.own.reading?.sendTokenLimit), {
        type: 'number', hint: '整次发送的上下文（含历史和提示词）超过此数值时，发送前会询问是否继续。设为 0 关闭提醒。',
    });
    tokenLimit.min = 0; tokenLimit.max = Number.MAX_SAFE_INTEGER; tokenLimit.step = 1; tokenLimit.required = true;
    const palette = field(body, '页面配色', frontendThemes.normalize(state.own.palette), { options: frontendThemes.options });
    palette.addEventListener('change', () => frontendThemes.apply(palette.value));
    const rememberReading = value => {
        const settings = readingSettings({
            ...value, sendDelay: state.own.reading?.sendDelay, sendTokenLimit: state.own.reading?.sendTokenLimit,
        }, true);
        state.own.reading = settings;
        applyReading(settings);
        resizeInput();
    };
    const reading = readingSettings(state.own.reading), typography = el('div', 'parameter-grid reading-parameters'); body.append(typography);
    const readingInputs = new Map();
    const values = () => Object.fromEntries([...readingInputs].map(([key, input]) => [key, input.value]));
    for (const [key, label, fallback, min, max, step] of readingFields) {
        const optional = fallback === '';
        const input = field(typography, label, reading[key], { type: 'number' });
        input.min = min;
        if (max != null) input.max = max;
        input.step = step;
        readingInputs.set(key, input);
        if (optional) input.placeholder = '跟随设备';
        input.addEventListener('input', () => {
            if (optional || key === 'fontSize') {
                if (input.validity.valid && (optional || input.value !== '')) {
                    rememberReading({ ...state.own.reading, [key]: input.value });
                }
            } else if (input.value !== '' && [...readingInputs.values()].every(input => input.validity.valid)) {
                rememberReading(values());
            }
        });
    }
    const dialogueColor = field(typography, '对话文字颜色', reading.dialogueColor, { hint: '仅调整聊天消息中引号内的对话文字。填写色号，例如 #75452e；留空跟随主题。' });
    dialogueColor.placeholder = '跟随主题'; dialogueColor.spellcheck = false; readingInputs.set('dialogueColor', dialogueColor);
    dialogueColor.addEventListener('input', () => {
        dialogueColor.setCustomValidity('');
        try { readingSettings({ dialogueColor: dialogueColor.value }, true); }
        catch (error) { dialogueColor.setCustomValidity(error.message); return; }
        if ([...readingInputs.values()].every(input => input.validity.valid)) rememberReading(values());
    });
    const sample = el('div', 'reading-sample');
    const sampleDialogue = el('p'); sampleDialogue.append(el('span', 'dialogue-quote', '“这是对话文字的颜色预览。”'));
    sample.append(el('p', '', '风从窗边吹来，书页轻轻翻过。文字沿着页面两侧整齐排列，让每一次阅读都从容一些。'), sampleDialogue); body.append(sample);
    const footer = el('div', 'editor-footer');
    footer.append(action('保存阅读设置', async () => {
        if (readingInputs.get('inputFontSize').validity.badInput) {
            readingInputs.get('inputFontSize').reportValidity();
            return;
        }
        if (!delay.reportValidity() || !tokenLimit.reportValidity()) return;
        const reading = readingSettings({ ...values(), sendDelay: delay.value, sendTokenLimit: tokenLimit.value }, true);
        const selectedPalette = palette.value;
        await saveOwn({ enterSend: enter.value === 'enter', palette: selectedPalette, reading });
        try { localStorage.setItem(readingStorageKey(), JSON.stringify(reading)); } catch { /* Server save remains available. */ }
        rememberReading(reading);
        frontendThemes.apply(selectedPalette, true);
        panelDirty = false; notify('阅读设置已保存');
    }, 'tools', 'primary'), action('恢复默认排版', () => {
        for (const [key, , fallback] of readingFields) readingInputs.get(key).value = fallback;
        dialogueColor.value = ''; dialogueColor.setCustomValidity('');
        rememberReading(values()); panelDirty = true;
    }, 'refresh'));
    if (state.dirty) footer.append(action('重试保存当前聊天', saveChat, 'refresh', 'primary'));
    if (state.bundle.account && state.bundle.displayTavern !== 'display') footer.append(action('设置展示密码', displayPasswordPanel));
    if (state.bundle.account) footer.append(tavernSwitchButton());
    body.append(footer);
}

function resizeInput() {
    const input = $('message-input');
    input.style.height = 'auto';
    if (!input.value) return;
    const style = getComputedStyle(input);
    const lineHeight = parseFloat(style.lineHeight);
    const singleLineHeight = lineHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    // Font metrics can add a few pixels of scroll height to a single visual line.
    const contentHeight = input.scrollHeight;
    const height = contentHeight < singleLineHeight + lineHeight / 2 ? singleLineHeight : contentHeight;
    input.style.height = `${Math.min(height, innerHeight * .28)}px`;
}
let activeTopPanel = null;
const topPanelButtons = new Map();
function setActiveTopPanel(callback) {
    activeTopPanel = callback;
    for (const [target, button] of topPanelButtons) button.setAttribute('aria-pressed', String(callback === target));
}
$('panel').addEventListener('close', () => { if (!$('panel').open) setActiveTopPanel(null); });
for (const [label, glyph, callback] of [['预设', 'tools', presetPanel], ['API', 'plug', connectionPanel], ['用户设定', 'user', personasPanel], ['世界书', 'book', worldsPanel], ['角色卡', 'card', characterPanel], ['正则与脚本', 'regex', regexPanel]]) {
    const button = action(label, () => $('panel').open && activeTopPanel === callback ? closePanel() : callback(), glyph, 'icon-button top-shortcut');
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
    const gap = parseFloat(getComputedStyle(menu).getPropertyValue('--menu-anchor-gap')) || 8;
    menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.bottom = `${Math.max(8, innerHeight - rect.top + gap)}px`;
    menu.style.maxHeight = `${Math.max(60, rect.top - 8 - gap)}px`;
}
function confirmFrontendUpdate(question) {
    return confirmAction({ title: '检查更新', message: question, confirmLabel: '更新', returnFocus: $('tools-toggle') });
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
for (const [label, glyph, callback] of [
    ['刷新页面', 'refresh', () => { assertIdle(); window.location.reload(); }],
    ['最近请求记录', 'requestFlow', () => showRequestLog({ el, action, notify, returnFocus: $('tools-toggle'), prepareNextPrompt: () => {
        assertIdle(); return preparePrompt();
    } })],
    ['变量管理器', 'tools', variableManagerPanel],
    ['加载日志', 'activity', timingPanel],
    ['检查更新', 'updateDownload', () => manualUpdate({ api, notify, confirmUpdate: confirmFrontendUpdate, guard: () => { assertSaved({ allowGeneration: true }); if (panelDirty) throw new Error('请先保存或取消当前编辑。'); } })],
    ['关闭聊天', 'close', async () => { assertSaved(); state.character = null; state.chat = []; state.header = null; state.file = ''; welcome(); synchronize(); }],
    ['聊天记录管理', 'message', chatHistoryPanel],
    ['历史聊天', 'history', chatsPanel],
    ['开启新聊天', 'plus', async () => { assertSaved(); if (!state.character) throw new Error('请先选择角色。'); await loadChat(null); }],
    ['数据预览', 'eye', databasePreviewPanel],
    ['数据管理', 'database', () => databasePanel()],
    [readingSettingsTitle, 'more', toolsPanel],
]) {
    composerTools.append(action(label, () => { composerTools.hidden = true; $('tools-toggle').setAttribute('aria-expanded', 'false'); return callback(); }, glyph));
}
$('tools-toggle').addEventListener('click', () => { closeQuickReplies(); composerTools.hidden = !composerTools.hidden; $('tools-toggle').setAttribute('aria-expanded', String(!composerTools.hidden)); if (!composerTools.hidden) positionComposerMenu(composerTools, $('tools-toggle')); });
const repositionComposerMenus = () => { if (!quickReplies.hidden) positionComposerMenu(quickReplies, document.getElementById('tools-toggle')); if (!composerTools.hidden) positionComposerMenu(composerTools, $('tools-toggle')); };
window.addEventListener('resize', repositionComposerMenus); window.visualViewport?.addEventListener('resize', repositionComposerMenus); window.visualViewport?.addEventListener('scroll', repositionComposerMenus);
document.addEventListener('click', event => { if (!composerTools.contains(event.target) && !$('tools-toggle').contains(event.target)) { composerTools.hidden = true; $('tools-toggle').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { composerTools.hidden = true; $('tools-toggle').setAttribute('aria-expanded', 'false'); } });
$('close-panel').addEventListener('click', () => run(closePanel));
$('panel').addEventListener('cancel', event => { if (event.target === $('panel')) { event.preventDefault(); void run(closePanel); } });
$('panel').addEventListener('click', event => { if (event.target === $('panel')) { const r = $('panel').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) void run(closePanel); } });
window.addEventListener('popstate', () => run(async () => {
    if (!$('panel').open) return;
    if (!await closePanel({ fromHistory: true }) && $('panel').open && !history.state?.appPanel) history.pushState({ appPanel: true }, '');
}));
$('composer').addEventListener('submit', event => {
    event.preventDefault();
    if (!state.busy) void afterMessageEdit(() => {
        if (!state.busy) return generate(false, null, { delaySend: true, confirmContext: true });
    });
});
window.addEventListener('resize', raiseNotification);
window.visualViewport?.addEventListener('resize', raiseNotification);
window.visualViewport?.addEventListener('scroll', raiseNotification);
document.addEventListener('close', raiseNotification, true);
$('message-input').addEventListener('input', resizeInput);
$('message-input').addEventListener('focus', preloadNextGeneration);
$('message-input').addEventListener('input', preloadNextGeneration);
$('message-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && state.own.enterSend !== false && matchMedia('(hover:hover) and (pointer:fine)').matches) { event.preventDefault(); $('composer').requestSubmit(); }
});
$('stop-button').addEventListener('click', () => state.controller?.abort(new DOMException('user-stop', 'AbortError')));

window.addEventListener('beforeunload', event => { if (state.busy || state.historySaving || state.dirty || inlineEdit || panelDirty || $('message-input').value.trim()) { event.preventDefault(); event.returnValue = ''; } });
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
const handleAndroidShell = () => {
    const updateButton = $('android-apk-update');
    if (!updateButton) return;
    androidShellObserver.disconnect();
    if (!updateButton.querySelector('svg')) {
        updateButton.replaceChildren(icon('apkUpdate'), el('span', '', updateButton.textContent.trim()));
    }
    void run(async () => {
        await startupPromise;
        await resumeBackgroundChat({ discover: true });
    });
};
const androidShellObserver = new MutationObserver(handleAndroidShell);
androidShellObserver.observe(composerTools, { childList: true });
handleAndroidShell();



