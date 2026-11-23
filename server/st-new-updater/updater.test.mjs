import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, scryptSync, randomUUID } from 'node:crypto';
import { init, validateManifest, listRecentCharacters, installUpdate, createCatalogReader, readCardMetadata, registerAccountLogin } from './index.mjs';
const files = Object.fromEntries(['index.html', 'main.js', 'version.js', 'style.css'].map(name => ['public/app/' + name, 'new ' + name]));
const manifest = { schema: 1, revision: 'a'.repeat(64), files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, createHash('sha256').update(value).digest('hex')])) };

test('chat delta preserves unknown history, verifies persistence, and rejects stale or unsafe writes', async t => {
    const chats = await fs.mkdtemp(path.join(os.tmpdir(), 'st-chat-delta-'));
    t.after(() => fs.rm(chats, { recursive: true, force: true }));
    await fs.mkdir(path.join(chats, '角色'));
    const target = path.join(chats, '角色', '聊天.jsonl');
    const header = { chat_metadata: { integrity: 'keep' }, unknown: { keep: 1 } };
    const history = { mes: '旧历史\n新行 🌅', swipes: ['旧历史', '候选'], extra: { other: 'keep' } };
    const user = { mes: '新增消息', is_user: true };
    const serialize = records => records.map(item => JSON.stringify(item)).join('\n');
    const revision = records => createHash('sha256').update(serialize(records)).digest('hex');
    await fs.writeFile(target, '\uFEFF' + serialize([header, history]).replaceAll('\n', '\r\n') + '\r\n');
    const routes = new Map();
    await init({ post: (route, handler) => routes.set(route, handler) });
    const call = overrides => {
        const result = { status: 200 };
        const response = { json: body => { result.body = body; }, status: code => { result.status = code; return response; },
            set: (name, value) => { if (name === 'Server-Timing') result.timings = value; } };
        routes.get('/chat-delta')({ user: { directories: { chats } }, body: {
            avatar_url: '角色.png', file_name: '聊天', base: revision([header, history]),
            result: revision([header, history, user]), append: [user], patches: [], ...overrides,
        } }, response);
        return result;
    };
    assert.equal(call({ file_name: '../聊天' }).status, 422);
    assert.equal(call({ file_name: '不存在' }).status, 409);
    const first = call();
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { ok: true, revision: revision([header, history, user]) });
    assert.match(first.timings, /deltaConfirmed;dur=0\.00/);
    const retry = call();
    assert.equal(retry.status, 200, 'an ambiguous retry cannot append twice');
    assert.match(retry.timings, /deltaConfirmed;dur=1\.00/);
    assert.equal(await fs.readFile(target, 'utf8'), serialize([header, history, user]));
    const edited = { ...user, variables: { 0: { score: 5 } } };
    const edit = { base: revision([header, history, user]), result: revision([header, history, edited]), append: [],
        patches: [{ index: 2, fields: { variables: edited.variables }, remove: [] }] };
    assert.equal(call({ ...edit, base: '0'.repeat(64) }).status, 409);
    assert.equal(call({ ...edit, patches: [{ index: 0, fields: { chat_metadata: { integrity: 'changed' } }, remove: [] }] }).status, 409);
    assert.equal(call({ ...edit, patches: [{ index: 2, fields: JSON.parse('{"__proto__":{}}'), remove: [] }] }).status, 400);
    const saved = call(edit);
    assert.equal(saved.status, 200);
    assert.match(saved.timings, /deltaConfirmed;dur=1\.00/);
    assert.equal(await fs.readFile(target, 'utf8'), serialize([header, history, edited]));
    assert.equal(call({ ...edit, result: '0'.repeat(64) }).status, 409);
    const external = serialize([header, { ...history, mes: '新历史' }, edited]);
    await fs.writeFile(target, external);
    assert.equal(call(edit).status, 409);
    assert.equal(await fs.readFile(target, 'utf8'), external);
    assert.deepEqual(await fs.readdir(path.dirname(target)), ['聊天.jsonl']);
});

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

