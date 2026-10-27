import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceUpdate,referenceSheetText,referencePreviewRows,referencePagination} from '../database-reference.js';
const database=()=>({mate:{type:'chatSheets'},sheet_0:{name:'人物',content:[[null,'姓名','状态'],[null,'甲','正常']]}});
test('upstream operations skip invalid targets, repair JSON, and extend update rows',()=>{
 let result=referenceUpdate('<dataUpdate>{"operations":[{"action":"insert","sheet":"missing"},{"action":"update","sheet":0,"row":2,"data":{"0":"乙"}}]}</dataUpdate>',database());
 assert.equal(result.changed,true);assert.equal(result.data.sheet_0.content[3][1],'乙');assert.ok(result.feedback.length);
 result=referenceUpdate('<dataUpdate>{"operations":[{"action":"update","sheet":0,"row":0,"data":{"1":"多行\n内容"}}]}</dataUpdate>',database());assert.equal(result.data.sheet_0.content[1][2],'多行\n内容');
});
test('upstream readable format, diff search and pagination',()=>{
 assert.equal(referenceSheetText('人物',['姓名','状态'],[[null,'甲','正常']]),'### 人物\n- 姓名: 甲\n  - 状态: 正常');
 const old=database(),table={key:'sheet_0',headers:old.sheet_0.content[0],rows:[[null,'乙','正常']]};
 const rows=referencePreviewRows(table,{diffMode:true,search:'乙',previousData:old});assert.equal(rows.length,1);assert.equal(rows[0].diffType,'modified');assert.equal(rows[0].changedCols[1],true);
 assert.deepEqual(referencePagination(1,3),[1,2,3]);
});

import { databaseSettings, fillMessages, migrateLegacySettings } from '../database.js';
import { parseUpdate, databaseUpdateNotice } from '../database.js';

test('update notices count successful upstream operations across batches, separately from replaced tables', () => {
 const counts = { operations: 0, tables: 0 };
 let value = parseUpdate('<dataUpdate>{"operations":[{"action":"insert","sheet":"missing"},{"action":"update","sheet":0,"row":0,"data":{"1":"更新"}},{"action":"insert","sheet":0,"data":{"0":"乙"}}]}</dataUpdate>', database(), counts);
 assert.deepEqual(counts, { operations: 2, tables: 0 });
 value = parseUpdate('<dataUpdate>{"operations":[{"action":"delete","sheet":0,"row":1}]}</dataUpdate>', value, counts);
 assert.equal(databaseUpdateNotice(counts), '数据更新成功，共应用 3 条更新');
 parseUpdate(`<dataUpdate>${JSON.stringify({ sheet_0: value.sheet_0 })}</dataUpdate>`, value, counts);
 assert.deepEqual(counts, { operations: 3, tables: 1 });
 assert.equal(databaseUpdateNotice(counts), '数据更新成功，共应用 3 条更新，更新 1 张表格');
 assert.equal(databaseUpdateNotice({ tables: 2 }), '数据更新成功，共更新 2 张表格');
 assert.throws(() => parseUpdate('<dataUpdate>{"operations":[]}</dataUpdate>', value, counts));
 assert.deepEqual(counts, { operations: 3, tables: 1 });
});
test('reference defaults, settings import/export fields and prompt tag processing survive adapters',()=>{
 const defaults=databaseSettings();assert.equal(defaults.autoUpdateFrequency,0);assert.equal(defaults.updateBatchSize,1);assert.equal(defaults.summaryTableMaxEntries,10);assert.equal('autoHideMessages' in defaults,false);assert.equal(defaults.maxTokens,120000);assert.equal(defaults.temperature,.9);assert.equal(defaults.inject,false);
 const source={autoUpdateEnabled:true,autoUpdateFrequency:5,updateBatchSize:8,removeTags:'think',userMessageTags:'user|context',apiMode:'custom',apiConfig:{useMainApi:false,url:'http://localhost',model:'test',max_tokens:50000,temperature:.7},charCardPrompts:[{name:'原预设',prompt:[{role:'USER',content:'$0\n$1\n$4'}],overviewTemplate:JSON.stringify(database())}],currentPromptIndex:0};
 const settings=migrateLegacySettings(source);assert.equal(settings.auto,true);assert.equal(settings.autoUpdateFrequency,5);assert.equal(settings.updateBatchSize,8);assert.equal(settings.apiConfig.url,source.apiConfig.url);assert.equal(settings.maxTokens,50000);
 const messages=fillMessages(settings,database(),[{is_user:true,mes:'<think>secret</think>hello'}],0,0,'world');assert.ok(messages[0].content.includes('<context><user>hello</user></context>'));assert.ok(!messages[0].content.includes('secret'));assert.ok(messages[0].content.includes('Columns:'));
});
