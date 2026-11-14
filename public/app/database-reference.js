// Adapted from SuperMIke604/data_table index.js @ a9e295d32b2e691d9ae4399bf0b2b3c3fe922205.
// Host adapters supply state and collect feedback. Parser diagnostics use fixed labels.
let currentJsonTableData, currentSettings, _dpState;
let feedback = [];
const showToast = (message, type, counts = {}) => feedback.push({message,type,...counts});
const appendTableEditErrorLog = detail => feedback.push({type:'error',...detail});
function normalizeJsonSyntax(text) {
    const tokens = /"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|\/\*|["'，]/g;
    let incompleteToken = false;
    const normalized = text.replace(tokens, token => {
        if (token === '，') return ',';
        if (token === '"' || token === "'" || token === '/*') {
            incompleteToken = true;
            return token;
        }
        if (token[0] === '/') return ' ';
        const singleQuoted = token[0] === "'";
        const content = token.slice(1, -1).replace(/\\[\s\S]|["\u0000-\u001f]/g, part => {
            if (part === "\\'" && singleQuoted) return "'";
            if (part.startsWith('\\')) return part;
            return JSON.stringify(part).slice(1, -1);
        });
        return '"' + content + '"';
    });
    if (incompleteToken) return null;

    // Skip complete strings before considering any structural replacements.
    return normalized.replace(/"(?:[^"\\]|\\[\s\S])*"|,\s*(?=[}\]])|([{,]\s*)(\w+)(?=\s*:)/g,
        (token, prefix, key) => prefix ? prefix + '"' + key + '"' : token.startsWith(',') ? '' : token);
}

function repairJsonBrackets(text, taggedUpdate) {
    const tokens = /"(operations|data)"\s*:\s*([{\[])|"(?:[^"\\]|\\[\s\S])*"|[{}\[\]]/g;
    const extraOperationClose = /\s*}(?=\s*(?:,\s*\{|\]))/y;
    const operationBoundary = /\s*(?:,\s*\{|\])/y;
    const stack = [];
    const repaired = [];
    let copiedThrough = 0;
    let repairedDataClose = false;

    for (let match; (match = tokens.exec(text));) {
        const [token, key, opener] = match;
        const bracket = opener ?? token;
        if (bracket === '{' || bracket === '[') {
            stack.push({ key, close: bracket === '{' ? '}' : ']', start: match.index });
            continue;
        }
        if (bracket !== '}' && bracket !== ']') continue;
        const container = stack.pop();
        const inOperations = taggedUpdate && stack[0]?.close === '}'
            && stack[1]?.key === 'operations' && stack[1].close === ']';
        if (bracket === container?.close) {
            if (inOperations && stack.length === 2 && bracket === '}') {
                // Skip one extra brace between a complete operation and the next item or array close.
                extraOperationClose.lastIndex = tokens.lastIndex;
                if (extraOperationClose.test(text)) {
                    const end = extraOperationClose.lastIndex;
                    repaired.push(text.slice(copiedThrough, end - 1));
                    copiedThrough = tokens.lastIndex = end;
                }
            }
            if (inOperations && stack.length === 3 && stack[2].close === '}' && container.key === 'data' && bracket === '}') {
                operationBoundary.lastIndex = tokens.lastIndex;
                if (operationBoundary.test(text)) {
                    // The data object is complete. Confirm the enclosing insert before closing it.
                    const end = tokens.lastIndex;
                    const operation = parseJsonObject(text.slice(stack[2].start, end) + '}');
                    if (operation?.action !== 'insert' || !operation.data || Array.isArray(operation.data)
                        || Object.entries(operation.data).some(([column, value]) => !/^(0|[1-9]\d*)$/.test(column)
                            || (value !== null && typeof value === 'object'))) return null;
                    stack.pop();
                    repaired.push(text.slice(copiedThrough, end), '}');
                    copiedThrough = end;
                }
            }
            continue;
        }

        // Only replace a single closing bracket of an operations[i].data object.
        if (!inOperations || repairedDataClose || bracket !== ']' || container?.key !== 'data' || container.close !== '}'
            || stack.length !== 3 || stack[2].close !== '}') return null;
        repaired.push(text.slice(copiedThrough, match.index), '}');
        copiedThrough = tokens.lastIndex;
        repairedDataClose = true;
    }

    if (repaired.length) {
        if (stack.length !== 0) return null;
        repaired.push(text.slice(copiedThrough));
        const data = parseJsonObject(repaired.join(''));
        return Array.isArray(data?.operations) ? data : null;
    }

    // At the end of input only the outer envelope may still need closing.
    if (stack.length === 0 || stack.length > 20) return null;
    if (taggedUpdate && (stack.length > 2 || stack[0].close !== '}'
        || (stack.length === 2 && (stack[1].key !== 'operations' || stack[1].close !== ']')))) return null;
    return parseJsonObject(text + stack.reverse().map(container => container.close).join(''));
}

