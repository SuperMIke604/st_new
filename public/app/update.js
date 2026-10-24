import { BUILD } from './version.js';
export const UPDATE_URL = 'https://raw.githubusercontent.com/SuperMIke604/st_new/main/version.json';
export async function checkForUpdate({ fetcher = fetch, signal, includeCurrent = false } = {}) {
    const response = await fetcher(`${UPDATE_URL}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal });
    if (!response.ok) throw new Error(`更新检查失败（${response.status}）`);
    const remote = await response.json();
    if (remote.schema !== 1 || typeof remote.revision !== 'string' || !/^[a-f0-9]{64}$/.test(remote.revision)) throw new Error('更新信息格式无效');
    return !includeCurrent && remote.revision === BUILD.revision ? null : remote;
}
export function updateProgress() {
    const node = document.createElement('div'); node.className = 'update-progress'; node.setAttribute('role', 'status'); node.setAttribute('popover', 'manual'); node.textContent = '正在下载并校验更新，请稍候…'; document.body.append(node);
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
        const remote = await checkForUpdate({ signal: controller.signal, includeCurrent: true });
        const status = await api.post('/api/plugins/st-new-updater/status');
        if (status?.available !== true) throw new Error('更新模块不可用');
        const backendPending = remote.backend && status.selfUpdate === true && status.installedHash !== remote.backend.sha256;
        const legacyBackend = remote.backend && status.selfUpdate !== true;
        if (remote.revision === BUILD.revision && !backendPending) {
            notify(legacyBackend ? '前端已是最新；后端模块需运行一次安装脚本升级，之后即可一起更新。' : status.restartRequired ? '更新已安装，请重启酒馆使后端插件生效。' : '当前已是最新版本'); return;
        }
        const question = legacyBackend ? '发现新版本，是否更新前端？当前后端模块尚不支持自身更新，需要运行一次安装脚本升级，之后即可一起更新。' : remote.backend ? '发现新版本，是否一起更新前端与后端插件？如插件发生变化，完成后需重启酒馆。' : '发现新版本，是否立即更新前端？';
        if (!confirm(question)) return;
        guard(); activeProgress = progress();
        const result = await api.post('/api/plugins/st-new-updater/install', { revision: remote.revision });
        if (!result?.ok) throw new Error('更新安装失败');
        notify(result.restartRequired ? '前端与后端插件更新完成。请先保留未发送内容，再重启酒馆并刷新网页。' : legacyBackend ? '前端更新完成，请刷新网页。后端模块仍需运行一次安装脚本升级。' : '更新完成，刷新网页后生效。未发送的内容请先保留。');
    } catch (error) {
        notify(error.status === 404 ? '检测到新版，请先在 Termux 安装一次更新模块，步骤见仓库说明。' : `检查或更新失败：${error.message}`, true);
    } finally { activeProgress?.close(); clearTimeout(timer); checking = false; }
}
