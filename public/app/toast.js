const types = {
    success: { duration: 3000, label: '成功' },
    info: { duration: 3000, label: '提示' },
    warning: { duration: 4000, label: '注意' },
    error: { duration: 5000, label: '失败' },
    loading: { duration: 0, label: '处理中' },
};

// Boolean types preserve existing notify(message, error) callers.
export function createToast(element, { raise, now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout } = {}) {
    const entries = new Set();
    function hideIfEmpty() {
        if (entries.size) return;
        if (element.matches(':popover-open')) element.hidePopover();
        element.hidden = true;
    }
    function remove(entry) {
        cancel(entry.timer); entries.delete(entry); entry.node.remove(); hideIfEmpty();
    }
    function start(entry) {
        cancel(entry.timer); entry.timer = undefined;
        if (!entries.has(entry) || !entry.remaining || entry.paused.size) return;
        entry.started = now(); entry.timer = schedule(() => remove(entry), entry.remaining);
    }
    function pause(entry, reason) {
        if (!entry.paused.size && entry.timer !== undefined) entry.remaining = Math.max(1, entry.remaining - (now() - entry.started));
        entry.paused.add(reason); cancel(entry.timer); entry.timer = undefined;
    }
    function resume(entry, reason) { entry.paused.delete(reason); start(entry); }
    function show(message, type = 'success') {
        type = type === true ? 'error' : type === false ? 'success' : Object.hasOwn(types, type) ? type : 'info';
        const spec = types[type], text = String(message ?? '');
        if (!text.trim()) return;
        const repeated = [...entries].find(entry => entry.text === text && entry.type === type);
        if (repeated) { repeated.remaining = spec.duration; start(repeated); return repeated.handle; }
        const node = element.ownerDocument.createElement('div');
        node.className = 'toast-item'; node.classList.toggle('error', type === 'error');
        node.dataset.type = type; node.textContent = text;
        node.setAttribute('role', type === 'error' ? 'alert' : 'status');
        node.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        node.setAttribute('aria-atomic', 'true');
        node.setAttribute('aria-label', `${spec.label}：${text}，点击关闭提示`);
        node.title = '点击关闭提示'; node.tabIndex = 0;
        const entry = { node, text, type, remaining: spec.duration, paused: new Set() };
        entry.handle = { element: node, dismiss: () => remove(entry) };
        node.addEventListener('click', () => remove(entry));
        node.addEventListener('keydown', event => {
            if (['Enter', ' ', 'Escape'].includes(event.key)) { event.preventDefault(); remove(entry); }
        });
        node.addEventListener('pointerenter', () => pause(entry, 'hover'));
        node.addEventListener('pointerleave', () => resume(entry, 'hover'));
        node.addEventListener('focus', () => pause(entry, 'focus'));
        node.addEventListener('blur', () => resume(entry, 'focus'));
        entries.add(entry); element.append(node); element.hidden = false; raise?.();
        if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) node.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
        start(entry);
        return entry.handle;
    }
    return { show, dismiss: () => { for (const entry of [...entries]) remove(entry); } };
}
