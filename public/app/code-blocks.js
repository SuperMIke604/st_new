const aliases = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', htm: 'html', xml: 'html' };
export function codeLanguage(value = '') { const language = value.toLowerCase().replace(/^language-/, '').split(/\s/)[0]; return aliases[language] || language; }
export function codeTokens(source, language) {
    const html = language === 'html';
    const pattern = html ? /(<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|<!DOCTYPE[^>]*>)/gi
        : /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|\#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|if|else|for|while|class|new|import|from|export|default|async|await|try|catch|throw|true|false|null|undefined|def|in|and|or|not|None|True|False|print|with|as|public|private|static|void|int|string)\b|\b\d+(?:\.\d+)?\b)/g;
    const tokens = []; let end = 0;
    for (const match of source.matchAll(pattern)) {
        if (match.index > end) tokens.push({ text: source.slice(end, match.index), kind: '' });
        const text = match[0];
        const kind = html ? text.startsWith('<!--') ? 'comment' : 'tag' : /^(\/\/|\/\*|#)/.test(text) ? 'comment' : /^["'`]/.test(text) ? 'string' : /^\d/.test(text) ? 'number' : 'keyword';
        tokens.push({ text, kind }); end = match.index + text.length;
    }
    if (end < source.length) tokens.push({ text: source.slice(end), kind: '' });
    return tokens;
}

// Message scripts run in an opaque-origin sandbox, never in the host document.
const previewFrames = new Map();
let previewListenerInstalled = false;
function registerPreview(frame) {
    if (!previewListenerInstalled) {
        window.addEventListener('message', event => {
            for (const [source, target] of previewFrames) {
                if (!target.isConnected) previewFrames.delete(source);
            }
            const target = previewFrames.get(event.source);
            if (!target || event.data?.type !== 'tavern-html-height') return;
            const height = event.data.height;
            if (!Number.isFinite(height)) return;
            const bounded = Math.min(20000, Math.max(1, Math.ceil(height)));
            if (Math.abs(target.getBoundingClientRect().height - bounded) > 1) target.style.height = `${bounded}px`;
        });
        previewListenerInstalled = true;
    }
    if (frame.contentWindow) previewFrames.set(frame.contentWindow, frame);
}
export function previewDocument(source) {
    const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
    const bridge = `<script>(()=>{
        let pending=false,last=0;
        const measure=()=>{pending=false;const body=document.body;if(!body)return;const style=getComputedStyle(body);const height=Math.min(20000,Math.max(1,Math.ceil(Math.max(body.scrollHeight,body.getBoundingClientRect().height)+(parseFloat(style.marginTop)||0)+(parseFloat(style.marginBottom)||0))));if(height!==last){last=height;parent.postMessage({type:'tavern-html-height',height},'*');}};
        const schedule=()=>{if(!pending){pending=true;requestAnimationFrame(measure);}};
        addEventListener('DOMContentLoaded',()=>{new ResizeObserver(schedule).observe(document.body);new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});document.addEventListener('toggle',schedule,true);document.addEventListener('input',schedule,true);document.addEventListener('change',schedule,true);schedule();});
        addEventListener('load',schedule);addEventListener('resize',schedule);
        document.addEventListener('submit',event=>event.preventDefault());
    })();<\/script>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:light}body{margin:0;font:14px/1.7 system-ui,sans-serif;overflow-wrap:anywhere;display:flow-root}*{box-sizing:border-box}img{max-width:100%}pre{white-space:pre-wrap}@media(max-width:700px){*{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}}</style>${bridge}</head><body>${source}</body></html>`;
}

export function decorateCodeBlocks(container, { icon, notify }) {
    for (const code of container.querySelectorAll('pre > code')) {
        const pre = code.parentElement, source = code.textContent;
        const language = codeLanguage([...code.classList].find(name => name.startsWith('language-')) || [...code.classList][0] || '');
        const html = language === 'html' || (!language && /^\s*(?:<!doctype html|<html|<style|<div|<details|<section|<form|<button|<input|<article|<main|<script)/i.test(source));
        if (html) {
            const frame = document.createElement('iframe'); frame.className = 'html-message'; frame.title = 'HTML 内容';
            frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer';
            frame.addEventListener('load', () => registerPreview(frame));
            frame.srcdoc = previewDocument(source); pre.replaceWith(frame); registerPreview(frame); continue;
        }
        const wrapper = document.createElement('section'); wrapper.className = 'code-block';
        const bar = document.createElement('div'); bar.className = 'code-toolbar';
        const name = document.createElement('span'); name.className = 'code-language'; name.textContent = language || (html ? 'html' : '代码'); bar.append(name);
        const button = (label, glyph, callback) => {
            const control = document.createElement('button'); control.type = 'button'; control.title = label; control.setAttribute('aria-label', label); control.append(icon(glyph), document.createTextNode(label)); control.addEventListener('click', callback); bar.append(control); return control;
        };
        button('复制代码', 'copy', async () => {
            try { await navigator.clipboard.writeText(source); notify('代码已复制'); } catch { notify('复制失败，请手动选择代码复制', true); }
        });
        pre.replaceWith(wrapper); wrapper.append(bar, pre);
        // Avoid expensive highlighting for exceptionally large or streaming blocks.
        if (source.length <= 60000) {
            const fragment = document.createDocumentFragment();
            for (const token of codeTokens(source, html ? 'html' : language)) {
                if (!token.kind) fragment.append(document.createTextNode(token.text));
                else { const span = document.createElement('span'); span.className = `code-${token.kind}`; span.textContent = token.text; fragment.append(span); }
            }
            code.replaceChildren(fragment);
        }
    }
}
