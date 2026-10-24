import test from 'node:test';
import assert from 'node:assert/strict';
import { expand, buildPrompt, fitPrompt } from '../engine.js';
test('setvar/getvar support empty declarations, multiline values and scoped state', () => {
 const scope = {};
 assert.equal(expand('{{setvar::NSFW强化::}}{{setvar::NSFW词汇::}}{{setvar::资料库::}}', scope), '');
 assert.equal(expand('{{setvar::NSFW词汇::\n123\n}}', scope), '');
 assert.equal(expand('{{getvar::NSFW词汇}}', scope), '\n123\n');
 assert.equal(expand('{{getvar::NSFW强化}}', scope), '');
 assert.equal(expand('{{getvar::NSFW词汇}}', {}), '');
 assert.equal(expand('{{setvar::资料库::A}}{{getvar::资料库}}', scope), 'A');
});

test('empty transformed history and absent character fields do not create request placeholders', () => {
 const result = buildPrompt({character:{name:'A',personality:'',scenario:''},chat:[{is_user:true,mes:'   '},{is_user:false,mes:'hello'}],preset:{personality_format:"[{{char}} personality: {{personality}}]",scenario_format:'[Context: {{scenario}}]'}});
 assert.ok(result.messages.every(message => message.content.trim()));
 assert.ok(!result.messages.some(message => message.content.includes('personality:') || message.content.includes('Context:')));
});

test('world variable values survive context fitting rebuilds', async () => {
 const input = { settings:{}, character: {name:'A'}, chat:[{is_user:true,mes:'hello'}], books:[{entries:{0:{constant:true,content:'{{setvar::词汇::123}}',position:0}}}], preset:{openai_max_context:4096,openai_max_tokens:100,prompts:[{identifier:'main',content:'read:{{getvar::词汇}}'}]}};
 const result = await fitPrompt(input, async messages => JSON.stringify(messages).length);
 assert.ok(result.messages.some(message => message.content === 'read:123'));
});

test('world output examples preserve literal placeholders through context fitting', async () => {
 const example = '输出格式：\n<status>\n{{姓名}}|{{N}}级\n</status>';
 const input = { settings:{}, character:{name:'测试角色'}, persona:{name:'测试用户'}, chat:[{is_user:true,mes:'姓名: Evan\n年龄: 34岁'}], books:[{entries:{0:{constant:true,content:example,position:0}}}], preset:{openai_max_context:4096,openai_max_tokens:100,prompts:[{identifier:'main',content:'{{char}} 与 {{user}}；示例 {{姓名}}'}]}};
 const result = await fitPrompt(input, async messages => JSON.stringify(messages).length);
 assert.ok(result.messages.some(message => message.content === example));
 assert.ok(result.messages.some(message => message.content === '测试角色 与 测试用户；示例 {{姓名}}'));
 assert.equal(input.books[0].entries[0].content, example);
});
