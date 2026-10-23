// Form editor data model. Unknown native fields and other order scopes survive.
export const markerLabels = {
    worldInfoBefore: '世界书 · 描述前', worldInfoAfter: '世界书 · 描述后',
    personaDescription: '用户设定', charDescription: '角色描述', charPersonality: '角色性格',
    scenario: '场景', dialogueExamples: '示例对话', chatHistory: '聊天历史',
};
const defaultIds = ['main', 'worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory', 'jailbreak'];
export function createPreset() {
    return presetDraft({ temperature: 1, top_p: 1, openai_max_context: 8192, openai_max_tokens: 512, names_behavior: 0,
        prompts: defaultIds.map(identifier => markerLabels[identifier]
            ? { identifier, name: markerLabels[identifier], marker: true, role: 'system', system_prompt: true }
            : { identifier, name: identifier === 'main' ? '主提示词' : '历史后指令', role: 'system', marker: false, system_prompt: true,
                content: identifier === 'main' ? 'Write {{char}}\'s next reply in a conversation with {{user}}.' : '' }),
        prompt_order: [{ character_id: 100001, order: defaultIds.map(identifier => ({ identifier, enabled: true })) }] });
}
export function uniquePresetName(base, names) {
    let name = base; let index = 2;
    while (names.includes(name)) name = `${base} ${index++}`;
    return name;
}
export function presetDraft(preset) {
    if (!preset || typeof preset !== 'object' || Array.isArray(preset)) throw new Error('预设文件格式不正确。');
    const draft = structuredClone(preset);
    draft.prompts ||= [];
    draft.prompt_order ||= [];
    if (!Array.isArray(draft.prompts) || !Array.isArray(draft.prompt_order)) throw new Error('预设条目格式不正确。');
    if (!draft.prompt_order.some(scope => Number(scope.character_id) === 100001)) {
        const base = draft.prompt_order[0]?.order || defaultIds.map(identifier => ({ identifier, enabled: true }));
        draft.prompt_order.push({ character_id: 100001, order: structuredClone(base) });
    }
    const order = promptOrder(draft);
    for (const item of order) {
        if (!draft.prompts.some(prompt => prompt.identifier === item.identifier) && markerLabels[item.identifier]) {
            draft.prompts.push({ identifier: item.identifier, name: markerLabels[item.identifier], marker: true, system_prompt: true });
        }
    }
    for (const prompt of draft.prompts) {
        if (!order.some(item => item.identifier === prompt.identifier)) order.push({ identifier: prompt.identifier, enabled: false });
    }
    return draft;
}
export function promptOrder(draft) { return draft.prompt_order.find(scope => Number(scope.character_id) === 100001).order; }
export function promptRows(draft) {
    return promptOrder(draft).map((order, index) => ({ order, index, prompt: draft.prompts.find(prompt => prompt.identifier === order.identifier) || { identifier: order.identifier, name: order.identifier, marker: true } }));
}
export function movePrompt(draft, identifier, delta) {
    const order = promptOrder(draft);
    const from = order.findIndex(item => item.identifier === identifier);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    const [item] = order.splice(from, 1); order.splice(to, 0, item);
}
export function addPrompt(draft, identifier) {
    if (draft.prompts.some(prompt => prompt.identifier === identifier)) throw new Error('条目标识已存在。');
    draft.prompts.push({ identifier, name: '新的提示词', role: 'system', content: '', system_prompt: false, marker: false, injection_position: 0, injection_depth: 0, injection_order: 100 });
    promptOrder(draft).push({ identifier, enabled: true });
}
export function removePrompt(draft, identifier) {
    if (markerLabels[identifier]) throw new Error('系统数据条目不能删除，可以通过开关停用。');
    draft.prompts = draft.prompts.filter(prompt => prompt.identifier !== identifier);
    for (const scope of draft.prompt_order) scope.order = scope.order.filter(item => item.identifier !== identifier);
}
export function validatePreset(draft) {
    const ids = new Set();
    for (const prompt of draft.prompts) {
        if (!prompt.identifier || ids.has(prompt.identifier)) throw new Error('预设条目标识缺失或重复。');
        ids.add(prompt.identifier);
        if (!prompt.marker && !['system', 'user', 'assistant'].includes(prompt.role || 'system')) throw new Error(`条目「${prompt.name}」的角色不正确。`);
    }
    const order = promptOrder(draft);
    const history = order.find(item => item.identifier === 'chatHistory');
    if (!history || history.enabled === false) throw new Error('请启用聊天历史条目，避免发送时漏掉对话。');
    if (new Set(order.map(item => item.identifier)).size !== order.length) throw new Error('预设顺序中存在重复条目。');
    for (const key of ['temperature', 'top_p', 'openai_max_context', 'openai_max_tokens']) if (!Number.isFinite(Number(draft[key]))) throw new Error('请填写有效的生成参数。');
    if (Number(draft.temperature) < 0 || Number(draft.temperature) > 2 || Number(draft.top_p) < 0 || Number(draft.top_p) > 1) throw new Error('Temperature 范围是 0–2，Top P 范围是 0–1。');
    if (Number(draft.openai_max_context) <= Number(draft.openai_max_tokens) + 64 || Number(draft.openai_max_tokens) < 1) throw new Error('上下文长度需大于回复长度，并至少留出 64 tokens。');
    return structuredClone(draft);
}
