export function installMessageEdit(node, edit, { now = Date.now } = {}) {
    const ignored = target => target.closest('button,input,textarea,select,a,summary,.inline-editor,.message-actions,.message-jumps');
    node.addEventListener('dblclick', event => { if (!ignored(event.target)) { event.preventDefault(); edit(); } });
    let last = null;
    node.addEventListener('pointerup', event => {
        if (event.pointerType === 'mouse' || ignored(event.target)) { last = null; return; }
        const tap = { time: now(), x: event.clientX, y: event.clientY };
        if (last && tap.time - last.time <= 350 && Math.hypot(tap.x - last.x, tap.y - last.y) <= 24) { last = null; edit(); }
        else last = tap;
    });
    node.addEventListener('pointercancel', () => { last = null; });
}

export function installMessageEditDismiss(root, cancel) {
    const dismiss = event => {
        if (event.target.closest('.inline-editor')) return;
        if (event.target.closest('button,a,input,textarea,select,summary,[role="button"],[contenteditable="true"]')) cancel();
    };
    root.addEventListener('click', dismiss, true);
    root.addEventListener('focusin', dismiss, true);
}
