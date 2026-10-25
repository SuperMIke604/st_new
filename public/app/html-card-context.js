// Runs inside the opaque-origin preview. Only the owning message is exposed.
export function htmlCardContext(snapshot) {
    const ready = callback => {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
        else queueMicrotask(callback);
    };
    window.getCurrentMessageId = () => snapshot.messageId;
    window.getChatMessages = id => Number(id) === snapshot.messageId ? [{
        message_id: snapshot.messageId, message: snapshot.message, name: snapshot.name, role: snapshot.role,
    }] : [];
    window.getCurrentBlockIndex = tag => snapshot.blockIndices?.[tag] ?? 0;
    // These imported beautifiers use jQuery only for its document-ready shorthand.
    window.$ = window.jQuery = callback => {
        if (typeof callback !== 'function') throw Error('此 HTML 展示页仅支持 $(初始化函数)。');
        ready(callback);
    };
    let avatars = [];
    const image = name => {
        const row = avatars.find(item => item.键 === name || item.显示名 === name || item.别名?.includes(name));
        return row?.图片 || null;
    };
    window['头像库'] = Object.freeze({ '取图': image, '取主角图': () => image(snapshot.personaName) || image('主角') });
    addEventListener('message', event => {
        if (event.source !== parent || event.data?.type !== 'tavern-html-avatars' || !Array.isArray(event.data.records)) return;
        avatars = event.data.records;
        document.dispatchEvent(new CustomEvent('头像库更新'));
        if (document.querySelector('[data-fate-marker]') && typeof window.init === 'function') ready(() => window.init());
    });
    ready(() => {
        // Native parent/frameElement access intentionally remains isolated.
        if (document.querySelector('[data-fate-marker]') && typeof window.getMyIndex === 'function') {
            window.getMyIndex = () => window.getCurrentBlockIndex('fate_ui');
        }
    });
}

export function cardContextScript(snapshot) {
    const json = JSON.stringify(snapshot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return `<script>(${htmlCardContext.toString()})(${json});<\/script>`;
}