function parseJsonObject(text) {
    try {
        const data = JSON.parse(text);
        return data && typeof data === 'object' ? data : null;
    } catch {
        return null;
    }
}

function repairOperationCellQuotes(payload) {
    const tokens = /("(?:0|[1-9]\d*)"\s*:\s*")|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g;
    const quotes = /\\[\s\S]|"/g;
    const boundary = /\s*(?:}|[,，]\s*(?:"(?:0|[1-9]\d*)"\s*:|}))/y;
    const ambiguousDelimiter = /\s*[,，}\]:]/y;
    const parts = [];
    let copiedThrough = 0;

    for (let match; (match = tokens.exec(payload));) {
        if (!match[1]) continue;
        quotes.lastIndex = tokens.lastIndex;
        let closed = false;
        for (let quote; (quote = quotes.exec(payload));) {
            if (quote[0] !== '"') continue;
            boundary.lastIndex = quotes.lastIndex;
            if (boundary.test(payload)) {
                tokens.lastIndex = quotes.lastIndex;
                closed = true;
                break;
            }
            ambiguousDelimiter.lastIndex = quotes.lastIndex;
            if (ambiguousDelimiter.test(payload)) return null;
            parts.push(payload.slice(copiedThrough, quote.index), '\\');
            copiedThrough = quote.index;
        }
        if (!closed) return null;
    }
    if (!parts.length) return null;
    parts.push(payload.slice(copiedThrough));
    const repaired = parts.join('');

    const data = parseJsonObject(repaired) ?? repairAIJson(repaired, true);
    if (!Array.isArray(data?.operations) || Object.keys(data).length !== 1) return null;
    const valid = data.operations.every(operation => {
        if (!operation || !['insert', 'update', 'delete'].includes(operation.action)
            || !Object.keys(operation).every(key => ['action', 'sheet', 'row', 'data'].includes(key))) return false;
        if (!Object.hasOwn(operation, 'data')) return operation.action === 'delete';
        const cells = operation.data;
        return cells && typeof cells === 'object' && !Array.isArray(cells)
            && Object.entries(cells).every(([column, value]) => /^(0|[1-9]\d*)$/.test(column)
                && (value === null || typeof value !== 'object'));
    });
    return valid ? data : null;
}

function repairJsonCandidate(text, taggedUpdate) {
    const normalized = normalizeJsonSyntax(text);
    if (normalized === null) return null;
    const data = normalized !== text ? parseJsonObject(normalized) : null;
    return data ?? repairJsonBrackets(normalized, taggedUpdate);
}

function repairAIJson(raw, taggedUpdate = false) {
    const text = raw.trim();
    if (!text) return null;
    const data = repairJsonCandidate(text, taggedUpdate);
    if (data) return data;

    // Keep support for an object wrapped in a fence or explanation.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start || (start === 0 && end === text.length - 1)) return null;
    const extracted = text.slice(start, end + 1);
    return parseJsonObject(extracted) ?? repairJsonCandidate(extracted, taggedUpdate);
}

function dataUpdatePayload(text, allowMissingClose = false) {
    const start = text.indexOf('<dataUpdate>');
    if (start === -1) return null;
    const rest = text.slice(start + '<dataUpdate>'.length);
    const tokens = /"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|<\/dataUpdate>/g;
    for (const { 0: token, index } of rest.matchAll(tokens)) {
        if (token === '</dataUpdate>') return rest.slice(0, index);
    }
    return allowMissingClose ? rest : null;
}

