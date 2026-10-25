import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDatabasePreview } from '../database-preview.js';

function fixture(settings = {}) {
    const node = (tag, className = '', text = '') => {
        const element = { tag, className, text, children: [], style: {}, dataset: {}, scrollTop: 0, scrollLeft: 0,
            append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
            setAttribute() {}, addEventListener() {},
            querySelector(selector) { for (const child of this.children) { if (child.className?.split(' ').includes(selector.slice(1))) return child; const nested = child.querySelector?.(selector); if (nested) return nested; } return null; }
        };
        element.classList = { add(value) { element.className += ' ' + value; } }; return element;
    };
    const body = node('main'), buttons = []; let writes = 0;
    const context = { settings, data: { sheet_0: { name: '表', content: [[null, '名称'], [null, '示例']] } }, el: node, index: 0,
        action(label, callback) { const button = node('button', '', label); button.callback = callback; buttons.push(button); return button; },
        savePreferences: async () => { writes++; }, saveData: async () => { writes++; },
    };
    renderDatabasePreview(body, context); return { body, buttons, writes: () => writes };
}

test('data preview retains an explicit reading size without persisting a UI default', () => {
    const saved = fixture({ dpFontSize: 23 });
    assert.equal(saved.body.querySelector('.reference-preview-grid').style.fontSize, '23px'); assert.equal(saved.body.querySelector('.reference-preview-grid').style.lineHeight, '1.5'); assert.equal(saved.writes(), 0);
    const defaulted = fixture();
    assert.match(defaulted.body.querySelector('.reference-preview-grid').style.fontSize, /var\(--type-body-size/); assert.equal(defaulted.writes(), 0);
});

test('canceling the preview font dialog keeps the saved reading size and settings', () => {
    const oldPrompt = globalThis.prompt; let initial;
    globalThis.prompt = (label, value) => { initial = value; return null; };
    try {
        const view = fixture({ dpFontSize: 23 }); view.buttons.find(button => button.text === '字体大小').callback();
        assert.equal(initial, '23'); assert.equal(view.writes(), 0); assert.equal(view.body.querySelector('.reference-preview-grid').style.fontSize, '23px');
    } finally { globalThis.prompt = oldPrompt; }
});
