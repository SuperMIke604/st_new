import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { init, validateManifest, listRecentCharacters, installUpdate, createCatalogReader, readCardMetadata } from './index.mjs';
const files = Object.fromEntries(['index.html', 'main.js', 'version.js', 'style.css'].map(name => ['public/app/' + name, 'new ' + name]));
const manifest = { schema: 1, revision: 'a'.repeat(64), files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, createHash('sha256').update(value).digest('hex')])) };

test('settings snapshots read only the authenticated user file, without caching or preset scans', async () => {
    const routes = new Map(), reads = [];
    let value = { unknown: { keep: 7 } };
    const io = { readFile: async file => { reads.push(file); return file === 'plugin.mjs' ? 'plugin' : JSON.stringify(value); } };
    await init({ post: (route, handler) => routes.set(route, handler) }, { pluginFile: 'plugin.mjs', io });
    const call = async root => {
        const result = { statusCode: 200, headers: {} };
        const response = { set: (key, value) => { result.headers[key] = value; }, json: body => { result.body = body; }, status: code => { result.statusCode = code; return response; } };
        await routes.get('/settings')({ user: { directories: { root } } }, response);
        return result;
    };
    assert.deepEqual((await call('/user-a')).body, { settings: value });
    value = { externalEdit: true };
    const second = await call('/user-b');
    assert.deepEqual(second.body.settings, value);
    assert.equal(second.headers['Cache-Control'], 'no-store');
    assert.deepEqual(reads, ['plugin.mjs', path.join('/user-a', 'settings.json'), path.join('/user-b', 'settings.json')]);
    value = [];
    assert.equal((await call('/user-a')).statusCode, 500);
    io.readFile = async () => { throw Error('private filename'); };
    const failed = await call('/user-a');
    assert.equal(failed.statusCode, 500);
    assert.ok(!JSON.stringify(failed).includes('private filename'));
});

test('catalog projections cache per file, detect external edits/additions/removals and isolate directories', async () => {
    const records = new Map(), reads = [];
    const add = (dir, name, value, stamp = 1) => records.set(path.join(dir, name), { value: JSON.stringify(value), stamp });
    add('/one', 'a.png', { data: { name: 'A', description: 'private'.repeat(10000), extensions: { script: 'private' } } });
    add('/one', 'b.png', { name: 'B', create_date: '2020-01-01' });
    add('/two', 'a.png', { name: 'Other' });
    add('/books', 'a.json', { name: 'Display name', extensions: { unknown: { keep: true } }, entries: { 1: { content: 'private' } } });
    const io = {
        readdir: async dir => [...records.keys()].filter(file => path.dirname(file) === path.normalize(dir)).map(file => ({ name: path.basename(file), isFile: () => true })),
        stat: async file => { const r = records.get(file); return { mtimeMs: r.stamp, ctimeMs: r.stamp, size: r.value.length }; },
        readFile: async file => { reads.push(file); return records.get(file).value; },
    };
    const list = createCatalogReader({ io, readCard: file => io.readFile(file) });
    const first = await list('/one', 'characters');
    assert.deepEqual(first.map(card => card.name), ['A', 'B']);
    assert.ok(!JSON.stringify(first).includes('private')); assert.ok(!Object.hasOwn(first[0], 'data'));
    await list('/one', 'characters'); assert.equal(reads.length, 2);
    add('/one', 'a.png', { name: 'Updated' }, 2);
    assert.equal((await list('/one', 'characters'))[0].name, 'Updated'); assert.equal(reads.length, 3);
    records.delete(path.join('/one', 'b.png')); add('/one', 'c.png', { name: 'C' });
    assert.deepEqual((await list('/one', 'characters')).map(card => card.name), ['Updated', 'C']);
    assert.equal((await list('/two', 'characters'))[0].name, 'Other');
    const worlds = await list('/books', 'worlds');
    assert.deepEqual(worlds, [{ file_id: 'a', name: 'Display name', extensions: { unknown: { keep: true } } }]);
    const before = reads.length; await list('/books', 'worlds'); assert.equal(reads.length, before);
    add('/books', 'a.json', { name: 'Renamed', extensions: { keep: 2 } }, 3);
    assert.equal((await list('/books', 'worlds'))[0].name, 'Renamed');
    const bounded = createCatalogReader({ io, readCard: file => io.readFile(file), maxEntries: 1 });
    await bounded('/one', 'characters'); const readCount = reads.length;
    await bounded('/one', 'characters'); assert.ok(reads.length > readCount, 'bounded cache evicts old projections');
});

