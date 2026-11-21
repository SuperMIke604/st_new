import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { MVU_MODULE_URL, SCHEMA_MODULE_REVISION, scriptModuleUrls, fallbackModuleUrls, loadScriptModules, loadMvuLibraries, requireMvuHost } from '../script-modules.js';
import { scriptSupport } from '../scripts.js';
import { scriptDocument, ScriptRuntime } from '../script-runtime.js';
import { scriptBridge } from '../script-bridge.js';

test('requested side-effect import accepts ordinary comments, quotes and semicolons without accepting other code or hosts', () => {
    for (const source of [`import '${MVU_MODULE_URL}'`, `// MVU\nimport "${MVU_MODULE_URL}"; /* original module */`]) {
        assert.deepEqual(scriptModuleUrls(source), [MVU_MODULE_URL]);
        assert.equal(scriptSupport({ content: source }).adapter, 'remote-module');
    }
    for (const source of ['', '/* import missing */', `import '${MVU_MODULE_URL}'; alert(1)`, `import '${MVU_MODULE_URL}?next=other'`, `import '${MVU_MODULE_URL.replace('testingcf.', 'evil.')}'`, `import '${MVU_MODULE_URL.replace('https:', 'http:')}'`, `import '${MVU_MODULE_URL.replace('https://', 'https://user:pass@')}'`, `import '${MVU_MODULE_URL}'; import 'https://other.invalid/a.js'`]) assert.equal(scriptModuleUrls(source), null, source);
});

test('unversioned MVU side-effect imports use the supported beta runtime', () => {
    for (const entry of [MVU_MODULE_URL, MVU_MODULE_URL.replace('testingcf.', 'cdn.')]) {
        const content = `import'${entry.replace('@beta', '')}';`;
        assert.deepEqual(scriptModuleUrls(content), [entry]);
        assert.equal(scriptSupport({ content }).adapter, 'remote-module');
        const html = scriptDocument([{ scope: 'character', content }], { chat: [] }, '');
        assert.ok(html.includes(entry));
        assert.ok(!html.includes(content));
        for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(code));
    }
});

test('aliased schema registration keeps its binding when paired with the unversioned MVU entry', () => {
    const schema = "import { registerMvuSchema as r } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';\nexport const Schema = z.object({});\n$(() => { r(Schema) });";
    const mvu = `import'${MVU_MODULE_URL.replace('@beta', '')}';`;
    assert.equal(scriptSupport({ content: schema }).adapter, 'remote-schema');
    assert.equal(scriptSupport({ content: schema.replace('r(Schema)', 'other(Schema)') }).supported, false);
    const html = scriptDocument([{ content: schema }, { content: mvu }], { chat: [] }, '');
    assert.ok(html.includes(`const {registerMvuSchema: r} = await import("https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource@${SCHEMA_MODULE_REVISION}/dist/util/mvu_zod.js");`));
    assert.ok(html.includes('$(() => { r(Schema) });'));
    for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(code));
});

