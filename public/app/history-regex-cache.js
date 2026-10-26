import { applyRegex } from './regex.js';

// Cache only pure prompt regex transforms. Macro expansion and variable state
// still run in order for every request, with the latest input and world data.
export class HistoryRegexCache {
    constructor(maxChars = 8000000, maxEntries = 512) { this.maxChars = maxChars; this.maxEntries = maxEntries; this.entries = new Map(); this.cold = new Map(); this.hot = new Map(); this.emptyMessages = new WeakMap(); this.hotChars = 0; this.chars = 0; this.signature = ''; this.hits = 0; this.misses = 0; this.dynamicSkips = 0; this.noRules = 0; this.oversize = 0; this.evictions = 0; this.invalidations = 0; this.entryLimitEvictions = 0; this.charLimitEvictions = 0; this.regexExecuteMs = 0; this.executions = 0; this.filteredHits = 0; this.filteredResults = 0; }
    stats() { return Object.fromEntries(['hits', 'misses', 'dynamicSkips', 'noRules', 'oversize', 'evictions', 'invalidations', 'entryLimitEvictions', 'charLimitEvictions', 'regexExecuteMs', 'executions', 'filteredHits', 'filteredResults'].map(key => [key, this[key]])); }
    capacity() { return { cacheEntries: this.entries.size, cacheChars: this.chars, cacheMaxEntries: this.maxEntries, cacheMaxChars: this.maxChars }; }
    reserve(messageCount) { this.maxEntries = Math.min(4096, Math.max(this.maxEntries, 512, messageCount * 2 + 32)); }
    evict(size = 0, extraEntries = 0) {
        while (this.entries.size && (this.entries.size + extraEntries > this.maxEntries || this.chars + size > this.maxChars)) {
            if (this.entries.size + extraEntries > this.maxEntries) this.entryLimitEvictions++;
            if (this.chars + size > this.maxChars) this.charLimitEvictions++;
            const oldest = this.cold.size ? this.cold.keys().next().value : this.hot.keys().next().value;
            const bytes = oldest.length + this.entries.get(oldest).length;
            if (this.hot.delete(oldest)) this.hotChars -= bytes;
            this.cold.delete(oldest); this.entries.delete(oldest); this.chars -= bytes; this.evictions++;
        }
    }
    protect(key, size) {
        if (this.hot.has(key)) this.hot.delete(key); else { this.cold.delete(key); this.hotChars += size; }
        this.hot.set(key, size);
        // A cold sequential scan cannot evict the entire repeatedly-used set.
        while (this.hot.size > Math.floor(this.maxEntries * .8) || this.hotChars > this.maxChars * .8) {
            const oldest = this.hot.keys().next().value, bytes = this.hot.get(oldest);
            this.hot.delete(oldest); this.hotChars -= bytes; this.cold.set(oldest, bytes);
        }
    }
    prepare(rules) {
        const candidates = rules.filter(rule => rule && !rule.disabled && rule.findRegex && rule.promptOnly && Array.isArray(rule.placement));
        const signature = JSON.stringify(candidates);
        if (signature !== this.signature) { this.entries.clear(); this.cold.clear(); this.hot.clear(); this.emptyMessages = new WeakMap(); this.hotChars = 0; this.chars = 0; this.signature = signature; this.invalidations++; }
        let effectiveCount = 0, adaptive = false;
        const retained = message => { if (message) { adaptive = true; this.reserve(++effectiveCount); } };
        const execute = (text, selected, placement, depth, variables) => { const started = performance.now(); this.executions++; try { return applyRegex(text, selected, placement, { phase: 'prompt', depth, variables }); } finally { this.regexExecuteMs += performance.now() - started; } };
        const transform = (text, placement, depth, variables = {}, warming = false, message = null) => {
            if (message) adaptive = true;
            if (this.signature !== signature) return warming ? null : execute(text, rules, placement, depth, variables);
            const eligible = candidates.filter(rule => rule.placement.map(Number).includes(placement) && !(rule.minDepth !== null && rule.minDepth !== '' && Number(rule.minDepth) >= -1 && depth < Number(rule.minDepth)) && !(rule.maxDepth !== null && rule.maxDepth !== '' && Number(rule.maxDepth) >= 0 && depth > Number(rule.maxDepth)));
            if (!eligible.length) { this.noRules++; return text; }
            if (eligible.some(rule => [rule.findRegex, rule.replaceString, ...(rule.trimStrings || [])].some(value => String(value || '').includes('{{')))) { this.dynamicSkips++; return warming ? null : execute(text, eligible, placement, depth, variables); }
            const group = eligible.map(rule => candidates.indexOf(rule)).join(',');
            if (message) {
                adaptive = true;
                const empty = this.emptyMessages.get(message);
                if (empty?.source === text && empty.groups.has(group)) { this.hits++; this.filteredHits++; return ''; }
            }
            const key = group + '\n' + text;
            if (this.entries.has(key)) { const result = this.entries.get(key); retained(message); this.protect(key, key.length + result.length); this.hits++; return result; }
            this.misses++;
            const result = execute(text, eligible, placement, depth, variables);
            if (result === '' && message) {
                // Key by message identity, exact source and applicable rule group.
                // Keep no concatenated copy of a discarded historical body.
                let empty = this.emptyMessages.get(message);
                if (!empty || empty.source !== text) { empty = { source: text, groups: new Set() }; this.emptyMessages.set(message, empty); }
                if (empty.groups.size >= 4) empty.groups.delete(empty.groups.values().next().value);
                empty.groups.add(group); this.filteredResults++; return result;
            }
            retained(message);
            const size = key.length + result.length;
            if (size <= this.maxChars && signature.length <= 2000000) {
                this.evict(size, 1);
                this.entries.set(key, result); this.cold.set(key, size); this.chars += size;
            } else this.oversize++;
            return result;
        };
        transform.finish = () => {
            if (adaptive && this.signature === signature) { this.maxEntries = Math.min(4096, Math.max(512, effectiveCount * 2 + 32)); this.evict(); }
        };
        return transform;
    }
}
export const historyRegexCache = new HistoryRegexCache();
export async function warmHistoryRegex(chat, rules, current = () => true) {
    let before = historyRegexCache.stats();
    const metrics = { messages: 0, workMs: 0, yieldMs: 0 };
    const collect = () => { const after = historyRegexCache.stats(); for (const key of Object.keys(after)) metrics[key] = (metrics[key] || 0) + after[key] - before[key]; };
    const result = status => { before = historyRegexCache.stats(); if (status === 'success') transform.finish(); collect(); return { status, metrics: { ...metrics, ...historyRegexCache.capacity() } }; };
    const transform = historyRegexCache.prepare(rules);
    collect();
    let started = performance.now();
    for (let index = 0; index < chat.length; index++) {
        if (!current()) return result('cancelled');
        if (chat[index].is_system) continue;
        const workStarted = performance.now(); before = historyRegexCache.stats();
        transform(chat[index].mes || '', chat[index].is_user ? 1 : 2, chat.length - index - 1, {}, true, chat[index]);
        collect(); metrics.messages++; metrics.workMs += performance.now() - workStarted;
        if ((index + 1) % 10 === 0 || performance.now() - started >= 8) { const yielded = performance.now(); await new Promise(resolve => setTimeout(resolve, 0)); metrics.yieldMs += performance.now() - yielded; started = performance.now(); }
    }
    return result('success');
}
