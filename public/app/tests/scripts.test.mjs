import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptTrees, scriptRows, activeScripts, scriptScopeEnabled, scriptSupport, scriptSnapshot, latestMvuData, validateScriptTree, saveCharacterScripts, patchScriptScope, characterScriptPlan, usesMvuCompat } from '../scripts.js';
import { scriptDocument } from '../script-runtime.js';

test('global and character scripts remain separate and disabled folders suppress children', () => {
    const global = { type: 'script', id: 'g', content: 'void 0', enabled: true }, cardScript = { type: 'script', id: 'c', content: 'void 1', enabled: true, data: { keep: 42 } };
    const settings = { extension_settings: { tavern_helper: { script: { scripts: [global], enabled: { global: true, characters: ['a.png'] } } } } };
    const card = { avatar: 'a.png', data: { extensions: { tavern_helper: { scripts: [{ type: 'folder', name: 'folder', enabled: false, scripts: [cardScript] }] } } } };
    assert.equal(scriptTrees(settings, card).global[0], global);
    assert.equal(scriptRows(scriptTrees(settings, card).character)[0].enabled, false);
    assert.deepEqual(activeScripts(settings, card).map(item => item.id), ['g']);
    card.data.extensions.tavern_helper.scripts[0].enabled = true;
    assert.deepEqual(activeScripts(settings, card).map(item => item.id), ['g', 'c']);
    assert.equal(scriptScopeEnabled(settings, { avatar: 'other.png' }, 'character'), false);
    assert.deepEqual(cardScript.data, { keep: 42 });
});
test('external MVU modules, schema imports and IndexedDB are explicitly unsupported', () => {
    for (const content of ["import 'https://example.com/mvu.js'", "import { x } from 'https://example.com/schema.js'", 'window.indexedDB.open("avatars")']) assert.equal(scriptSupport({ content }).supported, false);
    for (const content of ['getWorldbook("book")', 'createChatMessages([])']) assert.equal(scriptSupport({ content }).supported, true);
    assert.equal(scriptSupport({ content: 'const data=Mvu.getMvuData({message_id:"latest"}); $("body").append("Status");' }).supported, true);
});
test('MVU snapshots retain swipe-specific data and omit unrelated private configuration', () => {
    const message = { mes: 'reply', swipe_id: 1, variables: { 0: { stat_data: { value: 1 } }, 1: { stat_data: { value: 2 } } }, secret: 'omit' };
    const snapshot = scriptSnapshot({ chat: [message, { is_user: true, mes: 'user' }], header: { chat_metadata: { variables: { custom: true }, secret: 'omit' } }, settings: { username: 'User', secret: 'omit' } });
    assert.equal(latestMvuData(snapshot).stat_data.value, 2);
    assert.equal(latestMvuData(snapshot, 0).stat_data.value, 2);
    snapshot.chat[0].variables[1].stat_data.value = 9;
    assert.equal(message.variables[1].stat_data.value, 2);
    assert.ok(!JSON.stringify(snapshot).includes('secret'));
});
test('runtime escapes snapshot delimiters, keeps CSP restrictions and does not execute unsupported imports', () => {
    const html = scriptDocument([{ id: 'a', content: 'window.statusReady=true;' }, { id: 'b', content: "import 'https://bad.invalid/runtime.js'" }], { chat: [], characterName: '</script><script>bad()</script>' }, 'window.jqueryReady=true;');
    assert.ok(html.includes("connect-src 'none'")); assert.ok(html.includes("media-src 'none'"));
    assert.ok(html.includes('window.statusReady=true;')); assert.ok(!html.includes('https://bad.invalid'));
    assert.ok(!html.includes('</script><script>bad()'));
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 3);
    for (const [, code] of scripts) assert.doesNotThrow(() => new Function(code));
});
test('native OK save response is verified and does not overwrite helper variables or unrelated fields', async () => {
    const tree = [{ type: 'script', id: 'test', name: 'Test', enabled: true, content: 'void 0', data: { keep: true } }], calls = [];
    const card = { data: { extensions: { tavern_helper: { scripts: structuredClone(tree), variables: { unchanged: true } } } } };
    const saved = await saveCharacterScripts({ post: async (path, body, options) => { calls.push({ path, body, options }); return path.endsWith('/get') ? card : 'OK'; } }, 'card.png', tree);
    assert.equal(saved, card); assert.deepEqual(Object.keys(calls[0].body.data.extensions.tavern_helper), ['scripts']); assert.ok(calls[1].options.signal);
    assert.deepEqual(card.data.extensions.tavern_helper.variables, { unchanged: true });
    await assert.rejects(saveCharacterScripts({ post: async path => path.endsWith('/get') ? { data: { extensions: {} } } : { ok: true } }, 'card.png', tree), /核验失败/);
});
test('malformed script imports are rejected and native parent DOM dependencies are flagged', () => {
    for (const invalid of [[null], [42], [{ type: 'folder', scripts: 'bad' }], [{ content: 3 }]]) assert.throws(() => validateScriptTree(invalid));
    assert.equal(scriptSupport({ content: 'const p=window.parent; const $=p.jQuery;' }).supported, false);
});
test('scope saves preserve unrelated native settings and do not enable other legacy cards', () => {
    const settings = { extension_settings: { TavernHelper: { characters_with_scripts: ['old.png'], global_script_enabled: false }, tavern_helper: { optimize: { keep: true } } } };
    patchScriptScope(settings, 'character', { avatar: 'new.png', enabled: true, allAvatars: ['old.png', 'new.png', 'unrelated.png'] });
    assert.deepEqual(settings.extension_settings.tavern_helper.script.enabled.characters, ['old.png', 'new.png']);
    assert.equal(settings.extension_settings.tavern_helper.optimize.keep, true);
    assert.equal(scriptScopeEnabled(settings, null, 'global'), false);
    patchScriptScope(settings, 'global', { tree: [{ content: 'void 0', data: { keep: true } }], enabled: true });
    assert.equal(settings.extension_settings.tavern_helper.script.enabled.global, true);
    assert.deepEqual(settings.extension_settings.tavern_helper.script.enabled.characters, ['old.png', 'new.png']);
});
test('snapshot keeps floor indexes while bounding old message text and preserving the latest MVU data', () => {
    const chat = Array.from({ length: 100 }, (_, index) => ({ mes: 'message ' + index, variables: index === 2 ? { 0: { stat_data: { value: 2 } } } : {} }));
    const snapshot = scriptSnapshot({ chat }); assert.equal(snapshot.chat.length, 100);
    assert.equal(snapshot.chat[0].mes, ''); assert.equal(snapshot.chat[99].message_id, 99); assert.equal(snapshot.chat[99].mes, 'message 99'); assert.equal(latestMvuData(snapshot).stat_data.value, 2);
});

