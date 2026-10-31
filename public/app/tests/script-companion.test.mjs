import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { buildPrompt, generationBody } from '../engine.js';
import { validateExtensionPrompt } from '../script-prompts.js';
import { scriptSupport } from '../scripts.js';
import { roleScriptContent } from '../role-script-adapters.js';
import { scriptChat } from '../script-chat.js';
import { helperMessageRevision } from '../helper-state.js';
import { inlineScriptMessage } from '../scripts.js';
import { inlineFrameGeometry, ScriptInlineView } from '../script-inline.js';

test('extension prompts enter the counted history at their requested depth and are not persisted in presets', async () => {
    const preset = JSON.parse(await fs.readFile(new URL('./fixtures/Default.json', import.meta.url), 'utf8'));
    const before = JSON.stringify(preset);
    const prompts = [validateExtensionPrompt({ name: 'dice', value: 'DICE', depth: 1 }), validateExtensionPrompt({ name: 'anchor', value: 'ANCHOR', depth: 2 }), validateExtensionPrompt({ name: 'head', value: 'HEAD', position: 0 })];
    const result = buildPrompt({ character: { name: 'Card', data: {} }, preset, chat: [{ is_user: true, mes: 'FIRST' }, { is_user: false, mes: 'SECOND' }, { is_user: true, mes: 'THIRD' }], extensionPrompts: prompts });
    const contents = result.messages.map(message => message.content);
    assert.equal(contents[0], 'HEAD');
    assert.ok(contents.indexOf('FIRST') < contents.indexOf('ANCHOR'));
    assert.ok(contents.indexOf('ANCHOR') < contents.indexOf('SECOND'));
    assert.ok(contents.indexOf('SECOND') < contents.indexOf('DICE'));
    assert.ok(contents.indexOf('DICE') < contents.indexOf('THIRD'));
    assert.equal(JSON.stringify(preset), before);
    for (const payload of [{ name: 'x', value: 'x', scan: true }, { name: 'x', value: 'x', depth: -1 }, { name: 'x', value: 'x', role: 3 }, { name: '', value: 'x' }]) assert.throws(() => validateExtensionPrompt(payload));
});

