import { cardContextScript } from './html-card-context.js';
import { remoteHtmlUrl, fetchRemoteHtml, remoteHtmlDocument } from './html-card-loader.js';
import { adaptDeploymentVariables, adaptHtmlOpening, adaptMvuSealOpening } from './html-opening.js';
import { adaptHtmlMvuReparse } from './html-mvu-reparse.js';
import { adaptHtmlOrder } from './html-order.js';
import { adaptMazeSend } from './html-maze-send.js';

function adaptOpeningSend(source) {
    // Keep the form and its generated text. Replace only the send path.
    if (source.includes('var sent=sendBody(body);') && source.includes("d2.getElementById('send_textarea')") && source.includes("d2.getElementById('send_but')")) {
        const nativeSend = /function sendBody\(text\)\{[\s\S]*?\n\}(?=\s*function archItems\()/;
        if (nativeSend.test(source)) return source
            .replace(nativeSend, 'async function sendBody(text){\n  try{await window.__sendOpening(text);return true;}catch(error){window.alert(error.message);return false;}\n}')
            .replace('var sent=sendBody(body);', 'var sent=await sendBody(body);');
    }
    const legacySend = /triggerSlash\(`\/send \$\{txt\.replace\(\/\\n\/g,' '\)\} \| \/trigger`\);/;
    if (source.includes('function sub(){') && legacySend.test(source)) {
        return source.replace('function sub(){', 'async function sub(){')
            .replace(legacySend, 'await window.__sendOpening(txt.replace(/\\n/g,\' \'));')
            .replace('alert("错误");console.error(e);', 'alert(e.message);console.error(e);');
    }
    return null;
}
const aliases = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', htm: 'html', xml: 'html' };
export function codeLanguage(value = '') { const language = value.toLowerCase().replace(/^language-/, '').split(/\s/)[0]; return aliases[language] || language; }
export function isHtmlPreview(source, language = '') {
    language = codeLanguage(language);
    // Imported cards sometimes label a complete HTML document as text/test.
    // Detect the document itself without treating arbitrary tagged code
    // fragments in explicitly named programming languages as HTML cards.
    const document = /^\s*(?:<!doctype\s+html\b[^>]*>\s*)?<html\b[^>]*>[\s\S]*<\/(?:html)\s*>\s*$/i.test(source);
    return language === 'html' || document || (!language && /^\s*(?:<!doctype html|<html|<body\b|<style|<div|<details|<section|<form|<button|<input|<article|<main|<script)/i.test(source));
}
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
let previewJquery;
export function refreshHtmlVariables(container, variables = {}) {
    for (const frame of container.querySelectorAll('iframe.html-message')) {
        if ((!frame._helper && !frame._mvuReparse) || frame._variables === variables) continue;
        frame._variables = variables;
        frame.contentWindow?.postMessage({ type: 'tavern-html-variables', variables }, '*');
    }
}
function registerPreview(frame, loaded = false) {
    if (!previewListenerInstalled) {
        window.addEventListener('message', event => {
            for (const [source, target] of previewFrames) {
                if (!target.isConnected) previewFrames.delete(source);
            }
            const target = previewFrames.get(event.source);
            if (!target) return;
            if (event.data?.type === 'tavern-html-request' && Number.isSafeInteger(event.data.id) && typeof event.data.operation === 'string') {
                const source = event.source, { id, operation, payload } = event.data;
                Promise.resolve().then(() => {
                    if (!target.isConnected || !target._scriptAction) throw Error('此消息接口未接入或页面已关闭。');
                    return target._scriptAction(operation, payload);
                }).then(value => { if (target.isConnected) source.postMessage({ type: 'tavern-html-response', id, value }, '*'); }, error => {
                    if (target.isConnected) source.postMessage({ type: 'tavern-html-response', id, error: error.message }, '*');
                }); return;
            }
            if (event.data?.type === 'tavern-html-edit') { target._edit?.(); return; }
            if (event.data?.type === 'tavern-html-send' && typeof event.data.text === 'string' && event.data.text.length <= 100000) {
                if (confirm('发送此卡片生成的内容并请求回复？\n\n' + event.data.text.slice(0, 300))) target._send?.(event.data.text);
                return;
            }
            if (event.data?.type === 'tavern-html-alert') { target._notify?.(String(event.data.text || '').slice(0, 1000)); return; }
            if (event.data?.type !== 'tavern-html-height') return;
            const height = event.data.height;
            if (!Number.isFinite(height)) return;
            const bounded = Math.min(20000, Math.max(1, Math.ceil(height)));
            if (Math.abs(target.getBoundingClientRect().height - bounded) > 1) target.style.height = `${bounded}px`;
        });
        previewListenerInstalled = true;
    }
    if (frame.contentWindow) {
        previewFrames.set(frame.contentWindow, frame);
        if (loaded && frame._helper && !frame._helperRequested) {
            frame._helperRequested = true;
            previewJquery ||= fetch('./vendor/jquery.min.js').then(async response => {
                if (!response.ok) throw Error('HTML 助手运行库读取失败。');
                const text = await response.text();
                if (!text.includes('jQuery v')) throw Error('HTML 助手运行库内容异常。');
                return text;
            }).catch(error => { previewJquery = null; throw error; });
            previewJquery.then(jquery => { if (frame.isConnected) frame.contentWindow?.postMessage({ type: 'tavern-html-helper', jquery, variables: frame._variables }, '*'); })
                .catch(error => frame.contentWindow?.postMessage({ type: 'tavern-html-helper', error: error.message }, '*'));
        }
        if (loaded && frame._avatars && !frame._avatarsRequested) {
            frame._avatarsRequested = true;
            Promise.resolve().then(() => frame._avatars()).then(records => {
                if (frame.isConnected) frame.contentWindow?.postMessage({ type: 'tavern-html-avatars', records }, '*');
            }).catch(() => {}); // Missing optional avatars keep the card's own fallback.
        }
        // The iframe can finish its first measurement before it is mounted or
        // registered. Request a fresh measurement after registering on load.
        frame.contentWindow.postMessage({ type: 'tavern-html-measure' }, '*');
    }
}
// Runs inside the iframe, where the card's computed styles are available.
function installPreviewEdgeStyles() {
    const style = document.createElement('style');
    document.head.append(style);
    const marker = 'data-st-new-preview-edge';
    let previousWidth;
    let adjustedCard;
    function update() {
        const width = document.documentElement.clientWidth;
        previousWidth = width;
        adjustedCard?.removeAttribute(marker);
        adjustedCard = null;
        style.textContent = '';
        const body = document.body;
        if (!body || !width) return;
        const visible = [...body.children].filter(element => {
            const bounds = element.getBoundingClientRect();
            return bounds.width > 0 && bounds.height > 0 && getComputedStyle(element).visibility === 'visible';
        });
        if (visible.length !== 1) return;

        const [card] = visible;
        const bounds = card.getBoundingClientRect();
        const appearance = getComputedStyle(card);
        if (bounds.width < width * 0.85) return;
        const shadows = appearance.boxShadow.match(/(?:[^(),]|\([^)]*\))+/g) ?? [];
        const outerShadows = shadows.filter(shadow => !/\binset\b/.test(shadow));
        const backdrop = getComputedStyle(body);
        const bottomSpace = body.getBoundingClientRect().bottom + (parseFloat(backdrop.marginBottom) || 0) - bounds.bottom;
        const reachesEdge = (space, reach) => Math.max(0, space) < Math.min(24, reach);
        // Darker shadows can leave a visible edge even with a smaller blur.
        const clipsStrongShadow = outerShadows.some(shadow => {
            const [color = ''] = shadow.match(/[a-z-]+\([^)]*\)/i) ?? [];
            const alphaValue = color.match(/\/\s*([\d.]+%?)\)$/)?.[1] ??
                color.match(/^(?:rgba|hsla)\([^)]*,\s*([\d.]+%?)\)$/)?.[1] ?? '1';
            const alpha = parseFloat(alphaValue) / (alphaValue.endsWith('%') ? 100 : 1);
            const lengths = shadow.replace(color, '').match(/-?[\d.]+px/g) ?? [];
            const [x = 0, y = 0, blur = 0, spread = 0] = lengths.map(length => parseFloat(length));
            const minimumBlur = alpha >= 0.65 ? 16 : alpha >= 0.3 ? 24 : 40;
            if (alpha < 0.12 || blur < minimumBlur) return false;
            const reach = blur / 2 + spread;
            return reachesEdge(bounds.left, reach - x) || reachesEdge(width - bounds.right, reach + x) ||
                reachesEdge(bounds.top, reach - y) || reachesEdge(bottomSpace, reach + y);
        });
        if (!clipsStrongShadow) return;

        const inset = shadows.filter(shadow => /\binset\b/.test(shadow));
        const root = getComputedStyle(document.documentElement);
        // A solid body backdrop under a full-bleed card shows up as a rectangle
        // beside its rounded corners. Preserve backgrounds used as part of a layout.
        const fullBleed = Math.abs(bounds.left) <= 1 && Math.abs(width - bounds.right) <= 1;
        const rounded = parseFloat(appearance.borderBottomLeftRadius) && parseFloat(appearance.borderBottomRightRadius);
        const useHostSurface = fullBleed && rounded && root.backgroundColor === 'rgba(0, 0, 0, 0)' &&
            root.backgroundImage === 'none' && backdrop.backgroundImage === 'none' &&
            (appearance.backgroundImage !== 'none' || appearance.backgroundColor !== 'rgba(0, 0, 0, 0)');
        adjustedCard = card;
        card.setAttribute(marker, '');
        style.textContent = 'body > [' + marker + ']{box-shadow:' + (inset.join(',') || 'none') + '!important}' +
            (useHostSurface ? 'body{background-color:transparent!important}' : '');
    }
    addEventListener('DOMContentLoaded', () => {
        new MutationObserver(update).observe(document.body, { childList: true });
        update();
    }, { once: true });
    addEventListener('load', update, { once: true });
    addEventListener('animationend', event => {
        if (event.target.parentElement === document.body) update();
    });
    addEventListener('resize', () => {
        if (document.documentElement.clientWidth !== previousWidth) update();
    });
}

