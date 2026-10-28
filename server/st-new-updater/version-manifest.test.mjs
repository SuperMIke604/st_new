import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateManifest } from './index.mjs';

test('release manifest matches every distributed file and the displayed build', async () => {
    const root = new URL('../../', import.meta.url);
    const manifest = JSON.parse(await fs.readFile(new URL('version.json', root), 'utf8'));
    const entries = validateManifest(manifest);
    entries.push([manifest.backend.file, manifest.backend.sha256]);
    for (const [name, expected] of entries) {
        // Git distributes LF text, including when the checkout is on Windows.
        const text = (await fs.readFile(new URL(name, root), 'utf8')).replace(/\r\n/g, '\n');
        const actual = createHash('sha256').update(text).digest('hex');
        assert.equal(actual, expected, `${name}: run python scripts/refresh-version.py before publishing`);
    }
    const { BUILD } = await import('../../public/app/version.js');
    assert.equal(BUILD.revision, manifest.revision);
    assert.equal(BUILD.publishedAt, manifest.publishedAt);
});
