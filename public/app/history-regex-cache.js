import { applyRegex } from './regex.js';

// Cache only pure prompt regex transforms. Macro expansion and variable state
// still run in order for every request, with the latest input and world data.
export class HistoryRegexCache {
    constructor(maxChars = 8000000) { this.maxChars = maxChars; this.entries = new Map(); this.chars = 0; this.signature = ''; this.hits = 0; this.misses = 0; this.dynamicSkips = 0; this.noRules = 0; this.oversize = 0; this.evictions = 0; this.invalidations = 0; }
    stats() { return Object.fromEntries(['hits', 'misses', 'dynamicSkips', 'noRules', 'oversize', 'evictions', 'invalidations'].map(key => [key, this[key]])); }
    prepare(rules) {
        const candidates = rules.filter(rule => rule && !rule.disabled && rule.findRegex && rule.promptOnly && Array.isArray(rule.placement));
        const signature = JSON.stringify(candidates);
        if (signature !== this.signature) { this.entries.clear(); this.chars = 0; this.signature = signature; this.invalidations++; }
        return (text, placement, depth, variables = {}, warming = false) => {
            if (this.signature !== signature) return warming ? null : applyRegex(text, rules, placement, { phase: 'prompt', depth, variables });
            const eligible = candidates.filter(rule => rule.placement.map(Number).includes(placement) && !(rule.minDepth !== null && rule.minDepth !== '' && Number(rule.minDepth) >= -1 && depth < Number(rule.minDepth)) && !(rule.maxDepth !== null && rule.maxDepth !== '' && Number(rule.maxDepth) >= 0 && depth > Number(rule.maxDepth)));
            if (!eligible.length) { this.noRules++; return text; }
            if (eligible.some(rule => [rule.findRegex, rule.replaceString, ...(rule.trimStrings || [])].some(value => String(value || '').includes('{{')))) { this.dynamicSkips++; return warming ? null : applyRegex(text, eligible, placement, { phase: 'prompt', depth, variables }); }
            const group = eligible.map(rule => candidates.indexOf(rule)).join(','), key = group + '\n' + text;
            if (this.entries.has(key)) { const result = this.entries.get(key); this.entries.delete(key); this.entries.set(key, result); this.hits++; return result; }
            this.misses++;
            const result = applyRegex(text, eligible, placement, { phase: 'prompt', depth, variables });
            const size = key.length + result.length;
            if (size <= this.maxChars && signature.length <= 2000000) {
                while (this.entries.size && (this.entries.size >= 512 || this.chars + size > this.maxChars)) { const oldest = this.entries.keys().next().value; this.chars -= oldest.length + this.entries.get(oldest).length; this.entries.delete(oldest); this.evictions++; }
                this.entries.set(key, result); this.chars += size;
            } else this.oversize++;
            return result;
        };
    }
}
export const historyRegexCache = new HistoryRegexCache();
export async function warmHistoryRegex(chat, rules, current = () => true) {
    let before = historyRegexCache.stats();
    const metrics = { messages: 0 };
    const collect = () => { const after = historyRegexCache.stats(); for (const key of Object.keys(after)) metrics[key] = (metrics[key] || 0) + after[key] - before[key]; };
    const result = status => ({ status, metrics });
    const transform = historyRegexCache.prepare(rules);
    collect();
    let started = performance.now();
    for (let index = 0; index < chat.length; index++) {
        if (!current()) return result('cancelled');
        before = historyRegexCache.stats();
        transform(chat[index].mes || '', chat[index].is_user ? 1 : 2, chat.length - index - 1, {}, true);
        collect(); metrics.messages++;
        if ((index + 1) % 10 === 0 || performance.now() - started >= 8) { await new Promise(resolve => setTimeout(resolve, 0)); started = performance.now(); }
    }
    return result('success');
}
