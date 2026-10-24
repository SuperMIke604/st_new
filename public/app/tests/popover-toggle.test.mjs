import test from 'node:test';
import assert from 'node:assert/strict';
import { installPopoverToggle } from '../popover-toggle.js';

class Control {
    listeners = new Map(); attributes = {};
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    fire(type, detail = 1) { this.listeners.get(type)?.({ detail, preventDefault() {} }); }
}
test('second tap closes even when browser light-dismiss runs before click', () => {
    const button = new Control(); let visible = false, opens = 0, closes = 0;
    const popup = { id: 'options', matches: () => visible };
    installPopoverToggle(button, popup, { open: () => { visible = true; opens++; }, close: () => { visible = false; closes++; } });
    button.fire('pointerdown'); button.fire('click'); assert.equal(visible, true);
    button.fire('pointerdown'); visible = false; button.fire('click');
    assert.equal(visible, false); assert.equal(opens, 1); assert.equal(closes, 1);
    button.fire('pointerdown'); button.fire('click'); assert.equal(visible, true);
    button.fire('click', 0); assert.equal(visible, false);
});
test('world select surface taps and cancelled pointer gestures use the same toggle rules', () => {
    const button = new Control(), surface = new Control(); let visible = true, opens = 0;
    const activate = installPopoverToggle(button, { id: 'worlds', matches: () => visible }, { pointerTarget: surface, open: () => { visible = true; opens++; }, close: () => { visible = false; } });
    surface.fire('pointerdown'); visible = false; activate({ detail: 1, preventDefault() {} }); assert.equal(visible, false); assert.equal(opens, 0);
    visible = true; surface.fire('pointerdown'); surface.fire('pointercancel'); visible = false;
    button.fire('click', 0); assert.equal(visible, true);
});
