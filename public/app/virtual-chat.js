/** Variable-height list. Only the viewport plus overscan owns DOM nodes. */
export class VirtualChat {
    constructor(element, render, onRange, projectMessages = messages => messages) {
        this.element = element; this.renderMessage = render; this.onRange = onRange;
        this.projectMessages = projectMessages;
        this.messages = []; this.heights = new Map(); this.nodes = new Map(); this.prefix = [0];
        this.frame = 0; this.follow = true; this.revision = 0; this.gap = 0;
        this.messageFrame = element.parentElement?.classList.contains('message-list-frame') ? element.parentElement : null;
        this.frameEdgeCheckPending = false;
        this.clippedCards = new Set();
        this.scrollPosition = element.scrollTop;
        this.topAlignedMessage = null;
        this.pinLatestTop = false;
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
            if (changed || entries.some(({ target }) => target === element)) {
                if (changed) this.calculate();
                this.spacers();
                if (!this.alignScroll() && correction) this.setScrollTop(element.scrollTop + correction);
            }
        });
        this.observer.observe(element);
        element.addEventListener('scroll', () => {
            const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
            const position = Math.min(maxScroll, Math.max(0, element.scrollTop));
            // A resize can clamp scrollTop before ResizeObserver runs.
            const movement = position - Math.min(this.scrollPosition, maxScroll);
            if (Math.abs(movement) > 1) {
                this.follow = movement > 0 && maxScroll - position < 90;
                this.pinLatestTop = false;
            }
            this.scrollPosition = position;
            if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(null, true); });
        }, { passive: true });
    }
    calculate() {
        this.prefix = [0];
        for (let i = 0; i < this.messages.length; i++) this.prefix.push(this.prefix.at(-1) + (this.heights.get(i) || 200) + this.gap);
    }
    scheduleFrameEdgeCheck() {
        if (!this.messageFrame || this.frameEdgeCheckPending) return;
        this.frameEdgeCheckPending = true;
        requestAnimationFrame(() => {
            this.frameEdgeCheckPending = false;
            this.updateFrameEdges();
        });
    }
    updateFrameEdges() {
        const frame = this.messageFrame;
        if (!frame) return;
        const { clientHeight, scrollHeight } = this.element;
        const clipped = new Map();
        const outlines = {};
        if (clientHeight > 0 && scrollHeight > clientHeight
            && getComputedStyle(this.element).getPropertyValue('--clip-message-cards').trim() === '1') {
            const { top, bottom } = this.element.getBoundingClientRect();
            for (const node of this.nodes.values()) {
                const card = node.getBoundingClientRect();
                if (card.top >= bottom) break;
                if (card.bottom <= top) continue;
                const cutsTop = card.top < top - .5;
                const cutsBottom = card.bottom > bottom + .5;
                if (!cutsTop && !cutsBottom) continue;
                const visibleHeight = Math.min(card.bottom, bottom) - Math.max(card.top, top);
                const edge = cutsTop ? 'top' : 'bottom';
                const full = cutsTop && cutsBottom;
                clipped.set(node, { edge: full ? 'full' : edge, visibleHeight });
                if (visibleHeight > (cutsTop ? 8 : 2)) {
                    const color = getComputedStyle(node).getPropertyValue('--message-outline').trim();
                    outlines[edge] = { visibleHeight, color, full };
                }
            }
        }
        for (const node of this.clippedCards) {
            if (!clipped.has(node)) {
                node.removeAttribute('data-card-clip');
                node.style.removeProperty('--card-visible-height');
            }
        }
        for (const [node, { edge, visibleHeight }] of clipped) {
            node.dataset.cardClip = edge;
            node.style.setProperty('--card-visible-height', `${visibleHeight}px`);
        }
        this.clippedCards = new Set(clipped.keys());
        // Keep strokes fixed to the viewport while the cards move underneath.
        for (const edge of ['top', 'bottom']) {
            const outline = outlines[edge];
            if (outline) {
                frame.setAttribute(`data-outline-${edge}`, outline.full ? 'full' : '');
                frame.style.setProperty(`--outline-${edge}-height`, `${outline.visibleHeight}px`);
                frame.style.setProperty(`--outline-${edge}-color`, outline.color);
            } else frame.removeAttribute(`data-outline-${edge}`);
        }
    }
    locate(offset) {
        let low = 0; let high = this.messages.length;
        while (low < high) { const mid = (low + high) >> 1; if (this.prefix[mid + 1] < offset) low = mid + 1; else high = mid; }
        return Math.min(low, Math.max(0, this.messages.length - 1));
    }
    setMessages(messages, { reset = false, latest = false } = {}) {
        this.messages = this.projectMessages(messages);
        if (reset || this.messages.at(-1) !== this.topAlignedMessage) {
            this.topAlignedMessage = null;
            this.pinLatestTop = false;
        }
        if (reset) {
            this.heights.clear(); this.observer.disconnect(); this.nodes.clear();
            this.observer.observe(this.element);
            this.element.replaceChildren(this.top, this.bottom);
        }
        this.calculate();
        if (latest === 'top' && this.messages.length) {
            this.follow = false;
            this.topAlignedMessage = this.messages.at(-1);
            this.pinLatestTop = true;
            this.paint(this.messages.length - 1);
        } else if (latest) this.jump(this.messages.length - 1, true);
        else this.paint();
    }
    spacers() {
        this.top.style.height = `${this.prefix[this.start || 0] || 0}px`;
        const remaining = Math.max(0, this.prefix.at(-1) - (this.prefix[this.end || 0] || 0));
        let tailSpace = 0;
        if (this.topAlignedMessage) {
            const last = this.messages.length - 1;
            const height = this.nodes.get(last)?.getBoundingClientRect().height ?? this.heights.get(last) ?? 200;
            const { paddingTop, paddingBottom } = getComputedStyle(this.element);
            // Short replies need enough space below them to reach the top of the viewport.
            const padding = (parseFloat(paddingTop) || 0) + (parseFloat(paddingBottom) || 0);
            tailSpace = Math.max(0, this.element.clientHeight - height - this.gap - padding);
        }
        this.bottom.style.height = `${remaining + tailSpace}px`;
        this.bottom.dataset.atEnd = String(this.end === this.messages.length);
    }
    paint(forcedIndex = null, duringScroll = false) {
        const visibleIndex = this.locate(this.element.scrollTop);
        const index = forcedIndex ?? Math.max(visibleIndex, this.follow ? this.messages.length - 32 : 0);
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
        this.alignScroll();
        if (duringScroll) this.updateFrameEdges();
        else this.scheduleFrameEdgeCheck();
        this.onRange?.({ start: this.start, end: this.end, total: this.messages.length, follow: this.follow });
    }
    update(index) {
        const node = this.nodes.get(index);
        if (node) this.renderMessage(this.messages[index], index, node);
    }
    setScrollTop(position) {
        this.element.scrollTop = position;
        this.scrollPosition = Math.max(0, this.element.scrollTop);
    }
    alignScroll() {
        if (this.follow) {
            this.setScrollTop(this.element.scrollHeight);
            return true;
        }
        if (!this.pinLatestTop) return false;
        const node = this.nodes.get(this.messages.length - 1);
        if (!node) return false;
        const viewportTop = this.element.getBoundingClientRect().top + this.element.clientTop;
        const inset = parseFloat(getComputedStyle(this.element).paddingTop) || 0;
        this.setScrollTop(this.element.scrollTop + node.getBoundingClientRect().top - viewportTop - inset);
        return true;
    }
    jump(index, bottom = false) {
        index = Math.min(Math.max(0, index), Math.max(0, this.messages.length - 1));
        this.topAlignedMessage = null;
        this.pinLatestTop = false;
        this.follow = bottom;
        this.paint(index);
        if (!bottom) this.setScrollTop(this.prefix[index]);
    }
}