test('pinned two-source modules fall back only after failure and keep the same revision', async () => {
    const primary = MVU_MODULE_URL.replace('@beta', '@' + 'a'.repeat(40)), backup = primary.replace('testingcf.', 'cdn.');
    const source = `// pinned module\ntry { await import('${primary}'); } catch (e) { console.warn('retry', e); await import('${backup}'); }`;
    assert.deepEqual(scriptModuleUrls(source), [primary, backup]);
    assert.equal(scriptModuleUrls(source.replace(backup, backup.replace('a'.repeat(40), 'b'.repeat(40)))), null);
    assert.equal(scriptModuleUrls(source.replace('https://cdn.', 'https://evil.')), null);
    const calls = [];
    await loadScriptModules([primary, backup], async url => { calls.push(url); if (url === primary) throw Error('offline'); }, true);
    assert.deepEqual(calls, [primary, backup]);
    calls.length = 0;
    await loadScriptModules([primary, backup], async url => calls.push(url), true);
    assert.deepEqual(calls, [primary]);
    await assert.rejects(loadScriptModules([primary, backup], async () => { throw Error('offline'); }, true), /远程模块加载失败/);
    const schemaUrl = primary.replace('MagicalAstrogy/MagVarUpdate', 'StageDog/tavern_resource').replace('/artifact/bundle.js', '/dist/util/mvu_zod.js');
    const schema = `let registerMvuSchema; try { ({registerMvuSchema} = await import('${schemaUrl}')); } catch (e) { ({registerMvuSchema} = await import('${schemaUrl.replace('testingcf.', 'cdn.')}')); } export const Schema = z.object({}); $(()=>registerMvuSchema(Schema));`;
    assert.ok(fallbackModuleUrls(schema, true));
    assert.equal(scriptSupport({ content: schema }).adapter, 'remote-schema');
    const html = scriptDocument([{ content: source }, { content: schema }], { chat: [] }, '');
    assert.match(html, /https:\/\/cdn\.jsdelivr\.net/);
    assert.match(html, /await Promise.all\(window.__helperSchemas/);
    for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(code));
});

test('three unversioned CDN fallbacks load a single MVU revision and keep schema templates local', async () => {
    const sources = ['testingcf', 'cdn', 'fastly'].map(host => MVU_MODULE_URL.replace('testingcf.', host + '.').replace('@beta', ''));
    const [primary, secondary, tertiary] = sources;
    const content = `try { await import('${primary}'); } catch (e1) {
        try { await import('${secondary}'); } catch (e2) {
            try { await import('${tertiary}'); } catch (e3) { console.error('[MVU] Bundle CDN 加载失败:', e3); }
        }
    }`;
    const urls = scriptModuleUrls(content);
    assert.deepEqual(urls, sources.map(url => url.replace('/MagVarUpdate/', '/MagVarUpdate@beta/')));
    assert.equal(scriptSupport({ content }).adapter, 'remote-module');
    for (const source of [content.replace(tertiary, tertiary.replace('fastly.', 'unapproved.')), content.replace(tertiary, primary), content.replace(tertiary, urls[2]), content.replace('console.error', 'alert')]) {
        assert.equal(scriptModuleUrls(source), null);
    }
    const calls = [];
    await loadScriptModules(urls, async url => { calls.push(url); if (url !== urls[2]) throw Error('offline'); }, true);
    assert.deepEqual(calls, urls);
    const schema = `import {registerMvuSchema} from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';
export const 功法演化模板 = z.object({});
export const Schema = z.object({ 模板: 功法演化模板 });
$(() => registerMvuSchema(Schema));`;
    const html = scriptDocument([{ content }, { content: schema }], { chat: [] }, '');
    assert.match(html, /script-src 'unsafe-inline' https:\/\/testingcf\.jsdelivr\.net https:\/\/cdn\.jsdelivr\.net https:\/\/fastly\.jsdelivr\.net;/);
    assert.match(html, /const 功法演化模板 = z\.object/);
    for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(code));
    assert.ok(!scriptDocument([{ content, enabled: false }, { content: schema }], { chat: [] }, '').includes('https://fastly.jsdelivr.net'));
});

test('enabled character and global modules share the loader while disabled modules cannot open CDN access', () => {
    const remote = { scope: 'character', content: `import '${MVU_MODULE_URL}'` };
    const html = scriptDocument([remote], { chat: [] }, '');
    assert.match(html, /script-src 'unsafe-inline' https:\/\/testingcf\.jsdelivr\.net;/);
    assert.match(html, /connect-src 'none'/);
    assert.ok(!html.includes('allow-same-origin'));
    for (const scripts of [[{ ...remote, enabled: false }], [{ ...remote, scope: 'global', enabled: false }]]) {
        const disabled = scriptDocument(scripts, { chat: [] }, '');
        assert.ok(!disabled.includes(MVU_MODULE_URL));
        assert.ok(!disabled.includes("script-src 'unsafe-inline' https:"));
    }
    assert.ok(scriptDocument([{ ...remote, scope: 'global' }], { chat: [] }, '').includes(MVU_MODULE_URL));
    for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(code));
});

