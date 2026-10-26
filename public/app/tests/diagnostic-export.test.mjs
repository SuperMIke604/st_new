import test from 'node:test';
import assert from 'node:assert/strict';
import { exportDiagnostics } from '../diagnostic-export.js';

test('in-flight export captures a snapshot without download and saves the same snapshot after completion', async () => {
    let busy = true, urlsCreated = 0, blob, clicked = 0;
    const nodes = [], parent = { append(node) { nodes.push(node); }, querySelector() { return null; } };
    const doc = { createElement(tag) { return { tag, children: [], setAttribute() {}, addEventListener(_type, callback) { this.callback = callback; }, append(...children) { this.children.push(...children); }, click() { clicked++; }, remove() {} }; } };
    const dependencies = { document: doc, urls: { createObjectURL(value) { urlsCreated++; blob = value; return 'blob:snapshot'; }, revokeObjectURL() {} }, later() {} };
    exportDiagnostics('{"schema":3,"pending":true}', parent, () => busy, dependencies);
    const [note, preview, save] = nodes[0].children;
    assert.equal(urlsCreated, 0); assert.equal(preview.readOnly, true); assert.match(preview.value, /pending/);
    save.callback(); assert.equal(clicked, 0); assert.match(note.textContent, /仍在生成/);
    busy = false; save.callback();
    assert.equal(clicked, 1); assert.equal(await blob.text(), preview.value);
    const link = nodes.at(-1); assert.equal(link.tag, 'a'); assert.equal(link.target, '_blank'); assert.equal(link.download, 'loading-timings.json');
});
