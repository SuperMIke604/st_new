// Apply the last saved palette before CSS and the first page paint.
(() => {
    const colors = { paper: '#f3eee4', sage: '#f7f8f4', mist: '#f3eee4', ivory: '#f3eee4', 'claude-day': '#f8f8f6' };
    let palette = 'paper';
    try {
        const saved = localStorage.getItem('independent-palette');
        if (Object.hasOwn(colors, saved)) palette = saved;
    } catch { /* Use the default palette when storage is unavailable. */ }
    document.documentElement.dataset.palette = palette;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors[palette]);
})();
