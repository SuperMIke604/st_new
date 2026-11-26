import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const toggles = source.slice(source.indexOf('let activeTopPanel ='), source.indexOf('for (const [id, glyph] of'));
const navigation = source.slice(source.indexOf('function panelNavigationBlocked('), source.indexOf('function timingPanel('));
test('top buttons preserve the current editor until discard is confirmed', async () => {
    const buttons = new Map(), handlers = new Map(); let decide, confirmations = 0;
    const panel = { open: false, addEventListener: (type, fn) => handlers.set(type, fn), close() { this.open = false; }, showModal() { this.open = true; } };
    const context = vm.createContext({ state: {}, panelRevision: 0, panelDirty: false, variablesSaving: false, notify() {}, disposePanelWork() {},
        confirmAction: () => { confirmations++; return new Promise(resolve => { decide = resolve; }); },
        assertMessageEditClosed() {}, raiseNotification() {}, matchMedia: () => ({ matches: false }),
        history: { state: null, pushState() {} }, $: id => id === 'panel' ? panel : { append() {}, replaceChildren() {}, removeAttribute() {} },
        action(label, callback) { const button = { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, click: callback }; buttons.set(label, button); return button; }
    });
    for (const name of ['connectionPanel', 'presetPanel', 'personasPanel', 'worldsPanel', 'characterPanel', 'regexPanel']) context[name] = () => context.showPanel(name, '', '', context[name]);
    vm.runInContext(navigation + toggles, context);
    await buttons.get('API').click(); assert.equal(buttons.get('API').attributes['aria-pressed'], 'true');
    context.panelDirty = true;
    const switching = buttons.get('预设').click();
    await buttons.get('API').click();
    assert.equal(confirmations, 1);
    assert.equal(buttons.get('API').attributes['aria-pressed'], 'true');
    decide(false); await switching;
    assert.equal(context.panelDirty, true);
    assert.equal(buttons.get('API').attributes['aria-pressed'], 'true');
    const acceptedSwitch = buttons.get('预设').click(); decide(true); await acceptedSwitch;
    assert.equal(buttons.get('API').attributes['aria-pressed'], 'false');
    assert.equal(buttons.get('预设').attributes['aria-pressed'], 'true');
    context.panelDirty = true;
    const refusedClose = buttons.get('预设').click(); decide(false); await refusedClose;
    assert.equal(panel.open, true); assert.equal(buttons.get('预设').attributes['aria-pressed'], 'true');
    const acceptedClose = buttons.get('预设').click(); decide(true); await acceptedClose;
    assert.equal(panel.open, false); assert.equal(buttons.get('预设').attributes['aria-pressed'], 'false');
    await buttons.get('角色卡').click(); context.variablesSaving = true; await buttons.get('角色卡').click();
    assert.equal(panel.open, true, 'a pending variable write keeps its panel open'); context.variablesSaving = false;
    context.state.historySaving = true; await buttons.get('角色卡').click();
    assert.equal(panel.open, true, 'a pending chat history save keeps its panel open'); context.state.historySaving = false;
    handlers.get('close')(); assert.equal(buttons.get('角色卡').attributes['aria-pressed'], 'true', 'a delayed old close event cannot clear a reopened panel');
    panel.open = false; handlers.get('close')(); assert.equal(buttons.get('角色卡').attributes['aria-pressed'], 'false');
});
