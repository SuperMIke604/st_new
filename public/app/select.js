import { installPopoverToggle } from './popover-toggle.js';
// Keep native select values/events as the data interface; render an accessible
// combobox in the top layer so scroll containers cannot clip its options.
let sequence = 0;
let opened = null;
export function enhanceSelect(select) {
    if (select.dataset.enhanced) return;
    select.dataset.enhanced = 'true';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'select-control';
    button.setAttribute('role', 'combobox'); button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', select.getAttribute('aria-label') || select.closest('label')?.querySelector('span')?.textContent || '选择');
    const text = document.createElement('span'); button.append(text);
    const arrow = document.createElement('span'); arrow.className = 'select-chevron'; arrow.setAttribute('aria-hidden', 'true'); button.append(arrow);
    const menu = document.createElement('div'); menu.className = 'select-menu'; menu.id = `select-menu-${++sequence}`;
    menu.setAttribute('role', 'listbox'); menu.setAttribute('popover', 'auto'); menu.setAttribute('aria-label', button.getAttribute('aria-label'));
    button.setAttribute('aria-controls', menu.id);
    select.after(button); select.classList.add('native-select'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    let active = -1; let items = []; let search = ''; let searchAt = 0;
    const sync = () => { const label = select.selectedOptions[0]?.textContent || '请选择'; if (text.textContent !== label) text.textContent = label; button.disabled = select.disabled; };
    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(select, 'value', { configurable: true, get() { return valueDescriptor.get.call(this); }, set(value) { valueDescriptor.set.call(this, value); sync(); } });
    const close = () => { if (menu.matches(':popover-open')) menu.hidePopover(); button.setAttribute('aria-expanded', 'false'); button.removeAttribute('aria-activedescendant'); if (opened?.button === button) opened = null; };
    const highlight = index => {
        active = index; items.forEach((item, i) => item.classList.toggle('highlighted', i === active));
        if (items[active]) { button.setAttribute('aria-activedescendant', items[active].id); const item = items[active]; const scroller = item.parentElement; if (item.offsetTop < scroller.scrollTop) scroller.scrollTop = item.offsetTop; else if (item.offsetTop + item.offsetHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = item.offsetTop + item.offsetHeight - scroller.clientHeight; }
    };
    const choose = index => {
        if (!select.options[index] || select.options[index].disabled) return;
        select.selectedIndex = index; sync(); close();
        select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); button.focus();
    };
    const open = () => {
        opened?.close(); menu.replaceChildren();
        let root = menu; let filterInput = null;
        if (select.dataset.searchable === 'true') {
            menu.classList.add('searchable-select-menu');
            menu.removeAttribute('role');
            filterInput = document.createElement('input'); filterInput.type = 'search'; filterInput.className = 'select-search'; filterInput.placeholder = select.dataset.searchPlaceholder || '搜索或输入模型 ID…'; filterInput.setAttribute('aria-label', select.dataset.searchLabel || '搜索模型');
            root = document.createElement('div'); root.setAttribute('role', 'listbox'); root.id = `${menu.id}-options`; root.setAttribute('aria-label', button.getAttribute('aria-label')); button.setAttribute('aria-controls', root.id);
            root.className = 'select-options-scroll';
            menu.append(filterInput, root);
        }
        items = [...select.options].map((option, index) => {
            const item = document.createElement('div'); item.className = 'select-option'; item.id = `${menu.id}-${index}`;
            item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.selected)); item.setAttribute('aria-disabled', String(option.disabled));
            const label = document.createElement('span'); label.textContent = option.textContent;
            const check = document.createElement('span'); check.className = 'select-check'; check.textContent = option.selected ? '✓' : ''; check.setAttribute('aria-hidden', 'true'); item.append(label, check);
            item.addEventListener('pointerdown', event => event.preventDefault()); item.addEventListener('click', () => choose(index));
            item.addEventListener('pointermove', () => { if (!option.disabled) highlight(index); }); root.append(item); return item;
        });
        if (filterInput) {
            const custom = document.createElement('button'); custom.type = 'button'; custom.className = 'select-custom'; custom.hidden = true; menu.append(custom);
            const useCustom = () => {
                const value = filterInput.value.trim(); if (!value) return;
                const option = document.createElement('option'); option.value = value; option.textContent = value; select.append(option); choose(select.options.length - 1);
            };
            custom.addEventListener('click', useCustom);
            filterInput.addEventListener('input', () => {
                const query = filterInput.value.trim().toLowerCase();
                items.forEach((item, index) => { item.hidden = !select.options[index].textContent.toLowerCase().includes(query); });
                const first = items.findIndex((item, index) => !item.hidden && !select.options[index].disabled); highlight(first);
                custom.hidden = select.dataset.allowCustom !== 'true' || !query || [...select.options].some(option => option.value.toLowerCase() === query);
                custom.textContent = `使用模型 ID：${filterInput.value.trim()}`;
            });
            filterInput.addEventListener('keydown', event => {
                if (event.key === 'Escape') { event.preventDefault(); close(); button.focus(); }
                else if (event.key === 'Tab') close();
                else if (event.key === 'Enter') { event.preventDefault(); if (active >= 0 && !items[active].hidden) choose(active); else useCustom(); }
                else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault(); const enabled = items.map((item, index) => !item.hidden && !select.options[index].disabled ? index : -1).filter(index => index >= 0);
                    const position = enabled.indexOf(active); highlight(enabled[Math.max(0, Math.min(enabled.length - 1, position + (event.key === 'ArrowDown' ? 1 : -1)))]);
                }
            });
        }
        (select.closest('dialog') || document.body).append(menu);
        const rect = button.getBoundingClientRect();
        const controlSize = parseFloat(getComputedStyle(button).getPropertyValue('--control-size')) || 42;
        const height = Math.min(300, items.length * controlSize + Math.max(0, items.length - 1) * 5 + 12 + (filterInput ? controlSize + 14 : 0));
        const below = innerHeight - rect.bottom - 12;
        menu.style.width = `${Math.min(Math.max(rect.width, 180), innerWidth - 24)}px`;
        menu.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - Math.max(rect.width, 180) - 12))}px`;
        menu.style.top = `${below >= Math.min(height, 160) ? rect.bottom + 6 : Math.max(12, rect.top - height - 6)}px`;
        menu.style.maxHeight = `${Math.max(80, below >= Math.min(height, 160) ? Math.min(300, below - 6) : Math.min(300, rect.top - 18))}px`;
        menu.showPopover(); button.setAttribute('aria-expanded', 'true'); opened = { button, close }; highlight(select.selectedIndex);
        if (matchMedia('(hover: hover) and (pointer: fine)').matches) filterInput?.focus({ preventScroll: true });
    };
    installPopoverToggle(button, menu, { open, close });
    button.addEventListener('keydown', event => {
        const showing = menu.matches(':popover-open');
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab'].includes(event.key)) {
            if (event.key === 'Tab') { close(); return; }
            event.preventDefault();
            if (event.key === 'Escape') { close(); return; }
            if (!showing) { open(); return; }
            if (event.key === 'Enter' || event.key === ' ') { choose(active); return; }
            const enabled = [...select.options].map((o, i) => o.disabled ? -1 : i).filter(i => i >= 0);
            const at = enabled.indexOf(active);
            highlight(event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1) : enabled[Math.max(0, Math.min(enabled.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]);
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            if (!showing) open(); search = Date.now() - searchAt > 700 ? event.key : search + event.key; searchAt = Date.now();
            const index = [...select.options].findIndex(o => !o.disabled && o.textContent.toLowerCase().startsWith(search.toLowerCase())); if (index >= 0) highlight(index);
        }
    });
    menu.addEventListener('toggle', () => { if (!menu.matches(':popover-open')) { button.setAttribute('aria-expanded', 'false'); button.removeAttribute('aria-activedescendant'); if (opened?.button === button) opened = null; } });
    select.addEventListener('change', sync);
    const observer = new MutationObserver(sync); observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true });
    sync();
}
export function installSelects() {
    const scan = () => {
        if (opened && !opened.button.isConnected) opened.close();
        document.querySelectorAll('select:not([data-enhanced])').forEach(enhanceSelect);
        document.querySelectorAll('.select-menu').forEach(menu => { if (!document.querySelector(`[aria-controls="${menu.id}"], [aria-controls="${menu.id}-options"]`)) menu.remove(); });
    };
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    let viewportWidth = innerWidth;
    window.addEventListener('resize', () => { if (innerWidth !== viewportWidth) { viewportWidth = innerWidth; opened?.close(); } });
    document.addEventListener('scroll', event => { if (opened && !event.target.closest?.('.select-menu')) opened.close(); }, true);
    document.addEventListener('pointerdown', event => { if (opened && !event.target.closest('.select-menu') && !opened.button.contains(event.target)) opened.close(); });
    scan();
}
