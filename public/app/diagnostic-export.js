// External file handlers may pause or replace the page. Keep active generation
// exports in memory, and download the captured snapshot only after completion.
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
