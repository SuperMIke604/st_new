import test from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGE_VARIABLES, messageVariableContext, resolveMessageVariableMacro } from '../variable-macros.js';
import { buildPrompt, expand } from '../engine.js';
import { applyRegex } from '../regex.js';

test('message variables use the selected swipe and exclude private keys recursively', () => {
    const context = messageVariableContext([{ swipe_id: 1, variables: [{ stat_data: { money: 1 } }, { stat_data: { money: 9, $private: 'secret', nested: { $hidden: 7, visible: true } } }] }]);
    assert.deepEqual(JSON.parse(resolveMessageVariableMacro('get_message_variable::stat_data', context)), { money: 9, nested: { visible: true } });
    assert.equal(resolveMessageVariableMacro('get_message_variable::stat_data.$private', context), '');
    assert.equal(resolveMessageVariableMacro('get_message_variable::__proto__', context), '');
    assert.match(resolveMessageVariableMacro('format_message_variable::stat_data', context), /"money": 9/);
    assert.equal(expand('{{get_message_variable::stat_data.money}}', { [MESSAGE_VARIABLES]: context }), '9');
    assert.equal(resolveMessageVariableMacro('unrelated', context), undefined);
});

test('seed variables reach the actual prompt and regex replacements without exposing private fields', () => {
    const seed = { money: 21, $private: 'secret' };
    const context = messageVariableContext([], seed);
    const rules = [{ findRegex: 'STATE', replaceString: '{{format_message_variable::stat_data}}', placement: [2] }];
    assert.equal(applyRegex('STATE', rules, 2, { variables: { [MESSAGE_VARIABLES]: context } }), '"money": 21');
    const output = buildPrompt({ character: { name: '角色', data: { description: '{{format_message_variable::stat_data}}' } }, chat: [], mvuSeed: seed });
    const content = JSON.stringify(output.messages);
    assert.match(content, /money/); assert.match(content, /21/); assert.doesNotMatch(content, /secret|format_message_variable/);
});
