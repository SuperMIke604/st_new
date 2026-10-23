// Pointer capture keeps long-press sorting consistent for mouse and touch.
export function installPromptDrag(rows, scroller, commit) {
    for (const row of rows.children) {
        const summary = row.querySelector?.('.prompt-summary');
        if (!summary || summary.querySelector('.prompt-drag-handle')) continue;
        const handle = document.createElement('span'); handle.className = 'prompt-drag-handle'; handle.textContent = '⠿'; handle.title = '长按拖动排序'; handle.setAttribute('aria-label', '长按拖动排序'); summary.prepend(handle);
    }
    const controller = new AbortController();
    let gesture;
    let suppressClick = false;
    const finish = cancelled => {
        if (!gesture) return;
        const current = gesture; gesture = null;
        clearTimeout(current.timer); cancelAnimationFrame(current.frame);
        current.row.classList.remove('prompt-dragging');
        if (current.capture.hasPointerCapture(current.pointer)) current.capture.releasePointerCapture(current.pointer);
        if (current.active) {
            suppressClick = true;
            if (!cancelled) commit([...rows.children].map(row => row.dataset.promptId));
            else current.original.forEach(row => rows.append(row));
        }
    };
    const tick = () => {
        if (!gesture?.active) return;
        if (!rows.isConnected) { finish(true); return; }
        const { row, y } = gesture;
        const bounds = scroller.getBoundingClientRect();
        if (y < bounds.top + 55) scroller.scrollTop -= 9;
        else if (y > bounds.bottom - 70) scroller.scrollTop += 9;
        const others = [...rows.children].filter(item => item !== row);
        const next = others.find(item => { const rect = item.getBoundingClientRect(); return y < rect.top + rect.height / 2; });
        if (next) rows.insertBefore(row, next); else rows.append(row);
        gesture.frame = requestAnimationFrame(tick);
    };
    rows.addEventListener('pointerdown', event => {
        if (event.button !== 0 || gesture || event.target.closest('input,button')) return;
        const summary = event.target.closest('.prompt-summary');
        if (!summary) return;
        suppressClick = false;
        const row = summary.parentElement;
        gesture = { row, capture: summary, pointer: event.pointerId, x: event.clientX, startY: event.clientY, y: event.clientY, lastY: event.clientY, original: [...rows.children], active: false };
        summary.setPointerCapture(event.pointerId);
        gesture.timer = setTimeout(() => {
            if (!gesture) return;
            gesture.active = true; row.classList.add('prompt-dragging'); tick();
        }, 420);
    }, { signal: controller.signal });
    rows.addEventListener('pointermove', event => {
        if (!gesture || gesture.pointer !== event.pointerId) return;
        if (!gesture.active && (Math.abs(event.clientX - gesture.x) > 8 || Math.abs(event.clientY - gesture.startY) > 8)) {
            clearTimeout(gesture.timer);
            if (event.pointerType === 'touch') { finish(true); return; }
        }
        gesture.y = event.clientY; gesture.lastY = event.clientY;
    }, { signal: controller.signal });
    rows.addEventListener('pointerup', () => finish(false), { signal: controller.signal });
    rows.addEventListener('pointercancel', () => finish(true), { signal: controller.signal });
    rows.addEventListener('lostpointercapture', () => finish(true), { signal: controller.signal });
    rows.addEventListener('click', event => {
        if (!suppressClick) return;
        suppressClick = false; event.preventDefault(); event.stopPropagation();
    }, { capture: true, signal: controller.signal });
    rows.addEventListener('contextmenu', event => { if (gesture) event.preventDefault(); }, { signal: controller.signal });
    return () => { finish(true); controller.abort(); };
}
