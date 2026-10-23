import { BUILD } from './version.js';
export const UPDATE_URL = 'https://raw.githubusercontent.com/SuperMIke604/st_new/main/version.json';
export async function checkForUpdate({ fetcher = fetch, signal } = {}) {
    const response = await fetcher(`${UPDATE_URL}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal });
    if (!response.ok) throw new Error(`更新检查失败（${response.status}）`);
    const remote = await response.json();
    if (remote.schema !== 1 || typeof remote.revision !== 'string' || !/^[a-f0-9]{64}$/.test(remote.revision)) throw new Error('更新信息格式无效');
    return remote.revision === BUILD.revision ? null : remote;
}
export async function showUpdateNotice() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const remote = await checkForUpdate({ signal: controller.signal });
        if (!remote || document.getElementById('frontend-update')) return;
        const notice = document.createElement('aside'); notice.id = 'frontend-update'; notice.setAttribute('role', 'status');
        const label = document.createElement('span'); label.textContent = '发现新前端版本';
        const link = document.createElement('a'); link.textContent = '查看更新'; link.href = 'https://github.com/SuperMIke604/st_new'; link.target = '_blank'; link.rel = 'noopener noreferrer';
        const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', '关闭更新提示'); close.addEventListener('click', () => notice.remove());
        notice.append(label, link, close); document.body.append(notice);
    } catch (error) { console.debug('前端更新检查暂不可用：', error.message); }
    finally { clearTimeout(timer); }
}