const main = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const source = main.slice(main.indexOf('async function helperHostAction('), main.indexOf('\nfunction variableManagerPanel('));
function host() {
    const state = { character: {}, chat: [{ mes: 'kept' }], preset: {}, busy: false }, runtime = { frame: {}, epoch: 1, auxiliaryControllers: new Set(), extensionPrompts: new Map() };
    const input = { value: '', focus() {} }, calls = [];
    const context = vm.createContext({ state, scriptRuntime: runtime, inlineEdit: null, panelDirty: false, variablesSaving: false, AbortController, AbortSignal, validateExtensionPrompt, generationBody, helperMessageRevision,
        scriptIdentity: () => 'chat', connection: () => ({ source: 'custom', url: 'https://model.invalid/v1', model: 'chosen', secretId: 'host-only' }),
        $: () => input, resizeInput() {}, list: { setMessages() {} }, scriptSnapshot: () => ({}),
        api: { async response(path, body, options) { calls.push({ path, body, options }); return { headers: new Headers(), async json() { return { choices: [{ message: { content: 'parsed' } }] }; } }; } },
    });
    vm.runInContext(source, context);
    return { state, runtime, input, calls, context, call: (operation, payload, identity = 'chat') => context.helperHostAction(operation, payload, identity) };
}
test('raw script generation uses host credentials, accepts only text options and rejects invalid or stale callers', async () => {
    const f = host();
    const result = await f.call('generate-raw', { options: { prompt: 'parse', systemPrompt: 'rules', quietToLoud: true } });
    assert.equal(result.value, 'parsed'); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].body.model, 'chosen'); assert.equal(f.calls[0].body.secret_id, 'host-only'); assert.equal(f.calls[0].body.stream, false);
    assert.equal(f.runtime.auxiliaryControllers.size, 0); assert.equal(f.state.chat[0].mes, 'kept');
    await assert.rejects(f.call('generate-raw', { options: { prompt: 'parse', url: 'https://evil.invalid' } }), /参数无效/);
    await assert.rejects(f.call('generate-raw', { options: { prompt: 'parse' } }, 'other'), /切换/);
    f.state.busy = true; await assert.rejects(f.call('generate-raw', { options: { prompt: 'parse' } }), /正在生成/);
    f.runtime.processing = true; assert.equal((await f.call('generate-raw', { options: { prompt: 'parse' } })).value, 'parsed');
    f.context.api.response = async () => { f.runtime.epoch++; return { headers: new Headers(), json: async () => ({ choices: [{ message: { content: 'late' } }] }) }; };
    await assert.rejects(f.call('generate-raw', { options: { prompt: 'parse' } }), /重新启动/);
    assert.equal(f.runtime.auxiliaryControllers.size, 0);
});
test('raw parsing rejects changed reply branches and failed callers without handing late output to the script', async () => {
    const f = host();
    f.context.api.response = async () => { f.state.chat[0].swipe_id = 1; return { headers: new Headers(), json: async () => ({ choices: [{ message: { content: 'obsolete' } }] }) }; };
    await assert.rejects(f.call('generate-raw', { scriptId: 'character-one', options: { prompt: 'parse' } }), /分支已变化/);
    f.runtime.statusRows = new Map([['character-one', { dataset: { active: 'false' } }]]);
    await assert.rejects(f.call('generate-raw', { scriptId: 'character-one', options: { prompt: 'parse' } }), /停用/);
});
test('draft transfer protects existing input and prompt slots remain scoped to each script', async () => {
    const f = host();
    await f.call('set-draft', { text: 'form output' }); assert.equal(f.input.value, 'form output');
    await assert.rejects(f.call('set-draft', { text: 'overwrite' }), /已有草稿/);
    for (const scriptId of ['global-one', 'character-one']) await f.call('set-extension-prompt', { scriptId, name: 'dice', value: scriptId });
    assert.equal(f.runtime.extensionPrompts.size, 2);
    await f.call('set-extension-prompt', { scriptId: 'global-one', name: 'dice', value: '' });
    assert.equal(f.runtime.extensionPrompts.size, 1); assert.equal(f.runtime.extensionPrompts.values().next().value.content, 'character-one');
});
test('source adaptation awaits original injection tasks and never enables unrelated native DOM scripts', () => {
    const original = `(function () { const marker='mmDicePool'; async function 发骰池(){ 同步月度锚(); } async function 解析本楼(){}\n  发骰池();\n})();`;
    const script = { content: original }, support = scriptSupport(script);
    assert.equal(support.adapter, 'role-engine');
    const adapted = roleScriptContent(script, support.adapter);
    assert.ok(adapted.includes('window.__scriptDiceReady = 发骰池()'));
    assert.ok(adapted.includes('eventOn(tavern_events.GENERATION_STARTED'));
    assert.equal(script.content, original);
    assert.equal(scriptSupport({ content: 'window.parent.document.body.click()' }).supported, false);
});
test('the compatibility chat updates changed message HTML without resetting an in-progress form', async () => {
    const elements = new Map(), listeners = new Map();
    const node = tag => ({ tagName: tag, children: [], style: {}, attrs: {}, events: new Map(), addEventListener(name, fn) { this.events.set(name, fn); }, append(...items) { for (const item of items) { if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1); this.children.push(item); item.parent = this; } }, setAttribute(key, value) { this.attrs[key] = String(value); }, getAttribute(key) { return this.attrs[key]; }, get firstElementChild() { return this.children[0]; }, showModal() { this.open = true; }, close() { this.open = false; }, remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); } });
    const document = { createElement: tag => { const item = node(tag); Object.defineProperty(item, 'id', { set(value) { elements.set(value, item); } }); return item; }, head: node('head'), body: node('body') };
    const context = vm.createContext({ document, window: { toastr: { error() {} } }, initial: { scriptMessageViews: [{ id: 0, html: '<form>original</form>' }] }, on: (name, fn) => listeners.set(name, fn) });
    const view = vm.runInContext(`(${scriptChat.toString()})(initial,async()=>true,on)`, context);
    const body = elements.get('chat').children[0].firstElementChild; body.innerHTML = 'user edits';
    view.refresh({ scriptMessageViews: [{ id: 0, html: '<form>original</form>' }] }); assert.equal(body.innerHTML, 'user edits');
    view.refresh({ scriptMessageViews: [{ id: 0, html: '<div>new status</div>' }] }); assert.equal(body.innerHTML, '<div>new status</div>');
    listeners.get('script-chat-open')(); assert.equal(elements.get('script-chat-dialog').open, true);
    const input = elements.get('send_textarea'); input.value = 'form output';
    view.mount(0); assert.equal(elements.get('script-chat-dialog').open, false);
    assert.equal(elements.get('script-chat-root').parent, document.body);
    assert.equal(input.value, 'form output');
    listeners.get('script-chat-open')(); assert.equal(input.value, 'form output');
    view.mount(0); assert.equal(input.value, 'form output');
});

