import { MESSAGE_VARIABLES, resolveMessageVariableMacro } from './variable-macros.js';
// Native preset regex data, executed without loading extensions or scripts.
export function presetRegexes(preset) {
    const rules = preset?.extensions?.regex_scripts ?? preset?.regex_scripts;
    return Array.isArray(rules) ? rules : [];
}
export function scopedRegexes({ settings = {}, preset = {}, character = null } = {}) {
    const global = settings.extension_settings?.regex;
    const local = character?.data?.extensions?.regex_scripts ?? character?.extensions?.regex_scripts;
    return { global: Array.isArray(global) ? global : [], preset: presetRegexes(preset), character: Array.isArray(local) ? local : [] };
}
export function activeRegexes(input) {
    const scopes = scopedRegexes(input);
    return [...scopes.global, ...scopes.preset, ...scopes.character];
}
function macros(text, variables, escaped = false) {
    return String(text ?? '').replace(/{{\s*([^{}]+?)\s*}}/g, (raw, key) => {
        const messageValue = resolveMessageVariableMacro(key, variables[MESSAGE_VARIABLES]);
        if (messageValue !== undefined) return escaped ? messageValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : messageValue;
        if (!Object.hasOwn(variables, key.toLowerCase())) return raw;
        const value = String(variables[key.toLowerCase()] ?? '');
        return escaped ? value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') : value;
    });
}
const compiled = new Map();
export function compileRegex(text) {
    const value = String(text || '');
    if (compiled.has(value)) { const regex = compiled.get(value); regex.lastIndex = 0; return regex; }
    const literal = value.match(/^\/(.*)\/([dgimsuvy]*)$/s);
    const regex = literal ? new RegExp(literal[1], literal[2]) : new RegExp(value);
    if (compiled.size >= 200) compiled.delete(compiled.keys().next().value);
    compiled.set(value, regex); return regex;
}
export function applyRegex(text, rules, placement, { phase = 'raw', depth, edit = false, variables = {} } = {}) {
    let result = String(text ?? '');
    for (const rule of rules) {
        if (!rule || rule.disabled || !rule.findRegex || !Array.isArray(rule.placement) || !rule.placement.map(Number).includes(placement)) continue;
        if (edit && !rule.runOnEdit) continue;
        if (!(phase === 'display' ? rule.markdownOnly : phase === 'prompt' ? rule.promptOnly : !rule.markdownOnly && !rule.promptOnly)) continue;
        if (typeof depth === 'number') {
            if (rule.minDepth !== null && rule.minDepth !== '' && Number(rule.minDepth) >= -1 && depth < Number(rule.minDepth)) continue;
            if (rule.maxDepth !== null && rule.maxDepth !== '' && Number(rule.maxDepth) >= 0 && depth > Number(rule.maxDepth)) continue;
        }
        let find;
        try { find = compileRegex(Number(rule.substituteRegex) ? macros(rule.findRegex, variables, Number(rule.substituteRegex) === 2) : rule.findRegex); }
        catch { continue; } // Native behavior: invalid imported rules are skipped.
        result = result.replace(find, (...args) => {
            const replacement = String(rule.replaceString ?? '').replace(/{{match}}/gi, '$0').replace(/\$(\d+)|\$<([^>]+)>/g, (_, number, named) => {
                const groups = args.at(-1);
                let match = String(number !== undefined ? args[Number(number)] ?? '' : (typeof groups === 'object' ? groups[named] ?? '' : ''));
                for (const trim of rule.trimStrings || []) match = match.split(macros(trim, variables)).join('');
                return match;
            });
            return macros(replacement, variables);
        });
    }
    return result;
}
