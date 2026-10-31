// Keep the live iframe in one DOM location: moving an iframe between parents
// reloads its browsing context and would discard form values and script state.
export function inlineFrameGeometry(anchor, viewport, width, height) {
    const left = Math.max(anchor.left, viewport.left, 0), top = Math.max(anchor.top, viewport.top, 0);
    const right = Math.min(anchor.right, viewport.right, width), bottom = Math.min(anchor.bottom, viewport.bottom, height);
    if (right <= left || bottom <= top || anchor.width <= 0 || anchor.height <= 0) return 'path("M0 0Z")';
    return `inset(${top - anchor.top}px ${anchor.right - right}px ${anchor.bottom - bottom}px ${left - anchor.left}px)`;
}
export class ScriptInlineView {
    constructor(frame, post) {
        this.frame = frame; this.post = post; this.active = false; this.height = 600;
        this.sync = () => {
            if (!this.active) return;
            if (!this.anchor?.isConnected) { this.frame.style.clipPath = 'path("M0 0Z")'; return; }
            const rect = this.anchor.getBoundingClientRect(), viewport = this.anchor.closest('#message-list')?.getBoundingClientRect() || { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
            Object.assign(this.frame.style, { top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${this.height}px`, clipPath: inlineFrameGeometry(rect, viewport, innerWidth, innerHeight) });
        };
        document.addEventListener('scroll', this.sync, true); window.addEventListener('resize', this.sync);
        if (typeof ResizeObserver !== 'undefined') this.observer = new ResizeObserver(this.sync);
    }
    attach(anchor, messageId) {
        const changed = this.anchor !== anchor || this.messageId !== messageId;
        if (!changed && !this.active) return; // Keep an explicitly opened popup in the page overlay.
        this.anchor = anchor; this.messageId = messageId; this.active = true;
        anchor.style.height = `${this.height}px`; anchor.dataset.active = 'true';
        if (changed) {
            this.observer?.disconnect(); this.observer?.observe(anchor);
            const message = anchor.closest('.message'), viewport = anchor.closest('#message-list');
            if (message) this.observer?.observe(message);
            if (viewport) this.observer?.observe(viewport);
            this.post({ type: 'chat-mount', messageId });
        }
        this.sync();
    }
    resize(value) {
        if (!this.active || !Number.isFinite(value)) return;
        this.height = Math.min(20000, Math.max(100, Math.ceil(value)));
        if (this.anchor) this.anchor.style.height = `${this.height}px`;
        this.sync();
    }
    mode(inline) {
        this.active = inline && !!this.anchor;
        if (this.active) this.sync();
        else Object.assign(this.frame.style, { top: '', left: '', width: '', height: '', clipPath: 'path("M0 0Z")' });
    }
    dispose() {
        document.removeEventListener('scroll', this.sync, true); window.removeEventListener('resize', this.sync); this.observer?.disconnect();
    }
}
