// Replace the order handler in the imported phone panel's runtime copy.
export function adaptHtmlOrder(source) {
    if (!source.includes('ordered_item: pkg.name') || !source.includes('order_remarks:')) return source;
    const handler = /contentArea\.querySelector\('\.order-button'\)\.onclick = \(\) => \{\s*const remarks = prompt\([\s\S]*?\n[ \t]*\};(?=\s*currentView = 'details';)/;
    return source.replace(handler, () => `contentArea.querySelector('.order-button').onclick = function () {
        (${editOrderRemarks})(this, pkg.name);
    };`);
}

function editOrderRemarks(button, packageName) {
    const form = document.createElement('form');
    form.style.cssText = 'display:grid;gap:8px;margin:12px 0;';
    const label = document.createElement('label');
    label.textContent = '下单备注（可留空）';
    const input = document.createElement('input');
    input.type = 'text';
    input.style.cssText = 'display:block;width:100%;min-width:0;margin-top:6px;font:inherit;';
    label.append(input);
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
    const confirm = document.createElement('button');
    confirm.type = 'submit';
    confirm.textContent = '确认下单';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    actions.append(confirm, cancel);
    form.append(label, actions);
    const display = button.style.display;
    const close = () => { form.remove(); button.style.display = display; button.focus(); };
    cancel.addEventListener('click', close);
    form.addEventListener('keydown', event => { if (event.key === 'Escape' && !confirm.disabled) close(); });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (confirm.disabled) return;
        confirm.disabled = input.disabled = cancel.disabled = true;
        const remarks = input.value || '无';
        const message = `下单了“${packageName}”。\n备注：${remarks}`;
        try {
            await triggerSlash([
                `/setvar key=ordered_item value=${JSON.stringify(packageName)}`,
                `/setvar key=order_remarks value=${JSON.stringify(remarks)}`,
                `/send value=${JSON.stringify(message)}`,
                '/trigger await=true',
            ].join(' | '));
            close();
        } catch (error) {
            confirm.disabled = input.disabled = cancel.disabled = false;
            window.alert(error.message || String(error));
        }
    });
    button.style.display = 'none';
    button.after(form);
    input.focus();
}
