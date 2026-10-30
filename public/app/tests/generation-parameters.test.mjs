import test from 'node:test';
import assert from 'node:assert/strict';
import { generationBody } from '../engine.js';

const make = (source, model, preset = {}) => generationBody({ source, model, url: 'https://relay.example/v1', stream: false }, { temperature: 1, top_p: .9, openai_max_tokens: 40000, ...preset }, [{ role: 'system', content: 'test' }]);

test('OpenAI and custom match native ordinary request samplers for the test model', () => {
    for (const source of ['openai', 'custom']) {
        const body = make(source, '[bo+]gemini-4-argon-3.5', { top_k: 50, top_a: .2, min_p: .1, repetition_penalty: 1.2, reasoning_effort: 'auto', verbosity: 'auto' });
        assert.equal(body.temperature, 1); assert.equal(body.top_p, .9); assert.equal(body.max_tokens, 40000); assert.equal(body.stream, false);
        for (const key of ['top_k', 'top_a', 'min_p', 'repetition_penalty', 'custom_include_body', 'reasoning_effort', 'verbosity']) assert.equal(Object.hasOwn(body, key), false, key);
        assert.equal(body.messages[0].role, 'system');
    }
});

test('native reasoning aliases differ by source and model while auto is omitted', () => {
    for (const [source, model, value, expected] of [
        ['openai','gpt-5.4','min','none'], ['openai','gpt-5','min','min'], ['openai','gpt-4.1','min','low'],
        ['openai','gpt-6-astra','max','max'], ['openai','gpt-5.6','max','xhigh'], ['openai','gpt-4.1','max','high'],
        ['custom','gpt-5.6','max','high'], ['custom','koboldcpp/test','min','minimal'], ['custom','koboldcpp/test','max','xhigh'],
    ]) assert.equal(make(source,model,{reasoning_effort:value}).reasoning_effort,expected);
    assert.equal(make('custom','test',{verbosity:'high'}).verbosity,'high');
});

test('OpenAI reasoning models use native completion limits and custom models retain their own sampling', () => {
    for (const model of ['o1','o3','o4-mini','gpt-5','gpt-6-astra']) {
        const body = make('openai', model);
        assert.equal(body.max_completion_tokens,40000); assert.equal(body.max_tokens,undefined); assert.equal(body.temperature,undefined); assert.equal(body.top_p,undefined);
        const custom = make('custom',model);
        assert.equal(custom.max_tokens,40000); assert.equal(custom.max_completion_tokens,undefined); assert.equal(custom.temperature,1);
    }
    assert.equal(make('openai','o1').messages[0].role,'user');
    const streaming = model => generationBody({source:'openai',model,stream:true}, {}, []);
    assert.equal(streaming('o1').stream,false); assert.equal(streaming('o1-2024-12-17').stream,false); assert.equal(streaming('o3').stream,true);
    assert.equal(make('openai','o3').messages[0].role,'system');
    const base=make('openai','gpt-5.4'); assert.equal(base.temperature,1); assert.equal(base.top_p,.9); assert.equal(base.frequency_penalty,undefined);
    assert.equal(make('openai','gpt-5.4',{reasoning_effort:'high'}).temperature,undefined);
});

test('Claude 5 model filters apply to both supported routes and leave source data unchanged', () => {
    for (const source of ['openai','custom']) for (const model of ['claude-fable-5','anthropic/claude-opus-5','claude-sonnet-5']) {
        const preset={temperature:1,top_k:50,reasoning_effort:'high'}, before=structuredClone(preset);
        const messages=[{role:'system',content:'keep'}];
        const body=generationBody({source,model,url:'https://relay.example/v1'},preset,messages);
        for(const key of ['temperature','top_p','top_k','frequency_penalty','presence_penalty','reasoning_effort']) assert.equal(Object.hasOwn(body,key),false,key);
        assert.deepEqual(preset,before); assert.deepEqual(messages,[{role:'system',content:'keep'}]);
    }
});
