import { categorySelect } from './category-select.js';
import { uuid } from './uuid.js';
import { sheets, validateDatabase, parseDatabase, databaseSettings, defaultDatabase, defaultFillPrompt, migrateLegacySettings, recentFillRows } from './database.js';
import { databaseInjection } from './database-injection.js';
import { renderDatabaseOverview } from './database-overview.js';
import { autosizePrompt } from './prompt-autosize.js';
import { databaseLogText, databaseLogExport, clearDatabaseLog } from './database-log.js';
import { copyDiagnostics, downloadDiagnostics } from './diagnostic-export.js';

export function renderDatabasePanel(body, context) {
    const { el, field, apiKeyField, action, notify, pickFile } = context;
    let settings = databaseSettings(context.settings), tab = 'settings', settingsDirty = false;
    let activeTable = '', summaryWorking = false, statusRevision = 0;
    const openedPrompts = new WeakSet();
    const promptSizes = [];
    const statusFields = ['inject','keywordInjectionTokens','auto','messageSummaryPreset','autoUpdateFrequency','updateBatchSize','hideAfterMessageSummary','removeTags','userMessageTags','databaseSummaryPreset','databaseSummaryAuto','databaseSummaryTokens','databaseSummaryTable','databaseSummaryRows'];
    const statusValues = value => Object.fromEntries(statusFields.map(key => [key, value[key]]));
    let savedStatus = statusValues(settings), statusDirty = false, statusVersion = 0;
    const overviewDraft = { pending: new Set() };
    const hasDraft = () => settingsDirty || statusDirty || overviewDraft.pending.size > 0;
    const settingsValue = includeStatus => databaseSettings({ ...settings, ...(includeStatus ? {} : savedStatus) });
    const templateUndo = [];
    let saveTimer, editVersion=0, saveQueue=Promise.resolve(), disposed=false;
    body._dispose = () => { disposed=true; clearTimeout(saveTimer); for(const dispose of promptSizes.splice(0))dispose(); };
    const dirty = () => {
        if (tab === 'settings') { statusDirty = true; statusVersion++;const status=content.querySelector('.db-save-status');if(status)status.textContent='有未保存的修改'; }
        else settingsDirty = true;
        context.dirty(hasDraft());
        if(tab!=='settings') { const version=++editVersion;clearTimeout(saveTimer);saveTimer=setTimeout(()=>{let value;try{value=settingsValue(false);}catch{return;}saveQueue=saveQueue.catch(()=>{}).then(async()=>{if(disposed)return;value=databaseSettings({...value,...savedStatus});await context.saveSettings(value);savedStatus=statusValues(value);}).then(()=>{if(!disposed){if(version===editVersion)settingsDirty=false;context.dirty(hasDraft());}}).catch(error=>notify(error.message,true));},500); }
    };
    const download = (value, filename) => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
        const link = el('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const toolbarButton = (parent, label, glyph, callback, type = '') => {
        const control = action(label, callback, glyph, type); control.title = label; control.setAttribute('aria-label', label); parent.append(control); return control;
    };
    const discloseTools = (bar, tools, label, groupLabel) => context.discloseProfileTools(
        bar, tools, (text, callback, glyph) => toolbarButton(tools, text, glyph, callback), label, groupLabel,
    );
    const categories = [['settings', '状态与操作'], ['presets', 'AI 指令预设'], ['api', 'API 与连接'], ['world', '世界书参考'], ['overview', '数据概览'], ['template', '模板'], ['log', '更新日志']];
    const tabs = el('nav', 'db-tabs desktop-category'); tabs.setAttribute('aria-label', '数据库功能');
    const picker = categorySelect(el, '数据库功能', categories, tab, key => { tab = key; render(); });
    const categoryBar = el('div', 'db-category-bar');
    categoryBar.append(picker);
    const content = el('div', 'db-content');
    body.append(tabs, categoryBar, content);
    const render = () => {
        for(const dispose of promptSizes.splice(0))dispose();
        tabs.replaceChildren();
        picker.firstElementChild.value = tab;
        picker.firstElementChild.disabled = !!overviewDraft.saving;
        for (const [key, label] of categories) {
            const control = action(label, () => { tab = key; render(); }); control.setAttribute('aria-pressed', String(tab === key)); control.disabled = !!overviewDraft.saving; tabs.append(control);
        }
        content.replaceChildren();
        content.classList.toggle('preset-panel', tab === 'presets');
        if (tab === 'overview') renderDatabaseOverview(content, {
            ...context,
            dirty: () => context.dirty(hasDraft()),
            refresh: () => { if (!disposed && tab === 'overview') render(); },
        }, overviewDraft);
        else if (tab === 'log') renderLog();
        else if (tab === 'template') renderTemplate();
        else if (tab === 'presets') renderPresets(); else if(tab==='api')renderAPI();else if(tab==='world')void renderWorld();else renderSettings();
    };
    const note = (text, parent = content) => { const node = el('p', 'note', text); parent.append(node); return node; };
    const featureCard = (title = '', description = '') => {
        const card = el('section', 'dm-status-card db-feature-card');
        if (title) card.append(el('h2', '', title));
        if (description) note(description, card);
        return card;
    };
    function renderLog() {
        const card = featureCard(); content.append(card);
        note('记录本页面最近 50 次 AI 更新，刷新浏览器后清空。复制只包含摘要。导出会附带最近一次格式异常的完整原文，分享前请检查其中的私密内容。', card);
        const toolbar = el('div', 'db-toolbar');
        const output = el('textarea', 'timing-copy');
        const empty = el('p', 'note', '暂无更新日志');
        empty.setAttribute('role', 'status');
        output.readOnly = true;
        output.rows = 12;
        output.setAttribute('aria-label', '数据库更新日志');
        const refresh = () => {
            const text = databaseLogText();
            output.value = text;
            output.hidden = !text;
            empty.hidden = !!text;
            copy.disabled = save.disabled = clear.disabled = !text;
        };
        toolbarButton(toolbar, '刷新日志', 'refresh', refresh);
        const copy = toolbarButton(toolbar, '复制日志', 'copy', async () => {
            await copyDiagnostics(output.value, content);
            notify('更新日志已复制');
        });
        const save = toolbarButton(toolbar, '导出日志', 'export', () => {
            if (context.isGenerating() || context.isUpdating()) throw new Error('请在生成或更新结束后导出日志。');
            downloadDiagnostics(JSON.stringify(databaseLogExport(), null, 2), content, { filename: 'database-update-log.json' });
        });
        const clear = toolbarButton(toolbar, '清空日志', 'trash', () => { clearDatabaseLog(); refresh(); });
        card.append(toolbar, empty, output);
        refresh();
    }
    const saveSettings = async () => {
        clearTimeout(saveTimer);const version=++editVersion;
        const includeStatus = tab === 'settings', savedStatusVersion = statusVersion;
        const active = settings.presets.find(item => item.id === settings.activePreset);
        if (active) active.template = structuredClone(settings.template);
        let value=settingsValue(includeStatus);
        let status=content.querySelector('.db-save-status');if(!status){status=el('p','db-save-status');status.setAttribute('role','status');(content.querySelector(':scope > .editor-footer') || content).append(status);}status.textContent='保存中…';status.classList.remove('error');
        const task=saveQueue.catch(()=>{}).then(async()=>{if(!includeStatus)value=databaseSettings({...value,...savedStatus});await context.saveSettings(value);savedStatus=statusValues(value);});saveQueue=task;
        try{await task;if(includeStatus&&savedStatusVersion===statusVersion)statusDirty=false;if(version===editVersion)settingsDirty=false;context.dirty(hasDraft());if(status.isConnected)status.textContent='已保存';notify('数据库设置已保存');}
        catch(error){if(status.isConnected){status.textContent=`保存失败：${error.message}`;status.classList.add('error');}throw error;}
    };
    function renderTemplate() {
        const book = settings.template, history = templateUndo;
        const remember = () => { history.push(structuredClone(book)); if (history.length > 20) history.shift(); undoButton.disabled = false; };
        const replace = value => { settings.template = value; dirty(); render(); };
        const change = callback => { remember(); callback(); dirty(); render(); };
        const toolbar = el('div', 'db-toolbar db-table-toolbar');
        const fileActions = el('div', 'connection-profile-tools');
        toolbarButton(fileActions, '导入模板', 'import', async () => {
            const file = await pickFile('.json'); if (!file) return; const value = parseDatabase(await file.text());
            if (!confirm('使用导入内容替换当前模板草稿？保存后生效。')) return; remember(); replace(value);
        });
        toolbarButton(fileActions, '导出模板', 'export', () => download(book, 'database-template.json'));
        const undoButton = toolbarButton(fileActions, '撤销编辑', 'history', () => { replace(history.pop()); }); undoButton.disabled = !history.length;
        const saveBar = el('div', 'editor-footer');
        toolbarButton(saveBar, '保存模板', 'edit', saveSettings, 'primary');
        const presetCard = featureCard(); content.append(presetCard);
        const presetSelect = field(presetCard, '所属 AI 指令预设', settings.activePreset, { options: settings.presets.map(preset => [preset.id, preset.name]) });
        presetCard.append(toolbar);
        presetSelect.addEventListener('change', () => {
            settings.presets.find(preset => preset.id === settings.activePreset).template = structuredClone(book);
            settings.activePreset = presetSelect.value;
            settings.template = structuredClone(settings.presets.find(preset => preset.id === settings.activePreset).template);
            history.length = 0; activeTable = ''; dirty(); render();
        });
        toolbarButton(fileActions,'重置模板','refresh',()=>{if(!confirm('重置当前预设模板？'))return;remember();replace({mate:{type:'chatSheets'}});});
        toolbarButton(fileActions, '新增表格', 'plus', () => change(() => {
            let index = 0; while (Object.hasOwn(book, `sheet_${index}`)) index++;
            activeTable = `sheet_${index}`; book[activeTable] = { name: '新表格', content: [[null, '名称', '内容']] };
        }));
        const editor = el('section', 'db-sheet db-template-editor');
        const tables = sheets(book);
        if (!tables.some(([key]) => key === activeTable)) activeTable = tables[0]?.[0] || '';
        const tableOptions = tables.length ? tables.map(([key, table]) => [key, `${table.name || key}（${table.content[0].length - 1}）`]) : [['', '暂无表格']];
        const tablePicker = categorySelect(el, '模板表格', tableOptions, activeTable, key => { activeTable = key; render(); });
        tablePicker.classList.add('db-template-picker');
        toolbar.append(tablePicker, fileActions);
        discloseTools(toolbar, fileActions, '更多模板操作', '模板管理');
        const entry = tables.find(([key]) => key === activeTable);
        if (entry) {
            const [key, table] = entry;
            const heading = el('div', 'db-template-heading'); heading.append(el('h2', '', '表格设置'));
            toolbarButton(heading, '删除表格', 'trash', () => { if (confirm(`删除表格「${table.name}」及其模板内容？可撤销此操作。`)) change(() => { delete book[key]; }); }, 'icon-button danger'); editor.append(heading);
            const name = field(editor, '表格名称', table.name || key);
            name.addEventListener('focus', remember, { once: true });
            name.addEventListener('input', () => {
                table.name = name.value;
                const label = `${name.value || key}（${table.content[0].length - 1}）`;
                list.querySelector('[aria-pressed=true] > span').textContent = label;
                tablePicker.firstElementChild.selectedOptions[0].textContent = label;
                dirty();
            });
            const recent = recentFillRows(table);
            const fillRange = field(editor, '$0 填表范围', recent ? 'recent' : 'all', {
                options: [['all', '全表'], ['recent', '最近 N 条记录']], hint: '用于这份预设执行消息总结时。',
            });
            fillRange.addEventListener('change', () => change(() => { table.fillRecentRows = fillRange.value === 'recent' ? 10 : 0; }));
            if (recent) {
                const rows = field(editor, '$0 保留最近记录数', recent, { type: 'number' });
                rows.min = 1; rows.step = 1;
                rows.addEventListener('change', () => {
                    const value = rows.valueAsNumber;
                    const limit = Number.isSafeInteger(value) && value > 0 ? value : recentFillRows(table);
                    rows.value = limit;
                    if (limit === recentFillRows(table)) return;
                    remember(); table.fillRecentRows = limit; dirty();
                });
            }
            const injection = databaseInjection(table);
            const setInjection = patch => { table.injection = { ...table.injection, ...databaseInjection(table), ...patch }; };
            const mode = field(editor, '触发方式', injection.mode, { options: [['constant', '常驻'], ['keyword', '关键词']] });
            mode.addEventListener('change', () => change(() => setInjection({ mode: mode.value })));
            if (injection.mode === 'keyword') {
                const depth = field(editor, '扫描深度（消息数）', injection.depth, {
                    type: 'number', hint: '从最新一条消息往前计数，包含本轮输入。0 表示不扫描。',
                });
                depth.min = 0; depth.max = 1000; depth.step = 1;
                depth.addEventListener('change', () => {
                    const value = Number.isNaN(depth.valueAsNumber) ? 2 : Math.max(0, Math.min(1000, Math.round(depth.valueAsNumber)));
                    depth.value = value;
                    if (value === databaseInjection(table).depth) return;
                    remember(); setInjection({ depth: value }); dirty();
                });
                const maxRows = field(editor, '最大注入行数', injection.maxRows || '', { type: 'number', hint: '留空或填 0 表示不限。' });
                maxRows.min = 0; maxRows.step = 1;
                maxRows.addEventListener('change', () => {
                    const value = maxRows.valueAsNumber;
                    const limit = Number.isSafeInteger(value) && value > 0 ? value : 0;
                    maxRows.value = limit || '';
                    if (limit === databaseInjection(table).maxRows) return;
                    remember(); setInjection({ maxRows: limit }); dirty();
                });
                const priority = field(editor, '注入优先级', injection.priority, {
                    options: [['high', '高'], ['normal', '普通'], ['low', '低']], hint: '多张表共用 Token 上限时，按优先级分配。',
                });
                priority.addEventListener('change', () => { remember(); setInjection({ priority: priority.value }); dirty(); });
                const sources = el('section');
                const sourcesHeading = el('h2', '', '关键词来源列');
                sourcesHeading.id = 'database-keyword-columns';
                sources.setAttribute('aria-labelledby', sourcesHeading.id);
                sources.append(sourcesHeading, el('p', 'note', '支持多选，用顿号、逗号、分号或换行拆词。完整匹配或匹配到两个连续汉字即可命中；未选择来源列时不触发。'));
                const choices = el('div', 'db-keyword-columns');
                sources.append(choices);
                const selections = [];
                for (let column = 1; column < table.content[0].length; column++) {
                    const label = el('label', 'check-field'), check = el('input'), caption = el('span');
                    check.type = 'checkbox'; check.checked = injection.columns.includes(column);
                    caption.textContent = table.content[0][column] || `字段 ${column}`;
                    label.append(check, caption); choices.append(label);
                    selections.push({ column, check, caption });
                    check.addEventListener('change', () => {
                        remember(); setInjection({ columns: selections.filter(item => item.check.checked).map(item => item.column) }); dirty();
                    });
                }
                editor.append(sources);
                const linkLabel = el('label', 'check-field'), link = el('input');
                link.type = 'checkbox'; link.checked = injection.linkEnabled;
                linkLabel.append(link, el('span', '', '启用联动触发')); editor.append(linkLabel);
                link.addEventListener('change', () => change(() => setInjection({ linkEnabled: link.checked })));
                const linkSource = injection.linkEnabled ? field(editor, '联动来源列', injection.linkColumn, {
                    options: [[0, '请选择字段'], ...table.content[0].slice(1).map((header, index) => [index + 1, header || `字段 ${index + 1}`])],
                    hint: '聊天命中该行后，用此列的完整词查找其他关键词表，只联动一跳。',
                }) : null;
                linkSource?.addEventListener('change', () => { remember(); setInjection({ linkColumn: Number(linkSource.value) }); dirty(); });
                editor.addEventListener('input', event => {
                    const selection = selections.find(item => item.column === Number(event.target.dataset.templateColumn));
                    if (selection) {
                        const label = event.target.value || `字段 ${selection.column}`;
                        selection.caption.textContent = label;
                        if (linkSource) linkSource.options[selection.column].textContent = label;
                    }
                });
            }
            const fieldsHeading = el('div', 'db-template-heading'); fieldsHeading.append(el('h2', '', '字段'));
            toolbarButton(fieldsHeading, '新增字段', 'plus', () => change(() => {
                table.content[0].push('新字段'); for (const row of table.content.slice(1)) row.push('');
            }), 'icon-button'); editor.append(fieldsHeading);
            const fields = el('div', 'db-template-fields');
            for (let column = 1; column < table.content[0].length; column++) {
                const row = el('div', 'db-template-field');
                const input = field(row, `字段 ${column}`, table.content[0][column] ?? '');
                input.dataset.templateColumn = column;
                input.addEventListener('focus', remember, { once: true });
                input.addEventListener('input', () => { table.content[0][column] = input.value; dirty(); });
                const remove = toolbarButton(row, `删除字段 ${column}`, 'trash', () => {
                    if (confirm(`删除字段「${table.content[0][column]}」及其模板内容？可撤销此操作。`)) change(() => {
                        if (table.injection) {
                            const current = databaseInjection(table);
                            const shift = index => index === column ? 0 : index > column ? index - 1 : index;
                            setInjection({ columns: current.columns.map(shift).filter(Boolean), linkColumn: shift(current.linkColumn) });
                        }
                        for (const dataRow of table.content) dataRow.splice(column, 1);
                    });
                }, 'danger');
                remove.disabled = table.content[0].length <= 2; fields.append(row);
            }
            editor.append(fields, el('p', 'note', '至少保留一个字段。字段顺序即填表顺序。'));
        } else editor.append(el('p', 'note', '新增表格后，即可编辑表名和字段。'));
        content.append(editor, saveBar);
    }
    function renderPresets() {
        const toolbar = el('div', 'connection-profile-bar preset-profile-bar db-preset-bar'), presetTools = el('div', 'connection-profile-tools');
        const select = el('select'); select.setAttribute('aria-label', '数据库填表预设');
        select.dataset.searchable = 'true'; select.dataset.searchPlaceholder = '搜索预设…'; select.dataset.searchLabel = '搜索预设';
        for (const preset of settings.presets) { const option = el('option', '', preset.name); option.value = preset.id; select.append(option); }
        select.value = settings.activePreset; toolbar.append(select, presetTools); content.append(toolbar);
        select.addEventListener('change', () => { settings.presets.find(item => item.id === settings.activePreset).template = structuredClone(settings.template); settings.activePreset = select.value; settings.template = structuredClone(settings.presets.find(item => item.id === select.value).template || defaultDatabase()); dirty(); render(); });
        const preset = settings.presets.find(item => item.id === settings.activePreset);
        toolbarButton(presetTools, '新增预设', 'plus', () => { preset.template = structuredClone(settings.template); const value = { id: uuid(), name: '新填表预设', messages: [{ role: 'system', content: defaultFillPrompt }], template: defaultDatabase() }; settings.presets.push(value); settings.activePreset = value.id; settings.template = structuredClone(value.template); dirty(); render(); });
        toolbarButton(presetTools, '复制预设', 'copy', () => { preset.template = structuredClone(settings.template); const value = { ...structuredClone(preset), id: uuid(), name: `${preset.name}（副本）` }; settings.presets.push(value); settings.activePreset = value.id; dirty(); render(); });
        toolbarButton(presetTools, '删除预设', 'trash', () => { if (settings.presets.length < 2) throw new Error('至少保留一个填表预设。'); if (!confirm('删除当前填表预设？保存后生效。')) return; settings.presets = settings.presets.filter(item => item !== preset); settings.activePreset = settings.presets[0].id; for(const key of ['messageSummaryPreset','databaseSummaryPreset'])if(settings[key]===preset.id)settings[key]=settings.activePreset; settings.template = structuredClone(settings.presets[0].template || defaultDatabase()); dirty(); render(); }, 'danger');
        toolbarButton(presetTools, '导出填表预设', 'export', () => download({ name: preset.name, prompt: preset.messages, overviewTemplate: JSON.stringify(settings.template), version: '2.0.0' }, 'database-preset.json'));
        toolbarButton(presetTools, '导入填表预设', 'import', async () => {
            const file = await pickFile('.json'); if (!file) return; const imported = JSON.parse(await file.text());
            const migrated = imported.prompt || imported.charCardPrompts ? migrateLegacySettings(imported.charCardPrompts ? imported : { charCardPrompts: [imported] }) : databaseSettings({ presets: [imported], template: imported.template || defaultDatabase() });
            preset.template = structuredClone(settings.template); const value = { ...migrated.presets[0], id: uuid() }; settings.presets.push(value); settings.activePreset = value.id; settings.template = structuredClone(value.template || migrated.template); dirty(); render(); notify('填表预设已载入，保存后生效');
        });
        const rename = toolbarButton(presetTools, '编辑名称', 'edit', () => context.editName({
            title: '修改预设名称', label: '预设名称', value: preset.name,
            returnFocus: presetTools.querySelector('[aria-expanded]'),
            save: value => {
                if (preset.name === value) return;
                preset.name = value;
                select.selectedOptions[0].textContent = value;
                dirty();
            },
        }));
        presetTools.prepend(rename);
        discloseTools(toolbar, presetTools, '更多预设操作', '填表预设管理');

        const promptCard = featureCard(); promptCard.classList.add('db-prompt-card'); content.append(promptCard);
        const heading = el('div', 'section-heading preset-prompt-heading');
        heading.append(el('h2', '', '提示词条目'));
        toolbarButton(heading, '添加条目', 'plus', () => {
            const message = { role: 'user', content: '' };
            preset.messages.push(message); openedPrompts.add(message); dirty(); render();
            content.querySelector('.prompt-item:last-child')?.scrollIntoView({ block: 'nearest' });
        });
        const stats = el('div', 'preset-prompt-stats item-count', `${preset.messages.length} 个条目`);
        promptCard.append(heading, stats);
        note('$0 按模板范围提供表格，$FULL_TABLES 读取完整资料库，$1 为选定楼层对话，$4 为可选世界书参考内容。', promptCard);
        const rows = el('div', 'prompt-list');promptCard.append(rows);
        preset.messages.forEach((message, index) => {
            const section = el('details', 'prompt-item');section.open=openedPrompts.has(message);section.addEventListener('toggle',()=>{if(!section.isConnected)return;if(section.open)openedPrompts.add(message);else openedPrompts.delete(message);});
            const summary=el('summary','prompt-summary'),label=el('span','prompt-title'),kind=el('small','prompt-kind',({system:'系统',user:'用户',assistant:'助手'})[message.role]);label.append(el('span','',`提示词 ${index+1}`));label.append(kind);summary.append(label);
            const anchor=el('span','prompt-action-anchor'),tools=el('span','prompt-actions prompt-inline-actions inset-action-menu');tools.hidden=true;tools.id=`db-prompt-actions-${uuid()}`;tools.setAttribute('role','group');tools.setAttribute('aria-label','条目操作');tools.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});
            const more=toolbarButton(anchor,`提示词 ${index+1} 的条目操作`,'more',()=>{const expand=tools.hidden;for(const menu of rows.querySelectorAll('.prompt-inline-actions'))menu.hidden=true;for(const toggle of rows.querySelectorAll('.prompt-actions-toggle'))toggle.setAttribute('aria-expanded','false');tools.hidden=!expand;more.setAttribute('aria-expanded',String(expand));},'prompt-actions-toggle');more.setAttribute('aria-expanded','false');more.setAttribute('aria-controls',tools.id);more.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});anchor.prepend(tools);summary.append(anchor);
            summary.addEventListener('keydown',event=>{if(event.key==='Escape'&&!tools.hidden){event.preventDefault();event.stopPropagation();tools.hidden=true;more.setAttribute('aria-expanded','false');more.focus();}});
            const form=el('div','prompt-form');section.append(summary,form);const role=field(form,'消息角色',message.role,{options:[['system','System · 系统'],['user','User · 用户'],['assistant','Assistant · 助手']]});role.addEventListener('change',()=>{message.role=role.value;kind.textContent=({system:'系统',user:'用户',assistant:'助手'})[message.role];dirty();});
            const text = field(form, '提示词内容', message.content, { multiline: true, rows: 7 }); text.addEventListener('input', () => { message.content = text.value; dirty(); });
            promptSizes.push(autosizePrompt(text));
            for (const [label, glyph, target] of [['上移', 'up', index - 1], ['下移', 'down', index + 1]]) { const button = toolbarButton(tools, label, glyph, () => { [preset.messages[index], preset.messages[target]] = [preset.messages[target], preset.messages[index]]; dirty(); render(); }); button.disabled = target < 0 || target >= preset.messages.length; }
            const remove = toolbarButton(tools, '删除提示词段', 'trash', () => { preset.messages.splice(index, 1); dirty(); render(); }, 'danger'); remove.disabled = preset.messages.length <= 1; rows.append(section);
        });
        const footer=el('div','editor-footer');content.append(footer);toolbarButton(footer, '保存填表预设', 'edit', saveSettings, 'primary');
    }
    function renderAPI() {
        const profileBar=el('div','connection-profile-bar'),mode=el('select');mode.setAttribute('aria-label','API 模式');for(const [value,label]of [['custom','自定义 API'],['tavern','主 API']]){const option=el('option','',label);option.value=value;mode.append(option);}mode.value=settings.apiMode||'custom';profileBar.append(mode);content.append(profileBar);mode.addEventListener('change',()=>{settings.apiMode=mode.value;dirty();render();});
        const status=el('p','db-api-status');status.setAttribute('role','status');
        const tools=el('div','editor-footer db-api-actions');
        const connectionCard = featureCard(settings.apiMode === 'tavern' ? '' : '地址与密钥');
        const modelCard = featureCard(settings.apiMode === 'tavern' ? '模型参数' : '模型与参数');
        content.append(connectionCard, modelCard);
        const renderModels = ({ label, value, setValue, fetchModels, defaultLabel }) => {
            const defaults = defaultLabel === undefined ? [] : [['', defaultLabel]];
            const model = field(modelCard, label, value, { options: [
                ...defaults, ...(value ? [[value, value]] : defaultLabel === undefined ? [['', '读取列表或输入模型 ID']] : []),
            ] });
            model.dataset.searchable = 'true'; model.dataset.allowCustom = 'true';
            model.addEventListener('change', () => { setValue(model.value); dirty(); });
            const modelRow = el('div', 'connection-model-row'); model.before(modelRow); modelRow.append(model);
            const currentPage = () => !disposed && tab === 'api' && model.isConnected;
            const load = toolbarButton(modelRow, '读取模型列表', 'refresh', async () => {
                load.disabled = true; status.classList.remove('error'); status.textContent = '正在读取模型列表…';
                try {
                    const models = await fetchModels();
                    if (!currentPage()) return;
                    const selected = model.value;
                    const options = [...defaults, ...models];
                    if (selected && !models.some(([id]) => id === selected)) options.splice(defaults.length, 0, [selected, selected]);
                    model.replaceChildren(...options.map(([id, name]) => {
                        const option = el('option', '', name); option.value = id; return option;
                    }));
                    model.value = selected || (defaults.length ? '' : models[0][0]);
                    if (model.value !== selected) { setValue(model.value); dirty(); }
                    status.textContent = `已读取 ${models.length} 个模型，请在上方选择`;
                } catch (error) {
                    if (currentPage()) { status.classList.add('error'); status.textContent = `读取失败：${error.message}`; }
                } finally { if (currentPage()) load.disabled = false; }
            }, 'model-refresh');
            load.querySelector('span')?.remove();
        };
        if(settings.apiMode==='tavern') {
            const selectedId = settings.tavernProfile || settings.profileId || '';
            const profile = context.profiles.find(item => item.id === selectedId);
            const options = [['', '请选择渠道'], ...context.profiles.map(item => [item.id, item.name || item.model])];
            if (selectedId && !profile) options.push([selectedId, '原渠道已删除，请重新选择']);
            const channel = field(connectionCard, 'API 渠道', selectedId, { options });
            channel.addEventListener('change', () => { settings.tavernProfile = channel.value; settings.profileId = channel.value; dirty(); render(); });
            if (profile) {
                renderModels({
                    label: '数据库模型', defaultLabel: profile.model ? `沿用渠道模型（${profile.model}）` : '沿用渠道模型',
                    value: Object.hasOwn(settings.tavernModels, profile.id) ? settings.tavernModels[profile.id] : '',
                    setValue: model => {
                        if (model) settings.tavernModels = { ...settings.tavernModels, [profile.id]: model };
                        else delete settings.tavernModels[profile.id];
                    },
                    fetchModels: () => context.profileModels(profile),
                });
            }
        } else {
            const config=settings.apiConfig ||= {};
            config.useMainApi=false;
            const url=field(connectionCard,'API 基础地址',config.url||'',{type:'url'});url.addEventListener('input',()=>{config.url=url.value;dirty();});
            const key=apiKeyField(connectionCard,config.apiKey||'');key.addEventListener('input',()=>{config.apiKey=key.value;dirty();});
            const keyWrap=el('div','key-input-wrap');key.before(keyWrap);keyWrap.append(key);
            const eye=toolbarButton(keyWrap,'显示密钥','eye',()=>{const visible=key.type==='password';key.type=visible?'text':'password';if(context.icon)eye.replaceChildren(context.icon(visible?'eyeOff':'eye'));eye.title=visible?'隐藏密钥':'显示密钥';eye.setAttribute('aria-label',eye.title);eye.setAttribute('aria-pressed',String(visible));},'key-toggle');if(context.icon)eye.replaceChildren(context.icon('eye'));else eye.querySelector('span')?.remove();eye.setAttribute('aria-pressed','false');
            renderModels({ label: '模型', value: config.model || '', setValue: model => { config.model = model; }, fetchModels: () => context.models({ ...config }) });
        }
        const parameters=el('div','parameter-grid');modelCard.append(parameters, status);
        for(const [key,label,min,max,step] of [['maxTokens','最大回复 tokens',1,2000000,1],['temperature','Temperature',0,2,.05]]){const control=field(parameters,label,settings[key],{type:'number'});control.min=min;control.max=max;control.step=step;control.addEventListener('input',()=>{settings[key]=Number(control.value);dirty();});}
        toolbarButton(tools,'保存 API 配置','plug',saveSettings,'primary');content.append(tools);
    }
    async function renderWorld() {
        const config=settings.worldbookConfig ||= {source:'character',manualSelection:[],enabledEntries:{}};
        const sourceCard = featureCard(); content.append(sourceCard);
        const source=field(sourceCard,'世界书来源',config.source,{options:[['character','角色关联世界书'],['manual','手动选择世界书']]});source.addEventListener('change',()=>{config.source=source.value;dirty();render();});
        const books=await context.worlds(config);if(disposed || tab!=='world' || sourceCard.parentElement!==content)return;
        if (!books.length) note(config.source === 'manual' ? '暂无可选的世界书。' : '当前角色没有关联世界书。', sourceCard);
        for(const book of books){
            const section=el('details','dm-world-book'),summary=el('summary','dm-world-heading'),title=el('span','dm-world-title',book.name),tools=el('span','dm-world-tools');tools.setAttribute('role','group');tools.setAttribute('aria-label',`${book.name} 条目选择`);summary.append(title,tools);section.append(summary);
            if(config.source==='manual'){const wrap=el('label','check-field dm-world-use'),check=el('input');check.type='checkbox';check.checked=(config.manualSelection||[]).includes(book.name);wrap.append(check,el('span','','使用此世界书'));section.append(wrap);check.addEventListener('change',()=>{const selected=new Set(config.manualSelection||[]);if(check.checked)selected.add(book.name);else selected.delete(book.name);config.manualSelection=[...selected];dirty();});}
            const entries=Object.entries(book.entries||{}),enabled=config.enabledEntries ||= {},list=el('div','dm-world-entries'),checks=[];
            for(const [id,entry]of entries){const uid=String(entry.uid??id),wrap=el('label','dm-world-entry'),check=el('input');check.type='checkbox';check.checked=Array.isArray(enabled[book.name])?enabled[book.name].map(String).includes(uid):!entry.disable;wrap.append(check,el('span','',entry.comment||uid));list.append(wrap);checks.push([uid,check]);check.addEventListener('change',()=>{enabled[book.name]=checks.filter(([,check])=>check.checked).map(([uid])=>uid);dirty();});}
            for(const [label,selected]of [['全选',true],['全不选',false]]){const control=toolbarButton(tools,label,null,()=>{for(const [,check]of checks)check.checked=selected;enabled[book.name]=selected?checks.map(([uid])=>uid):[];dirty();});control.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});}
            section.append(list);content.append(section);
        }
        const footer = el('div', 'editor-footer');
        toolbarButton(footer,'保存世界书配置','edit',saveSettings,'primary');content.append(footer);
    }
    function renderSettings() {
        const revision=++statusRevision;
        const current=context.latest?.(), data=validateDatabase(current?.data ?? context.data);
        const tables=sheets(data),latest=current?.index??context.chat.findLastIndex(message=>!message.is_user&&message.TavernDB_ACU_Data);
        const meta=current ? current.meta : context.chat[latest]?.extra?.independentDatabase;
        const recorded=meta?.kind==='database'?(meta.messageSummaryTo??latest):(meta?.to??latest);
        const check=(parent,label,key)=>{const wrap=el('label','check-field'),control=el('input');control.type='checkbox';control.checked=!!settings[key];control.addEventListener('change',()=>{settings[key]=control.checked;dirty();});wrap.append(control,el('span','',label));parent.append(wrap);};
        const status=el('section','dm-status-card dm-summary-status');
        status.append(el('h2','','数据库状态'));
        const metrics=el('div','dm-summary-metrics');
        for(const [label,value]of [['数据表',tables.length],['记录',tables.reduce((sum,[,table])=>sum+table.content.length-1,0)],['待总结楼层',Math.max(0,context.chat.length-1-recorded)],['最新快照',latest<0?'模板 / 种子':`#${latest}${current?.archived?' · 覆盖前版本':''}`]]){const item=el('div','dm-summary-metric');item.append(el('span','note',label),el('strong','',String(value)));metrics.append(item);}
        status.append(metrics);content.append(status);
        const grid=el('div','dm-summary-grid');
        const bindPreset=(parent,label,key)=>{const control=field(parent,label,settings[key],{options:settings.presets.map(preset=>[preset.id,preset.name])});control.addEventListener('change',()=>{settings[key]=control.value;dirty();});};
        const setting=(parent,key,label,type='number',min=0)=>{const control=field(parent,label,settings[key]??'',{type});if(type==='number'){control.min=min;control.step=1;}control.addEventListener('input',()=>{settings[key]=type==='number'?Number(control.value):control.value;dirty();});return control;};
        const injection=featureCard('提示词注入');
        check(injection,'注入提示词','inject');
        setting(injection, 'keywordInjectionTokens', '资料库关键词注入 Token 上限（0 为不限）');
        content.append(injection,grid);
        const run=async callback=>{if(statusDirty||settingsDirty)throw Error('请先保存配置，再执行总结。');summaryWorking=true;render();try{await callback();}finally{summaryWorking=false;if(!disposed&&tab==='settings')render();}};
        const message=featureCard('消息总结','将选定楼层的对话整理到数据库。楼层号从 0 开始。');grid.append(message);
        bindPreset(message,'消息总结预设','messageSummaryPreset');check(message,'自动总结消息','auto');
        check(message,'总结后向 AI 隐藏对应楼层','hideAfterMessageSummary');
        const messageConfig=el('div','dm-config-grid');message.append(messageConfig);
        setting(messageConfig,'autoUpdateFrequency','保留最新 N 层', 'number',0);
        setting(messageConfig,'updateBatchSize','每次总结楼层数','number',1);
        setting(message,'removeTags','删除标签（| 分隔）','text');setting(message,'userMessageTags','用户消息标签（| 分隔）','text');
        const range=el('div','dm-config-grid dm-summary-range');message.append(range);
        const from=field(range,'起始楼层',Math.min(Math.max(0,recorded+1),Math.max(0,context.chat.length-1)),{type:'number'}),to=field(range,'结束楼层',Math.max(0,context.chat.length-1),{type:'number'});from.min=to.min=0;from.max=to.max=Math.max(0,context.chat.length-1);from.step=to.step=1;
        for(const control of [from,to])control.addEventListener('input',()=>context.dirty(hasDraft()));
        const messageRun=toolbarButton(message,'总结所选消息','refresh',()=>run(()=>context.fill(Number(from.value),Number(to.value))),'primary');
        const database=featureCard('数据库总结','整理最新快照中的已有记录，合并冗余信息。两个阈值满足任意一个即触发，0 表示关闭该条件。');grid.append(database);
        bindPreset(database,'数据库总结预设','databaseSummaryPreset');check(database,'自动总结数据库','databaseSummaryAuto');
        const tokenStatus=el('p','note','最新快照总 Token：统计中…');tokenStatus.setAttribute('role','status');database.append(tokenStatus);
        const refreshTokens=()=>{tokenStatus.textContent='最新快照总 Token：统计中…';Promise.resolve().then(()=>context.countDatabaseTokens?.()).then(count=>{if(!disposed&&tab==='settings'&&revision===statusRevision)tokenStatus.textContent=Number.isFinite(count)?`最新快照总 Token：${count}`:'最新快照总 Token：暂不可用';}).catch(error=>{if(!disposed&&tab==='settings'&&revision===statusRevision)tokenStatus.textContent=`Token 统计失败：${error.message}`;});};refreshTokens();
        setting(database,'databaseSummaryTokens','总 Token 达到');
        const tableOptions=[['','请选择数据表'],...tables.map(([key,table])=>[key,`${table.name||key} · ${table.content.length-1} 条`])];
        if(settings.databaseSummaryTable&&!tables.some(([key])=>key===settings.databaseSummaryTable))tableOptions.push([settings.databaseSummaryTable,`${settings.databaseSummaryTable}（当前不存在）`]);
        const table=field(database,'监测数据表',settings.databaseSummaryTable,{options:tableOptions});table.addEventListener('change',()=>{settings.databaseSummaryTable=table.value;dirty();});
        setting(database,'databaseSummaryRows','该表记录数达到');
        database.append(el('p','note','自动检查在回复保存后执行；消息总结启用时，先完成消息总结，再检查数据库。相同快照总结完成后不重复自动触发。'));
        const databaseRun=toolbarButton(database,'总结最新数据库','refresh',()=>run(()=>context.summarize()),'primary');
        messageRun.disabled=databaseRun.disabled=summaryWorking||!!context.isUpdating?.()||!context.chat.some(message=>!message.is_user);
        const footer = el('div', 'editor-footer db-status-footer');
        toolbarButton(footer, '保存配置', 'edit', saveSettings, 'primary');
        const saveStatus = el('p', 'db-save-status', statusDirty ? '有未保存的修改' : '');
        saveStatus.setAttribute('role', 'status');
        footer.append(saveStatus);
        content.append(footer);
    }
    render();
}
