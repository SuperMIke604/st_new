// Recognize a standalone jQuery body loader. Fetch only public, pinned CDN HTML;
// never forward application cookies or allow a card to fetch a local endpoint.
export function remoteHtmlUrl(source) {
    const match = /^\s*<body\b[^>]*>\s*<script\b[^>]*>\s*\$\(\s*(['"])body\1\s*\)\.load\(\s*(['"])(https:\/\/[^'"\s]+)\2\s*\)\s*;?\s*<\/script>\s*<\/body>\s*$/i.exec(source);
    if (!match) return null;
    try {
        if (decodeURIComponent(match[3]).split('/').some(part => part === '.' || part === '..')) return null;
        const url = new URL(match[3]);
        if (url.username || url.password || url.search || url.hash || url.port || !['testingcf.jsdelivr.net', 'cdn.jsdelivr.net'].includes(url.hostname)) return null;
        const path = decodeURIComponent(url.pathname);
        if (!/^\/gh\/[\w.-]+\/[\w.-]+@(?:[a-f0-9]{40}|v?\d+\.\d+\.\d+(?:-[\w.-]+)?)\/(?:[^/?#]+\/)*[^/?#]+\.html$/.test(path) || path.split('/').some(part => part === '.' || part === '..')) return null;
        return url.href;
    } catch { return null; }
}

export async function fetchRemoteHtml(url, fetcher = fetch) {
    // Validate again at the network boundary, including direct callers.
    if (!remoteHtmlUrl(`<body><script>$('body').load('${url}')</script></body>`)) throw Error('只支持固定版本 CDN 的 HTML 页面。');
    const response = await fetcher(url, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error(`远程 HTML 加载失败（HTTP ${response.status}）。`);
    if (Number(response.headers?.get('content-length')) > 2000000) throw Error('远程 HTML 超出 2MB 限制。');
    const source = await response.text();
    if (source.length > 2000000 || !/<(?:!doctype\s+html|html|body)\b/i.test(source)) throw Error('远程 HTML 内容无效或超出限制。');
    return source;
}

export function remoteHtmlDocument(source) {
    // Compiled Vue cards declare Vue as a webpack external. Supply the real
    // library in the same module scope before executing the original bundle.
    return source.replace(/(<script\b[^>]*\btype\s*=\s*['"]module['"][^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (_, open, code, close) =>
        open + (/\bexports\s*=\s*Vue\b/.test(code) ? "import * as __cardVue from 'https://testingcf.jsdelivr.net/npm/vue@3.5.21/+esm'; const Vue = __cardVue;\n" : '') + code.replace(/\bwindow\.top\s*\|\|\s*window\b/g, 'window') + close);
}
