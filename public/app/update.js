import { BUILD } from './version.js';
export const UPDATE_URL = 'https://raw.githubusercontent.com/SuperMIke604/st_new/main/version.json';
export async function checkForUpdate({ fetcher = fetch, signal } = {}) {
    const response = await fetcher(`${UPDATE_URL}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal });
    if (!response.ok) throw new Error(`更新检查失败（${response.status}）`);
    const remote = await response.json();
    if (remote.schema !== 1 || typeof remote.revision !== 'string' || !/^[a-f0-9]{64}$/.test(remote.revision)) throw new Error('更新信息格式无效');
    return remote.revision === BUILD.revision ? null : remote;
}
export function updateProgress() {
    const node = document.createElement('div'); node.className = 'update-progress'; node.setAttribute('role', 'status'); node.setAttribute('popover', 'manual'); node.textContent = '正在下载并安装更新，请稍候…'; document.body.append(node);
    node.showPopover?.();
    return { close() { node.remove(); } };
}
let checking = false;
export async function manualUpdate({ api, notify, guard, progress = updateProgress }) {
    if (checking) return;
    guard(); checking = true;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
    let activeProgress;
    try {
        notify('正在检查更新…');
        const remote = await checkForUpdate({ signal: controller.signal });
        if (!remote) { notify('当前已是最新版本'); return; }
        const status = await api.post('/api/plugins/st-new-updater/status');
        if (status?.available !== true) throw new Error('更新模块不可用');
        if (!confirm('发现新版本，是否立即更新前端？')) return;
        guard(); activeProgress = progress();
        const result = await api.post('/api/plugins/st-new-updater/install', { revision: remote.revision });
        if (!result?.ok) throw new Error('更新安装失败');
        notify('更新完成，刷新网页后生效。未发送的内容请先保留。');
    } catch (error) {
        notify(error.status === 404 ? '检测到新版，请先在 Termux 安装一次更新模块，步骤见仓库说明。' : `检查或更新失败：${error.message}`, true);
    } finally { activeProgress?.close(); clearTimeout(timer); checking = false; }
}