export function previewDocument(source, context = {}, remote = false) {
    if (!remote && source.includes('&amp;&amp;')) {
        // SillyTavern removes one ampersand escape layer from rendered code blocks.
        // Restore that layer in encoded inline JS while preserving HTML text and attributes.
        source = source.replace(/(<script\s*>)([\s\S]*?)(<\/script\s*>)/gi, (block, opening, script, closing) =>
            script.includes('&amp;&amp;') ? opening + script.replaceAll('&amp;', '&') + closing : block);
    }
    if (context.scriptActions && source.includes("document.querySelectorAll('.sys-btn')") && source.includes("triggerSlash('/setinput ' + command)")) {
        source = source.replace(/\}\.catch\(function \(\) \{\s*triggerSlash\('\/echo severity=info 已填入命令：' \+ command\);/, "}.catch(function (error) { window.alert(error.message || String(error));");
    }
    if (context.scriptActions && !remote) source = adaptHtmlOrder(source);
    const cdn = remote ? ' https://testingcf.jsdelivr.net https://cdn.jsdelivr.net' : '';
    const policy = `default-src 'none'; script-src 'unsafe-inline'${cdn}; style-src 'unsafe-inline' https://fonts.googleapis.com${cdn}; img-src data: blob: http: https:; font-src data: https://fonts.gstatic.com${cdn}; connect-src 'none'; form-action 'none'; base-uri 'none'`;
    const bridge = `<script>(()=>{
        window.alert=text=>parent.postMessage({type:'tavern-html-alert',text:String(text)},'*');
        window.triggerSlash=command=>{const match=String(command).match(/^\\/send\\s+([\\s\\S]*?)\\|\\/trigger\\s*$/);if(!match)throw Error('仅支持 /send 内容|/trigger');parent.postMessage({type:'tavern-html-send',text:match[1]},'*');};
        let pending=false,last=0;
        const measure=()=>{pending=false;const body=document.body;if(!body)return;const style=getComputedStyle(body);const height=Math.min(20000,Math.max(1,Math.ceil(Math.max(body.scrollHeight,body.getBoundingClientRect().height)+(parseFloat(style.marginTop)||0)+(parseFloat(style.marginBottom)||0))));if(height!==last){last=height;parent.postMessage({type:'tavern-html-height',height},'*');}};
        const schedule=()=>{if(!pending){pending=true;requestAnimationFrame(measure);}};
        addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='tavern-html-measure'){last=0;schedule();}});
        addEventListener('DOMContentLoaded',()=>{new ResizeObserver(schedule).observe(document.body);new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});document.addEventListener('toggle',schedule,true);document.addEventListener('input',schedule,true);document.addEventListener('change',schedule,true);schedule();});
        addEventListener('load',schedule);addEventListener('resize',schedule);
        document.addEventListener('submit',event=>event.preventDefault());
        const canEdit=target=>!target.closest('button,input,textarea,select,a,summary');
        document.addEventListener('dblclick',event=>{if(canEdit(event.target)){event.preventDefault();parent.postMessage({type:'tavern-html-edit'},'*');}});
        let tap=null;document.addEventListener('pointerup',event=>{if(event.pointerType==='mouse'||!canEdit(event.target)){tap=null;return;}const next={time:Date.now(),x:event.clientX,y:event.clientY};if(tap&&next.time-tap.time<=350&&Math.hypot(next.x-tap.x,next.y-tap.y)<=24){tap=null;parent.postMessage({type:'tavern-html-edit'},'*');}else tap=next;});document.addEventListener('pointercancel',()=>{tap=null;});
    })();<\/script>`;
    const snapshot = { messageId: 0, message: '', name: '', role: 'assistant', personaName: '', blockIndices: {}, ...context };
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:light}body{margin:0;font:14px/1.7 system-ui,sans-serif;overflow-wrap:anywhere;display:flow-root}*{box-sizing:border-box}img{max-width:100%}pre{white-space:pre-wrap}@media(max-width:700px){*{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}}</style>${bridge}<script>(${installPreviewEdgeStyles})();<\/script>${cardContextScript(snapshot)}</head><body>${source}</body></html>`;
}

export function decorateCodeBlocks(container, { icon, notify, send, edit, messageId, message = '', name: messageName = '', role = 'assistant', personaName = '', variables = {}, getAvatars, scriptAction, swipes } = {}) {
    let fateIndex = 0;
    for (const code of container.querySelectorAll('pre > code')) {
        const pre = code.parentElement, source = code.textContent;
        const language = codeLanguage([...code.classList].find(name => name.startsWith('language-')) || [...code.classList][0] || '');
        const html = isHtmlPreview(source, language);
        if (html) {
            const canOpen = messageId === 0 && role === 'assistant' && scriptAction;
            const seal = canOpen ? adaptMvuSealOpening(source) : null;
            const opening = seal || (canOpen ? adaptHtmlOpening(source) : null);
            const openingSend = canOpen && !opening ? adaptOpeningSend(source) : null;
            const deployment = openingSend && adaptDeploymentVariables(openingSend);
            const reparse = Number.isSafeInteger(messageId) && messageId > 0 && role === 'assistant' && scriptAction ? adaptHtmlMvuReparse(source) : null;
            const mazeSend = Number.isSafeInteger(messageId) && messageId >= 0 && role === 'assistant' && scriptAction && !opening && !openingSend && !reparse
                ? adaptMazeSend(source, messageId === 0) : null;
            const frame = document.createElement('iframe'); frame.className = 'html-message'; frame.title = 'HTML 内容';
            if (Number.isInteger(messageId) && messageId >= 0) frame.name = `TH-message--${messageId}--preview`;
            frame._send = send; frame._notify = notify; frame._edit = edit;
            frame._scriptAction = (operation, payload) => {
                if (operation === 'send-opening' && !openingSend) throw Error('此消息不支持直接发送开局。');
                if (operation === 'write-opening-stat' && !deployment) throw Error('此消息不支持保存通告单变量。');
                if (operation === 'send-card-message' && !mazeSend) throw Error('此消息不支持直接发送指令。');
                if (operation.startsWith('opening-') && (!opening || operation.startsWith('opening-seal') !== !!seal)) throw Error('此消息不支持该开局操作。');
                if (operation.startsWith('mvu-') && !reparse) throw Error('此消息不支持重填 MVU 变量。');
                return scriptAction?.(operation, payload);
            };
            frame._mvuReparse = !!reparse;
            frame._helper = /\b(?:errorCatched|waitGlobalInitialized|getAllVariables)\b/.test(source);
            frame._variables = variables;
            frame._avatars = source.includes('头像库') ? getAvatars : null;
            // Form submit handlers need allow-forms even when they prevent the
            // default submission. CSP form-action 'none' still blocks navigation.
            frame.setAttribute('sandbox', 'allow-scripts allow-forms'); frame.referrerPolicy = 'no-referrer';
            frame.addEventListener('load', () => registerPreview(frame, true));
            const blockIndices = /data-fate-marker\s*=/.test(source) ? { fate_ui: fateIndex++ } : {};
            const context = { messageId: Number.isInteger(messageId) ? messageId : 0, message, name: messageName, role, personaName, blockIndices, variables, helper: frame._helper, scriptActions: !!scriptAction, opening: !!opening, swipes: Array.isArray(swipes) && JSON.stringify(swipes).length <= 500000 ? swipes : undefined };
            const remote = remoteHtmlUrl(source);
            context.mvuReparse = !!reparse;
            context.openingSend = !!openingSend && !remote;
            context.deployment = !!deployment && !remote;
            context.cardSend = !!mazeSend && !remote;
            frame.srcdoc = previewDocument(remote ? '<p role="status">正在加载 HTML 页面…</p>' : opening ?? (deployment || openingSend) ?? reparse ?? mazeSend ?? source, context);
            pre.replaceWith(frame); registerPreview(frame);
            if (remote) void fetchRemoteHtml(remote).then(html => {
                if (frame.isConnected) frame.srcdoc = previewDocument(remoteHtmlDocument(html), context, true);
            }).catch(error => {
                if (!frame.isConnected) return;
                frame.srcdoc = previewDocument('<p role="alert">远程 HTML 页面加载失败，请检查网络后重新打开聊天。</p>', context);
                notify?.(error.message, true);
            });
            continue;
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
