import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVariables, parseVariableValue, variableRows, setVariable, deleteVariable, defaultVariableMessage, chatVariableValue, patchChatVariables } from '../variable-manager.js';

test('typed variable edits preserve strings, numbers, flags, null and nested arrays', () => {
    assert.equal(parseVariableValue('007','string'),'007');
    assert.equal(parseVariableValue('7.5','number'),7.5);
    assert.equal(parseVariableValue('false','boolean'),false);
    assert.equal(parseVariableValue('ignored','null'),null);
    assert.deepEqual(parseVariableValue('[1,{"ok":true}]','array'),[1,{ok:true}]);
    for(const [text,type] of [['','number'],['Infinity','number'],['yes','boolean'],['[]','object'],['{','object']]) assert.throws(()=>parseVariableValue(text,type));
});
test('invalid or unsafe variable objects never become a draft', () => {
    assert.throws(()=>validateVariables([]));
    assert.throws(()=>validateVariables({score:Infinity}));
    assert.throws(()=>validateVariables(JSON.parse('{"x":{"__proto__":{"polluted":true}}}')));
    assert.throws(()=>validateVariables({text:'x'.repeat(1000001)}));
    assert.equal({}.polluted,undefined);
});
test('editing a nested leaf keeps unrelated variables and the original snapshot', () => {
    const original={stat_data:{score:7,name:'007'},array:[1,2],empty:{}};
    const next=setVariable(original,['stat_data','score'],9);
    assert.equal(next.stat_data.score,9);assert.equal(original.stat_data.score,7);
    assert.equal(next.stat_data.name,'007');assert.deepEqual(next.array,[1,2]);
    assert.equal(variableRows(next).length,5);
    assert.throws(()=>setVariable(original,['missing','score'],1));
});
const fixture=()=>[{chat_metadata:{variables:{topic:'old'},other:'preserved'}},
    {mes:'first',swipe_id:1,variables:[{score:3},{score:7}],extra:{keep:true}},
    {mes:'second',variables:[{flag:true}]}];
test('deleting draft variables removes object fields and compacts arrays', () => {
    const original = { nested: { obsolete: true, keep: '007' }, list: ['first', 'second'], empty: {} };
    let draft = deleteVariable(original, ['nested', 'obsolete']);
    draft = deleteVariable(draft, ['list', '0']);
    draft = deleteVariable(draft, ['empty']);
    assert.deepEqual(draft, { nested: { keep: '007' }, list: ['second'] });
    assert.deepEqual(original, { nested: { obsolete: true, keep: '007' }, list: ['first', 'second'], empty: {} });
    for (const path of [[], ['nested', 'missing'], ['nested', 'keep', '0'], ['list', 'length'], ['__proto__']]) {
        assert.throws(() => deleteVariable(draft, path));
    }
});
test('saving a deletion keeps it absent after reading the chosen reply', () => {
    const records = fixture(), base = { score: 7 };
    const next = patchChatVariables(records, {
        scope: 'message', messageId: 0, swipeId: 1, messageText: 'first',
        base, value: deleteVariable(base, ['score']),
    });
    assert.deepEqual(chatVariableValue(next[0], next.slice(1), 'message', 0), {});
    assert.deepEqual(next[1].variables[0], { score: 3 });
    assert.deepEqual(next[2], records[2]);
});
test('message variable saving touches only the chosen swipe, not prose or other floors', () => {
    const original=fixture(),next=patchChatVariables(original,{scope:'message',messageId:0,swipeId:1,messageText:'first',base:{score:7},value:{score:9}});
    assert.deepEqual(next[1].variables,[{score:3},{score:9}]);
    assert.equal(next[1].mes,'first');assert.deepEqual(next[1].extra,{keep:true});
    assert.deepEqual(next[0],original[0]);assert.deepEqual(next[2],original[2]);
    assert.equal(original[1].variables[1].score,7);
});
test('chat variable saving preserves message variables and other metadata', () => {
    const original=fixture(),next=patchChatVariables(original,{scope:'chat',base:{topic:'old'},value:{topic:'new'}});
    assert.deepEqual(next[0].chat_metadata,{variables:{topic:'new'},other:'preserved'});
    assert.deepEqual(next.slice(1),original.slice(1));
});
test('stale values, changed replies and moved messages are rejected before writing', () => {
    const records=fixture(),request={scope:'message',messageId:0,swipeId:1,messageText:'first',base:{score:7},value:{score:9}};
    assert.throws(()=>patchChatVariables(records,{...request,base:{score:1}}),/其他页面/);
    assert.throws(()=>patchChatVariables(records,{...request,swipeId:0}),/回复分支/);
    assert.throws(()=>patchChatVariables(records,{...request,messageText:'changed'}),/消息/);
    assert.equal(records[1].variables[1].score,7);
    const saved=patchChatVariables(records,request);
    assert.doesNotThrow(()=>patchChatVariables(saved,request)); // Retry after an uncertain response.
});
test('default floor chooses recent visible variables and reads active branches', () => {
    const messages=[{variables:[{stat_data:{score:1}}]},{mes:'plain'},{is_system:true,variables:[{hidden:true}]}];
    assert.equal(defaultVariableMessage(messages),0);
    assert.deepEqual(chatVariableValue({},fixture().slice(1),'message',0),{score:7});
});