function parseDataUpdate(aiResponse, diagnostics) {
    if (typeof aiResponse !== 'string') {
        if (diagnostics) diagnostics.result = '模型响应内容不是文本';
        return false;
    }
    if (!currentJsonTableData) {
        console.error('parseDataUpdate: currentJsonTableData 未加载');
        return false;
    }

    // Accept a complete bare operations object without scanning prose for JSON.
    const trimmed = aiResponse.trim();
    if (trimmed.startsWith('{')) {
        let bare;
        try { bare = JSON.parse(trimmed); } catch { /* Try the explicit carrier below. */ }
        if (Array.isArray(bare?.operations) && Object.keys(bare).length === 1) {
            return applyOperations(bare.operations, diagnostics, '纯 JSON 兼容');
        }
    }

    // 提取 <dataUpdate> 块
    const payload = dataUpdatePayload(aiResponse);
    if (!payload) {
        if (diagnostics) diagnostics.result = trimmed ? '缺少完整的 <dataUpdate> 块，或块为空' : '模型返回空文本';
        console.warn('parseDataUpdate: AI 响应中未找到 <dataUpdate> 块');
        return false;
    }

    let data, format;
    try {
        data = JSON.parse(payload.trim());
    } catch (e) {
        // 使用 repairAIJson 进行多策略修复
        console.warn('parseDataUpdate: 首次 JSON.parse 失败，启动修复');
        data = repairAIJson(payload, true);
        if (!data) {
            data = repairOperationCellQuotes(payload);
            if (data) format = '已修复单元格引号';
        }
        if (!data) {
            if (diagnostics) diagnostics.result = '<dataUpdate> JSON 无效，自动修复失败';
            console.error('parseDataUpdate: repairAIJson 也未能修复');
            appendTableEditErrorLog({
                reason: '<dataUpdate> JSON 解析失败（修复后仍无效）',
                command: payload,
                detail: String(e.message || e),
            });
            return false;
        }
    }

    if (!data || typeof data !== 'object') {
        if (diagnostics) diagnostics.result = '<dataUpdate> JSON 不是有效对象';
        console.warn('parseDataUpdate: 解析结果不是有效对象');
        return false;
    }

    // 格式 A：operations 数组 — 增量更新
    if (Array.isArray(data.operations)) {
        return applyOperations(data.operations, diagnostics, format);
    }

    // 格式 B：完整数据替换 — 直接合并/覆盖 sheet_*
    const sheetKeys = Object.keys(data).filter(k => k.startsWith('sheet_'));
    if (sheetKeys.length > 0) {
        sheetKeys.forEach(key => {
            currentJsonTableData[key] = JSON.parse(JSON.stringify(data[key]));
        });
        showToast(`已从 <dataUpdate> 更新 ${sheetKeys.length} 张表格`, 'info', { tables: sheetKeys.length });
        return true;
    }

    if (diagnostics) diagnostics.result = '缺少 operations 数组和 sheet_* 表';
    console.warn('parseDataUpdate: 数据中既没有 operations 也没有 sheet_ 表');
    return false;
}

