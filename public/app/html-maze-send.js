export function adaptMazeSend(source, opening) {
    if (opening && source.includes('onclick="signPact()"') && source.includes('textarea.value = commandStr;')) {
        const send = /    function signPact\(\) \{([\s\S]*?const commandStr = [^\n]+\n)\s*try \{\s*const doc = window\.parent\.document;[\s\S]*?\n    \}(?=\s*<\/script>)/;
        if (send.test(source)) return source.replace(send, (_, form) => `    async function signPact() {${form}
      try {
        await window.__sendCardMessage(commandStr);
        showToast();
      } catch (error) {
        window.alert(error.message);
      }
    }`);
    }

    if (!opening && source.includes('onclick="commitCache()"') && source.includes('let finalCmd = cacheCmds.map') && source.includes('$(document).ready(function()')) {
        const send = /    window\.commitCache = function\(\) \{\s*if\(cacheCmds\.length === 0\)[\s\S]*?const doc = window\.parent\.document;[\s\S]*?\n    \}(?=\s*\/\/[^\n]*\n    window\.openBook)/;
        if (!send.test(source) || !/<script type="module">[\s\S]*?<\/script>/.test(source)) return null;
        return source.replace(send, () => String.raw`    window.commitCache = async function() {
      if (cacheCmds.length === 0) return showToast('暂无意志');
      const button = document.querySelector('[onclick="commitCache()"]');
      if (button.disabled) return;
      button.disabled = true;
      try {
        const finalCmd = cacheCmds.map(c => typeof c === 'string' ? c : c.text).join('\n');
        await window.__sendCardMessage('<迷宫>\n' + finalCmd + '\n</迷宫>');
        cacheCmds = [];
        renderCachePreview();
        localRoomsCache = {};
        localStorage.removeItem('maze_sys_cmds');
        if (currentDateStr) lastProcessedDateStr = currentDateStr;
        saveResourceCaches();
        showToast('指令已传输！');
      } catch (error) {
        showToast(error.message);
      } finally {
        button.disabled = false;
      }
    }`)
            .replace(/(<script type="module">)([\s\S]*?)(<\/script>)/, (_, start, script, end) => `${start}\nwindow.__whenHtmlHelperReady(function () {${script}\n});\n${end}`);
    }
    return null;
}
