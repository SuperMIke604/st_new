import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { scriptDocument } from '../script-runtime.js';
import { SCRIPT_API_NAMES } from '../script-helper.js';
import { nativeScriptPlan } from '../scripts.js';

test('ordinary global and character scripts load the entire API without MVU and retain their own identity and buttons', async () => {
    const listeners = new Map(), reports = [], requests = [];
    const node = () => ({ style: {}, dataset: {}, append() {}, addEventListener() {} });
    const snapshot = { chat: [], chatVariables: {}, helperScriptSettings: {}, helperSettings: { legacy: true }, helperLegacyScriptId: '', worldbookName: 'Role', lorebookSettings: { selected_global_lorebooks: ['Global'] } };
    const context = vm.createContext({ structuredClone, setTimeout, clearTimeout, document: { createElement: node, head: node(), body: node() }, addEventListener: (event, handler) => listeners.set(event, handler) });
    context.window = context;
    context.parent = { postMessage(message) {
        reports.push(message);
        if (message.type !== 'request') return;
        requests.push(message);
        queueMicrotask(() => listeners.get('message')({ source: context.parentTransport, data: { channel: 'st-new-scripts', type: 'response', id: message.id, value: { value: true } } }));
    } };
    context.parentTransport = context.parent;
    const content = name => `window.${name} = { ${SCRIPT_API_NAMES.join(',')} };`;
    const html = scriptDocument([
        { scope: 'global', id: 'tool', content: content('globalApi'), button: { buttons: [{ name: 'Configured', visible: true }] } },
        { scope: 'character', id: 'tool', content: content('characterApi') },
        { scope: 'character', id: 'off', enabled: false, content: 'window.offRan=true;' },
    ], snapshot, '');
    for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, context);
    assert.equal(context.globalApi.getScriptId(), 'global-tool');
    assert.equal(context.characterApi.getScriptId(), 'character-tool');
    for (const api of [context.globalApi, context.characterApi]) {
        for (const name of SCRIPT_API_NAMES) assert.notEqual(api[name], undefined, name);
        assert.equal(api.SillyTavern.extensionSettings.legacy, undefined);
        assert.deepEqual(Array.from(await api.getWorldbookNames()), ['Role', 'Global']);
    }
    context.globalApi.appendInexistentScriptButtons([{ name: 'Global', visible: true }]);
    context.characterApi.appendInexistentScriptButtons([{ name: 'Character', visible: true }]);
    assert.deepEqual(Array.from(context.globalApi.getScriptButtons(), item => item.name), ['Configured', 'Global']);
    assert.equal(context.characterApi.getScriptButtons()[0].name, 'Character');
    context.globalApi.SillyTavern.extensionSettings = { globalOnly: true };
    context.characterApi.SillyTavern.extensionSettings = { characterOnly: true };
    context.globalApi.SillyTavern.saveSettingsDebounced();
    context.characterApi.SillyTavern.saveSettingsDebounced();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests.map(item => item.payload.scriptId), ['global-tool', 'character-tool']);
    assert.equal(requests[0].payload.payload.value.globalOnly, true);
    assert.equal(requests[1].payload.payload.value.characterOnly, true);
    assert.equal(context.offRan, undefined);
    assert.equal(reports.some(item => item.type === 'failed'), false);
});

test('native plan honors global item toggles and preserves disabled character folders', () => {
    const settings = { extension_settings: { tavern_helper: { script: { enabled: { global: false }, scripts: [{ id: 'g', content: 'void 0' }] } } } };
    const character = { data: { extensions: { tavern_helper: { scripts: [{ type: 'folder', enabled: false, scripts: [{ id: 'c', content: 'void 0' }] }] } } } };
    const plan = nativeScriptPlan(settings, character);
    assert.deepEqual(plan.map(item => [item.scope, item.id, item.enabled]), [['global', 'g', true], ['character', 'c', false]]);
});
