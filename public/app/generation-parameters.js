// Mirrors the supported OPENAI / CUSTOM branches of native
// createGenerationParameters and getReasoningEffort (SillyTavern 1.19.0).
export function nativeGenerationParameters(body, preset) {
    const result = structuredClone(body), model = result.model, openai = result.chat_completion_source === 'openai';
    // Neither supported native source adds these provider-specific samplers.
    for (const key of ['top_k', 'top_a', 'min_p', 'repetition_penalty']) delete result[key];
    let effort = preset.reasoning_effort;
    if (!effort || effort === 'auto') effort = undefined;
    else if (!openai && /^koboldcpp\/(.+)$/.test(model)) effort = ({ min: 'minimal', max: 'xhigh' })[effort] || effort;
    else if (effort === 'min') effort = openai && /^gpt-5\.(4|5|6)/.test(model) ? 'none' : openai && /^gpt-5/.test(model) ? 'min' : 'low';
    else if (effort === 'max') effort = openai && /^gpt-6-astra/.test(model) ? 'max' : openai && /^gpt-5\.6/.test(model) ? 'xhigh' : 'high';
    delete result.reasoning_effort;
    if (effort) result.reasoning_effort = effort;
    if (preset.verbosity && preset.verbosity !== 'auto') result.verbosity = preset.verbosity;
    else delete result.verbosity;
    if (openai && ['o1', 'o1-2024-12-17'].includes(model)) result.stream = false;
    const remove = (...keys) => { for (const key of keys) delete result[key]; };
    const completionLimit = () => { result.max_completion_tokens = result.max_tokens; delete result.max_tokens; };
    if (openai && /^(o1|o3|o4)/.test(model)) {
        completionLimit(); remove('temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'logprobs', 'top_logprobs', 'stop', 'logit_bias');
        if (/^o1/.test(model)) {
            for (const message of result.messages) if (message.role === 'system') message.role = 'user';
            remove('n', 'tools', 'tool_choice');
        }
    }
    if (openai && /gpt-5/.test(model)) {
        completionLimit(); remove('logprobs', 'top_logprobs');
        if (/gpt-5-chat-latest/.test(model)) remove('tools', 'tool_choice');
        else if (/gpt-5\.(1|2|3|4)/.test(model) && !/chat-latest/.test(model) && !result.reasoning_effort) remove('frequency_penalty', 'presence_penalty', 'logit_bias', 'stop');
        else remove('temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'logit_bias', 'stop');
    }
    if (openai && /gpt-6-astra/.test(model)) { completionLimit(); remove('temperature', 'top_p', 'logprobs', 'top_logprobs'); }
    if (/claude-(fable|opus-5|sonnet-5)/.test(model)) remove('temperature', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty', 'reasoning_effort');
    return result;
}
