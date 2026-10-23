import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { init, validateManifest } from './index.mjs';
const files = Object.fromEntries(['index.html', 'main.js', 'version.js', 'style.css'].map(name => ['public/app/' + name, 'new ' + name]));
const manifest = { schema: 1, revision: 'a'.repeat(64), files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, createHash('sha256').update(value).digest('hex')])) };
test('manifest rejects traversal, server paths and missing entrypoints', () => {
    assert.equal(validateManifest(manifest).length, 4);
    for (const name of ['public/app/../config.yaml', 'public/app/vendor/../../config.yaml', 'server.js', 'public/app/x/y.js']) assert.throws(() => validateManifest({ ...manifest, files: { ...manifest.files, [name]: 'a'.repeat(64) } }));
    assert.throws(() => validateManifest({ ...manifest, files: {} }));
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
