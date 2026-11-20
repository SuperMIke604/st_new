/** Variable-height list. Only the viewport plus overscan owns DOM nodes. */
export class VirtualChat {
    constructor(element, render, onRange, projectMessages = messages => messages) {
        this.element = element; this.renderMessage = render; this.onRange = onRange;
        this.projectMessages = projectMessages;
        this.messages = []; this.heights = new Map(); this.nodes = new Map(); this.prefix = [0];
        this.frame = 0; this.follow = true; this.revision = 0; this.gap = 0;
        this.hasMessageFrame = element.parentElement?.classList.contains('message-list-frame');
        this.frameEdgeCheckPending = false;
        this.edgeSlivers = [];
        this.top = document.createElement('div'); this.bottom = document.createElement('div');
        this.top.className = this.bottom.className = 'virtual-spacer';
        this.element.replaceChildren(this.top, this.bottom);
        this.observer = new ResizeObserver(entries => {
            this.scheduleFrameEdgeCheck();
            const first = this.nodes.values().next().value;
            if (!first) return;
            const gap = parseFloat(getComputedStyle(first).marginBlockEnd) || 0;
            let changed = gap !== this.gap;
            let correction = changed ? this.locate(this.element.scrollTop) * (gap - this.gap) : 0;
            this.gap = gap;
            for (const { target, borderBoxSize } of entries) {
                if (target === this.element) continue;
                const index = Number(target.dataset.index);
                if (this.nodes.get(index) !== target) continue;
                const height = borderBoxSize?.[0]?.blockSize || target.getBoundingClientRect().height;
                const old = this.heights.get(index) || 200;
                if (Math.abs(height - old) < 1) continue;
                if (this.prefix[index + 1] < this.element.scrollTop) correction += height - old;
                this.heights.set(index, height); changed = true;
            }
            if (changed) {
                this.calculate(); this.spacers();
                if (this.follow) this.element.scrollTop = this.element.scrollHeight;
                else if (correction) this.element.scrollTop += correction;
            }
        });
        this.observer.observe(element);
        element.addEventListener('scroll', () => {
            this.follow = element.scrollHeight - element.scrollTop - element.clientHeight < 90;
            if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
        }, { passive: true });
    }
    calculate() {
        this.prefix = [0];
        for (let i = 0; i < this.messages.length; i++) this.prefix.push(this.prefix.at(-1) + (this.heights.get(i) || 200) + this.gap);
    }
    scheduleFrameEdgeCheck() {
        if (!this.hasMessageFrame || this.frameEdgeCheckPending) return;
        this.frameEdgeCheckPending = true;
        requestAnimationFrame(() => {
            this.frameEdgeCheckPending = false;
            const { clientHeight, scrollHeight } = this.element;
            const radius = parseFloat(getComputedStyle(this.element).borderTopLeftRadius);
            let topClipped = false, bottomClipped = false;
            const slivers = [];
            if (radius > 0 && clientHeight > 0 && scrollHeight > clientHeight) {
                const { top, bottom } = this.element.getBoundingClientRect();
                for (const node of this.nodes.values()) {
                    const card = node.getBoundingClientRect();
                    if (card.top >= bottom) break;
                    if (card.bottom <= top) continue;
                    // Leave gaps and the cards' own rounded borders unobstructed.
                    topClipped ||= card.top < top - 1 && card.bottom >= top + radius;
                    bottomClipped ||= card.bottom > bottom + 1 && card.top <= bottom - radius;
                    if ((card.top < top && card.bottom - top <= 8)
                        || (card.bottom > bottom && bottom - card.top <= 8)) slivers.push(node);
                    if (topClipped && bottomClipped) break;
                }
            }
            for (const node of this.edgeSlivers) if (!slivers.includes(node)) node.removeAttribute('data-frame-sliver');
            for (const node of slivers) node.setAttribute('data-frame-sliver', '');
            this.edgeSlivers = slivers;
            this.element.toggleAttribute('data-frame-top', topClipped);
            this.element.toggleAttribute('data-frame-bottom', bottomClipped);
        });
    }
    locate(offset) {
        let low = 0; let high = this.messages.length;
        while (low < high) { const mid = (low + high) >> 1; if (this.prefix[mid + 1] < offset) low = mid + 1; else high = mid; }
        return Math.min(low, Math.max(0, this.messages.length - 1));
    }
    setMessages(messages, { reset = false, latest = false } = {}) {
        this.messages = this.projectMessages(messages);
        if (reset) {
            this.heights.clear(); this.observer.disconnect(); this.nodes.clear();
            this.observer.observe(this.element);
            this.element.replaceChildren(this.top, this.bottom);
        }
        this.calculate();
        if (latest) { this.follow = true; this.jump(Math.max(0, this.messages.length - 1), true); }
        else this.paint();
    }
    spacers() {
        this.top.style.height = `${this.prefix[this.start || 0] || 0}px`;
        this.bottom.style.height = `${Math.max(0, this.prefix.at(-1) - (this.prefix[this.end || 0] || 0))}px`;
        this.bottom.dataset.atEnd = String(this.end === this.messages.length);
    }
    paint(forcedIndex = null) {
        const index = forcedIndex ?? this.locate(this.element.scrollTop);
        this.start = Math.max(0, index - 8);
        this.end = Math.min(this.messages.length, this.start + 40);
        const next = new Map();
        for (let i = this.start; i < this.end; i++) {
            let node = this.nodes.get(i);
            node = this.renderMessage(this.messages[i], i, node);
            node.dataset.index = String(i);
            next.set(i, node);
        }
        for (const [index, node] of this.nodes) if (!next.has(index)) { this.observer.unobserve(node); node.remove(); }
        // Moving an existing message through a fragment detaches its iframes,
        // which reloads HTML cards on every wheel event. Keep retained nodes in
        // place and insert only messages newly entering the virtual window.
        let cursor = this.top.nextSibling;
        for (const node of next.values()) {
            if (node !== cursor) this.element.insertBefore(node, cursor || this.bottom);
            cursor = node.nextSibling;
        }
        this.nodes = next;
        for (const node of next.values()) this.observer.observe(node, { box: 'border-box' });
        this.spacers();
        this.scheduleFrameEdgeCheck();
        this.onRange?.({ start: this.start, end: this.end, total: this.messages.length, follow: this.follow });
    }
    update(index) {
        const node = this.nodes.get(index);
        if (node) this.renderMessage(this.messages[index], index, node);
    }
    jump(index, bottom = false) {
        index = Math.min(Math.max(0, index), Math.max(0, this.messages.length - 1));
        this.follow = bottom;
        this.paint(index);
        this.element.scrollTop = bottom ? this.element.scrollHeight : this.prefix[index];
        if (bottom) requestAnimationFrame(() => { if (this.follow) this.element.scrollTop = this.element.scrollHeight; });
    }
}