function applyOperations(operations, diagnostics, format) {
    const sheets = Object.keys(currentJsonTableData)
        .filter(k => k.startsWith('sheet_'))
        .map(k => currentJsonTableData[k]);

    let appliedCount = 0;

    operations.forEach((op, opIndex) => {
        if (!op || !op.action) {
            console.warn(`applyOperations: 第 ${opIndex} 项缺少 action 字段`);
            return;
        }

        try {
            // 支持 sheet 为数字索引或字符串 key
            let table;
            let tableIndex;
            if (typeof op.sheet === 'number') {
                tableIndex = op.sheet;
                table = sheets[tableIndex];
            } else if (typeof op.sheet === 'string' && op.sheet.startsWith('sheet_')) {
                table = currentJsonTableData[op.sheet];
                tableIndex = sheets.indexOf(table);
            } else if (typeof op.sheet === 'string') {
                // 按名称查找
                tableIndex = sheets.findIndex(t => t && t.name === op.sheet);
                table = tableIndex >= 0 ? sheets[tableIndex] : null;
            }

            if (!table || !table.content) {
                appendTableEditErrorLog({
                    reason: `${op.action} 目标表不存在`,
                    command: JSON.stringify(op),
                });
                return;
            }

            switch (op.action) {
                case 'insert': {
                    const data = op.data || {};
                    const rowIndex = typeof op.row === 'number' ? op.row : null;
                    const newRow = [null];
                    const headers = Array.isArray(table.content[0]) ? table.content[0].slice(1) : [];
                    headers.forEach((_, colIndex) => {
                        newRow.push(data[colIndex] ?? data[String(colIndex)] ?? '');
                    });
                    if (rowIndex !== null) {
                        const insertAt = Math.max(0, Math.min(rowIndex, Math.max(0, table.content.length - 1)));
                        table.content.splice(insertAt + 1, 0, newRow);
                    } else {
                        table.content.push(newRow);
                    }
                    appliedCount++;
                    break;
                }
                case 'delete': {
                    const rowIndex = op.row;
                    if (typeof rowIndex === 'number' && table.content.length > rowIndex + 1) {
                        table.content.splice(rowIndex + 1, 1);
                        appliedCount++;
                    } else {
                        appendTableEditErrorLog({
                            reason: 'delete 行索引越界',
                            command: JSON.stringify(op),
                        });
                    }
                    break;
                }
                case 'update': {
                    const rowIndex = op.row;
                    const data = op.data || {};
                    if (typeof rowIndex !== 'number') {
                        appendTableEditErrorLog({
                            reason: 'update 缺少 row 索引',
                            command: JSON.stringify(op),
                        });
                        break;
                    }
                    const headerLen = Array.isArray(table.content[0]) ? table.content[0].length : 0;
                    const createEmptyRow = () => {
                        const row = [];
                        for (let i = 0; i < Math.max(1, headerLen); i++) row.push('');
                        row[0] = null;
                        return row;
                    };
                    while (table.content.length <= rowIndex + 1) {
                        table.content.push(createEmptyRow());
                    }
                    Object.keys(data).forEach(colIndexStr => {
                        const colIndex = parseInt(colIndexStr, 10);
                        if (isNaN(colIndex)) return;
                        const targetCol = colIndex + 1;
                        const row = table.content[rowIndex + 1];
                        while (row.length <= targetCol) row.push('');
                        row[targetCol] = data[colIndexStr];
                    });
                    appliedCount++;
                    break;
                }
                default:
                    console.warn(`applyOperations: 第 ${opIndex} 项 action 不受支持`);
                    appendTableEditErrorLog({
                        reason: `未知 action: ${op.action}`,
                        command: JSON.stringify(op),
                    });
            }
        } catch (err) {
            console.error(`applyOperations: 第 ${opIndex} 项执行异常`);
            appendTableEditErrorLog({
                reason: '操作执行异常',
                command: JSON.stringify(op),
                detail: String(err.message || err),
            });
        }
    });

    if (appliedCount > 0) {
        showToast(`从 AI 响应中成功应用了 ${appliedCount} 个数据库更新`, 'info', { operations: appliedCount });
    }
    if (diagnostics) {
        const result = appliedCount > 0 ? `收到 ${operations.length} 条操作`
            : operations.length ? `收到 ${operations.length} 条操作，均未应用` : 'operations 数组为空';
        diagnostics.result = format ? `${format} · ${result}` : result;
    }
    return appliedCount > 0;
}

function formatTableToReadable(tableName, headerRow, rows, startIndex = 0) {
    if (!rows || rows.length === 0) return '';

    const sectionLines = [];
    sectionLines.push(`### ${tableName}`);

    rows.forEach((row, index) => {
        const rowCells = Array.isArray(row) ? row.slice(1) : [];

        // 第一列为顶级项，后续列为缩进子项
        headerRow.forEach((header, colIndex) => {
            const fieldName = (header && String(header).trim()) ? String(header).trim() : `字段 ${colIndex + 1}`;
            const fieldValue = rowCells[colIndex];
            const displayValue = (fieldValue !== undefined && fieldValue !== null && String(fieldValue).trim() !== '') ? String(fieldValue).trim() : '-';
            if (colIndex === 0) {
                sectionLines.push(`- ${fieldName}: ${displayValue}`);
            } else {
                sectionLines.push(`  - ${fieldName}: ${displayValue}`);
            }
        });

        sectionLines.push('');
    });

    return sectionLines.join('\n').trim();
}