test('the current interactive message is rendered through the live script document, including a new onboarding chat', () => {
    const character = { data: { extensions: { tavern_helper: { scripts: [{ content: "MEIMAN_ONBOARDING_BLOCK __mmFormHook send_textarea" }] } } } };
    const chat = [{ mes: 'MEIMAN_ONBOARDING_BLOCK' }];
    assert.equal(inlineScriptMessage({}, character, null, chat), 0);
    chat.push({ is_user: true, mes: '<状态栏/>' }, { mes: 'reply <状态栏/>' });
    assert.equal(inlineScriptMessage({}, character, null, chat), 2);
    character.data.extensions.tavern_helper.scripts[0].enabled = false;
    assert.equal(inlineScriptMessage({}, character, null, chat), -1);
});

test('inline iframe clipping leaves the composer and offscreen message areas available', () => {
    const viewport = { left: 10, right: 390, top: 70, bottom: 600 };
    assert.equal(inlineFrameGeometry({ left: 20, right: 380, top: -100, bottom: 900, width: 360, height: 1000 }, viewport, 400, 700), 'inset(170px 0px 300px 0px)');
    assert.equal(inlineFrameGeometry({ left: 20, right: 380, top: 900, bottom: 1900, width: 360, height: 1000 }, viewport, 400, 700), 'path("M0 0Z")');
});

test('inline placement scrolls and resizes the same frame without reparenting or resetting its content', () => {
    const previous = { document: globalThis.document, window: globalThis.window, innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight };
    const listeners = new Map(), posted = [], frame = { style: {}, contentWindow: { preserved: true } };
    globalThis.document = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
    globalThis.window = { addEventListener() {}, removeEventListener() {} }; globalThis.innerWidth = 400; globalThis.innerHeight = 700;
    let top = 100;
    const anchor = { isConnected: true, style: {}, dataset: {}, closest: () => ({ getBoundingClientRect: () => ({ left: 0, right: 400, top: 70, bottom: 600 }) }), getBoundingClientRect() { const height = parseFloat(this.style.height); return { left: 20, right: 380, top, bottom: top + height, width: 360, height }; } };
    try {
        const placement = new ScriptInlineView(frame, data => posted.push(data));
        placement.attach(anchor, 0); placement.resize(1200);
        assert.equal(posted.length, 1); assert.equal(frame.style.height, '1200px'); assert.equal(anchor.style.height, '1200px');
        top = -200; listeners.get('scroll')(); assert.equal(frame.style.top, '-200px');
        assert.equal(frame.style.clipPath, 'inset(270px 0px 400px 0px)');
        placement.attach(anchor, 0); assert.equal(posted.length, 1, 'repeat render must not remount the form');
        assert.equal(frame.contentWindow.preserved, true);
        placement.mode(false); placement.attach(anchor, 0); assert.equal(placement.active, false, 'unrelated saves must not displace the popup');
        placement.mode(true);
        anchor.isConnected = false; listeners.get('scroll')(); assert.equal(frame.style.clipPath, 'path("M0 0Z")');
        placement.dispose(); assert.equal(listeners.has('scroll'), false);
    } finally { Object.assign(globalThis, previous); }
});
