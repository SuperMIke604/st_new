// Load the selected colors before the first paint. All themes share the Ivory Cards layout.
const frontendThemes = (() => {
    const defaultTheme = 'ivory-cards';
    const themes = {
        'ivory-cards': { label: '象牙卡片', color: '#f3eee4' },
        purple: { label: '紫色', color: '#f0ebf7' },
        blue: { label: '蓝色', color: '#e9f1f8' },
        light: { label: '浅色', color: '#f3f5f7' },
        dark: { label: '深色', color: '#171a20' },
    };
    const storageKey = 'independent-palette';
    const normalize = theme => typeof theme === 'string' && Object.hasOwn(themes, theme) ? theme : defaultTheme;
    function apply(theme, persist = false) {
        const selected = normalize(theme);
        document.documentElement.dataset.theme = selected;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themes[selected].color);
        document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', selected === 'dark' ? 'dark' : 'light');
        if (persist) {
            try { localStorage.setItem(storageKey, selected); } catch { /* Server preferences remain available. */ }
        }
    }
    let saved;
    try { saved = localStorage.getItem(storageKey); } catch { /* Use the default when storage is unavailable. */ }
    apply(saved);
    return { apply, normalize, options: Object.entries(themes).map(([id, { label }]) => [id, label]) };
})();