function buildTableDataTextForDollar0(jsonTableData, settings) {
    if (!jsonTableData) {
        // 即使没有表格数据，也返回说明性文本，避免 $0 完全为空
        return { text: '(当前还没有表格数据)', hasData: false };
    }

    const summaryLimit = settings?.summaryTableMaxEntries || 10;
    const tableKeys = Object.keys(jsonTableData).filter(k => k.startsWith('sheet_'));
    if (tableKeys.length === 0) {
        // 没有任何 sheet_ 表时，同样返回占位说明
        return { text: '(当前还没有表格数据)', hasData: false };
    }

    let hasAnyRow = false;
    let tableDataText = '';

    tableKeys.forEach((sheetKey, tableIndex) => {
        const table = jsonTableData[sheetKey];
        if (!table || !table.name || !Array.isArray(table.content)) {
            return;
        }

        tableDataText += `[${tableIndex}:${table.name}]\n`;
        const headers = Array.isArray(table.content[0])
            ? table.content[0].slice(1).map((h, i) => `[${i}:${h}]`).join('|')
            : 'No Headers';
        tableDataText += `  Columns: ${headers}\n`;

        const allRows = table.content.slice(1);
        let rowsToProcess = allRows;
        let startIndex = 0;

        if (table.name.trim() === '总结表' && allRows.length > summaryLimit) {
            startIndex = allRows.length - summaryLimit;
            rowsToProcess = allRows.slice(-summaryLimit);
            tableDataText += `  - Note: Showing last ${rowsToProcess.length} of ${allRows.length} entries.\n`;
        }

        if (rowsToProcess.length > 0) {
            rowsToProcess.forEach((row, index) => {
                hasAnyRow = true;
                const originalRowIndex = startIndex + index;
                const rowData = Array.isArray(row) ? row.slice(1).join('|') : '';
                tableDataText += `  [${originalRowIndex}] ${rowData}\n`;
            });
        } else {
            tableDataText += '  (No data rows)\n';
        }

        tableDataText += '\n';
    });

    return { text: tableDataText.trim(), hasData: hasAnyRow };
}

function _dpGetDisplayRows(tableObj) {
    const key = tableObj.key;
    const headers = tableObj.headers;
    const rows = tableObj.rows;

    let annotated = rows.map((row, idx) => ({ row, realIndex: idx, diffType: '', changedCols: [] }));

    if (_dpState.diffMode && _dpState.previousData) {
        const oldTable = _dpState.previousData[key];
        if (oldTable && Array.isArray(oldTable.content)) {
            const oldRows = oldTable.content.slice(1);
            const maxLen = Math.max(rows.length, oldRows.length);
            const result = [];
            for (let i = 0; i < maxLen; i++) {
                const oldRow = oldRows[i];
                const newRow = rows[i];
                if (oldRow && !newRow) {
                    result.push({ row: oldRow, realIndex: i, diffType: 'deleted', changedCols: [] });
                } else if (!oldRow && newRow) {
                    result.push({ row: newRow, realIndex: i, diffType: 'added', changedCols: [] });
                } else if (oldRow && newRow) {
                    if (JSON.stringify(oldRow) !== JSON.stringify(newRow)) {
                        const cc = [];
                        const colCount = Math.max(oldRow.length, newRow.length, headers.length);
                        for (let c = 0; c < colCount; c++) {
                            cc[c] = ((oldRow[c] ?? '') !== (newRow[c] ?? ''));
                        }
                        result.push({ row: newRow, realIndex: i, diffType: 'modified', changedCols: cc });
                    }
                }
            }
            annotated = result;
        }
    } else if (_dpState.previousData) {
        const oldTable = _dpState.previousData[key];
        if (oldTable && Array.isArray(oldTable.content)) {
            const oldRows = oldTable.content.slice(1);
            annotated = rows.map((row, idx) => {
                const oldRow = oldRows[idx];
                let diffType = '';
                let changedCols = [];
                if (!oldRow) {
                    diffType = 'added';
                } else if (JSON.stringify(oldRow) !== JSON.stringify(row)) {
                    diffType = 'modified';
                    const colCount = Math.max(oldRow.length, row.length, headers.length);
                    for (let c = 0; c < colCount; c++) {
                        changedCols[c] = ((oldRow[c] ?? '') !== (row[c] ?? ''));
                    }
                }
                return { row, realIndex: idx, diffType, changedCols };
            });
        }
    }

    if (_dpState.search) {
        const kw = _dpState.search.toLowerCase();
        annotated = annotated.filter(item => {
            return item.row.some(cell => String(cell || '').toLowerCase().includes(kw));
        });
    }

    return annotated;
}

function _dpPaginationRange(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = [];
    pages.push(1);
    if (current > 3) pages.push('...');
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
        pages.push(i);
    }
    if (current < total - 2) pages.push('...');
    pages.push(total);
    return pages;
}
export function referenceUpdate(text, database, diagnostics) { currentJsonTableData=structuredClone(database);feedback=[];const changed=parseDataUpdate(text, diagnostics);return {data:currentJsonTableData,changed,feedback:structuredClone(feedback)}; }
export function referenceTableText(database, settings={}) { return buildTableDataTextForDollar0(database,settings); }
export function referenceSheetText(name,headers,rows,start=0) {return formatTableToReadable(name,headers,rows,start);}
export function referencePreviewRows(table,state) {_dpState=state;return _dpGetDisplayRows(table);}
export const referencePagination = _dpPaginationRange;

