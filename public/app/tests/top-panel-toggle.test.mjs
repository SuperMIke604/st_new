import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const toggles = source.slice(source.indexOf('let activeTopPanel ='), source.indexOf('for (const [id, glyph] of'));
const close = source.slice(source.indexOf('function closePanel('), source.indexOf('function timingPanel('));
test('top buttons clear selection on repeat click and native close, and preserve refused close', () => {
    const buttons = new Map(), handlers = new Map(); let permitted = true;
    const panel = { open: false, addEventListener: (type, fn) => handlers.set(type, fn), close() { this.open = false; } };
    const context = vm.createContext({ state: {}, panelRevision: 0, panelDirty: false, variablesSaving: false, notify() {}, confirm: () => permitted, disposePanelWork() {},
        history: { state: null }, run: fn => fn(), $: id => id === 'panel' ? panel : { append() {} },
        action(label, callback) { const button = { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, click: callback }; buttons.set(label, button); return button; }
    });
    for (const name of ['connectionPanel', 'presetPanel', 'personasPanel', 'worldsPanel', 'characterPanel', 'regexPanel']) context[name] = () => { context.panelRevision++; panel.open = true; };
    vm.runInContext(close + toggles, context);
    buttons.get('API').click(); assert.equal(buttons.get('API').attributes['aria-pressed'], 'true');
    buttons.get('预设').click(); assert.equal(buttons.get('API').attributes['aria-pressed'], 'false'); assert.equal(buttons.get('预设').attributes['aria-pressed'], 'true');
    context.panelDirty = true; permitted = false; buttons.get('预设').click(); assert.equal(panel.open, true); assert.equal(buttons.get('预设').attributes['aria-pressed'], 'true');
    permitted = true; buttons.get('预设').click(); assert.equal(panel.open, false); assert.equal(buttons.get('预设').attributes['aria-pressed'], 'false');
    buttons.get('角色卡').click(); context.variablesSaving = true; buttons.get('角色卡').click();
    assert.equal(panel.open, true, 'a pending variable write keeps its panel open'); context.variablesSaving = false;
    context.state.historySaving = true; buttons.get('角色卡').click();
    assert.equal(panel.open, true, 'a pending chat history save keeps its panel open'); context.state.historySaving = false;
    handlers.get('close')(); assert.equal(buttons.get('角色卡').attributes['aria-pressed'], 'true', 'a delayed old close event cannot clear a reopened panel');
    panel.open = false; handlers.get('close')(); assert.equal(buttons.get('角色卡').attributes['aria-pressed'], 'false');
});
