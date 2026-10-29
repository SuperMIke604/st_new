import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { htmlCardContext, cardContextScript } from '../html-card-context.js';

function fixture(snapshot, marker = false) {
    const ready = [], events = [], messages = [];
    const window = { getMyIndex: () => 0, init: () => events.push('render') }, parent = {};
    const document = { readyState: 'loading', addEventListener: (_, fn) => ready.push(fn), querySelector: () => marker ? {} : null, dispatchEvent: event => events.push(event.type), createElement: () => ({}), head: { append: () => events.push('jquery') } };
    const context = vm.createContext({ window, parent, document, queueMicrotask: fn => fn(), CustomEvent: class { constructor(type) { this.type = type; } }, addEventListener: (_, fn) => messages.push(fn) });
    vm.runInContext(`(${htmlCardContext.toString()})(${JSON.stringify(snapshot)})`, context);
    return { window, ready, events, parent, receive: event => messages.forEach(fn => fn(event)) };
}

test('HTML cards read only their owning message and receive fresh result objects', () => {
    const { window } = fixture({ messageId: 14, message: '<star_zone>sample</star_zone>', name: 'Example', role: 'assistant' });
    assert.equal(window.getCurrentMessageId(), 14);
    assert.equal(window.getChatMessages(14)[0].message, '<star_zone>sample</star_zone>');
    assert.equal(window.getChatMessages('14')[0].role, 'assistant');
    assert.equal(window.getChatMessages(13).length, 0);
    window.getChatMessages(14)[0].message = 'changed';
    assert.equal(window.getChatMessages(14)[0].message, '<star_zone>sample</star_zone>');
});

test('HTML status initialization waits for the owning host library and reads cloned message variables', () => {
    const f = fixture({ helper: true, variables: { stat_data: { score: 7 } } });
    let initialized = false;
    f.window.$(() => { initialized = true; });
    f.ready.forEach(fn => fn());
    assert.equal(initialized, false);
    f.receive({ source: {}, data: { type: 'tavern-html-helper', jquery: 'untrusted' } });
    assert.equal(f.events.includes('jquery'), false);
    f.receive({ source: f.parent, data: { type: 'tavern-html-helper', jquery: 'local library' } });
    f.ready.forEach(fn => fn());
    assert.equal(initialized, true);
    const variables = f.window.getAllVariables(); variables.stat_data.score = 99;
    assert.equal(f.window._.get(f.window.getAllVariables(), 'stat_data.score'), 7);
    assert.equal(f.window._.get({}, '__proto__.polluted', 'blocked'), 'blocked');
    let updates = 0;
    f.window.eventOn(f.window.Mvu.events.VARIABLE_UPDATE_ENDED, () => { updates++; });
    f.receive({ source: {}, data: { type: 'tavern-html-variables', variables: { stat_data: { score: 99 } } } });
    assert.equal(f.window.getAllVariables().stat_data.score, 7);
    f.receive({ source: f.parent, data: { type: 'tavern-html-variables', variables: { stat_data: { score: 8 } } } });
    assert.equal(f.window.getAllVariables().stat_data.score, 8);
    assert.equal(updates, 1);
});

test('block ordinal is available before imported document-ready initializers', () => {
    const f = fixture({ messageId: 1, message: '', blockIndices: { fate_ui: 2 } }, true);
    let index;
    f.window.$(() => { index = f.window.getMyIndex(); });
    f.ready.forEach(fn => fn());
    assert.equal(index, 2);
});

test('optional avatar updates accept only the host and preserve alias lookups', () => {
    const f = fixture({ personaName: 'Example' }, true), records = [{ 键: 'person', 显示名: 'Example', 别名: ['Alias'], 图片: 'data:image/png;base64,AA==' }];
    f.receive({ source: {}, data: { type: 'tavern-html-avatars', records } });
    assert.equal(f.window.头像库.取图('Alias'), null);
    f.receive({ source: f.parent, data: { type: 'tavern-html-avatars', records } });
    assert.equal(f.window.头像库.取图('Alias'), records[0].图片);
    assert.equal(f.window.头像库.取主角图(), records[0].图片);
    assert.equal(f.events[0], '头像库更新');
});

test('message text cannot escape the embedded context script', () => {
    const script = cardContextScript({ messageId: 0, message: '</script><script>bad()</script>\u2028' });
    assert.equal((script.match(/<\/script>/g) || []).length, 1);
    assert.ok(script.includes('\\u003c/script>'));
    assert.doesNotThrow(() => new Function(script.slice(8, -9)));
});

test('preview libraries get isolated in-memory storage without cross-frame persistence', () => {
    const first = fixture({}).window.localStorage, second = fixture({}).window.localStorage;
    first.setItem('theme', 'dark');
    assert.equal(first.getItem('theme'), 'dark');
    assert.equal(first.length, 1); assert.equal(first.key(0), 'theme');
    assert.equal(second.getItem('theme'), null);
    first.removeItem('theme'); assert.equal(first.getItem('theme'), null);
});