test('helper snapshot bounds candidate text so large swipe histories cannot multiply the frame payload', () => {
    const text = 'x'.repeat(90000), chat = Array.from({ length: 40 }, () => ({ mes: text, swipes: Array(5).fill(text) }));
    const snapshot = scriptSnapshot({ chat });
    const total = snapshot.chat.reduce((size, message) => size + message.mes.length + (message.swipes || []).reduce((sum, swipe) => sum + swipe.length, 0), 0);
    assert.ok(total <= 2000000); assert.equal(snapshot.chat.at(-1).textAvailable, true);
    assert.ok(snapshot.chat.some(message => !message.textAvailable || !message.swipesAvailable));
});
test('role plan loads the original MVU module while enabled global scripts use the same native host', () => {
    const content = "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@beta/artifact/bundle.js'";
    const card = { avatar: 'a.png', data: { extensions: { tavern_helper: { scripts: [{ id: 'mvu', enabled: true, content }] } } } };
    const settings = { extension_settings: { tavern_helper: { script: { scripts: [{ id: 'global', content: 'window.globalRan=true' }] } } } };
    assert.deepEqual(characterScriptPlan(settings, card).map(script => script.id), ['mvu']); assert.equal(usesMvuCompat(settings, card), false);
    const document = scriptDocument([{ id: 'global', scope: 'global', content: 'window.globalRan=true' }, ...characterScriptPlan(settings, card)], { chat: [] }, '/* jQuery */');
    assert.ok(document.includes('window.globalRan=true')); assert.ok(document.includes('https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@beta/artifact/bundle.js')); assert.ok(document.includes('script-empty'));
    assert.equal(scriptSupport({ content }).adapter, 'remote-module');
    assert.ok(document.includes('"externalMvu":true'));
});
test('role status bar fallback probes of parent DOM do not block its working local MVU adapter', () => {
    const content = '/* fate-phone-container getMvuDataSafe initFatePhone */ try { const p=window.parent; p.document; } catch {}';
    assert.equal(scriptSupport({ content }).adapter, 'mvu-status'); assert.equal(scriptSupport({ content }).supported, true);
});
