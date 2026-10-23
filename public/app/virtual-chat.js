/** Variable-height list. Only the viewport plus overscan owns DOM nodes. */
export class VirtualChat {
    constructor(element, render, onRange) {
        this.element = element; this.renderMessage = render; this.onRange = onRange;
        this.messages = []; this.heights = new Map(); this.nodes = new Map(); this.prefix = [0];
        this.frame = 0; this.follow = true; this.revision = 0;
        this.top = document.createElement('div'); this.bottom = document.createElement('div');
        this.top.className = this.bottom.className = 'virtual-spacer';
        this.element.replaceChildren(this.top, this.bottom);
        this.observer = new ResizeObserver(entries => {
            let correction = 0; let changed = false;
            for (const { target, borderBoxSize } of entries) {
                const index = Number(target.dataset.index);
                if (this.nodes.get(index) !== target) continue;
                const height = (borderBoxSize?.[0]?.blockSize || target.getBoundingClientRect().height) + 16;
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
        element.addEventListener('scroll', () => {
            this.follow = element.scrollHeight - element.scrollTop - element.clientHeight < 90;
            if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
        }, { passive: true });
    }
    calculate() {
        this.prefix = [0];
        for (let i = 0; i < this.messages.length; i++) this.prefix.push(this.prefix.at(-1) + (this.heights.get(i) || 200));
    }
    locate(offset) {
        let low = 0; let high = this.messages.length;
        while (low < high) { const mid = (low + high) >> 1; if (this.prefix[mid + 1] < offset) low = mid + 1; else high = mid; }
        return Math.min(low, Math.max(0, this.messages.length - 1));
    }
    setMessages(messages, { reset = false, latest = false } = {}) {
        this.messages = messages;
        if (reset) {
            this.heights.clear(); this.observer.disconnect(); this.nodes.clear();
            this.element.replaceChildren(this.top, this.bottom);
        }
        this.calculate();
        if (latest) { this.follow = true; this.jump(Math.max(0, messages.length - 1), true); }
        else this.paint();
    }
    spacers() {
        this.top.style.height = `${this.prefix[this.start || 0] || 0}px`;
        this.bottom.style.height = `${Math.max(0, this.prefix.at(-1) - (this.prefix[this.end || 0] || 0))}px`;
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
        for (const node of next.values()) this.observer.observe(node);
        this.spacers();
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
