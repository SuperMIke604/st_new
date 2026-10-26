const types = {
    success: { duration: 2000, priority: 0, label: '成功', symbol: '✓' },
    info: { duration: 3000, priority: 0, label: '提示', symbol: 'i' },
    warning: { duration: 4000, priority: 1, label: '注意', symbol: '!' },
    error: { duration: 5000, priority: 2, label: '失败', symbol: '×' },
    loading: { duration: 0, priority: 0, label: '处理中', symbol: '◌' },
};

// Boolean types preserve existing notify(message, error) callers.
export function createToast(element, { raise, now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout } = {}) {
    let timer, current, remaining = 0, started = 0;
    const paused = new Set();
    const stopTimer = () => { cancel(timer); timer = undefined; };
    const startTimer = () => {
        stopTimer();
        if (!current || !remaining || paused.size) return;
        started = now(); timer = schedule(dismiss, remaining);
    };
    function dismiss() {
        stopTimer(); current = null; remaining = 0;
        if (element.matches(':popover-open')) element.hidePopover();
        element.hidden = true;
    }
    function pause(reason) {
        if (!paused.size && timer !== undefined) remaining = Math.max(1, remaining - (now() - started));
        paused.add(reason); stopTimer();
    }
    function resume(reason) { paused.delete(reason); startTimer(); }
    function show(message, type = 'success') {
        type = type === true ? 'error' : type === false ? 'success' : Object.hasOwn(types, type) ? type : 'info';
        const spec = types[type], text = String(message ?? '').trim();
        if (!text || current && types[current.type].priority > spec.priority) return;
        const repeated = current?.text === text && current?.type === type;
        current = { text, type }; remaining = spec.duration;
        element.dataset.type = type;
        element.classList.toggle('error', type === 'error');
        element.setAttribute('role', type === 'error' ? 'alert' : 'status');
        element.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        element.setAttribute('aria-atomic', 'true');
        element.setAttribute('aria-label', `${spec.label}：${text}，点击关闭提示`);
        if (!repeated) {
            const symbol = element.ownerDocument.createElement('span');
            symbol.className = 'toast-symbol'; symbol.textContent = spec.symbol; symbol.setAttribute('aria-hidden', 'true');
            const content = element.ownerDocument.createElement('span');
            content.className = 'toast-text'; content.textContent = text;
            element.replaceChildren(symbol, content);
        }
        element.hidden = false; raise?.();
        if (!repeated && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            element.getAnimations?.().forEach(animation => animation.cancel());
            element.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
        }
        // Do not inherit a hover/focus pause from a previously dismissed toast.
        if (!element.matches(':hover')) paused.delete('hover');
        if (element.ownerDocument.activeElement !== element) paused.delete('focus');
        startTimer();
    }
    element.title = '点击关闭提示'; element.tabIndex = 0;
    element.addEventListener('click', dismiss);
    element.addEventListener('keydown', event => {
        if (['Enter', ' ', 'Escape'].includes(event.key)) { event.preventDefault(); dismiss(); }
    });
    element.addEventListener('pointerenter', () => pause('hover'));
    element.addEventListener('pointerleave', () => resume('hover'));
    element.addEventListener('focus', () => pause('focus'));
    element.addEventListener('blur', () => resume('focus'));
    return { show, dismiss };
}