function chunk(type, value) {
    const data = Buffer.concat([Buffer.from(type), value]), result = Buffer.alloc(value.length + 12);
    result.writeUInt32BE(value.length); data.copy(result, 4);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
}
const text = (keyword, value) => chunk('tEXt', Buffer.from(keyword + '\0' + Buffer.from(JSON.stringify(value)).toString('base64')));
const signature = Buffer.from('89504e470d0a1a0a', 'hex');
const header = Buffer.from('0000000d49484452000000010000000108060000001f15c489', 'hex');

test('PNG metadata reader preserves V3 precedence and Unicode, skips image bytes and rejects damaged metadata', async () => {
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
test('display accounts see only published cards and merge their previous chats into shared history', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'st-display-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const account = (handle, admin) => ({
        profile: { handle, admin, password: 'hash' }, directories: { root: path.join(root, handle), characters: path.join(root, handle, 'characters'), chats: path.join(root, handle, 'chats') },
    });
    const owner = account('existing-user', false);
    const guest = account('st-display-' + createHash('sha256').update(owner.profile.handle).digest('hex').slice(0, 32), false);
    const originalPassword = 'fixture-original', alternatePassword = 'fixture-display';
    Object.assign(owner.profile, { enabled: true, salt: randomUUID() });
    owner.profile.password = scryptSync(originalPassword, owner.profile.salt, 64).toString('base64');
    await Promise.all([owner, guest].flatMap(user => Object.values(user.directories).map(dir => fs.mkdir(dir, { recursive: true }))));
    const card = (name, description) => Buffer.concat([signature, header, text('chara', { name, description }), chunk('IEND', Buffer.alloc(0))]);
    const avatar = '可展示.png';
    const source = path.join(owner.directories.characters, avatar);
    const original = card('展品', '角色专属设定');
    await fs.writeFile(source, original);
    await fs.writeFile(path.join(owner.directories.characters, '私有.png'), card('私有角色'));
    await fs.writeFile(path.join(guest.directories.characters, '示例.png'), card('默认示例'));
    await fs.mkdir(path.join(owner.directories.chats, '可展示'));
    await fs.writeFile(path.join(owner.directories.chats, '可展示', '原版聊天.jsonl'), '{"mes":"仅原版"}');

    const profiles = new Map([[owner.profile.handle, owner.profile]]);
    const displayHost = {
        getProfile: async handle => profiles.get(handle), saveProfile: async profile => profiles.set(profile.handle, profile),
        getDirectories: handle => handle === owner.profile.handle ? owner.directories : guest.directories,
        createSalt: randomUUID, initialize: async handle => assert.equal(handle, guest.profile.handle),
    };
    const routes = new Map();
    const router = { post: (route, handler) => routes.set(route, handler) };
    await init(router, { displayHost });
    registerAccountLogin(router, { getProfile: displayHost.getProfile, accountVersion: profile => profile.password, consume: async () => async () => {} });
    const call = async (route, user, body = {}, session = { handle: user.profile.handle }) => {
        const result = { status: 200 };
        const response = { json: value => { result.body = value; }, status: code => { result.status = code; return response; }, sendStatus: code => { result.status = code; }, set() {} };
        const request = { user, session, body };
        await routes.get(route)(request, response);
        result.session = request.session;
        return result;
    };
    const share = (enabled, user = owner) => call('/display-card', user, { avatar, enabled });
    const login = (password, handle = owner.profile.handle) => call('/st-new-login', null, { handle, password }, {});
    assert.deepEqual((await share()).body, { available: false, enabled: false });
    assert.equal((await login(originalPassword)).session.handle, owner.profile.handle);
    assert.equal((await login(alternatePassword)).status, 403);
    assert.equal((await call('/display-password', owner, { password: originalPassword })).status, 400);
    assert.equal((await call('/display-password', owner, { password: alternatePassword })).status, 200);
    guest.profile = profiles.get(guest.profile.handle);
    assert.equal((await login(alternatePassword)).session.handle, guest.profile.handle);
    assert.deepEqual((await login(alternatePassword)).body, { handle: owner.profile.handle });
    assert.equal((await login(alternatePassword, guest.profile.handle)).status, 403);
    assert.equal((await login(alternatePassword, 'unrelated-user')).status, 403);
    assert.equal((await call('/display-password', guest, { password: 'blocked' })).status, 403);
    assert.deepEqual((await share()).body, { available: true, enabled: false });
    assert.deepEqual((await call('/characters', guest)).body, []);
    assert.equal((await share(true, guest)).status, 403);
    assert.equal((await call('/display-card', owner, { avatar, enabled: true }, {})).status, 403);
    assert.equal((await call('/display-card', owner, { avatar: '../私有.png', enabled: true })).status, 400);
    assert.equal((await call('/display-card', owner, { avatar: '不存在.png', enabled: true })).status, 404);
    assert.equal((await call('/install', guest)).status, 403);

    assert.deepEqual((await share(true)).body, { available: true, enabled: true });
    assert.equal((await share()).body.enabled, true);
    const [listed] = (await call('/characters', guest)).body;
    assert.equal(listed.name, '展品');
    assert.deepEqual((await call('/characters', guest)).body.map(item => item.name), ['展品']);
    assert.deepEqual(await fs.readFile(path.join(guest.directories.characters, listed.avatar)), original);
    assert.deepEqual(await fs.readdir(guest.directories.chats), []);
    const chatDir = path.join(guest.directories.chats, path.parse(listed.avatar).name);
    await fs.mkdir(chatDir);
    await fs.writeFile(path.join(chatDir, '展示聊天.jsonl'), '{"mes":"仅展示版"}');
    await fs.writeFile(path.join(chatDir, '原版聊天.jsonl'), '{"mes":"同名的展示版记录"}');
    assert.equal((await call('/recent', guest)).body[0].characterName, '展品');
    const sharedChats = path.join(owner.directories.chats, '可展示');
    const conflictCopy = (await fs.readdir(sharedChats)).find(name => name.startsWith('展示版-'));
    assert.equal(await fs.readFile(path.join(sharedChats, conflictCopy), 'utf8'), '{"mes":"同名的展示版记录"}');
    assert.equal(await fs.readFile(path.join(sharedChats, '原版聊天.jsonl'), 'utf8'), '{"mes":"仅原版"}');
    await call('/recent', guest);
    assert.equal((await fs.readdir(sharedChats)).length, 3);

    await fs.writeFile(source, 'bad png');
    assert.equal((await share(true)).status, 500);
    assert.deepEqual(await fs.readFile(path.join(guest.directories.characters, listed.avatar)), original);
    await fs.writeFile(source, card('更新后的展品'));
    assert.equal((await share(true)).status, 200);
    assert.equal((await call('/characters', guest)).body[0].avatar, listed.avatar);
    assert.equal((await call('/characters', guest)).body[0].name, '更新后的展品');

    const beforeRotation = (await login(alternatePassword)).session;
    const newPassword = 'fixture-rotated';
    assert.equal((await call('/display-password', owner, { password: newPassword })).status, 200);
    assert.equal((await login(alternatePassword)).status, 403);
    const rotated = (await login(newPassword)).session;
    assert.equal(rotated.handle, beforeRotation.handle);
    assert.notEqual(rotated.version, beforeRotation.version);
    assert.equal((await call('/characters', guest)).body[0].avatar, listed.avatar);
    profiles.get(guest.profile.handle).enabled = false;
    assert.deepEqual((await share(false)).body, { available: false, enabled: false });
    assert.equal((await share(true)).status, 409);
    assert.deepEqual((await call('/characters', guest)).body, []);
    assert.deepEqual((await call('/recent', guest)).body, []);
    assert.deepEqual(await fs.readdir(guest.directories.characters), ['示例.png']);
    assert.deepEqual(await fs.readdir(chatDir), []);
    assert.deepEqual((await fs.readdir(sharedChats)).sort(), ['原版聊天.jsonl', '展示聊天.jsonl', conflictCopy].sort());
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
test('HTTP 503 retries the file and falls back to GitHub Contents with checksum verification', async t => {
    await combinedFixture(async options => {
        const file = 'public/app/api.js', data = 'new api.js';
        const apiHash = createHash('sha256').update(data).digest('hex');
        const config = {
            ...options,
            manifest: { ...options.manifest, files: { ...options.manifest.files, [file]: apiHash } },
            downloadFile: undefined,
        };
        let requests = [];
        let fallback = new Response(null, { status: 503 });
        t.mock.method(globalThis, 'fetch', async (url, init) => {
            const source = new URL(url);
            if (!source.pathname.endsWith('/' + file)) return new Response(await options.downloadFile(url));
            requests.push(source);
            if (source.hostname === 'raw.githubusercontent.com') return new Response(null, { status: 503 });
            assert.equal(source.href, 'https://api.github.com/repos/SuperMIke604/st_new/contents/public/app/api.js?ref=main');
            assert.equal(init.headers.Accept, 'application/vnd.github.raw+json');
            return fallback;
        });
        const index = path.join(options.root, 'public/app/index.html');
        await assert.rejects(installUpdate(config), /public\/app\/api\.js.*HTTP 503/);
        assert.equal(await fs.readFile(index, 'utf8'), 'old frontend');
        fallback = new Response('corrupt');
        await assert.rejects(installUpdate(config), /校验失败/);
        assert.equal(await fs.readFile(options.pluginFile, 'utf8'), 'old updater');
        assert.equal(await fs.readFile(index, 'utf8'), 'old frontend');
        fallback = new Response(data);
        requests = [];
        assert.deepEqual(await installUpdate(config), { backendUpdated: true });
        assert.equal(await fs.readFile(path.join(options.root, file), 'utf8'), data);
        assert.deepEqual(requests.map(url => url.hostname), ['raw.githubusercontent.com', 'raw.githubusercontent.com', 'api.github.com']);
        assert.equal(requests[0].searchParams.has('retry'), false);
        assert.equal(requests[1].searchParams.has('retry'), true);
        assert.equal(requests[1].searchParams.get('revision'), config.manifest.revision);
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
        let corrupt = true, styleRequests = 0;
        globalThis.fetch = async url => {
            const name = new URL(url).pathname.split('/main/')[1];
            if (!corrupt && name === 'public/app/style.css' && ++styleRequests === 1) {
                return new Response(null, { status: 503 });
            }
            return new Response(name === 'version.json' ? JSON.stringify(manifest) : corrupt ? 'corrupt' : files[name]);
        };
        const routes = new Map(); await init({ post: (name, handler) => routes.set(name, handler) });
        const run = async () => { const result = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; await routes.get('/install')({ body: { revision: manifest.revision } }, result); return result; };
        assert.equal((await run()).code, 500); assert.equal(await fs.readFile('public/app/index.html', 'utf8'), 'old');
        corrupt = false; const installed = await run(); assert.equal(installed.body.ok, true, JSON.stringify(installed)); assert.equal(await fs.readFile('public/app/index.html', 'utf8'), 'new index.html'); assert.equal(await fs.readFile('private-data', 'utf8'), 'keep');
        assert.equal(styleRequests, 2);
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

test('display reads and writes selected shared settings without routing private resources to the owner', async t => {
    const { registerSharedDisplayConfig } = await import('./index.mjs');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'st-display-shared-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const handle = 'shared-owner';
    const directories = name => Object.fromEntries(['root', 'files', 'openAI_Settings', 'worlds', 'characters', 'chats'].map(key => [key, path.join(root, name, key)]));
    const owner = directories('owner'), guest = directories('guest');
    await Promise.all([owner, guest].flatMap(view => [view.root, view.files].map(directory => fs.mkdir(directory, { recursive: true }))));
    const ownerSettings = { extension_settings: { regex: ['shared'], private: true }, world_info_settings: { world_info: { globalSelect: ['private world'] } } };
    const guestSettings = { extension_settings: { regex: ['old display'] }, world_info_settings: { world_info: { globalSelect: ['display world'] } } };
    await fs.writeFile(path.join(owner.root, 'settings.json'), JSON.stringify(ownerSettings));
    await fs.writeFile(path.join(guest.root, 'settings.json'), JSON.stringify(guestSettings));
    await fs.writeFile(path.join(owner.files, 'independent-frontend-connections.json'), JSON.stringify({ profiles: [{ source: 'custom', url: 'https://model.example/v1', secretId: 'configured' }] }));
    const router = { stack: ['native'], use(middleware) { this.stack.push(middleware); } };
    let written;
    registerSharedDisplayConfig(router, { getDirectories: id => { assert.equal(id, handle); return owner; }, writeSettings: (file, text) => { assert.equal(file, path.join(owner.root, 'settings.json')); written = JSON.parse(text); } });
    const call = (pathname, body, { method = 'POST', scope } = {}) => {
        const profile = { handle: 'st-display-' + createHash('sha256').update(handle).digest('hex').slice(0, 32), stNewDisplay: { owner: handle } };
        const request = { method, path: pathname, body, user: { profile, directories: guest }, get: () => scope };
        const result = { json: value => value, send: value => value, status: code => assert.fail(`unexpected ${code}`) };
        router.stack[0](request, result, () => {});
        return { request, result };
    };
    const read = call('/api/settings/get');
    assert.equal(read.request.user.directories.openAI_Settings, owner.openAI_Settings);
    const merged = JSON.parse(read.result.json({ settings: JSON.stringify(guestSettings) }).settings);
    assert.deepEqual(merged.extension_settings, { regex: ['shared'] });
    assert.deepEqual(merged.world_info_settings, guestSettings.world_info_settings);
    const edit = { extension_settings: { regex: ['updated'] }, world_info_settings: {} };
    call('/api/settings/save', structuredClone(edit));
    assert.equal(written, undefined);
    const save = call('/api/settings/save', edit, { scope: 'regex' });
    assert.deepEqual(written, { ...ownerSettings, extension_settings: { regex: ['updated'], private: true } });
    assert.deepEqual(save.request.body.extension_settings.regex, ['old display']);
    assert.equal(call('/api/presets/save', { apiId: 'openai' }).request.user.directories.openAI_Settings, owner.openAI_Settings);
    assert.equal(call('/user/files/independent-frontend-connections.json', null, { method: 'GET' }).request.user.directories.files, owner.files);
    assert.equal(call('/user/files/private.json', null, { method: 'GET' }).request.user.directories.files, guest.files);
    assert.deepEqual(call('/api/secrets/read').result.send({ api_key_openai: [], unrelated: ['private'] }), { api_key_openai: [] });
    assert.equal(call('/api/secrets/view').request.user.directories.root, guest.root);
    const model = custom_url => call('/api/backends/chat-completions/generate', { chat_completion_source: 'custom', custom_url, secret_id: 'configured' }).request.user.directories.root;
    assert.equal(model('https://model.example/v1'), owner.root);
    assert.equal(model('https://elsewhere.example/v1'), guest.root);
    for (const pathname of ['/api/worldinfo/get', '/api/characters/get', '/api/chats/get']) assert.equal(call(pathname).request.user.directories, guest);
});

test('bootstrap marks a signed-in passwordless original account as eligible for first-time password setup', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'st-display-first-password-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const openAI_Settings = path.join(root, 'presets');
    await fs.mkdir(openAI_Settings);
    await fs.writeFile(path.join(root, 'settings.json'), '{}');
    const routes = new Map();
    await init({ post: (route, handler) => routes.set(route, handler) }, { displayHost: {} });
    const bootstrap = async (password, handle = 'original-account') => {
        let result;
        const profile = { handle: 'original-account', password };
        await routes.get('/bootstrap')({ user: { profile, directories: { root, openAI_Settings } }, session: { handle } }, {
            json: value => { result = value; }, status: code => assert.fail(`Bootstrap failed with ${code}`),
        });
        return result;
    };
    assert.equal((await bootstrap('')).needsPrimaryPassword, true);
    const protectedAccount = await bootstrap('hashed');
    assert.equal(protectedAccount.needsPrimaryPassword, false);
    assert.equal(protectedAccount.displayTavern, 'owner');
    assert.equal((await bootstrap('', 'other-account')).needsPrimaryPassword, false);
});
