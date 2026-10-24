import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { LoadTimings } from '../load-timings.js';
const source = await fs.readFile(new URL('../main.js', import.meta.url), 'utf8');
const startup = source.slice(source.indexOf('function startupStage('), source.indexOf('async function initializeConnections('));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
    const recent = deferred(), settings = deferred(), connections = deferred(), state = {}, views = [], logs = new LoadTimings();
    const context = vm.createContext({ state, document: { querySelector: () => null }, loadTimings: logs,
        homeRecentRequest: null, connectionInitialization: null,
        api: { connect: async () => {}, loadConnections: () => connections.promise },
        loadRecentCharacters: () => recent.promise, reloadResources: () => settings.promise,
        initializeConnections: request => request,
        welcome: () => views.push({ loading: state.startupLoading, ready: state.ready }), synchronize() {}, notify() {},
    });
    vm.runInContext(startup, context);
    return { state, views, recent, settings, connections, logs, run: () => vm.runInContext('start()', context) };
}
test('home loading stays visible until settings, recent characters and connection initialization all finish', async () => {
    for (const last of ['recent', 'settings', 'connections']) {
        const f = fixture(), running = f.run(); await tick();
        for (const step of ['recent', 'settings', 'connections']) if (step !== last) f[step].resolve([]);
        await tick();
        assert.equal(f.state.startupLoading, true, `${last} is still pending`);
        assert.equal(f.state.ready, false);
        f[last].resolve([]); await running;
        assert.equal(f.state.startupLoading, false); assert.equal(f.state.ready, true);
        assert.equal(f.views.at(-1).loading, false);
        assert.equal(f.logs.snapshot().find(entry => entry.label === '全局初始化').status, 'success');
    }
});
test('startup failures dismiss the loader only after outstanding reads settle and allow a retry state', async () => {
    const f = fixture(), running = f.run();
    const rejected = assert.rejects(running, /settings offline/);
    await tick(); f.settings.reject(new Error('settings offline')); await tick();
    assert.equal(f.state.startupLoading, true);
    f.recent.resolve([]); f.connections.resolve({}); await rejected;
    assert.equal(f.state.ready, false); assert.equal(f.state.startupLoading, false);
    assert.equal(f.state.startupError, 'settings offline');
    assert.equal(f.logs.snapshot().find(entry => entry.label === '全局初始化').status, 'error');
});
test('connection failure finishes initialization with an explicit partial status', async () => {
    const f = fixture(), running = f.run(); await tick();
    f.recent.resolve([]); f.settings.resolve({}); f.connections.reject(new Error('connection offline'));
    await running;
    assert.equal(f.state.startupLoading, false); assert.equal(f.state.ready, true);
    assert.equal(f.state.connectionError, 'connection offline');
    assert.equal(f.logs.snapshot().find(entry => entry.label === '全局初始化').status, 'partial');
});