export function extractDataFromMessage(message, options = {}) {
    if (!message || message.extra?.independentDatabase?.snapshotDeleted) return null;
    const { requireMate = false } = options;

    // 1. 优先取已保存的结构化数据
    if (message.TavernDB_ACU_Data) {
        return message.TavernDB_ACU_Data;
    }

    // 2. 从消息文本中提取
    if (!message.mes || typeof message.mes !== 'string') return null;
    const mesText = message.mes.trim();
    if (!mesText) return null;

    // 2.0 显式载体抽取（兼容性，O(n)）：
    //     在"是否像 JSON 文档"的预筛之前，先按本扩展已知的两种"显式数据载体"
    //     抽取 payload（抽不到则自然落到后面的通用逻辑）：
    //       (a) <dataUpdate> … (</dataUpdate> | 串尾) —— 支持响应被截断、缺闭合标签；
    //       (b) Markdown 围栏代码块 ```json … ``` / ``` … ```。
    const carrierPayloads = [];
    const taggedPayload = dataUpdatePayload(mesText, true);
    if (taggedPayload) carrierPayloads.push(taggedPayload);
    const fencedMatch = mesText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fencedMatch && fencedMatch[1]) carrierPayloads.push(fencedMatch[1]);

    for (const payload of carrierPayloads) {
        let json = null;
        try {
            json = JSON.parse(payload.trim());
        } catch (_) {
            // 只修复看起来像 JSON 的载体，跳过普通代码块和散文。
            const pt = payload.trim();
            json = (pt[0] === '{' || pt[0] === '[') ? repairAIJson(payload) : null;
        }
        if (json && typeof json === 'object') {
            if (!requireMate || (json.mate && json.mate.type === 'chatSheets')) {
                return json;
            }
        }
    }

    // 2.1 廉价预筛（性能关键）：
    //     既没有解出显式载体，整段文本又不像一个 JSON 文档，即"明显不是数据消息"
    //     → 直接返回 null，绝不进入昂贵的解析/修复流程。先剥离前导不可见字符
    //     （零宽空格/连接符等）再判断首字符，兼容 \u200B 之类前缀。
    const head = mesText.replace(/^[\u200B-\u200D\u2060\uFEFF]+/, '');
    const looksLikeJsonDoc = head[0] === '{' || head[0] === '[';
    if (!looksLikeJsonDoc) {
        // 2.2 散文内嵌对象兜底（有界成本）：
        //     只做一次直接解析，并检查旧快照的数据形状。
        const braceStart = mesText.indexOf('{');
        const braceEnd = mesText.lastIndexOf('}');
        if (braceStart >= 0 && braceEnd > braceStart) {
            let json = null;
            try {
                json = JSON.parse(mesText.substring(braceStart, braceEnd + 1));
            } catch (_) {
                json = null; // 非合法 JSON：Y 的正常边界，直接返回 null，不做修复
            }
            if (json && typeof json === 'object') {
                const hasMate = !!(json.mate && json.mate.type === 'chatSheets');
                let hasSheetShape = false;
                if (!hasMate) {
                    for (const k of Object.keys(json)) {
                        if (!k.startsWith('sheet_')) continue;
                        const v = json[k];
                        if (v && typeof v === 'object' && 'name' in v && 'content' in v) {
                            hasSheetShape = true;
                            break;
                        }
                    }
                }
                if (hasMate || hasSheetShape) {
                    if (!requireMate || hasMate) {
                        return json;
                    }
                }
            }
        }
        return null;
    }

    // 2b. 兜底：整段文本本身就是一个 JSON 文档（以 { 或 [ 开头），直接解析 / 修复
    try {
        const json = JSON.parse(head);
        if (json && typeof json === 'object') {
            if (!requireMate || (json.mate && json.mate.type === 'chatSheets')) {
                return json;
            }
        }
    } catch (_) {
        // 尝试 repairAIJson 修复
        const json = repairAIJson(head);
        if (json && typeof json === 'object') {
            if (!requireMate || (json.mate && json.mate.type === 'chatSheets')) {
                return json;
            }
        }
    }

    return null;
}
