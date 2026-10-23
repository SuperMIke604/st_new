export const worldSettingsFields = [
    ['world_info_depth', '扫描深度（消息数）', 2, 0, 1000],
    ['world_info_budget', '上下文预算（%）', 25, 0, 100],
    ['world_info_budget_cap', '预算上限（tokens，0 不限制）', 0, 0, 2000000],
    ['world_info_max_recursion_steps', '递归扫描上限（0 不限制）', 0, 0, 1000],
];
export function validateWorldSettings(settings) {
    for (const [key, label, fallback, min, max] of worldSettingsFields) {
        const value = Number(settings[key] ?? fallback);
        if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) throw new Error(`${label}需填写 ${min}–${max} 之间的整数。`);
    }
    return structuredClone(settings);
}
