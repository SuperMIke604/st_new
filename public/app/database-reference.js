// Copied unchanged from SuperMIke604/data_table index.js @ a9e295d32b2e691d9ae4399bf0b2b3c3fe922205.
// Host adapters below supply state and collect feedback; function bodies remain upstream.
let currentJsonTableData, currentSettings, _dpState;
let feedback = [];
const showToast = (message, type, counts = {}) => feedback.push({message,type,...counts});
const appendTableEditErrorLog = detail => feedback.push({type:'error',...detail});
function repairAIJson(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let text = raw.trim();
    if (!text) return null;

    // --- 策略 0：原文直接解析 ---
    try { const r = JSON.parse(text); if (r && typeof r === 'object') return r; } catch (_) {}

    // ======================================================================
    //  核心修复：转义 JSON 字符串值内的裸换行符
    //  这是最常见的 AI 输出问题 — AI 在字符串值里写多行文本导致 JSON.parse 炸掉
    //  例："6": "黑色山本耀司\n风格"  ← \n 是真实换行符而非 \\n
    // ======================================================================
    function escapeNewlinesInStrings(input) {
        let result = '';
        let inString = false;
        let escape = false;
        for (let i = 0; i < input.length; i++) {
            const ch = input[i];
            if (escape) {
                result += ch;
                escape = false;
                continue;
            }
            if (ch === '\\' && inString) {
                result += ch;
                escape = true;
                continue;
            }
            if (ch === '"') {
                inString = !inString;
                result += ch;
                continue;
            }
            if (inString) {
                if (ch === '\n') { result += '\\n'; continue; }
                if (ch === '\r') { result += '\\r'; continue; }
                if (ch === '\t') { result += '\\t'; continue; }
            }
            result += ch;
        }
        return result;
    }

    const escapedText = escapeNewlinesInStrings(text);

    // --- 策略 1：仅转义裸换行（覆盖 90% 的真实报错场景） ---
    try { const r = JSON.parse(escapedText); if (r && typeof r === 'object') return r; } catch (_) {}

    // ======================================================================
    //  辅助修复函数
    // ======================================================================

    /** 移除 JSON 中的注释 (// 和 /* * /) */
    function removeComments(s) {
        let out = '';
        let inString = false;
        let escape = false;
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (escape) { out += ch; escape = false; continue; }
            if (ch === '\\' && inString) { out += ch; escape = true; continue; }
            if (ch === '"') { inString = !inString; out += ch; continue; }
            if (inString) { out += ch; continue; }
            // 不在字符串内时，检测注释
            if (ch === '/' && i + 1 < s.length) {
                if (s[i + 1] === '/') {
                    // 单行注释：跳到行尾
                    while (i < s.length && s[i] !== '\n') i++;
                    continue;
                }
                if (s[i + 1] === '*') {
                    // 多行注释：跳到 */
                    i += 2;
                    while (i + 1 < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
                    i++; // 跳过 /
                    continue;
                }
            }
            out += ch;
        }
        return out;
    }

    /** 移除尾随逗号（只移除 }, ] 前的逗号） */
    function removeTrailingCommas(s) {
        return s.replace(/,\s*([}\]])/g, '$1');
    }

    /** 智能单引号 → 双引号（只替换 JSON 结构层的单引号，不误伤字符串值中的撇号） */
    function smartSingleToDoubleQuotes(s) {
        let out = '';
        let inSingle = false;
        let inDouble = false;
        let escape = false;
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (escape) { out += ch; escape = false; continue; }
            if (ch === '\\' && (inSingle || inDouble)) { out += ch; escape = true; continue; }
            if (ch === '"' && !inSingle) { inDouble = !inDouble; out += ch; continue; }
            if (ch === "'" && !inDouble) {
                // 判断这个单引号是否是 JSON 结构层的（key/value 的定界符）
                if (!inSingle) {
                    // 进入单引号字符串 → 替换为双引号
                    inSingle = true;
                    out += '"';
                    continue;
                } else {
                    // 离开单引号字符串 → 替换为双引号
                    inSingle = false;
                    out += '"';
                    continue;
                }
            }
            out += ch;
        }
        return out;
    }

    /** 给无引号的 key 加双引号 */
    function quoteBareKeys(s) {
        return s.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
    }

    /** 统计未闭合的括号/花括号，在末尾补齐 */
    function closeBrackets(s) {
        let openBraces = 0;
        let openBrackets = 0;
        let inString = false;
        let escape = false;
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\' && inString) { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{') openBraces++;
            if (ch === '}') openBraces--;
            if (ch === '[') openBrackets++;
            if (ch === ']') openBrackets--;
        }
        let suffix = '';
        for (let i = 0; i < Math.min(Math.max(0, openBrackets), 10); i++) suffix += ']';
        for (let i = 0; i < Math.min(Math.max(0, openBraces), 10); i++) suffix += '}';
        return s + suffix;
    }

    // ======================================================================
    //  组合策略：逐步加码
    // ======================================================================

    // --- 策略 2：换行转义 + 移除注释 ---
    {
        let fixed = removeComments(escapedText);
        try { const r = JSON.parse(fixed); if (r && typeof r === 'object') return r; } catch (_) {}
    }

    // --- 策略 3：换行转义 + 移除注释 + 尾随逗号 ---
    {
        let fixed = removeTrailingCommas(removeComments(escapedText));
        try { const r = JSON.parse(fixed); if (r && typeof r === 'object') return r; } catch (_) {}
    }

    // --- 策略 4：换行转义 + 全套修复（注释 + 尾随逗号 + 单引号 + 无引号key + 补括号） ---
    {
        let fixed = closeBrackets(quoteBareKeys(smartSingleToDoubleQuotes(removeTrailingCommas(removeComments(escapedText)))));
        try { const r = JSON.parse(fixed); if (r && typeof r === 'object') return r; } catch (_) {}
    }

    // --- 策略 5：不转义换行 + 全套修复（防止换行转义误伤的 fallback） ---
    {
        let fixed = closeBrackets(quoteBareKeys(smartSingleToDoubleQuotes(removeTrailingCommas(removeComments(text)))));
        try { const r = JSON.parse(fixed); if (r && typeof r === 'object') return r; } catch (_) {}
    }

    // --- 策略 6：尝试提取最外层 {} 之间内容后修复 ---
    {
        const braceStart = text.indexOf('{');
        const braceEnd = text.lastIndexOf('}');
        if (braceStart >= 0 && braceEnd > braceStart) {
            let extracted = text.substring(braceStart, braceEnd + 1);
            extracted = escapeNewlinesInStrings(extracted);
            extracted = removeTrailingCommas(removeComments(extracted));
            try { const r = JSON.parse(extracted); if (r && typeof r === 'object') return r; } catch (_) {}
            // 加全套修复再试
            let fixed = closeBrackets(quoteBareKeys(smartSingleToDoubleQuotes(extracted)));
            try { const r = JSON.parse(fixed); if (r && typeof r === 'object') return r; } catch (_) {}
        }
    }

    // --- 策略 7：中间缺少 } 修复（支持单处 & 多处同时缺失）---
    // 针对 AI 在 operations 数组条目中漏写闭合括号的情况
    // 思路：找到候选插入点，先逐个尝试，再尝试多点组合（最多4处同时缺失）
    {
        const base = escapeNewlinesInStrings(text);
        // 找出所有结构性 "}" 的位置（不在字符串内）
        const insertionCandidates = [];
        let inString7 = false, escape7 = false;
        for (let i = 0; i < base.length; i++) {
            const ch = base[i];
            if (escape7) { escape7 = false; continue; }
            if (ch === '\\' && inString7) { escape7 = true; continue; }
            if (ch === '"') { inString7 = !inString7; continue; }
            if (inString7) continue;
            if (ch === '}' && i + 1 < base.length) {
                const next = base[i + 1];
                if (next === ',' || next === ']' || next === '\n' || next === '\r' || next === ' ') {
                    insertionCandidates.push(i);
                }
            }
        }

        // 辅助：在多个位置同时插入 }（positions 必须升序），返回修复后的字符串
        function insertBracesAt(src, positions) {
            let result = src;
            // 从后往前插入，避免偏移量变化
            for (let k = positions.length - 1; k >= 0; k--) {
                const p = positions[k];
                result = result.substring(0, p + 1) + '}' + result.substring(p + 1);
            }
            return result;
        }

        // 单点修复（原有逻辑）
        for (let ci = insertionCandidates.length - 1; ci >= 0; ci--) {
            const candidate = insertBracesAt(base, [insertionCandidates[ci]]);
            const repaired = removeTrailingCommas(candidate);
            try { const r = JSON.parse(repaired); if (r && typeof r === 'object') return r; } catch (_) {}
            const full = closeBrackets(quoteBareKeys(smartSingleToDoubleQuotes(repaired)));
            try { const r = JSON.parse(full); if (r && typeof r === 'object') return r; } catch (_) {}
        }

        // 多点修复：对候选点取最后 N 个（N=2,3,4），暴力枚举组合（候选点过多时限制范围避免性能问题）
        const maxCandidates = Math.min(insertionCandidates.length, 20); // 最多取后20个候选点
        const tail = insertionCandidates.slice(insertionCandidates.length - maxCandidates);
        for (let n = 2; n <= 4; n++) {
            // 枚举 tail 中所有 C(len, n) 的组合
            const len = tail.length;
            if (len < n) continue;
            // 使用迭代组合枚举
            const indices = Array.from({length: n}, (_, i) => i);
            while (true) {
                const positions = indices.map(i => tail[i]);
                const candidate = insertBracesAt(base, positions);
                const repaired = removeTrailingCommas(candidate);
                try { const r = JSON.parse(repaired); if (r && typeof r === 'object') return r; } catch (_) {}
                const full = closeBrackets(quoteBareKeys(smartSingleToDoubleQuotes(repaired)));
                try { const r = JSON.parse(full); if (r && typeof r === 'object') return r; } catch (_) {}
                // 推进组合
                let i = n - 1;
                while (i >= 0 && indices[i] === len - n + i) i--;
                if (i < 0) break;
                indices[i]++;
                for (let j = i + 1; j < n; j++) indices[j] = indices[j - 1] + 1;
            }
        }
    }

    // --- 策略 8：中间多余 } 修复 ---
    // 针对 AI 多写了一个 } 的情况（与策略7相反）
    // 思路：找出所有结构性 } 的位置，从后往前逐个尝试删除一个，直到解析成功
    {
        const base = escapeNewlinesInStrings(text);
        const deletionCandidates = [];
        let inString8 = false, escape8 = false;
        for (let i = 0; i < base.length; i++) {
            const ch = base[i];
            if (escape8) { escape8 = false; continue; }
            if (ch === '\\' && inString8) { escape8 = true; continue; }
            if (ch === '"') { inString8 = !inString8; continue; }
            if (inString8) continue;
            if (ch === '}') deletionCandidates.push(i);
        }
        // 从后往前逐个尝试删除一个 }
        for (let ci = deletionCandidates.length - 1; ci >= 0; ci--) {
            const pos = deletionCandidates[ci];
            const candidate = base.substring(0, pos) + base.substring(pos + 1);
            const repaired = removeTrailingCommas(candidate);
            try { const r = JSON.parse(repaired); if (r && typeof r === 'object') return r; } catch (_) {}
            // 加全套修复
            const full = closeBrackets(quoteBareKeys(smartSingleToDoubleQuotes(repaired)));
            try { const r = JSON.parse(full); if (r && typeof r === 'object') return r; } catch (_) {}
        }
    }

    // --- 策略 9：逐行括号平衡修复 ---
    // 针对多行同时缺 }（策略7枚举组合超出范围）的情况
    // 思路：按行扫描，对每一行单独计算花括号缺口，在行尾补上对应数量的 }
    {
        const base = escapeNewlinesInStrings(text);
        const lines9 = base.split('\n');
        const fixedLines = lines9.map(line => {
            const trimmed = line.trim();
            // 只处理 operations 数组里的操作条目行（有缩进且以 { 开头，且包含 "action"）
            if (!trimmed.startsWith('{') || !trimmed.includes('"action"')) return line;
            let depth9 = 0, inStr9 = false, esc9 = false;
            for (const ch of trimmed) {
                if (esc9) { esc9 = false; continue; }
                if (ch === '\\' && inStr9) { esc9 = true; continue; }
                if (ch === '"') { inStr9 = !inStr9; continue; }
                if (inStr9) continue;
                if (ch === '{') depth9++;
                else if (ch === '}') depth9--;
            }
            if (depth9 <= 0) return line; // 平衡或多余，不动
            // 在行尾（逗号之前）补上缺失的 }
            const trailingComma = trimmed.endsWith(',');
            const withoutComma = trailingComma ? trimmed.slice(0, -1) : trimmed;
            const fixed = withoutComma + '}'.repeat(depth9) + (trailingComma ? ',' : '');
            // 保留原缩进
            const indent = line.match(/^(\s*)/)[1];
            return indent + fixed;
        });
        const fixedText = fixedLines.join('\n');
        const repaired = removeTrailingCommas(fixedText);
        try { const r = JSON.parse(repaired); if (r && typeof r === 'object') return r; } catch (_) {}
        const full = closeBrackets(quoteBareKeys(smartSingleToDoubleQuotes(repaired)));
        try { const r = JSON.parse(full); if (r && typeof r === 'object') return r; } catch (_) {}
    }

    // 全部失败
    console.warn('repairAIJson: 所有修复策略均失败');
    console.warn('原始文本前500字符:', text.substring(0, 500));
    // 输出位置附近的上下文（如果有错误位置信息传入的话）
    return null;
}

