import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import { parseScriptCommands, patchScriptWorldFields } from '../script-commands.js';
import { patchHelperMessages, helperMessageRevision } from '../helper-state.js';
import { scriptSupport } from '../scripts.js';
import { roleScriptContent } from '../role-script-adapters.js';
import { scriptDocument } from '../script-runtime.js';
import { SCHEMA_MODULE_REVISION, MVU_MODULE_URL } from '../script-modules.js';
import { htmlCardContext } from '../html-card-context.js';
import { scriptLayoutNodes } from '../script-layout.js';
import { scriptHelper } from '../script-helper.js';

test('world field batches preserve escaped delimiters, multiline profiles and unknown book fields', () => {
    const commands = parseScriptCommands('/setentryfield file="School Book" uid=7 field=content Name: Example\nNote: a\\|b || /setentryfield file="School Book" uid=20 field=disable false');
    assert.equal(commands.length, 2); assert.equal(commands[0].value, 'Name: Example\nNote: a|b');
    const book = { keep: 1, entries: { 7: { uid: 7, content: 'old', custom: true }, 20: { uid: 20, disable: true }, 99: { content: 'untouched' } } };
    const result = patchScriptWorldFields(book, commands);
    assert.equal(result.entries[7].content, commands[0].value); assert.equal(result.entries[7].custom, true); assert.equal(result.entries[20].disable, false);
    assert.deepEqual(result.entries[99], book.entries[99]); assert.equal(result.keep, 1); assert.equal(book.entries[7].content, 'old');
    for (const source of ['/setentryfield file=Book uid=7 field=content ok | /exec bad', '/setentryfield file=Book uid=7 field=__proto__ bad', '/getentryfield file=Book field=content -1', '/setentryfield file=Book uid=7 field=disable nope', '/setentryfield file=A uid=7 field=content a | /setentryfield file=B uid=7 field=content b']) assert.throws(() => parseScriptCommands(source));
    assert.throws(() => patchScriptWorldFields(book, parseScriptCommands('/setentryfield file=Book uid=88 field=content missing')));
});
test('send pipelines cannot smuggle extra generation, preserve escaped macros and accept apostrophes', () => {
    const commands = parseScriptCommands("/send {{user}} reads the school's paper: a\\|b | /trigger | /echo severity=warning Loading");
    assert.deepEqual(commands.map(c => c.type), ['send', 'trigger', 'echo']); assert.ok(commands[0].text.includes('a|b'));
    assert.throws(() => parseScriptCommands('/send first | /trigger | /trigger'));
    assert.throws(() => parseScriptCommands('/send first | /send second | /trigger'));
    assert.equal(parseScriptCommands('/setvar type=chat key=phone_history [{"text":"a\\|b"}]')[0].value, '[{"text":"a|b"}]');
    assert.equal(parseScriptCommands('/getvar type=chat phone_history')[0].type, 'getvar');
    assert.throws(() => parseScriptCommands('/setvar type=chat key=__proto__ bad'));
});
test('opening selection hydrates only a matching greeting and preserves every branch and unknown field', () => {
    const message = { mes: 'home', variables: { 0: { score: 1 } }, extra: { preserve: true }, custom: 42 }, records = [{ chat_metadata: { integrity: 'keep' } }, message];
    const patch = { message_id: 0, revision: helperMessageRevision(message), base: message.variables, swipe_id: 2 };
    const result = patchHelperMessages(records, [patch], { greetings: ['home', 'opening A', 'opening B'] });
    assert.equal(result[1].mes, 'opening B'); assert.equal(result[1].swipe_id, 2); assert.equal(result[1].custom, 42); assert.deepEqual(result[1].variables, message.variables); assert.equal(result[0].chat_metadata.integrity, 'keep');
    const back = patchHelperMessages(result, [{ ...patch, revision: helperMessageRevision(result[1]), swipe_id: 0 }]); assert.equal(back[1].mes, 'home');
    assert.throws(() => patchHelperMessages(records, [patch], { greetings: ['different', 'a', 'b'] }));
    assert.throws(() => patchHelperMessages(result, [patch]));
    assert.throws(() => patchHelperMessages(records, [{ ...patch, swipe_id: 99 }], { greetings: ['home', 'a'] }));
});
test('eventOnButton publishes configured actions and binds callbacks to the calling script only', async () => {
    const listeners = new Map(), reports = [], node = () => ({ style: {}, dataset: {}, addEventListener() {}, append() {} });
    const context = vm.createContext({ structuredClone, document: { createElement: node, head: node(), body: node() }, window: {}, setTimeout }); context.window = context;
    context.SillyTavern = { chat: [] }; context.tavern_events = {}; context.__scriptReport = value => reports.push(value);
    context.options = { scriptId: 'character-buttons', buttons: [{ name: 'Paper', visible: true }], request: async () => ({}), on: (name, fn) => { listeners.set(name, fn); return () => listeners.delete(name); }, emit() {}, update() {} };
    const helper = vm.runInContext(`(${scriptHelper.toString()})({chat:[]},options)`, context);
    assert.equal(reports[0].buttons[0].name, 'Paper');
    let clicks = 0; const stop = helper.api.eventOnButton('Paper', () => clicks++);
    listeners.get('character-buttons:Paper')(); assert.equal(clicks, 1); assert.equal(listeners.has('other:Paper'), false); stop(); assert.equal(listeners.size, 0);
});
test('known structure imports execute the original pinned module and produce valid isolated script syntax', () => {
    const schema = "import {registerMvuSchema} from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js'; export const Schema = z.object({}); $(()=>registerMvuSchema(Schema));";
    assert.equal(scriptSupport({ content: schema }).adapter, 'remote-schema');
    const html = scriptDocument([{ content: schema }, { content: `import '${MVU_MODULE_URL}'` }], { chat: [] }, '');
    assert.ok(html.includes(SCHEMA_MODULE_REVISION));
    for (const [, source] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(source));
    const buttons = 'eventOnButton("Profile", () => { const npcName = prompt("Name?"); if(npcName) triggerSlash(npcName); });';
    const adapted = roleScriptContent({ content: buttons }, scriptSupport({ content: buttons }).adapter);
    assert.match(adapted, /await SillyTavern.callGenericPopup/); assert.doesNotThrow(() => new vm.Script(adapted));
});
test('message HTML authenticates RPC replies and reads its own opening alternatives synchronously', async () => {
    const sent = [], handlers = [], parent = { postMessage: value => sent.push(value) }, window = {};
    const context = vm.createContext({ window, parent, setTimeout, clearTimeout, queueMicrotask, document: { readyState: 'loading', addEventListener() {} }, addEventListener: (_name, fn) => handlers.push(fn) });
    vm.runInContext(`(${htmlCardContext.toString()})({messageId:0,message:'home',scriptActions:true,swipes:['home','opening']})`, context);
    assert.equal(window.getChatMessages('0', { include_swipes: true })[0].swipes[1], 'opening'); assert.equal(window.getChatMessages(1).length, 0);
    const pending = window.setChatMessages([{ message_id: 0, swipe_id: 1 }]), request = sent.at(-1);
    handlers.forEach(fn => fn({ source: {}, data: { type: 'tavern-html-response', id: request.id, value: 'spoof' } }));
    handlers.forEach(fn => fn({ source: parent, data: { type: 'tavern-html-response', id: request.id, value: true } })); assert.equal(await pending, true);
    const failed = window.triggerSlash('/setentryfield file=Other uid=0 field=disable true'), call = sent.at(-1);
    handlers.forEach(fn => fn({ source: parent, data: { type: 'tavern-html-response', id: call.id, error: 'worldbook not associated' } })); await assert.rejects(failed, /not associated/);
});
test('zero-size shadow hosts expose only visible interactive controls to iframe clipping', () => {
    const element = (width, height, style = {}) => ({ tagName: 'DIV', children: [], style: { display: 'block', pointerEvents: 'auto', ...style }, getBoundingClientRect: () => ({ width, height }) });
    const host = element(0, 0, { pointerEvents: 'none' }), ball = element(48, 48), hiddenPanel = element(400, 600, { display: 'none' });
    host.shadowRoot = { children: [ball, hiddenPanel] };
    const first = scriptLayoutNodes({ body: { children: [host] } }, node => node.style); assert.deepEqual(first.nodes, [ball]); assert.deepEqual(first.shadows, [host.shadowRoot]);
    hiddenPanel.style.display = 'block'; assert.deepEqual(scriptLayoutNodes({ body: { children: [host] } }, node => node.style).nodes, [ball, hiddenPanel]);
    hiddenPanel.style.opacity = '0'; assert.deepEqual(scriptLayoutNodes({ body: { children: [host] } }, node => node.style).nodes, [ball]);
});