test('loader runs the original module and its dependency, then propagates initialization errors', async () => {
    const dependency = 'data:text/javascript,' + encodeURIComponent('export const value = 42;');
    const source = `import {value} from '${dependency}'; globalThis.__stModuleSmoke = value;`;
    const url = 'data:text/javascript,' + encodeURIComponent(source);
    try {
        await loadScriptModules([url]);
        assert.equal(globalThis.__stModuleSmoke, 42);
    } finally { delete globalThis.__stModuleSmoke; }
    const calls = [];
    await assert.rejects(loadScriptModules(['first', 'failing', 'never'], async url => {
        calls.push(url); if (url === 'failing') throw Error('getTavernHelperVersion is not defined');
    }), /远程模块加载失败.*failing.*getTavernHelperVersion/);
    assert.deepEqual(calls, ['first', 'failing']);
});

test('external MVU owns its global namespace instead of receiving a replacement implementation', () => {
    const context = vm.createContext({ parent: { postMessage() {} }, structuredClone, setTimeout, clearTimeout, addEventListener() {} });
    context.window = context;
    vm.runInContext(`(${scriptBridge.toString()})({chat:[]},{externalMvu:true})`, context);
    assert.equal(context.Mvu, undefined);
    assert.equal(typeof context.getVariables, 'function');
});

test('original MVU receives actual external libraries and a failed library load never replaces a working namespace', async () => {
    const target = { _: { previous: true } }, imports = [];
    await loadMvuLibraries(async url => {
        imports.push(url); return url.includes('lodash@') ? { default: { originalLodash: true } } : { originalModule: url };
    }, target);
    assert.equal(target._.originalLodash, true);
    assert.match(target.Vue.originalModule, /vue@3\.5\.21/);
    assert.match(target.YAML.originalModule, /yaml@2\.8\.0/);
    assert.match(target.z.originalModule, /zod@4\.1\.11/);
    assert.equal(imports.length, 4);
    assert.ok(imports.every(url => new URL(url).origin === 'https://testingcf.jsdelivr.net'));
    const original = { _: { previous: true } };
    await assert.rejects(loadMvuLibraries(async url => { if (url.includes('yaml@')) throw Error('network offline'); return {}; }, original), /network offline/);
    assert.deepEqual(original, { _: { previous: true } });
});

test('module status does not overwrite a failure with successful import completion', async () => {
    const runtime = new ScriptRuntime({ notify() {} });
    runtime.frame = { contentWindow: {} };
    const row = { dataset: { adapter: 'remote-module' } };
    runtime.statusRows.set('character-mvu', row);
    const send = data => runtime.receive({ source: runtime.frame.contentWindow, data: { channel: 'st-new-scripts', id: 'character-mvu', ...data } });
    await send({ type: 'executed' }); assert.match(row.textContent, /已完成初始化/);
    await send({ type: 'failed', text: '缺少脚本接口', error: true });
    await send({ type: 'executed' }); assert.equal(row.textContent, '缺少脚本接口');
});

test('incomplete host is reported as unavailable instead of faking native helper support or silently substituting MVU', () => {
    assert.throws(() => requireMvuHost({ SillyTavern: {} }), /尚未接入.*SillyTavern.saveChat.*getTavernHelperVersion/);
    assert.throws(() => requireMvuHost({ SillyTavern: { saveChat: true }, getTavernHelperVersion() {} }), /SillyTavern.saveChat/);
    assert.doesNotThrow(() => requireMvuHost({ SillyTavern: { saveChat() {} }, getTavernHelperVersion() {} }));
});
