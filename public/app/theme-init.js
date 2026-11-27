// Load the selected appearance before the first paint.
const frontendThemes = (() => {
    const defaultTheme = 'ivory-cards';
    const themes = {
        'ivory-cards': { label: '象牙卡片', color: '#f3eee4' },
        purple: { label: '紫色', color: '#f0ebf7' },
        blue: { label: '蓝色', color: '#e9f1f8' },
        light: { label: '浅色', color: '#f3f5f7' },
        dark: { label: '深色', color: '#171a20' },
        'aurora-glass': { label: '极光玻璃', color: '#e9eafa', darkColor: '#18182e' },
        'ivory-glass': { label: '象牙玻璃', color: '#f3eee4' },
    };
    const storageKey = 'independent-palette';
    const systemDark = matchMedia('(prefers-color-scheme: dark)');
    const normalize = theme => typeof theme === 'string' && Object.hasOwn(themes, theme) ? theme : defaultTheme;
    function updateBrowserAppearance(theme) {
        const { color, darkColor } = themes[theme];
        const dark = theme === 'dark' || Boolean(darkColor && systemDark.matches);
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark && darkColor ? darkColor : color);
        document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', dark ? 'dark' : 'light');
    }
    function apply(theme, persist = false) {
        const selected = normalize(theme);
        document.documentElement.dataset.theme = selected;
        updateBrowserAppearance(selected);
        if (persist) {
            try { localStorage.setItem(storageKey, selected); } catch { /* Server preferences remain available. */ }
        }
    }
    let saved;
    try { saved = localStorage.getItem(storageKey); } catch { /* Use the default when storage is unavailable. */ }
    apply(saved);
    systemDark.addEventListener('change', () => updateBrowserAppearance(normalize(document.documentElement.dataset.theme)));
    return { apply, normalize, options: Object.entries(themes).map(([id, { label }]) => [id, label]) };
})();
