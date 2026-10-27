// Keep short prompts compact and scroll long prompts within their original row limit.
export function autosizePrompt(textarea) {
    textarea.classList.add('prompt-autosize');
    let frame = 0, width = 0;
    const resize = () => {
        frame = 0;
        if (!textarea.isConnected || !textarea.getClientRects().length || !textarea.clientWidth) return;
        const style = getComputedStyle(textarea);
        const number = key => Number.parseFloat(style[key]) || 0;
        const border = number('borderTopWidth') + number('borderBottomWidth');
        const padding = number('paddingTop') + number('paddingBottom');
        const maximum = textarea.rows * number('lineHeight') + padding + border;
        textarea.style.maxHeight = `${maximum}px`;
        textarea.style.height = '0px';
        textarea.style.height = `${Math.min(maximum, Math.max(42, textarea.scrollHeight + border))}px`;
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(resize); };
    const observer = new ResizeObserver(() => {
        const next = textarea.getBoundingClientRect().width;
        if (next !== width) { width = next; schedule(); }
    });
    observer.observe(textarea);
    textarea.addEventListener('input', schedule);
    schedule();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); textarea.removeEventListener('input', schedule); };
}
