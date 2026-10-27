// External file handlers may pause or replace the page. Keep active generation
// exports in memory, and download the captured snapshot only after completion.
export async function copyDiagnostics(text, parent, { clipboard = globalThis.navigator?.clipboard, document: doc = globalThis.document } = {}) {
    try { if (clipboard?.writeText) { await clipboard.writeText(text); return; } } catch { /* HTTP/mobile browsers may require the legacy copy path. */ }
    const focused = doc.activeElement, selection = doc.getSelection?.();
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
    const input = doc.createElement('textarea'); input.value = text; input.readOnly = true;
    input.setAttribute('aria-hidden', 'true'); input.tabIndex = -1;
    Object.assign(input.style, { position: 'fixed', left: '-10000px', top: '0', opacity: '0', pointerEvents: 'none' });
    parent.append(input);
    try {
        input.focus({ preventScroll: true }); input.select();
        if (!doc.execCommand?.('copy')) throw new Error('复制失败，请允许浏览器访问剪贴板后重试。');
    } finally {
        input.remove(); focused?.focus?.({ preventScroll: true });
        if (selection && ranges.length) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range); }
    }
}

export function downloadDiagnostics(text, parent, { document: doc = document, urls = URL, later = setTimeout } = {}) {
    const url = urls.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = doc.createElement('a'); link.href = url; link.download = 'loading-timings.json';
    link.target = '_blank'; link.rel = 'noopener noreferrer'; parent.append(link);
    try { link.click(); } finally { link.remove(); later(() => urls.revokeObjectURL(url), 60000); }
}

export function exportDiagnostics(text, parent, isGenerating, dependencies = {}) {
    if (!isGenerating()) { downloadDiagnostics(text, parent, dependencies); return; }
    const doc = dependencies.document || document;
    const preview = doc.createElement('textarea'); preview.className = 'timing-copy'; preview.readOnly = true; preview.rows = 10; preview.value = text;
    preview.setAttribute('aria-label', '已保存的日志快照，可全选复制');
    const note = doc.createElement('p'); note.className = 'note'; note.textContent = '已保留此刻的日志快照。为避免手机浏览器下载影响生成，现在可全选复制；生成结束后点击下面的按钮下载同一份快照。';
    const save = doc.createElement('button'); save.type = 'button'; save.className = 'button'; save.textContent = '下载此快照（生成结束后）';
    save.addEventListener('click', () => {
        if (isGenerating()) { note.textContent = '对话仍在生成，快照已保留，可先全选复制。生成结束后再点击下载。'; return; }
        downloadDiagnostics(text, parent, dependencies);
    });
    parent.querySelector('.timing-export-snapshot')?.remove();
    const section = doc.createElement('section'); section.className = 'timing-export-snapshot'; section.append(note, preview, save); parent.append(section);
}
