const requestTimeout = () => AbortSignal.timeout(12000);

async function getToken(fetchRequest) {
    // A password changed in another session may invalidate the first cookie.
    let response = await fetchRequest('/csrf-token', { cache: 'no-store', signal: requestTimeout() });
    if (response.status === 403) response = await fetchRequest('/csrf-token', { cache: 'no-store', signal: requestTimeout() });
    if (!response.ok) throw Error('无法连接酒馆，请稍后重试。');
    const { token } = await response.json();
    if (!token) throw Error('无法初始化登录，请刷新页面。');
    return token;
}

export async function loginWithPassword(handle, password, fetchRequest = fetch) {
    const token = await getToken(fetchRequest);
    const post = (path, data = {}) => fetchRequest(`/api/users/${path}`, {
        method: 'POST', cache: 'no-store', signal: requestTimeout(),
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify(data),
    });
    let response = await post('st-new-login', { handle, password });
    if ([403, 404].includes(response.status) && !response.headers.has('X-ST-New-Login')) {
        response = await post('login', { handle, password });
    }
    if (response.status === 429) throw Error('尝试次数过多，请稍后再试。');
    if (response.status === 403) throw Error('用户名或密码有误，请重试。');
    if (!response.ok) throw Error('登录服务暂时不可用，请稍后重试。');
    const signedIn = await response.json();
    if (signedIn.handle !== handle) throw Error('无法进入该账号，请重新登录。');
}

const form = typeof document === 'undefined' ? null : document.getElementById('tavern-login');
if (form) {
    const username = document.getElementById('tavern-username');
    const password = document.getElementById('tavern-password');
    const status = document.getElementById('tavern-login-status');
    const submit = form.querySelector('button[type="submit"]');
    const back = document.getElementById('tavern-login-back');
    if (back) back.hidden = new URLSearchParams(location.search).get('switch') !== '1';
    try { username.value = sessionStorage.getItem('st-new-login-handle') || ''; } catch { /* Login still works. */ }
    const signIn = async (handle, secret) => {
        await loginWithPassword(handle, secret);
        try { sessionStorage.setItem('st-new-login-handle', handle); } catch { /* Login still works. */ }
        location.replace('./');
    };
    const errorMessage = error => error.name === 'TimeoutError' || error instanceof TypeError ? '连接酒馆失败，请重试。' : error.message;
    window.addEventListener('message', event => {
        const port = event.ports[0];
        if (!event.isTrusted || event.source !== null || event.data !== 'st-new-android-account-login' || !port) return;
        let pending = false;
        port.onmessage = async ({ data }) => {
            if (pending) return;
            pending = true;
            try {
                const { handle, password: secret } = JSON.parse(data);
                await signIn(handle, secret);
            } catch (error) {
                port.postMessage(JSON.stringify({ type: 'error', message: errorMessage(error) }));
            } finally { pending = false; }
        };
        port.postMessage(JSON.stringify({ type: 'ready', handle: username.value }));
    });
    submit.disabled = false;
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (submit.disabled) return;
        submit.disabled = true;
        username.readOnly = password.readOnly = true;
        status.hidden = true;
        submit.textContent = '正在登录…';
        try {
            await signIn(username.value.trim(), password.value);
            password.value = '';
        } catch (error) {
            status.textContent = errorMessage(error);
            status.hidden = false;
        } finally {
            submit.disabled = false;
            username.readOnly = password.readOnly = false;
            submit.textContent = '登录';
            if (!status.hidden) { password.focus(); password.select(); }
        }
    });
}
