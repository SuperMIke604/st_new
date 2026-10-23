export const readingFields = [
    ['fontSize', '字体大小（px）', 15, 12, 36, 1],
    ['letterSpacing', '字间距（px）', .15, 0, 6, .1],
    ['lineHeight', '行间距（倍）', 1.95, 1.2, 3.5, .05],
    ['paragraphSpacing', '段间距（px）', 10, 0, 60, 1],
];
export function readingSettings(value = {}, strict = false) {
    return Object.fromEntries(readingFields.map(([key, label, fallback, min, max]) => {
        const number = value[key] === '' || value[key] == null ? fallback : Number(value[key]);
        if (strict && (!Number.isFinite(number) || number < min || number > max)) throw new Error(`${label}的范围是 ${min}–${max}。`);
        return [key, Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback];
    }));
}
export function applyReading(value, root = document.documentElement) {
    const settings = readingSettings(value);
    for (const [key, unit] of [['fontSize', 'px'], ['letterSpacing', 'px'], ['lineHeight', ''], ['paragraphSpacing', 'px']]) root.style.setProperty(`--reading-${key}`, `${settings[key]}${unit}`);
}
