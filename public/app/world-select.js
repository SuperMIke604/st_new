export function renderGlobalWorldSelect(container, worlds, selected, { el, icon, changed }) {
    const label = el('div', 'global-world-label', '已启用的世界书（全局有效）');
    const control = el('div', 'global-world-control');
    const tags = el('div', 'global-world-tags');
    const toggle = el('button', 'global-world-toggle'); toggle.type = 'button'; toggle.append(icon('chevron'));
    toggle.setAttribute('aria-label', '选择全局世界书'); toggle.setAttribute('aria-expanded', 'false');
    const popup = el('div', 'global-world-popup'); popup.setAttribute('popover', 'auto'); popup.id = `global-world-${crypto.randomUUID()}`;
    toggle.setAttribute('aria-controls', popup.id);
    const search = el('input', 'global-world-search'); search.type = 'search'; search.placeholder = '搜索世界书…'; search.setAttribute('aria-label', '搜索全局世界书');
    const list = el('div', 'global-world-options'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', '全局世界书选项');
    const empty = el('p', 'note', '没有匹配的世界书');
    popup.append(search, list, empty); control.append(tags, toggle); container.append(label, control, popup);
    const names = new Map(worlds.map(world => [world.file_id, world.name]));
    const checkboxes = new Map();
    const sync = () => {
        tags.replaceChildren();
        if (!selected.size) tags.append(el('span', 'global-world-placeholder', '选择全局世界书'));
        for (const id of selected) {
            const tag = el('span', 'global-world-tag'); tag.append(el('span', '', names.get(id) || id));
            const remove = el('button'); remove.type = 'button'; remove.append(icon('close')); remove.setAttribute('aria-label', `移除全局世界书 ${names.get(id) || id}`); remove.title = '移除';
            remove.addEventListener('click', () => { selected.delete(id); sync(); changed(); }); tag.append(remove); tags.append(tag);
        }
        for (const [id, check] of checkboxes) check.checked = selected.has(id);
    };
    for (const world of worlds) {
        const row = el('label', 'global-world-option'); row.dataset.search = `${world.name} ${world.file_id}`.toLocaleLowerCase();
        const check = el('input'); check.type = 'checkbox'; check.checked = selected.has(world.file_id); checkboxes.set(world.file_id, check);
        check.addEventListener('change', () => { if (check.checked) selected.add(world.file_id); else selected.delete(world.file_id); sync(); changed(); });
        row.append(check, el('span', '', world.name)); list.append(row);
    }
    const filter = () => {
        const query = search.value.trim().toLocaleLowerCase(); let count = 0;
        for (const row of list.children) { row.hidden = !row.dataset.search.includes(query); if (!row.hidden) count++; }
        empty.hidden = count > 0;
    };
    search.addEventListener('input', filter);
    toggle.addEventListener('click', () => {
        if (popup.matches(':popover-open')) { popup.hidePopover(); return; }
        search.value = ''; filter(); popup.showPopover();
        const rect = control.getBoundingClientRect(), gap = 6;
        popup.style.width = `${Math.min(rect.width, innerWidth - 24)}px`;
        popup.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - popup.offsetWidth - 12))}px`;
        const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
        const openBelow = below >= Math.min(260, above);
        const height = Math.max(100, Math.min(330, openBelow ? below - gap : above - gap));
        popup.style.maxHeight = `${height}px`;
        popup.style.top = `${openBelow ? rect.bottom + gap : Math.max(12, rect.top - Math.min(popup.scrollHeight, height) - gap)}px`;
        search.focus();
    });
    control.addEventListener('click', event => { if (!event.target.closest('button,.global-world-tag')) toggle.click(); });
    popup.addEventListener('toggle', () => toggle.setAttribute('aria-expanded', String(popup.matches(':popover-open'))));
    popup.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); popup.hidePopover(); toggle.focus(); } });
    container.parentElement?.addEventListener('scroll', () => { if (popup.matches(':popover-open')) popup.hidePopover(); });
    sync(); filter();
}
