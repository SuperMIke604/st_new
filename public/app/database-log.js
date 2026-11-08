const entries = [];
const limit = 50;
let latestMalformed;

export function startDatabaseLog(automatic, kind) {
    const entry = {
        startedAt: Date.now(), trigger: automatic ? '自动' : '手动',
        task: kind === 'database' ? '数据库总结' : '消息总结',
        status: '进行中', stage: '检查更新条件',
    };
    entries.unshift(entry);
    entries.length = Math.min(entries.length, limit);
    if (latestMalformed && !entries.includes(latestMalformed.entry)) latestMalformed = undefined;
    return entry;
}

export function finishDatabaseLog(entry, status, error) {
    entry.status = status;
    entry.durationMs = Date.now() - entry.startedAt;
    if (Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599) entry.httpStatus = error.status;
    // Error messages can include model output, prompts or credentials.
    if (error?.name === 'TimeoutError') entry.reason = '请求超时';
    else if (!entry.reason && error?.name === 'SyntaxError' && entry.stage === '读取模型响应') entry.reason = '模型接口返回的 JSON 无效';
    else if (!entry.reason && error?.name === 'TypeError' && entry.stage === '请求模型' && !entry.httpStatus) entry.reason = '未收到模型接口的 HTTP 响应';
}

export function clearDatabaseLog() {
    entries.length = 0;
    latestMalformed = undefined;
}

export function retainMalformedDatabaseResponse(entry, source, text) {
    if (entries.includes(entry)) latestMalformed = { entry, source, text };
}

export function databaseLogExport() {
    return {
        entries: entries.map(entry => {
            if (latestMalformed?.entry !== entry) return { ...entry };
            const { source, text } = latestMalformed;
            return { ...entry, malformedResponse: { source, text } };
        }),
    };
}

export function databaseLogText() {
    return entries.map(entry => {
        const { startedAt, trigger, task, status, stage, durationMs, from, to, batch, httpStatus,
            format, responseChars, finishReason, parser, operations, tables, reason } = entry;
        const details = [
            Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from ? `楼层 ${from}–${to}` : '',
            batch ? `第 ${batch} 批` : '',
            httpStatus ? `HTTP ${httpStatus}` : '',
            format,
            Number.isInteger(responseChars) ? `响应 ${responseChars} 字符` : '',
            finishReason ? `模型结束原因 ${finishReason}` : '',
            Number.isInteger(operations) ? `已解析 ${operations} 条操作、${tables} 张整表` : '',
        ].filter(Boolean).join(' · ');
        return [
            `${new Date(startedAt).toLocaleString()} · ${trigger}${task} · ${status}${durationMs === undefined ? '' : ` · ${durationMs} ms`}`,
            `阶段 · ${stage}`,
            details,
            reason,
            parser?.result,
            ...Object.entries(parser?.issues || {}).map(([label, count]) => `${label} × ${count}`),
        ].filter(Boolean).join('\n');
    }).join('\n\n');
}
