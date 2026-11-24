/** Variable-height list. Only the viewport plus overscan owns DOM nodes. */
export class VirtualChat {
    constructor(element, render, onRange, projectMessages = messages => messages) {
        this.element = element; this.renderMessage = render; this.onRange = onRange;
        this.projectMessages = projectMessages;
        this.messages = []; this.heights = new Map(); this.nodes = new Map(); this.prefix = [0];
        this.frame = 0; this.follow = true; this.revision = 0; this.gap = 0;
        this.cropOnScroll = globalThis.CSS?.supports('(animation-timeline: view()) and (animation-range: entry-crossing)') === false
            && element.matches('[data-palette="ivory-cards"] #message-list');
        this.croppedCards = new Map();
        this.scrollPosition = element.scrollTop;
        this.topAlignedMessage = null;
        this.pinLatestTop = false;
        this.top = document.createElement('div'); this.bottom = document.createElement('div');
        this.top.className = this.bottom.className = 'virtual-spacer';
        this.element.replaceChildren(this.top, this.bottom);
        this.observer = new ResizeObserver(entries => {
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
            if (this.cropOnScroll) this.updateCardCrops();
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
            if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(null, { reuse: true }); });
        }, { passive: true });
    }
    calculate() {
        this.prefix = [0];
        for (let i = 0; i < this.messages.length; i++) this.prefix.push(this.prefix.at(-1) + (this.heights.get(i) || 200) + this.gap);
    }
    updateCardCrops() {
        const { top, bottom } = this.element.getBoundingClientRect();
        const cropped = new Map();
        for (const node of this.nodes.values()) {
            const card = node.getBoundingClientRect();
            if (card.top >= bottom) break;
            if (card.bottom <= top || !card.height) continue;
            const before = Math.max(0, top - card.top);
            const after = Math.max(0, card.bottom - bottom);
            if (!before && !after) continue;
            const crop = [100 * before / card.height, 100 * after / card.height];
            cropped.set(node, crop);
        }
        for (const node of this.croppedCards.keys()) {
            if (cropped.has(node)) continue;
            node.style.removeProperty('--message-crop-top');
            node.style.removeProperty('--message-crop-bottom');
        }
        for (const [node, [before, after]] of cropped) {
            const previous = this.croppedCards.get(node);
            if (previous?.[0] !== before) node.style.setProperty('--message-crop-top', `${before}%`);
            if (previous?.[1] !== after) node.style.setProperty('--message-crop-bottom', `${after}%`);
        }
        this.croppedCards = cropped;
    }
    locate(offset) {
        let low = 0; let high = this.messages.length;
        while (low < high) { const mid = (low + high) >> 1; if (this.prefix[mid + 1] < offset) low = mid + 1; else high = mid; }
        return Math.min(low, Math.max(0, this.messages.length - 1));
    }
    setMessages(messages, { reset = false, latest = false, appendPreview = false } = {}) {
        const previous = this.messages;
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
        } else if (latest) this.jump(this.messages.length - 1, true, { reuse: appendPreview, previous });
        else this.paint();
    }
    spacers() {
        this.top.style.height = `${this.prefix[this.start || 0] || 0}px`;
        const remaining = Math.max(0, this.prefix.at(-1) - (this.prefix[this.end || 0] || 0));
        this.bottom.dataset.atEnd = String(this.end === this.messages.length);
        let tailSpace = 0;
        if (this.topAlignedMessage) {
            const last = this.messages.length - 1;
            const node = this.nodes.get(last);
            const height = node?.getBoundingClientRect().height ?? this.heights.get(last) ?? 200;
            const gap = node ? parseFloat(getComputedStyle(node).marginBlockEnd) || 0 : this.gap;
            const { paddingTop, paddingBottom } = getComputedStyle(this.element);
            // Short replies need enough space below them to reach the top of the viewport.
            const padding = (parseFloat(paddingTop) || 0) + (parseFloat(paddingBottom) || 0);
            tailSpace = Math.max(0, this.element.clientHeight - height - gap - padding);
        }
        this.bottom.style.height = `${remaining + tailSpace}px`;
    }
    paint(forcedIndex = null, { reuse = false, previous = this.messages } = {}) {
        const visibleIndex = this.locate(this.element.scrollTop);
        const index = forcedIndex ?? Math.max(visibleIndex, this.follow ? this.messages.length - 32 : 0);
        const start = Math.max(0, index - 8);
        const end = Math.min(this.messages.length, start + 40);
        if (!(reuse && forcedIndex === null && start === this.start && end === this.end)) {
            this.renderRange(start, end, reuse, previous);
            this.spacers();
        }
        this.alignScroll();
        if (this.cropOnScroll) this.updateCardCrops();
        this.onRange?.({ start, end, total: this.messages.length, follow: this.follow });
    }
    renderRange(start, end, reuse, previous) {
        this.start = start;
        this.end = end;
        const next = new Map();
        for (let i = start; i < end; i++) {
            let node = this.nodes.get(i);
            if (!reuse || !node || previous[i] !== this.messages[i]) {
                const existing = node;
                node = this.renderMessage(this.messages[i], i, existing);
                node.dataset.index = String(i);
            }
            next.set(i, node);
        }
        for (const [index, node] of this.nodes) if (next.get(index) !== node) { this.observer.unobserve(node); node.remove(); }
        // Moving an existing message through a fragment detaches its iframes,
        // which reloads HTML cards on every wheel event. Keep retained nodes in
        // place and insert only messages newly entering the virtual window.
        let cursor = this.top.nextSibling;
        for (const [index, node] of next) {
            if (node !== cursor) this.element.insertBefore(node, cursor || this.bottom);
            if (this.nodes.get(index) !== node) this.observer.observe(node, { box: 'border-box' });
            cursor = node.nextSibling;
        }
        this.nodes = next;
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
    jump(index, bottom = false, options) {
        index = Math.min(Math.max(0, index), Math.max(0, this.messages.length - 1));
        this.topAlignedMessage = null;
        this.pinLatestTop = false;
        this.follow = bottom;
        this.paint(index, options);
        if (!bottom) this.setScrollTop(this.prefix[index]);
    }
}
