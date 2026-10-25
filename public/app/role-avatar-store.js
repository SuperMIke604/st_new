export function avatarRecords(records) {
    if (!Array.isArray(records) || records.length > 500) throw Error('头像记录过多或格式无效。');
    let size = 0; const keys = new Set();
    return records.map(item => {
        if (!item || typeof item.键 !== 'string' || !item.键 || item.键.length > 200 || keys.has(item.键)) throw Error('头像主键无效或重复。');
        keys.add(item.键);
        if (typeof item.显示名 !== 'string' || item.显示名.length > 200 || !Array.isArray(item.别名) || item.别名.length > 100 || item.别名.some(name => typeof name !== 'string' || name.length > 200)) throw Error('头像名称或别名无效。');
        const image = item.图片 ?? null;
        if (image !== null && (typeof image !== 'string' || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 6000000)) throw Error('头像仅支持本地 PNG、JPEG、WebP 或 GIF 图片，请通过选择图片导入。');
        size += image?.length || 0; if (size > 50000000) throw Error('一次写入的头像数据超过限制。');
        return { 键: item.键, 显示名: item.显示名, 别名: [...item.别名], 图片: image, 更新时间: Number(item.更新时间) || Date.now() };
    });
}
export class RoleAvatarStore {
    constructor(database = globalThis.indexedDB) { this.database = database; }
    async run(avatar, payload) {
        if (typeof avatar !== 'string' || !avatar || !['list', 'put', 'delete', 'clear'].includes(payload?.operation)) throw Error('头像操作无效。');
        if (!this.database?.open) throw Error('浏览器不支持本地头像存储。');
        const records = payload.operation === 'put' ? avatarRecords(payload.records) : null;
        if (payload.operation === 'delete' && (typeof payload.key !== 'string' || payload.key.length > 200)) throw Error('头像主键无效。');
        const db = await new Promise((resolve, reject) => { const request = this.database.open('st-new-role-avatars', 1); request.onupgradeneeded = () => { const store = request.result.createObjectStore('avatars', { keyPath: ['avatar', 'key'] }); store.createIndex('avatar', 'avatar'); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onblocked = () => reject(Error('头像库正被其他页面占用。')); });
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction('avatars', payload.operation === 'list' ? 'readonly' : 'readwrite'), store = tx.objectStore('avatars'); let result = true;
                tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error || Error('头像保存失败。'));
                if (payload.operation === 'list') { const request = store.index('avatar').getAll(avatar); request.onsuccess = () => { result = request.result.map(row => row.value); }; }
                else if (payload.operation === 'put') for (const record of records) store.put({ avatar, key: record.键, value: record });
                else if (payload.operation === 'delete') store.delete([avatar, payload.key]);
                else { const request = store.index('avatar').openKeyCursor(avatar); request.onsuccess = () => { const cursor = request.result; if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); } }; }
            });
        } finally { db.close(); }
    }
}
