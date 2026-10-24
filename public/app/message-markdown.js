// Isolate HTML cards, not the entire message: prose following a card still
// needs Markdown parsing. Explicit fenced/inline code remains untouched.
const cardStart = /<(?:!doctype\s+html\b|html\b|style\b|div\b|details\b|section\b|form\b|button\b|input\b|article\b|main\b|script\b)/i;
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
function htmlEnd(source, start) {
    const tags = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
    tags.lastIndex = start;
    const stack = [];
    let token;
    while ((token = tags.exec(source))) {
        const name = token[1]?.toLowerCase();
        if (!name) continue;
        if (token[0].startsWith('</')) {
            if (stack.at(-1) === name) stack.pop();
        } else if (!voidTags.has(name) && !token[0].endsWith('/>')) {
            if (name === 'script' || name === 'style') {
                const closing = new RegExp(`</${name}\\s*>`, 'gi'); closing.lastIndex = tags.lastIndex;
                const end = closing.exec(source);
                if (!end) return source.length;
                tags.lastIndex = closing.lastIndex;
            } else stack.push(name);
        }
        if (!stack.length) return tags.lastIndex;
    }
    return source.length;
}
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function messageMarkdown(source, converter) {
    let prefix = 'TAVERNHTMLBLOCK';
    while (source.includes(prefix)) prefix += 'X';
    const blocks = [];
    const tokens = /(^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]{0,3}\2[ \t]*(?=\n|$))|(`+)[^`]*?\3|<(?:!doctype\s+html\b|html\b|style\b|div\b|details\b|section\b|form\b|button\b|input\b|article\b|main\b|script\b)/gim;
    let result = '', cursor = 0, match;
    while ((match = tokens.exec(source))) {
        if (!match[0].startsWith('<')) continue;
        let end = htmlEnd(source, match.index);
        // Keep adjacent style/script/card fragments in one sandbox document.
        while (end < source.length) {
            const next = end + (source.slice(end).match(/^\s*/)?.[0].length || 0);
            if (source.slice(next).search(cardStart) !== 0) break;
            end = htmlEnd(source, next);
        }
        const key = `${prefix}${blocks.length}END`;
        blocks.push(source.slice(match.index, end));
        result += source.slice(cursor, match.index) + `\n\n${key}\n\n`;
        cursor = end; tokens.lastIndex = end;
    }
    result += source.slice(cursor);
    return converter.makeHtml(result).replace(new RegExp(`<p>(${prefix}(\\d+)END)</p>`, 'g'), (_, key, index) => `<pre><code class="language-html">${escape(blocks[Number(index)])}</code></pre>`);
}