test('catalog malformed files match native lists while directory and parser failures stay errors', async () => {
    const io = { readdir: async () => [{ name: 'a.png', isFile: () => true }], stat: async () => ({ mtimeMs: 1, ctimeMs: 1, size: 1 }), readFile: async () => 'broken' };
    const list = createCatalogReader({ io, readCard: file => io.readFile(file) });
    assert.deepEqual(await list('/cards', 'characters'), []);
    io.readdir = async () => [{ name: 'a.json', isFile: () => true }];
    assert.deepEqual(await list('/books', 'worlds'), [{ file_id: 'a', name: 'a', extensions: {} }]);
    io.readdir = async () => [{ name: 'a.png', isFile: () => true }];
    const unavailable = createCatalogReader({ io, readCard: () => { throw Error('parser unavailable'); } });
    await assert.rejects(unavailable('/cards', 'characters'), /parser unavailable/);
    io.readdir = async () => { throw Error('directory offline'); };
    await assert.rejects(list('/cards', 'characters'), /directory offline/);
});

test('PNG metadata reader preserves V3 precedence and Unicode, skips image bytes and rejects damaged metadata', async () => {
    const chunk = (type, value) => {
        const data = Buffer.concat([Buffer.from(type), value]), result = Buffer.alloc(value.length + 12);
        result.writeUInt32BE(value.length); data.copy(result, 4);
        let crc = 0xffffffff;
        for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
        result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
    };
    const text = (keyword, value) => chunk('tEXt', Buffer.from(keyword + '\0' + Buffer.from(JSON.stringify(value)).toString('base64')));
    const signature = Buffer.from('89504e470d0a1a0a', 'hex');
    const header = Buffer.from('0000000d49484452000000010000000108060000001f15c489', 'hex');
    const image = chunk('IDAT', Buffer.alloc(10000));
    const v3 = { data: { name: '中文🙂', extensions: { unknown: true } } };
    const metadata = text('CCV3', v3);
    let contents = Buffer.concat([signature, header, image, text('chara', { name: 'old' }), metadata, chunk('IEND', Buffer.alloc(0))]);
    let closed = 0; const positions = [];
    const io = { open: async () => ({ stat: async () => ({ size: contents.length }), close: async () => { closed++; }, read: async (target, offset, length, position) => {
        positions.push([position, length]); const bytesRead = contents.copy(target, offset, position, Math.min(contents.length, position + length)); return { bytesRead };
    } }) };
    assert.deepEqual(JSON.parse(await readCardMetadata('test.png', io)), v3);
    assert.equal(closed, 1);
    const imageStart = signature.length + header.length + 8;
    assert.ok(positions.every(([start, length]) => start + length <= imageStart || start >= imageStart + 10000), 'IDAT body is never read');
    const bad = Buffer.from(metadata); bad[bad.length - 1] ^= 1;
    contents = Buffer.concat([signature, header, bad, chunk('IEND', Buffer.alloc(0))]);
    await assert.rejects(readCardMetadata('bad.png', io), /CRC/); assert.equal(closed, 2);
    contents = Buffer.concat([signature, header, text('chara', { name: 'V2' }), chunk('IEND', Buffer.alloc(0))]);
    assert.equal(JSON.parse(await readCardMetadata('v2.png', io)).name, 'V2');
    contents = contents.subarray(0, contents.length - 5);
    await assert.rejects(readCardMetadata('short.png', io), /end|Truncated/); assert.equal(closed, 4);
});
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
