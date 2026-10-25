export function roleScriptContent(script, adapter) {
    let content = script.content || '';
    if (['mvu', 'mvu-schema'].includes(adapter)) return '';
    if (['role-avatar', 'role-archive'].includes(adapter)) {
        content = content.replaceAll("$('<div></div>').text(文案).css(常态)", "$('<div role=\"button\" tabindex=\"0\"></div>').text(文案).css(常态)").replaceAll('<div class="mxav-link"></div>', '<div class="mxav-link" role="button" tabindex="0"></div>');
        if (/^\s*\(async\s*\(/.test(content)) content = 'await ' + content;
    }
    if (adapter !== 'role-avatar') return content;
    const start = content.indexOf('  function 开库() {'), end = content.indexOf('  function 规范名(', start);
    if (start < 0 || end < 0) throw Error('头像库版本结构已变化，请重新检查适配。');
    return (content.slice(0, start) + `
  const 读全部=()=>__avatarStore('list');
  const 存记录=records=>__avatarStore('put',{records});
  const 删记录=key=>__avatarStore('delete',{key:String(key)});
  const 清空库=()=>__avatarStore('clear');
` + content.slice(end)).replace('window.indexedDB ?? 宿主窗口.indexedDB', 'true');
}