function parseDataUpdate(aiResponse) {
    if (!currentJsonTableData) {
        console.error('parseDataUpdate: currentJsonTableData 未加载');
        return false;
    }

    // 提取 <dataUpdate> 块
    const match = aiResponse.match(/<dataUpdate>([\s\S]*?)<\/dataUpdate>/);
    if (!match || !match[1]) {
        console.warn('parseDataUpdate: AI 响应中未找到 <dataUpdate> 块');
        return false;
    }

    let data;
    try {
        data = JSON.parse(match[1].trim());
    } catch (e) {
        // 使用 repairAIJson 进行多策略修复
        console.warn('parseDataUpdate: 首次 JSON.parse 失败，启动修复', e.message);
        data = repairAIJson(match[1]);
        if (!data) {
            console.error('parseDataUpdate: repairAIJson 也未能修复');
            appendTableEditErrorLog({
                reason: '<dataUpdate> JSON 解析失败（修复后仍无效）',
                command: match[1],
                detail: String(e.message || e),
            });
            return false;
        }
    }

    if (!data || typeof data !== 'object') {
        console.warn('parseDataUpdate: 解析结果不是有效对象');
        return false;
    }

    // 格式 A：operations 数组 — 增量更新
    if (Array.isArray(data.operations)) {
        return applyOperations(data.operations);
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

    console.warn('parseDataUpdate: 数据中既没有 operations 也没有 sheet_ 表');
    return false;
}

function applyOperations(operations) {
    const sheets = Object.keys(currentJsonTableData)
        .filter(k => k.startsWith('sheet_'))
        .map(k => currentJsonTableData[k]);

    let appliedCount = 0;

    operations.forEach((op, opIndex) => {
        if (!op || !op.action) {
            console.warn(`applyOperations: 第 ${opIndex} 项缺少 action 字段`, op);
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
                    console.warn(`applyOperations: 未知 action "${op.action}"`, op);
                    appendTableEditErrorLog({
                        reason: `未知 action: ${op.action}`,
                        command: JSON.stringify(op),
                    });
            }
        } catch (err) {
            console.error(`applyOperations: 第 ${opIndex} 项执行异常`, err);
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
export function referenceUpdate(text, database) { currentJsonTableData=structuredClone(database);feedback=[];const changed=parseDataUpdate(text);return {data:currentJsonTableData,changed,feedback:structuredClone(feedback)}; }
export function referenceTableText(database, settings={}) { return buildTableDataTextForDollar0(database,settings); }
export function referenceSheetText(name,headers,rows,start=0) {return formatTableToReadable(name,headers,rows,start);}
export function referencePreviewRows(table,state) {_dpState=state;return _dpGetDisplayRows(table);}
export const referencePagination = _dpPaginationRange;

export function extractDataFromMessage(message, options = {}) {
    if (!message) return null;
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
    //     只有这两类"被明确标记"的文本才可能承载数据；普通对话消息（首字符为
    //     文字等、且无 <dataUpdate>）会在下方 2.1 预筛处快速返回 null，从而规避
    //     repairAIJson 策略 7 的括号候选组合爆炸（数据概览卡顿根因）。
    //     注意：载体正则不带 m 标志 —— 无 m 时 $ 表示"串尾（含末尾换行前）"，
    //     正是截断兜底所需；若加 m 则 $ 会匹配每一行的行尾，lazy 量词会在第一个
    //     换行处收住，payload 被腰斩。
    const carrierPayloads = [];
    const dataUpdateMatch = mesText.match(/^[\s\S]*?<dataUpdate>([\s\S]*?)(?:<\/dataUpdate>|$)/);
    if (dataUpdateMatch && dataUpdateMatch[1]) carrierPayloads.push(dataUpdateMatch[1]);
    const fencedMatch = mesText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fencedMatch && fencedMatch[1]) carrierPayloads.push(fencedMatch[1]);

    for (const payload of carrierPayloads) {
        let json = null;
        try {
            json = JSON.parse(payload.trim());
        } catch (_) {
            // 载体修复必须有界（性能关键）：
            // 仅当 payload 本身看起来就是（损坏的）JSON 文档——trim 后以 { 或 [ 开头——
            // 才允许进入完整修复；代码块 / 散文等"垃圾载体"一律不进入修复、直接判为
            // 无数据。否则 repairAIJson 策略 7/8/9 的 C(20,2..4) 组合枚举会被"高密度
            // 花括号"的代码块重新触发，使数据概览重新卡到秒级。
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
        //     仅当"首个 { 与末个 } 之间"能【直接】JSON.parse 成功、且结果符合本扩展
        //     的数据形状时才采纳。刻意【不调用 repairAIJson】——只做一次朴素
        //     indexOf/lastIndexOf 抽取 + 一次 JSON.parse，从根本上杜绝策略 7 的
        //     括号候选组合爆炸（数据概览卡顿根因）。
        //     形状判据（收紧版）：
        //       主：mate.type === 'chatSheets'（与 requireMate 的判定标准一致）；
        //       备：存在 sheet_ 前缀键、且其值具备表格结构 { name, content }。
        //     由于 { a: 1 } 这类无引号 key 的对象字面量 JSON.parse 必然失败，
        //     纯说明性文本（如"示例：配置项 { a: 1 }"）不会被误采。
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