const main = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
test('world field commands verify readback, reject a stale base and do not invoke generation', async () => {
    const source = main.slice(main.indexOf('async function roleScriptAction('), main.indexOf('async function normalizeRoleMvu('));
    let book = { entries: { 7: { uid: 7, content: 'old', custom: 1 }, 20: { uid: 20, disable: true } } }, writes = 0, reads = 0, conflict = false;
    const context = vm.createContext({ state: { character: { name: 'Card' }, chat: [] }, panelDirty: false, parseScriptCommands, patchScriptWorldFields, assertSaved() {}, scriptIdentity: () => 'chat',
        roleWorldbook: async name => { if (name !== 'School') throw Error('unrelated'); reads++; if(conflict&&reads===2)book.entries[7].custom++; return structuredClone(book); },
        api: { post: async (_path, payload) => { writes++; book = payload.data; }, readCache: { clear() {} } }, generationPreload: { invalidate() {} },
    }); vm.runInContext(source, context);
    await context.roleScriptAction('slash', { command: '/setentryfield file=School uid=7 field=content profile | /setentryfield file=School uid=20 field=disable false' }, 'chat');
    assert.equal(writes, 1); assert.equal(book.entries[7].content, 'profile'); assert.equal(book.entries[7].custom, 1); assert.equal(book.entries[20].disable, false);
    await Promise.all([
        context.roleScriptAction('slash', { command: '/setentryfield file=School uid=7 field=comment title' }, 'chat'),
        context.roleScriptAction('slash', { command: '/setentryfield file=School uid=20 field=constant true' }, 'chat'),
    ]);
    assert.equal(book.entries[7].comment, 'title'); assert.equal(book.entries[20].constant, true); assert.equal(writes, 3);
    await assert.rejects(context.roleScriptAction('slash', { command: '/getentryfield file=Other field=content 7' }, 'chat'), /unrelated/);
    conflict = true; reads = 0; await assert.rejects(context.roleScriptAction('slash', { command: '/setentryfield file=School uid=7 field=content overwrite' }, 'chat'), /其他操作/); assert.equal(writes, 3);
});
