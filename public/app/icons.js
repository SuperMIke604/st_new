// Original inline line drawings. No icon font or external resource dependency.
const paths = {
    message: '<path d="M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z"/><path d="M7 10h10M7 14h6"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v7c0 4 18 4 18 0V5M3 12v7c0 4 18 4 18 0v-7"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="2"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    autofill: '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z"/>',
    import: '<path d="M4 14v6h16v-6M12 3v12m-5-5 5 5 5-5"/>',
    export: '<path d="M4 14v6h16v-6M12 15V3m-5 5 5-5 5 5"/>',
    left: '<path d="m15 5-7 7 7 7"/>',
    right: '<path d="m9 5 7 7-7 7"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 14h12l1-14M10 10v6m4-6v6"/>',
    regex: '<path d="m8 5-4 14m16-14-4 14M5 9h16M3 15h16"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="m3 3 18 18M10 5a12 12 0 0 1 12 7 18 18 0 0 1-4 5M6 6a18 18 0 0 0-4 6s3.5 7 10 7a12 12 0 0 0 4-1M10 10a3 3 0 0 0 4 4"/>',
    nav: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
    tools: '<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    send: '<path d="m4 11 16-7-7 16-2-7-7-2Zm7 2 9-9"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    chat: '<path d="M21 11a8 8 0 0 1-8 8H6l-4 3 1-7a8 8 0 0 1-1-4 9 9 0 0 1 19 0Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    card: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M6 16a3 3 0 0 1 6 0m3-8h3m-3 5h3"/>',
    book: '<path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15"/>',
    plug: '<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0Zm6 9v4"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    history: '<path d="M3 4v5h5M3 9a9 9 0 1 1 0 7m9-10v6l4 2"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L20 8a3 3 0 0 0-4-4L5 15l-1 5Z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    refresh: '<path d="M20 4v6h-6M4 20v-6h6m-6-4a8 8 0 0 1 13-6l3 6M4 14l3 6a8 8 0 0 0 13-6"/>',
    down: '<path d="M12 4v16m-6-6 6 6 6-6"/>',
    up: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
    folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
};
export function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.65', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
    svg.innerHTML = paths[name] || paths.tools;
    return svg;
}
