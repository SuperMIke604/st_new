import test from 'node:test';
import assert from 'node:assert/strict';
import { loginWithPassword } from '../login.js';

function fixture({ accepted = 'vault-user', status = 200, legacy = false } = {}) {
    const attempts = [];
    let token = 0;
    const fetch = async (path, options) => {
        if (path === '/csrf-token') return Response.json({ token: String(++token) });
        assert.equal(options.headers['X-CSRF-Token'], String(token));
        assert.notEqual(path, '/api/users/logout', 'a pending sign-in must preserve the current session');
        const credentials = JSON.parse(options.body);
        attempts.push([path, credentials]);
        if (legacy && path.endsWith('/st-new-login')) return new Response(null, { status: 403 });
        return Response.json({ handle: accepted }, { status, headers: { 'X-ST-New-Login': '1' } });
    };
    return { fetch, attempts, tokens: () => token };
}

test('either password is sent with the existing username to the same endpoint', async () => {
    for (const password of ['fixture-original', 'fixture-display']) {
        const { fetch, attempts } = fixture();
        await loginWithPassword('vault-user', password, fetch);
        assert.deepEqual(attempts, [['/api/users/st-new-login', { handle: 'vault-user', password }]]);
    }
});

test('credential rejection and rate limiting never trigger a second login attempt', async () => {
    const wrong = fixture({ status: 403 });
    await assert.rejects(loginWithPassword('vault-user', 'wrong', wrong.fetch), /用户名或密码有误/);
    assert.equal(wrong.attempts.length, 1);
    const limited = fixture({ status: 429 });
    await assert.rejects(loginWithPassword('vault-user', 'limited', limited.fetch), /尝试次数过多/);
    assert.equal(limited.attempts.length, 1);
    const mismatch = fixture({ accepted: 'unrelated' });
    await assert.rejects(loginWithPassword('vault-user', 'fixture', mismatch.fetch), /无法进入该账号/);
});

test('an older backend can still authenticate the original account with the native endpoint', async () => {
    const legacy = fixture({ legacy: true });
    await loginWithPassword('vault-user', 'fixture-original', legacy.fetch);
    assert.deepEqual(legacy.attempts.map(([path]) => path), ['/api/users/st-new-login', '/api/users/login']);
    assert.equal(legacy.tokens(), 1);
});
