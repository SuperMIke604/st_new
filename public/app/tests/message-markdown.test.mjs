import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { messageMarkdown } from '../message-markdown.js';
const require = createRequire(import.meta.url);
const showdown = require('../vendor/showdown.min.js');
const converter = new showdown.Converter({ strikethrough: true });

test('HTML opening card does not swallow following Markdown prose', () => {
    const html = messageMarkdown('<details><summary>资料</summary><div>内层<div>嵌套</div></div></details>\n\n九月的阳光 **篮球部**、*斜体*、~~删除~~。\n\n下一段', converter);
    assert.match(html, /<strong>篮球部<\/strong>/);
    assert.match(html, /<em>斜体<\/em>/);
    assert.match(html, /<del>删除<\/del>/);
    assert.match(html, /<p>下一段<\/p>/);
    assert.match(html, /&lt;details&gt;/);
    assert.doesNotMatch(html, /<details>/);
});
test('adjacent HTML fragments share styles and script strings do not end the card', () => {
    const source = '<style>.x{color:red}</style>\n<div class="x">卡片</div><script>const x="<div>";</script>';
    const html = messageMarkdown(source + '\n\n**正文**', converter);
    assert.equal((html.match(/class="language-html"/g) || []).length, 1);
    assert.match(html, /<strong>正文<\/strong>/);
});
test('explicit code examples and ordinary Markdown remain unchanged', () => {
    for (const source of ['**粗体** and `代码`', '```html\n<div>**literal**</div>\n```\n\n**正文**', '`<div>literal</div>`', '<!doctype html><html><head><style>body{color:red}</style></head><body>卡片</body></html>']) {
        const html = messageMarkdown(source, converter);
        if (!source.startsWith('<!')) assert.equal(html, converter.makeHtml(source));
        else assert.match(html, /&lt;\/html&gt;/);
    }
});
