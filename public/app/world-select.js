import { installPopoverToggle } from './popover-toggle.js';
import { uuid } from './uuid.js';

const popupPositions = new WeakMap();
const openPopupSelector = '.global-world-popup:is(:popover-open)';
function repositionOpenPopup() {
    const popup = document.querySelector(openPopupSelector);
    popupPositions.get(popup)?.();
}
window.addEventListener('resize', repositionOpenPopup);
window.visualViewport?.addEventListener('resize', repositionOpenPopup);
window.visualViewport?.addEventListener('scroll', repositionOpenPopup);
document.addEventListener('close', event => {
    if (event.target.localName === 'dialog' && !event.target.open) {
        event.target.querySelector(openPopupSelector)?.hidePopover();
    }
}, true);

export function renderGlobalWorldSelect(container, worlds, selected, { el, icon, changed }) {
    const label = el('div', 'global-world-label', '已启用的世界书（全局有效）');
    const control = el('div', 'global-world-control');
    const tags = el('div', 'global-world-tags');
    const toggle = el('button', 'global-world-toggle'); toggle.type = 'button'; toggle.append(icon('chevron'));
    toggle.setAttribute('aria-label', '选择全局世界书'); toggle.setAttribute('aria-expanded', 'false');
    const popup = el('div', 'global-world-popup'); popup.setAttribute('popover', 'auto'); popup.id = `global-world-${uuid()}`;
    toggle.setAttribute('aria-controls', popup.id);
    const search = el('input', 'global-world-search'); search.type = 'search'; search.placeholder = '搜索世界书…'; search.setAttribute('aria-label', '搜索全局世界书');
    const list = el('div', 'global-world-options'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', '全局世界书选项');
    const empty = el('p', 'note', '没有匹配的世界书');
    popup.append(search, list, empty); control.append(tags, toggle); container.append(label, control, popup);
    const names = new Map(worlds.map(world => [world.file_id, world.name]));
    const options = new Map();
    const sync = () => {
        tags.replaceChildren();
        if (!selected.size) tags.append(el('span', 'global-world-placeholder', '选择全局世界书'));
        for (const id of selected) {
            const tag = el('span', 'global-world-tag'); tag.append(el('span', '', names.get(id) || id));
            const remove = el('button'); remove.type = 'button'; remove.append(icon('close')); remove.setAttribute('aria-label', `移除全局世界书 ${names.get(id) || id}`); remove.title = '移除';
            remove.addEventListener('click', () => { selected.delete(id); sync(); changed(); }); tag.append(remove); tags.append(tag);
        }
        for (const [id, { check }] of options) check.checked = selected.has(id);
    };
    for (const world of worlds) {
        const row = el('label', 'global-world-option'); row.dataset.search = `${world.name} ${world.file_id}`.toLocaleLowerCase();
        const check = el('input'); check.type = 'checkbox';
        check.addEventListener('change', () => { if (check.checked) selected.add(world.file_id); else selected.delete(world.file_id); sync(); changed(); });
        row.append(check, el('span', '', world.name)); list.append(row);
        options.set(world.file_id, { check, row });
    }
    const filter = () => {
        const query = search.value.trim().toLocaleLowerCase(); let count = 0;
        for (const row of list.children) { row.hidden = !row.dataset.search.includes(query); if (!row.hidden) count++; }
        empty.hidden = count > 0;
    };
    const close = () => {
        if (popup.matches(':popover-open')) popup.hidePopover();
        toggle.setAttribute('aria-expanded', 'false');
    };
    const position = () => {
        const rect = control.getBoundingClientRect(), gap = 6, margin = 12;
        const viewport = window.visualViewport;
        const top = (viewport?.offsetTop ?? 0) + margin;
        const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) - margin;
        const left = (viewport?.offsetLeft ?? 0) + margin;
        const availableWidth = Math.max(0, (viewport?.width ?? innerWidth) - 2 * margin);
        const width = Math.min(rect.width, availableWidth);
        const below = bottom - rect.bottom - gap, above = rect.top - top - gap;
        const openBelow = below >= Math.min(260, above);
        const availableHeight = openBelow ? below : above;
        const height = Math.max(0, Math.min(330, bottom - top, Math.max(100, availableHeight)));
        popup.style.width = `${width}px`;
        popup.style.left = `${Math.max(left, Math.min(rect.left, left + availableWidth - width))}px`;
        popup.style.maxHeight = `${height}px`;
        const popupHeight = Math.min(popup.scrollHeight, height);
        const y = openBelow ? rect.bottom + gap : rect.top - gap - popupHeight;
        popup.style.top = `${Math.max(top, Math.min(y, bottom - popupHeight))}px`;
    };
    popupPositions.set(popup, position);
    search.addEventListener('input', filter);
    const activate = installPopoverToggle(toggle, popup, { pointerTarget: control, close, open: () => {
        const checked = [], unchecked = [];
        for (const [id, { row }] of options) (selected.has(id) ? checked : unchecked).push(row);
        list.replaceChildren(...checked, ...unchecked);
        search.value = ''; filter(); popup.showPopover({ source: toggle }); list.scrollTop = 0;
        position();
    } });
    control.addEventListener('click', event => { if (!event.target.closest('button,.global-world-tag')) activate(event); });
    popup.addEventListener('toggle', () => toggle.setAttribute('aria-expanded', String(popup.matches(':popover-open'))));
    popup.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); close(); toggle.focus(); } });
    container.parentElement?.addEventListener('scroll', () => {
        if (!popup.matches(':popover-open')) return;
        // A soft keyboard can scroll the panel as it focuses the search field.
        if (document.activeElement === search) position();
        else close();
    });
    sync(); filter();
}
