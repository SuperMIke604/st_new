export function categorySelect(el, label, options, value, choose) {
    const wrapper = el('div', 'category-select');
    const select = el('select');
    select.setAttribute('aria-label', label);
    for (const [key, title] of options) {
        const option = el('option', '', title);
        option.value = key;
        select.append(option);
    }
    select.value = value;
    select.disabled = options.length < 2;
    select.addEventListener('change', async () => {
        const document = select.ownerDocument;
        const dialog = select.closest?.('dialog');
        const trigger = wrapper.querySelector('.select-control') || select;
        const restoreFocus = document?.activeElement === trigger;
        await choose(select.value, select);
        if (!restoreFocus || select.isConnected || !dialog?.open || document.activeElement !== document.body) return;
        for (const control of dialog.querySelectorAll('.category-select .select-control, .category-select select:not(.native-select)')) {
            if (control.getAttribute('aria-label') === label && control.getClientRects().length) {
                control.focus({ preventScroll: true });
                break;
            }
        }
    });
    wrapper.append(select);
    return wrapper;
}
