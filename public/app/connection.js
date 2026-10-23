export function inheritedConnection(settings = {}) {
    const own = settings.independent_frontend?.connection;
    if (own) return { ...own };
    const oai = settings.oai_settings || {};
    const url = oai.chat_completion_source === 'custom' ? oai.custom_url : oai.reverse_proxy;
    return { source: url ? 'custom' : 'openai', url: url || 'https://api.openai.com/v1',
        model: oai.chat_completion_source === 'custom' ? oai.custom_model || '' : oai.openai_model || '' };
}
export function connectionProfiles(raw) {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.profiles) || !raw.profiles.length) throw new Error('连接配置文件无效，已停止读取，避免回退或覆盖已有地址。');
    const result = structuredClone(raw); const ids = new Set();
    for (const profile of result.profiles) {
        if (!profile.id || ids.has(profile.id) || !profile.url) throw new Error('连接配置中存在缺失或重复标识。');
        ids.add(profile.id);
    }
    if (!ids.has(result.activeId)) result.activeId = result.profiles[0].id;
    return result;
}
export function upsertConnection(store, profile) {
    const result = structuredClone(store); const index = result.profiles.findIndex(item => item.id === profile.id);
    if (index < 0) result.profiles.push(structuredClone(profile)); else result.profiles[index] = structuredClone(profile);
    result.activeId = profile.id; return connectionProfiles(result);
}
// Native reverse-proxy passwords are settings fields, unlike protected API
// secrets. Reuse only an explicitly identified native-proxy credential.
export function visibleConnectionPassword(connection, settings, secretState = {}) {
    if (typeof connection.proxyPassword === 'string') return connection.proxyPassword;
    const native = settings.oai_settings || {};
    const sameAddress = String(connection.url || '').replace(/\/+$/, '') === String(native.reverse_proxy || '').replace(/\/+$/, '');
    const records = secretState.api_key_custom;
    const record = Array.isArray(records) ? records.find(item => item.id === connection.secretId) : null;
    if (sameAddress && native.proxy_password && (connection.credentialSource === 'nativeProxy' || record?.label === '独立前端·原生反代')) return native.proxy_password;
    return '';
}
/** Normalize the base endpoint without changing its host or guessing a version. */
export function normalizeConnection(value) {
    const config = { ...value, url: String(value.url || '').trim(), model: String(value.model || '').trim() };
    if (config.url) {
        let url;
        try { url = new URL(config.url); } catch { throw new Error('请输入完整的 API 地址，例如 https://服务商地址/v1。'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('API 地址需使用 HTTP/HTTPS；密钥请填写到 API Key。');
        if (url.search || url.hash) throw new Error('API 基础地址不要包含查询参数或锚点，密钥请填写到 API Key。');
        url.pathname = url.pathname.replace(/\/(?:chat\/completions|models)\/?$/, '').replace(/\/+$/, '');
        config.url = url.toString().replace(/\/+$/, '');
        // The native OpenAI source ignores custom_url. A third-party base URL
        // must use the CUSTOM source for both model listing and generation.
        if (config.source === 'openai' && (url.origin !== 'https://api.openai.com' || url.pathname !== '/v1')) config.source = 'custom';
    }
    if (config.source === 'custom' && !config.url) throw new Error('请填写第三方 API 基础地址。');
    if (config.source !== value.source) delete config.secretId;
    return config;
}

export function modelOptions(result) {
    if (result?.error) throw new Error('读取模型失败：请核对反代地址、密钥及服务商是否提供 /models 接口。酒馆后端未返回上游错误详情。');
    const rows = Array.isArray(result) ? result : result?.data || result?.models;
    if (!Array.isArray(rows)) throw new Error('接口未返回可识别的模型列表，可手动填写模型 ID。');
    const ids = [...new Set(rows.map(item => typeof item === 'string' ? item : item?.id || item?.name).filter(id => typeof id === 'string' && id.trim()))];
    if (!ids.length) throw new Error('接口返回了空模型列表，可手动填写服务商提供的模型 ID。');
    return ids.map(id => [id, id]);
}
