export function installMessageEdit(list, messageAtNode, edit, { now = Date.now } = {}) {
    const messageAt = target => {
        if (target?.closest('button,input,textarea,select,a,summary,.inline-editor,.message-actions,.message-jumps')) return;
        const node = target?.closest('article.message[data-index]');
        if (node?.parentElement === list) return messageAtNode(node);
    };

    let previousClick, doubleClick;
    list.addEventListener('click', event => {
        const message = messageAt(event.target);
        doubleClick = event.detail >= 2 && previousClick === message ? message : null;
        previousClick = message;
    }, true);
    list.addEventListener('dblclick', event => {
        const message = messageAt(event.target);
        const confirmed = message && message === doubleClick;
        doubleClick = previousClick = null;
        if (confirmed) {
            event.preventDefault();
            edit(message);
        }
    });

    let pressed, previousTap;
    list.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse') { previousTap = null; return; }
        const message = messageAt(event.target);
        pressed = message && { message, id: event.pointerId, x: event.clientX, y: event.clientY };
        if (message !== previousTap?.message) previousTap = null;
    });
    list.addEventListener('pointerup', event => {
        if (event.pointerType === 'mouse') return;
        const down = pressed;
        pressed = null;
        // Touch capture can deliver pointerup to the original element after the list has shifted.
        const message = messageAt(list.ownerDocument.elementFromPoint(event.clientX, event.clientY));
        if (!down || down.id !== event.pointerId || down.message !== message || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 24) {
            previousTap = null;
            return;
        }
        const tap = { message, time: now(), x: event.clientX, y: event.clientY };
        if (previousTap?.message === message && tap.time - previousTap.time <= 350 && Math.hypot(tap.x - previousTap.x, tap.y - previousTap.y) <= 24) {
            previousTap = null;
            edit(message);
        } else {
            previousTap = tap;
        }
    });
    list.addEventListener('pointercancel', () => { pressed = previousTap = null; });
}

export function installMessageEditGuard(root, isEditing, resume) {
    root.addEventListener('click', event => {
        if (!isEditing() || event.target.closest('.inline-editor,#message-edit-confirmation')) return;
        const control = event.target.closest('button,a,input,textarea,select,summary,[role="button"],[contenteditable="true"]');
        if (!control) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        resume(() => {
            if (!control.isConnected) return;
            control.focus({ preventScroll: true });
            // Preserve modifiers for links and replay nested targets for delegated handlers.
            const target = control.contains(event.target) ? event.target : control;
            target.dispatchEvent(new MouseEvent('click', {
                bubbles: true, cancelable: true, composed: true, view: event.view,
                detail: event.detail, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
                shiftKey: event.shiftKey, altKey: event.altKey,
            }));
        });
    }, true);
}
