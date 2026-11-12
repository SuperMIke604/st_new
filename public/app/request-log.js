import { copyDiagnostics } from './diagnostic-export.js';

const preferenceKey = 'st-new-request-log-enabled';
export const REQUEST_LOG_LIMIT = 10;
const sources = { chat: '原生对话', script: '脚本', database: '资料库' };
const statuses = { pending: '请求中', success: '已完成', error: '失败', cancelled: '已停止' };

export class RequestLog extends EventTarget {
    #entries = [];
    #sequence = 0;
    #enabled = true;

    constructor(storage = () => undefined) {
        super();
        this.storage = storage;
        try { this.#enabled = storage()?.getItem(preferenceKey) !== 'false'; } catch { /* Storage may be blocked. */ }
    }

    get enabled() { return this.#enabled; }

    setEnabled(enabled) {
        this.#enabled = enabled;
        try { this.storage()?.setItem(preferenceKey, String(enabled)); } catch { /* Keep the setting for this tab. */ }
        this.dispatchEvent(new Event('change'));
    }

    get entries() { return this.#entries.slice(); }

    clear() {
        this.#entries = [];
        this.dispatchEvent(new Event('change'));
    }

    start(source, body, signal, api) {
        if (!this.enabled || signal?.aborted || !Array.isArray(body.messages)) return;
        let messages;
        try { messages = structuredClone(body.messages); } catch { return; }
        const id = ++this.#sequence;
        const processing = body.custom_prompt_post_processing ? 'pending' : 'none';
        const entry = { id, source, model: body.model, stream: body.stream === true, time: new Date(), messages, status: 'pending', processing };
        this.#entries.unshift(entry);
        if (this.#entries.length > REQUEST_LOG_LIMIT) this.#entries.pop();
        this.dispatchEvent(new Event('change'));
        if (processing === 'pending') {
            // Run the same SillyTavern conversion separately from the live request.
            // A missing or slow diagnostic endpoint must not hold up generation.
            const updatePrompt = processed => {
                if (!this.#entries.includes(entry)) return;
                entry.processing = Array.isArray(processed) ? 'done' : 'unavailable';
                if (entry.processing === 'done') entry.messages = processed;
                this.dispatchEvent(new Event('change'));
            };
            const { custom_prompt_post_processing, char_name, user_name, group_names } = body;
            Promise.resolve().then(() => api?.processPrompt({ messages, custom_prompt_post_processing, char_name, user_name, group_names }))
                .then(updatePrompt, () => updatePrompt());
        }
        return (error, reply, reasoning) => {
            const entry = this.#entries.find(item => item.id === id);
            if (entry?.status !== 'pending') return;
            entry.status = signal?.aborted || error?.name === 'AbortError' ? 'cancelled' : error ? 'error' : 'success';
            if (typeof reply === 'string' && reply) entry.reply = reply;
            if (typeof reasoning === 'string' && reasoning) entry.reasoning = reasoning;
            if (Number.isInteger(error?.status)) entry.httpStatus = error.status;
            this.dispatchEvent(new Event('change'));
        };
    }
}

export const requestLog = new RequestLog(() => globalThis.localStorage);

function messageText(message) {
    return typeof message?.content === 'string' ? message.content : JSON.stringify(message, null, 2) ?? '';
}

export function groupAdjacentMessages(messages) {
    const groups = [];
    for (const message of messages) {
        const role = typeof message?.role === 'string' ? message.role : '';
        const name = typeof message?.name === 'string' ? message.name : '';
        const previous = groups.at(-1);
        if (role && previous?.role === role && previous.name === name) {
            previous.messages.push(message);
        } else {
            groups.push({ role, name, messages: [message] });
        }
    }
    return groups;
}

export function showRequestLog({ el, action, notify, returnFocus }) {
    const existing = document.getElementById('request-log-dialog');
    if (existing?.open) return;
    const dialog = el('dialog', 'timing-panel request-log-panel');
    dialog.id = 'request-log-dialog';
    dialog.setAttribute('aria-labelledby', 'request-log-title');
    const heading = el('h1', '', '最近请求记录');
    heading.id = 'request-log-title';
    const header = el('header', 'panel-header');
    const close = action('关闭', () => dialog.close());
    close.autofocus = true;
    header.append(heading, close);

    const body = el('div', 'timing-body');
    const toolbar = el('div', 'timing-toolbar request-log-toolbar');
    const capture = el('input'); capture.type = 'checkbox';
    const toggle = el('label', 'check-field');
    toggle.append(capture, el('span', '', '自动记录'));
    const count = el('span', 'item-count');
    const clear = action('清空', () => requestLog.clear(), 'trash');
    toolbar.append(toggle, count, clear);
    const filters = el('div', 'request-log-filters');
    const search = el('input'); search.type = 'search';
    search.placeholder = '搜索提示词、回复或模型';
    search.setAttribute('aria-label', search.placeholder);
    const source = el('select');
    source.setAttribute('aria-label', '请求来源');
    for (const [value, label] of [['', '全部来源'], ...Object.entries(sources)]) {
        const option = el('option', '', label); option.value = value; source.append(option);
    }
    filters.append(search, source);
    const list = el('div', 'request-log-list');
    const empty = el('p', 'note');
    body.append(toolbar, filters, list, empty);
    dialog.append(header, body);

    const cards = new Map();
    const copyText = async text => {
        await copyDiagnostics(text, dialog);
        notify('已复制');
    };
    const disclosure = (label, render) => {
        const details = el('details', 'request-log-disclosure');
        const summary = el('summary', '', label);
        details.append(summary);
        details.addEventListener('toggle', () => {
            if (details.open && details.children.length === 1) render(details);
        });
        return { details, summary };
    };
    const renderText = (parent, text) => {
        const textBody = el('div', 'request-log-text');
        textBody.append(action('复制', () => copyText(text), 'copy'), el('pre', '', text));
        parent.append(textBody);
    };
    const createCard = entry => {
        let content, messages, renderedProcessing, replySection, reasoningSection;
        const update = () => {
            const count = entry.processing === 'pending' ? '核对提示词中'
                : entry.processing === 'unavailable' ? `${entry.messages.length} 条提交给后端的消息`
                    : `${entry.messages.length} 条消息`;
            context.textContent = `${entry.time.toLocaleTimeString()} · ${count} · ${entry.stream ? '流式' : '非流式'} · `;
            status.textContent = statuses[entry.status] + (entry.httpStatus ? ` · HTTP ${entry.httpStatus}` : '');
            if (content && renderedProcessing !== entry.processing) {
                renderedProcessing = entry.processing;
                content.replaceChildren();
                if (entry.processing === 'pending') {
                    content.append(el('p', 'note', '正在读取 SillyTavern 后处理后的提示词…'));
                    return;
                }
                if (entry.processing === 'unavailable') content.append(el('p', 'note', '无法读取后处理结果。以下是提交给 SillyTavern 的原始消息。'));
                content.append(action('复制全部提示词', () => copyText(JSON.stringify(entry.messages, null, 2)), 'copy'));
                messages = el('div', 'request-log-messages');
                for (const [index, group] of groupAdjacentMessages(entry.messages).entries()) {
                    const { role, name, messages: parts } = group;
                    const label = `${index + 1}. ${role || '未知角色'}${name ? ` · ${name}` : ''}${parts.length > 1 ? ` · ${parts.length} 条` : ''}`;
                    messages.append(disclosure(label, item => renderText(item, parts.map(messageText).join('\n\n'))).details);
                }
                content.append(messages);
            }
            if (messages && entry.reasoning && !reasoningSection) {
                reasoningSection = disclosure('模型思考', parent => renderText(parent, entry.reasoning)).details;
                messages.append(reasoningSection);
            }
            if (messages && entry.reply && !replySection) {
                replySection = disclosure('模型回复', parent => renderText(parent, entry.reply)).details;
                messages.append(replySection);
            }
        };
        const { details, summary } = disclosure('', parent => {
            content = el('div', 'request-log-content');
            parent.append(content);
            update();
        });
        const status = el('span');
        const context = document.createTextNode('');
        const metadata = el('small', 'request-log-meta');
        metadata.append(context, status);
        summary.append(el('span', '', `${sources[entry.source]} · ${entry.model || '未知模型'}`), metadata);
        return { details, update };
    };
    const draw = () => {
        const entries = requestLog.entries;
        capture.checked = requestLog.enabled;
        count.textContent = `${entries.length} / ${REQUEST_LOG_LIMIT}`;
        clear.disabled = !entries.length;
        const ids = new Set(entries.map(entry => entry.id));
        for (const [id, card] of cards) if (!ids.has(id)) { card.details.remove(); cards.delete(id); }
        const query = search.value.trim().toLowerCase();
        let next = list.firstChild;
        let matches = 0;
        for (const entry of entries) {
            const visible = (!source.value || entry.source === source.value) && (!query ||
                [entry.model, entry.reply, entry.reasoning].some(value => value?.toLowerCase().includes(query)) ||
                entry.messages.some(message => messageText(message).toLowerCase().includes(query)));
            const card = cards.get(entry.id) || createCard(entry);
            cards.set(entry.id, card);
            card.update();
            card.details.hidden = !visible;
            if (card.details !== next) list.insertBefore(card.details, next);
            next = card.details.nextSibling;
            if (visible) matches++;
        }
        empty.hidden = matches > 0;
        empty.textContent = entries.length ? '没有匹配的请求。' : requestLog.enabled ? '暂无请求记录。记录仅保留在当前页面，刷新后清空。' : '自动记录已关闭。';
    };
    capture.addEventListener('change', () => requestLog.setEnabled(capture.checked));
    search.addEventListener('input', draw);
    source.addEventListener('change', draw);
    requestLog.addEventListener('change', draw);
    dialog.addEventListener('close', () => {
        requestLog.removeEventListener('change', draw);
        dialog.remove();
        returnFocus?.focus();
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    draw();
}
