import { applyRegex } from './regex.js';

// Cache only pure prompt regex transforms. Macro expansion and variable state
// still run in order for every request, with the latest input and world data.
export class HistoryRegexCache {
    constructor(maxChars = 8000000) { this.maxChars = maxChars; this.entries = new Map(); this.chars = 0; this.signature = ''; this.hits = 0; this.misses = 0; }
    prepare(rules) {
        const candidates = rules.filter(rule => rule && !rule.disabled && rule.findRegex && rule.promptOnly && Array.isArray(rule.placement));
        const signature = JSON.stringify(candidates);
        if (signature !== this.signature) { this.entries.clear(); this.chars = 0; this.signature = signature; }
        return (text, placement, depth, variables = {}, warming = false) => {
            if (this.signature !== signature) return warming ? null : applyRegex(text, rules, placement, { phase: 'prompt', depth, variables });
            const eligible = candidates.filter(rule => rule.placement.map(Number).includes(placement) && !(rule.minDepth !== null && rule.minDepth !== '' && Number(rule.minDepth) >= -1 && depth < Number(rule.minDepth)) && !(rule.maxDepth !== null && rule.maxDepth !== '' && Number(rule.maxDepth) >= 0 && depth > Number(rule.maxDepth)));
            if (!eligible.length) return text;
            if (eligible.some(rule => [rule.findRegex, rule.replaceString, ...(rule.trimStrings || [])].some(value => String(value || '').includes('{{')))) return warming ? null : applyRegex(text, eligible, placement, { phase: 'prompt', depth, variables });
            const group = eligible.map(rule => candidates.indexOf(rule)).join(','), key = group + '\n' + text;
            if (this.entries.has(key)) { const result = this.entries.get(key); this.entries.delete(key); this.entries.set(key, result); this.hits++; return result; }
            this.misses++;
            const result = applyRegex(text, eligible, placement, { phase: 'prompt', depth, variables });
            const size = key.length + result.length;
            if (size <= this.maxChars && signature.length <= 2000000) {
                while (this.entries.size && (this.entries.size >= 512 || this.chars + size > this.maxChars)) { const oldest = this.entries.keys().next().value; this.chars -= oldest.length + this.entries.get(oldest).length; this.entries.delete(oldest); }
                this.entries.set(key, result); this.chars += size;
            }
            return result;
        };
    }
}
export const historyRegexCache = new HistoryRegexCache();
export async function warmHistoryRegex(chat, rules, current = () => true) {
    const transform = historyRegexCache.prepare(rules);
    let started = performance.now();
    for (let index = 0; index < chat.length; index++) {
        if (!current()) return;
        transform(chat[index].mes || '', chat[index].is_user ? 1 : 2, chat.length - index - 1, {}, true);
        if ((index + 1) % 10 === 0 || performance.now() - started >= 8) { await new Promise(resolve => setTimeout(resolve, 0)); started = performance.now(); }
    }
}
