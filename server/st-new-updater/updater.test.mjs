import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { init, validateManifest, listRecentCharacters, installUpdate } from './index.mjs';
const files = Object.fromEntries(['index.html', 'main.js', 'version.js', 'style.css'].map(name => ['public/app/' + name, 'new ' + name]));
const manifest = { schema: 1, revision: 'a'.repeat(64), files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, createHash('sha256').update(value).digest('hex')])) };
test('manifest rejects traversal, server paths and missing entrypoints', () => {
    assert.equal(validateManifest(manifest).length, 4);
    for (const name of ['public/app/../config.yaml', 'public/app/vendor/../../config.yaml', 'server.js', 'public/app/x/y.js']) assert.throws(() => validateManifest({ ...manifest, files: { ...manifest.files, [name]: 'a'.repeat(64) } }));
    assert.throws(() => validateManifest({ ...manifest, files: {} }));
    for (const file of ['server.js', 'server/st-new-updater/../../config.yaml', 'server/other/index.mjs']) assert.throws(() => validateManifest({ ...manifest, backend: { file, sha256: 'a'.repeat(64) } }));
    assert.throws(() => validateManifest({ ...manifest, backend: { file: 'server/st-new-updater/index.mjs', sha256: 'bad' } }));
});

async function combinedFixture(task) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'st-new-combined-test-'));
    const pluginFile = path.join(root, 'plugins/st-new-updater/index.mjs');
    const backend = Buffer.from('// new updater'), combined = { ...manifest, backend: { file: 'server/st-new-updater/index.mjs', sha256: createHash('sha256').update(backend).digest('hex') } };
    try {
        await fs.mkdir(path.join(root, 'public/app'), { recursive: true }); await fs.mkdir(path.dirname(pluginFile), { recursive: true });
        await fs.writeFile(path.join(root, 'public/app/index.html'), 'old frontend'); await fs.writeFile(pluginFile, 'old updater'); await fs.writeFile(path.join(root, 'private-data'), 'keep');
        const downloadFile = async url => { const name = new URL(url).pathname.split('/main/')[1]; return name === combined.backend.file ? backend : Buffer.from(files[name]); };
        await task({ root, pluginFile, manifest: combined, downloadFile });
        assert.equal(await fs.readFile(path.join(root, 'private-data'), 'utf8'), 'keep');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
}
test('combined updates verify and install both components; unchanged plugin needs no replacement', async () => {
    await combinedFixture(async options => {
        assert.deepEqual(await installUpdate(options), { backendUpdated: true });
        assert.equal(await fs.readFile(options.pluginFile, 'utf8'), '// new updater');
        assert.equal(await fs.readFile(path.join(options.root, 'public/app/index.html'), 'utf8'), 'new index.html');
        assert.deepEqual(await installUpdate(options), { backendUpdated: false });
    });
});
test('corrupt backend download preserves both installed components', async () => {
    await combinedFixture(async options => {
        const realDownload = options.downloadFile;
        await assert.rejects(installUpdate({ ...options, downloadFile: url => url.includes('/server/') ? Buffer.from('corrupt') : realDownload(url) }), /校验失败/);
        assert.equal(await fs.readFile(options.pluginFile, 'utf8'), 'old updater');
        assert.equal(await fs.readFile(path.join(options.root, 'public/app/index.html'), 'utf8'), 'old frontend');
    });
});
test('failed plugin replacement rolls back the frontend and original plugin together', async () => {
    await combinedFixture(async options => {
        const io = { ...fs, rename: async (from, to) => { if (from.startsWith(options.pluginFile + '.stage-')) throw Error('simulated disk failure'); return fs.rename(from, to); } };
        await assert.rejects(installUpdate({ ...options, io }), /simulated disk failure/);
        assert.equal(await fs.readFile(options.pluginFile, 'utf8'), 'old updater');
        assert.equal(await fs.readFile(path.join(options.root, 'public/app/index.html'), 'utf8'), 'old frontend');
    });
});
test('failed frontend replacement restores its original directory before touching the plugin', async () => {
    await combinedFixture(async options => {
        const io = { ...fs, rename: async (from, to) => { if (path.basename(from).startsWith('.st-new-stage-')) throw Error('frontend replace failed'); return fs.rename(from, to); } };
        await assert.rejects(installUpdate({ ...options, io }), /frontend replace failed/);
        assert.equal(await fs.readFile(options.pluginFile, 'utf8'), 'old updater');
        assert.equal(await fs.readFile(path.join(options.root, 'public/app/index.html'), 'utf8'), 'old frontend');
    });
});
test('status distinguishes running plugin from an installed update awaiting restart', async () => {
    await combinedFixture(async options => {
        const routes = new Map(); await init({ post: (route, fn) => routes.set(route, fn) }, options);
        const readStatus = async () => { let body; await routes.get('/status')({}, { json: value => { body = value; } }); return body; };
        assert.equal((await readStatus()).restartRequired, false);
        await installUpdate(options);
        const status = await readStatus(); assert.equal(status.selfUpdate, true); assert.equal(status.restartRequired, true); assert.notEqual(status.runningHash, status.installedHash);
        const restarted = new Map(); await init({ post: (route, fn) => restarted.set(route, fn) }, options);
        let latest; await restarted.get('/status')({}, { json: value => { latest = value; } }); assert.equal(latest.restartRequired, false);
    });
});
test('confirmed installs replace only frontend; corrupt downloads preserve previous frontend', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'st-new-update-test-'));
    const cwd = process.cwd(), fetcher = globalThis.fetch;
    try {
        process.chdir(root); await fs.mkdir('public/app', { recursive: true }); await fs.writeFile('public/app/index.html', 'old'); await fs.writeFile('private-data', 'keep');
        let corrupt = true;
        globalThis.fetch = async url => {
            const name = new URL(url).pathname.split('/main/')[1];
            return new Response(name === 'version.json' ? JSON.stringify(manifest) : corrupt ? 'corrupt' : files[name]);
        };
        const routes = new Map(); await init({ post: (name, handler) => routes.set(name, handler) });
        const run = async () => { const result = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; await routes.get('/install')({ body: { revision: manifest.revision } }, result); return result; };
        assert.equal((await run()).code, 500); assert.equal(await fs.readFile('public/app/index.html', 'utf8'), 'old');
        corrupt = false; const installed = await run(); assert.equal(installed.body.ok, true, JSON.stringify(installed)); assert.equal(await fs.readFile('public/app/index.html', 'utf8'), 'new index.html'); assert.equal(await fs.readFile('private-data', 'utf8'), 'keep');
    } finally { process.chdir(cwd); globalThis.fetch = fetcher; await fs.rm(root, { recursive: true, force: true }); }
});


test('recent role index uses directory metadata only and returns six unique roles', async () => {
    const entry = name => ({ name, isFile: () => true }); let stats = 0;
    const dirs = { characters: path.resolve('characters'), chats: path.resolve('chats') };
    const io = {
        readdir: async folder => folder === dirs.characters ? Array.from({ length: 8 }, (_, i) => entry(`role${i}.png`)) : [entry('old.jsonl'), entry('new.jsonl')],
        stat: async file => { stats++; return { mtimeMs: Number(file.match(/role(\d)/)[1]) * 10 + (file.endsWith('new.jsonl') ? 2 : 1) }; },
        readFile: async () => { throw Error('Chat contents must never be read'); }
    };
    const result = await listRecentCharacters(dirs, io);
    assert.equal(result.length, 6); assert.equal(result[0].avatar, 'role7.png'); assert.equal(result[0].file_name, 'new.jsonl'); assert.equal(stats, 16);
});
