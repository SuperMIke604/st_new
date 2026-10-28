export const readingFields = [
    ['fontSize', '字体大小（px）', 15, 12, 36, 1],
    ['letterSpacing', '字间距（px）', .15, 0, 6, .1],
    ['lineHeight', '行间距（倍）', 1.95, 1.2, 3.5, .05],
    ['paragraphSpacing', '段间距（px）', 10, 0, 60, 1],
];
export function readingSettings(value = {}, strict = false) {
    const settings = Object.fromEntries(readingFields.map(([key, label, fallback, min, max]) => {
        const number = value[key] === '' || value[key] == null ? fallback : Number(value[key]);
        if (strict && (!Number.isFinite(number) || number < min || number > max)) throw new Error(`${label}的范围是 ${min}–${max}。`);
        return [key, Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback];
    }));
    const color = String(value.dialogueColor ?? '').trim();
    const validColor = /^#?(?:[\da-f]{3}|[\da-f]{6})$/i.test(color);
    if (strict && color && !validColor) throw new Error('对话文字颜色请填写 3 位或 6 位十六进制色号，例如 #68280f；留空跟随主题。');
    settings.dialogueColor = validColor ? `#${color.replace(/^#/, '').toLowerCase()}` : '';
    return settings;
}
export function applyReading(value, root = document.documentElement) {
    const settings = readingSettings(value);
    for (const [key, unit] of [['fontSize', 'px'], ['letterSpacing', 'px'], ['lineHeight', ''], ['paragraphSpacing', 'px']]) root.style.setProperty(`--reading-${key}`, `${settings[key]}${unit}`);
    root.style.setProperty('--reading-dialogueColor', settings.dialogueColor);
}
