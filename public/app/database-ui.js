import { sheets, validateDatabase, parseDatabase, databaseSettings, defaultDatabase, defaultFillPrompt, migrateLegacySettings } from './database.js';
import { autosizePrompt } from './prompt-autosize.js';

export function renderDatabasePanel(body, context) {
    const { el, field, action, notify, pickFile } = context;
    let data = validateDatabase(context.data), settings = databaseSettings(context.settings), tab = context.preview ? 'data' : 'settings', dataDirty = false, settingsDirty = false;
    let activeTable = '', summaryWorking = false, statusRevision = 0;
    const openedPrompts = new WeakSet();
    const promptSizes = [];
    const statusFields = ['inject','auto','messageSummaryPreset','autoUpdateFrequency','updateBatchSize','removeTags','userMessageTags','databaseSummaryPreset','databaseSummaryAuto','databaseSummaryTokens','databaseSummaryTable','databaseSummaryRows'];
    const statusValues = value => Object.fromEntries(statusFields.map(key => [key, value[key]]));
    let savedStatus = statusValues(settings), statusDirty = false, statusVersion = 0;
    const hasDraft = () => dataDirty || settingsDirty || statusDirty;
    const settingsValue = includeStatus => databaseSettings({ ...settings, ...(includeStatus ? {} : savedStatus) });
    const undo = { data: [], template: [] }, pages = new Map();
    let saveTimer, editVersion=0, saveQueue=Promise.resolve(), disposed=false;
    body._dispose = () => { disposed=true; clearTimeout(saveTimer); for(const dispose of promptSizes.splice(0))dispose(); };
    const dirty = kind => {
        if (kind === 'data') dataDirty = true;
        else if (tab === 'settings') { statusDirty = true; statusVersion++;const status=content.querySelector('.db-save-status');if(status)status.textContent='有未保存的修改'; }
        else settingsDirty = true;
        context.dirty(hasDraft());
        if(kind!=='data' && tab!=='settings') { const version=++editVersion;clearTimeout(saveTimer);saveTimer=setTimeout(()=>{let value;try{value=settingsValue(false);}catch{return;}saveQueue=saveQueue.catch(()=>{}).then(async()=>{if(disposed)return;value=databaseSettings({...value,...savedStatus});await context.saveSettings(value);savedStatus=statusValues(value);}).then(()=>{if(!disposed){if(version===editVersion)settingsDirty=false;context.dirty(hasDraft());}}).catch(error=>notify(error.message,true));},500); }
    };
    const download = (value, filename) => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
        const link = el('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const toolbarButton = (parent, label, glyph, callback, type = '') => {
        const control = action(label, callback, glyph, type); control.title = label; control.setAttribute('aria-label', label); parent.append(control); return control;
    };
    const tabs = el('nav', 'db-tabs'); tabs.setAttribute('aria-label', '数据库功能');
    const content = el('div', 'db-content');
    body.append(tabs, content);
    const render = () => {
        for(const dispose of promptSizes.splice(0))dispose();
        tabs.replaceChildren();
        for (const [key, label] of (context.preview ? [['data', '聊天数据'], ['template', '模板']] : [['settings', '状态与操作'], ['presets', 'AI 指令预设'], ['api', 'API 与连接'], ['world', '世界书参考'], ['template', '模板']])) {
            const control = action(label, () => { tab = key; render(); }); control.setAttribute('aria-pressed', String(tab === key)); tabs.append(control);
        }
        content.replaceChildren();
        content.classList.toggle('preset-panel', tab === 'presets');
        if (tab === 'data' || tab === 'template') renderTables(tab);
        else if (tab === 'presets') renderPresets(); else if(tab==='api')renderAPI();else if(tab==='world')void renderWorld();else renderSettings();
    };
    const note = text => { const node = el('p', 'note', text); content.append(node); return node; };
    const saveSettings = async () => {
        clearTimeout(saveTimer);const version=++editVersion;
        const includeStatus = tab === 'settings', savedStatusVersion = statusVersion;
        const source = content.querySelector('.db-template-json');
        if (source && source.value !== source.dataset.original) settings.template = parseDatabase(source.value);
        const active = settings.presets.find(item => item.id === settings.activePreset);
        if (active) active.template = structuredClone(settings.template);
        let value=settingsValue(includeStatus);
        let status=content.querySelector('.db-save-status');if(!status){status=el('p','db-save-status');status.setAttribute('role','status');content.append(status);}status.textContent='保存中…';status.classList.remove('error');
        const task=saveQueue.catch(()=>{}).then(async()=>{if(!includeStatus)value=databaseSettings({...value,...savedStatus});await context.saveSettings(value);savedStatus=statusValues(value);});saveQueue=task;
        try{await task;if(includeStatus&&savedStatusVersion===statusVersion)statusDirty=false;if(version===editVersion)settingsDirty=false;context.dirty(hasDraft());if(status.isConnected)status.textContent='已保存';notify('数据库设置已保存');}
        catch(error){if(status.isConnected){status.textContent=`保存失败：${error.message}`;status.classList.add('error');}throw error;}
    };
    const saveData = async () => { data = validateDatabase(data); await context.saveData(data); dataDirty = false; context.dirty(hasDraft()); notify('当前聊天数据库已保存'); render(); };
    function renderTables(kind) {
        const template = kind === 'template'; let book = template ? settings.template : data;
        const label = template ? '模板' : '数据库';
        const history = undo[kind];
        const remember = () => { history.push(structuredClone(book)); if (history.length > 20) history.shift(); undoButton.disabled = false; };
        const replace = value => { if (template) settings.template = value; else data = value; dirty(kind); render(); };
        const change = callback => { remember(); callback(); dirty(kind); render(); };
        const toolbar = el('div', 'db-toolbar'); content.append(toolbar);
        toolbar.classList.add('db-table-actions');
        toolbarButton(toolbar, `导入${label}`, 'import', async () => {
            const file = await pickFile('.json'); if (!file) return; const value = parseDatabase(await file.text());
            if (!confirm(`使用导入内容替换当前${label}草稿？保存后生效。`)) return; remember(); replace(value);
        });
        toolbarButton(toolbar, `导出${label}`, 'export', () => download(book, template ? 'database-template.json' : 'database.json'));
        const undoButton = toolbarButton(toolbar, '撤销编辑', 'history', () => { replace(history.pop()); }); undoButton.disabled = !history.length;
        const saveBar = el('div', 'db-template-save');
        toolbarButton(saveBar, template ? '保存模板' : '保存数据', 'edit', template ? saveSettings : saveData, 'primary');
        content.prepend(saveBar);
        if (template) {

            toolbarButton(toolbar,'重置模板','refresh',()=>{if(!confirm('重置当前预设模板？'))return;remember();replace({mate:{type:'chatSheets'}});});
            const raw=el('details','advanced');raw.append(el('summary','','JSON 模板'));const source=field(raw,'模板内容',JSON.stringify(book,null,2),{multiline:true,rows:12});source.classList.add('db-template-json');source.dataset.original=source.value;source.addEventListener('input',()=>{settingsDirty=true;context.dirty(true);});toolbarButton(raw,'保存 JSON 模板','edit',async()=>{const value=parseDatabase(source.value);settings.template=value;source.dataset.original=source.value;dirty('template');await saveSettings();render();});content.append(raw);
            note('模板用于初始化没有数据库的新聊天。编辑模板不会改写其他聊天的数据。');
            toolbarButton(toolbar, '应用模板到当前聊天', 'refresh', () => {
                if (!confirm('用此模板替换当前聊天数据库草稿？原快照会保留，点击保存数据后生效。')) return;
                undo.data.push(structuredClone(data)); data = validateDatabase(book); dataDirty = true; context.dirty(true); tab = context.preview ? 'data' : 'settings'; render();
            });
        } else {
            note(`${context.chatName} · ${sheets(book).length} 张表 · ${sheets(book).reduce((sum, [, table]) => sum + table.content.length - 1, 0)} 行${context.legacy ? ' · 已读取旧插件快照' : ''}`);
            const fillBar = el('div', 'db-fill-bar');
            const from = field(fillBar, '起始楼层', Math.max(0, context.chat.length - settings.batch), { type: 'number' }); from.min = 0;
            const to = field(fillBar, '结束楼层', context.chat.length - 1, { type: 'number' }); to.min = 0;
            toolbarButton(fillBar, 'AI 更新', 'refresh', async () => {
                if (dataDirty || settingsDirty) throw new Error('请先保存数据库与设置，再调用 AI。');
                context.dirty(false); await context.fill(Number(from.value), Number(to.value));
            }, 'primary');
            content.append(fillBar);
            const snapshots = context.chat.map((message, index) => ({ data: message.TavernDB_ACU_Data, label: `#${index} · ${message.extra?.independentDatabase?.stale ? '来源已修改' : message.name || '角色'}` })).filter(item => !!item.data);
            for (const item of context.history()) snapshots.push({ data: item.data, label: `#${item.index} · 覆盖前版本 · ${item.updatedAt?.replace('T', ' ').slice(0, 19) || ''}` });
            if (snapshots.length) {
                const restore = el('details', 'advanced'); restore.append(el('summary', '', `历史快照 · ${snapshots.length}`));
                const select = field(restore, '选择历史快照', snapshots.length - 1, { options: snapshots.map((item, index) => [index, item.label]).reverse() });
                toolbarButton(restore, '恢复到数据草稿', 'history', () => {
                    const value = validateDatabase(snapshots[Number(select.value)].data);
                    if (!confirm('将此历史快照恢复到当前草稿？保存前可以撤销。')) return; remember(); replace(value);
                }); content.append(restore);
            }
        }
        const create = el('details', 'advanced'); create.append(el('summary', '', '新增数据表'));
        const name = field(create, '表名', '新表'), columns = field(create, '列名（英文逗号分隔）', '名称,内容');
        toolbarButton(create, '创建数据表', 'plus', () => {
            const labels = columns.value.split(',').map(text => text.trim()).filter(Boolean); if (!labels.length) throw new Error('请填写列名。');
            change(() => { let index = 0; while (Object.hasOwn(book, `sheet_${index}`)) index++; book[`sheet_${index}`] = { name: name.value.trim() || '新表', content: [[null, ...labels]] }; });
        }); content.append(create);
        const tableTabs = el('nav', 'db-table-tabs'); content.append(tableTabs);
        const tables = sheets(book); if (!tables.some(([key]) => key === activeTable)) activeTable = tables[0]?.[0] || '';
        for (const [key, table] of tables) { const button = action(`${table.name || key} · ${Math.max(0,table.content.length-1)}`, () => { activeTable = key; render(); }); button.setAttribute('aria-pressed', String(key === activeTable)); tableTabs.append(button); }
        for (const [key, table] of tables.filter(([key]) => key === activeTable)) {
            const section = el('section', 'db-sheet'); section.setAttribute('aria-label', table.name || key);
            const heading = el('div', 'db-sheet-heading');
            const tableName = el('input'); tableName.value = table.name || key; tableName.setAttribute('aria-label', `表名 ${key}`); tableName.addEventListener('focus', remember, { once: true }); tableName.addEventListener('input', () => { table.name = tableName.value; dirty(kind); });
            heading.append(tableName, el('small', '', key));
            toolbarButton(heading, '新增行', 'plus', () => change(() => table.content.push([null, ...table.content[0].slice(1).map(() => '')])));
            toolbarButton(heading, '新增列', 'plus', () => {
                change(() => { table.content[0].push('新列'); for (const row of table.content.slice(1)) row.push(''); });
            });
            toolbarButton(heading, '删除表', 'trash', () => { if (confirm(`删除表「${table.name}」及其数据？保存后生效。`)) change(() => { delete book[key]; }); }, 'danger'); section.append(heading);
            if(template){
                const fields=el('div','db-template-fields');
                for(let column=1;column<table.content[0].length;column++){
                    const row=el('div','db-template-field');const control=field(row,`字段 ${column}`,table.content[0][column]||'');control.addEventListener('focus',remember,{once:true});control.addEventListener('input',()=>{table.content[0][column]=control.value;dirty(kind);});
                    const remove=toolbarButton(row,'删除字段','trash',()=>{if(!confirm('删除此字段及其模板内容？'))return;change(()=>{for(const dataRow of table.content)dataRow.splice(column,1);});},'danger');remove.disabled=table.content[0].length<=2;fields.append(row);
                }
                section.append(fields);content.append(section);continue;
            }
            const scroll = el('div', 'db-table-scroll'), grid = el('table'); const head = el('thead'), header = el('tr'); header.append(el('th', '', '行'));
            for (let column = 1; column < table.content[0].length; column++) {
                const cell = el('th'), input = el('input'); input.value = table.content[0][column] || ''; input.setAttribute('aria-label', `列名 ${table.name} ${column}`);
                input.addEventListener('focus', remember, { once: true }); input.addEventListener('input', () => { table.content[0][column] = input.value; dirty(kind); }); cell.append(input);
                const removeColumn = toolbarButton(cell, `删除列 ${table.content[0][column]}`, 'trash', () => { if (!confirm('删除该列及其数据？保存前可撤销。')) return; change(() => { for (const row of table.content) row.splice(column, 1); }); }, 'danger'); removeColumn.disabled = table.content[0].length <= 2; header.append(cell);
            }
            header.append(el('th', '', '操作')); head.append(header); grid.append(head);
            const tbody = el('tbody'); const pageKey = `${kind}-${key}`, rowCount = table.content.length - 1, pageCount = Math.max(1, Math.ceil(rowCount / 25));
            const page = Math.min(pages.get(pageKey) || 0, pageCount - 1); pages.set(pageKey, page);
            for (let rowIndex = page * 25; rowIndex < Math.min(rowCount, (page + 1) * 25); rowIndex++) {
                const row = el('tr'); row.append(el('td', 'db-row-number', String(rowIndex + 1)));
                for (let column = 1; column < table.content[0].length; column++) {
                    const cell = el('td'), input = el('textarea'); cell.dataset.label = table.content[0][column] || `字段 ${column}`; input.rows = 2; input.value = table.content[rowIndex + 1][column] ?? ''; input.setAttribute('aria-label', `${table.name} 第${rowIndex}行 ${table.content[0][column]}`);
                    input.addEventListener('focus', remember, { once: true }); input.addEventListener('input', () => { table.content[rowIndex + 1][column] = input.value; dirty(kind); }); cell.append(input); row.append(cell);
                }
                const tools = el('td'); toolbarButton(tools, '删除行', 'trash', () => { if (confirm(`删除第 ${rowIndex} 行？保存后生效。`)) change(() => table.content.splice(rowIndex + 1, 1)); }, 'danger'); row.append(tools); tbody.append(row);
            }
            grid.append(tbody); scroll.append(grid); section.append(scroll);
            if (!rowCount) section.append(el('p', 'note', '暂无数据，可新增行或让 AI 填表。'));
            const pager = el('div', 'db-pager');
            const previous = toolbarButton(pager, '上一页', 'up', () => { pages.set(pageKey, page - 1); render(); }); previous.disabled = page === 0;
            pager.append(el('small', '', `${page + 1} / ${pageCount} · ${rowCount} 行`));
            const next = toolbarButton(pager, '下一页', 'down', () => { pages.set(pageKey, page + 1); render(); }); next.disabled = page >= pageCount - 1; section.append(pager); content.append(section);
        }
    }
    function renderPresets() {
        const toolbar = el('div', 'connection-profile-bar preset-profile-bar db-preset-bar'), presetTools = el('div', 'connection-profile-tools');
        const select = el('select'); select.setAttribute('aria-label', '数据库填表预设');
        select.dataset.searchable = 'true'; select.dataset.searchPlaceholder = '搜索预设…'; select.dataset.searchLabel = '搜索预设';
        for (const preset of settings.presets) { const option = el('option', '', preset.name); option.value = preset.id; select.append(option); }
        select.value = settings.activePreset; toolbar.append(select, presetTools); content.append(toolbar);
        select.addEventListener('change', () => { settings.presets.find(item => item.id === settings.activePreset).template = structuredClone(settings.template); settings.activePreset = select.value; settings.template = structuredClone(settings.presets.find(item => item.id === select.value).template || defaultDatabase()); dirty('settings'); render(); });
        const preset = settings.presets.find(item => item.id === settings.activePreset);
        toolbarButton(presetTools, '新增预设', 'plus', () => { preset.template = structuredClone(settings.template); const value = { id: crypto.randomUUID(), name: '新填表预设', messages: [{ role: 'system', content: defaultFillPrompt }], template: defaultDatabase() }; settings.presets.push(value); settings.activePreset = value.id; settings.template = structuredClone(value.template); dirty('settings'); render(); });
        toolbarButton(presetTools, '复制预设', 'copy', () => { preset.template = structuredClone(settings.template); const value = { ...structuredClone(preset), id: crypto.randomUUID(), name: `${preset.name}（副本）` }; settings.presets.push(value); settings.activePreset = value.id; dirty('settings'); render(); });
        toolbarButton(presetTools, '删除预设', 'trash', () => { if (settings.presets.length < 2) throw new Error('至少保留一个填表预设。'); if (!confirm('删除当前填表预设？保存后生效。')) return; settings.presets = settings.presets.filter(item => item !== preset); settings.activePreset = settings.presets[0].id; for(const key of ['messageSummaryPreset','databaseSummaryPreset'])if(settings[key]===preset.id)settings[key]=settings.activePreset; settings.template = structuredClone(settings.presets[0].template || defaultDatabase()); dirty('settings'); render(); }, 'danger');
        toolbarButton(presetTools, '导出填表预设', 'export', () => download({ name: preset.name, prompt: preset.messages, overviewTemplate: JSON.stringify(settings.template), version: '2.0.0' }, 'database-preset.json'));
        toolbarButton(presetTools, '导入填表预设', 'import', async () => {
            const file = await pickFile('.json'); if (!file) return; const imported = JSON.parse(await file.text());
            const migrated = imported.prompt || imported.charCardPrompts ? migrateLegacySettings(imported.charCardPrompts ? imported : { charCardPrompts: [imported] }) : databaseSettings({ presets: [imported], template: imported.template || defaultDatabase() });
            preset.template = structuredClone(settings.template); const value = { ...migrated.presets[0], id: crypto.randomUUID() }; settings.presets.push(value); settings.activePreset = value.id; settings.template = structuredClone(value.template || migrated.template); dirty('settings'); render(); notify('填表预设已载入，保存后生效');
        });
        const name = field(content, '预设名称', preset.name); name.addEventListener('input', () => { preset.name = name.value; dirty('settings'); });
        const heading = el('div', 'section-heading'), title = el('div');title.append(el('h2', '', '提示词条目'), el('span', 'item-count', `${preset.messages.length} 个条目`));heading.append(title);toolbarButton(heading, '添加条目', 'plus', () => { const message={role:'user',content:''};preset.messages.push(message);openedPrompts.add(message);dirty('settings');render();content.querySelector('.prompt-item:last-child')?.scrollIntoView({block:'nearest'}); });content.append(heading);
        note('$0 为当前表格，$1 为选定楼层对话，$4 为可选世界书参考内容。');
        const rows = el('div', 'prompt-list');content.append(rows);
        preset.messages.forEach((message, index) => {
            const section = el('details', 'prompt-item');section.open=openedPrompts.has(message);section.addEventListener('toggle',()=>{if(!section.isConnected)return;if(section.open)openedPrompts.add(message);else openedPrompts.delete(message);});
            const summary=el('summary','prompt-summary'),label=el('span','prompt-title'),kind=el('small','prompt-kind',({system:'系统',user:'用户',assistant:'助手'})[message.role]);label.append(el('span','',`提示词 ${index+1}`));label.append(kind);summary.append(label);
            const anchor=el('span','prompt-action-anchor'),tools=el('span','prompt-actions prompt-inline-actions inset-action-menu');tools.hidden=true;tools.id=`db-prompt-actions-${crypto.randomUUID()}`;tools.setAttribute('role','group');tools.setAttribute('aria-label','条目操作');tools.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});
            const more=toolbarButton(anchor,`提示词 ${index+1} 的条目操作`,'more',()=>{const expand=tools.hidden;for(const menu of rows.querySelectorAll('.prompt-inline-actions'))menu.hidden=true;for(const toggle of rows.querySelectorAll('.prompt-actions-toggle'))toggle.setAttribute('aria-expanded','false');tools.hidden=!expand;more.setAttribute('aria-expanded',String(expand));},'prompt-actions-toggle');more.setAttribute('aria-expanded','false');more.setAttribute('aria-controls',tools.id);more.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});anchor.prepend(tools);summary.append(anchor);
            summary.addEventListener('keydown',event=>{if(event.key==='Escape'&&!tools.hidden){event.preventDefault();event.stopPropagation();tools.hidden=true;more.setAttribute('aria-expanded','false');more.focus();}});
            const form=el('div','prompt-form');section.append(summary,form);const role=field(form,'消息角色',message.role,{options:[['system','System · 系统'],['user','User · 用户'],['assistant','Assistant · 助手']]});role.addEventListener('change',()=>{message.role=role.value;kind.textContent=({system:'系统',user:'用户',assistant:'助手'})[message.role];dirty('settings');});
            const text = field(form, '提示词内容', message.content, { multiline: true, rows: 7 }); text.addEventListener('input', () => { message.content = text.value; dirty('settings'); });
            promptSizes.push(autosizePrompt(text));
            for (const [label, glyph, target] of [['上移', 'up', index - 1], ['下移', 'down', index + 1]]) { const button = toolbarButton(tools, label, glyph, () => { [preset.messages[index], preset.messages[target]] = [preset.messages[target], preset.messages[index]]; dirty('settings'); render(); }); button.disabled = target < 0 || target >= preset.messages.length; }
            const remove = toolbarButton(tools, '删除提示词段', 'trash', () => { preset.messages.splice(index, 1); dirty('settings'); render(); }, 'danger'); remove.disabled = preset.messages.length <= 1; rows.append(section);
        });
        const footer=el('div','editor-footer');content.append(footer);toolbarButton(footer, '保存填表预设', 'edit', saveSettings, 'primary');
    }
    function renderAPI() {
        const profileBar=el('div','connection-profile-bar'),mode=el('select');mode.setAttribute('aria-label','API 模式');for(const [value,label]of [['custom','自定义 API'],['tavern','酒馆连接预设']]){const option=el('option','',label);option.value=value;mode.append(option);}mode.value=settings.apiMode||'custom';profileBar.append(mode);content.append(profileBar);mode.addEventListener('change',()=>{settings.apiMode=mode.value;dirty('settings');render();});
        const status=el('p','db-api-status');status.setAttribute('role','status');
        const tools=el('div','db-api-actions');
        if(settings.apiMode==='tavern') {
            const options=[['','请选择连接预设'],...context.profiles.map(profile=>[profile.id,profile.name||profile.model])];
            const profile=field(content,'酒馆连接预设',settings.tavernProfile||'',{options});profile.addEventListener('change',()=>{settings.tavernProfile=profile.value;settings.profileId=profile.value;dirty('settings');});
        } else {
            const config=settings.apiConfig ||= {};
            config.useMainApi=false;
            const url=field(content,'API 基础地址',config.url||'',{type:'url'});url.addEventListener('input',()=>{config.url=url.value;dirty('settings');});
            const key=field(content,'API Key',config.apiKey||'',{type:'password'});key.autocomplete='new-password';key.addEventListener('input',()=>{config.apiKey=key.value;dirty('settings');});
            const keyWrap=el('div','key-input-wrap');key.before(keyWrap);keyWrap.append(key);
            const eye=toolbarButton(keyWrap,'显示密钥','eye',()=>{const visible=key.type==='password';key.type=visible?'text':'password';if(context.icon)eye.replaceChildren(context.icon(visible?'eyeOff':'eye'));eye.title=visible?'隐藏密钥':'显示密钥';eye.setAttribute('aria-label',eye.title);eye.setAttribute('aria-pressed',String(visible));},'key-toggle');eye.querySelector('span')?.remove();eye.setAttribute('aria-pressed','false');
            const model=field(content,'模型',config.model||'',{options:config.model?[[config.model,config.model]]:[['','读取列表或输入模型 ID']]});model.dataset.searchable='true';model.dataset.allowCustom='true';model.addEventListener('change',()=>{config.model=model.value;dirty('settings');});
            const modelRow=el('div','connection-model-row');model.before(modelRow);modelRow.append(model);
            const currentPage=()=>!disposed&&tab==='api'&&model.isConnected;
            const load=toolbarButton(modelRow,'读取模型列表','refresh',async()=>{
                load.disabled=true;status.classList.remove('error');status.textContent='正在读取模型列表…';
                try{const models=await context.models({...config});if(!currentPage())return;model.replaceChildren();if(config.model&&!models.some(([id])=>id===config.model))models.unshift([config.model,config.model]);for(const [id,label]of models){const option=el('option','',label);option.value=id;model.append(option);}model.value=config.model||models[0]?.[0]||'';config.model=model.value;dirty('settings');status.textContent=`已读取 ${models.length} 个模型，请在上方选择`;}
                catch(error){if(currentPage()){status.classList.add('error');status.textContent=`读取失败：${error.message}`;}}
                finally{if(currentPage())load.disabled=false;}
            },'model-refresh');load.querySelector('span')?.remove();
        }
        const parameters=el('div','parameter-grid');content.append(parameters);
        for(const [key,label,min,max,step] of [['maxTokens','最大回复 tokens',1,2000000,1],['temperature','Temperature',0,2,.05]]){const control=field(parameters,label,settings[key],{type:'number'});control.min=min;control.max=max;control.step=step;control.addEventListener('input',()=>{settings[key]=Number(control.value);dirty('settings');});}
        toolbarButton(tools,'保存 API 配置','plug',saveSettings,'primary');content.append(tools,status);
    }
    async function renderWorld() {
        const config=settings.worldbookConfig ||= {source:'character',manualSelection:[],enabledEntries:{}};
        const source=field(content,'世界书来源',config.source,{options:[['character','角色关联世界书'],['manual','手动选择世界书']]});source.addEventListener('change',()=>{config.source=source.value;dirty('settings');render();});
        const target=content;const books=await context.worlds(config);if(tab!=='world'||target!==content)return;
        for(const book of books){
            const section=el('details','dm-world-book'),summary=el('summary','dm-world-heading'),title=el('span','dm-world-title',book.name),tools=el('span','dm-world-tools');tools.setAttribute('role','group');tools.setAttribute('aria-label',`${book.name} 条目选择`);summary.append(title,tools);section.append(summary);
            if(config.source==='manual'){const wrap=el('label','check-field dm-world-use'),check=el('input');check.type='checkbox';check.checked=(config.manualSelection||[]).includes(book.name);wrap.append(check,el('span','','使用此世界书'));section.append(wrap);check.addEventListener('change',()=>{const selected=new Set(config.manualSelection||[]);if(check.checked)selected.add(book.name);else selected.delete(book.name);config.manualSelection=[...selected];dirty('settings');});}
            const entries=Object.entries(book.entries||{}),enabled=config.enabledEntries ||= {},list=el('div','dm-world-entries'),checks=[];
            for(const [id,entry]of entries){const uid=String(entry.uid??id),wrap=el('label','dm-world-entry'),check=el('input');check.type='checkbox';check.checked=Array.isArray(enabled[book.name])?enabled[book.name].map(String).includes(uid):!entry.disable;wrap.append(check,el('span','',entry.comment||uid));list.append(wrap);checks.push([uid,check]);check.addEventListener('change',()=>{enabled[book.name]=checks.filter(([,check])=>check.checked).map(([uid])=>uid);dirty('settings');});}
            for(const [label,selected]of [['全选',true],['全不选',false]]){const control=toolbarButton(tools,label,null,()=>{for(const [,check]of checks)check.checked=selected;enabled[book.name]=selected?checks.map(([uid])=>uid):[];dirty('settings');});control.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});}
            section.append(list);content.append(section);
        }
        toolbarButton(content,'保存世界书配置','edit',saveSettings,'primary');
    }
    function renderSettings() {
        const revision=++statusRevision;
        const current=context.latest?.();if(current)data=validateDatabase(current.data);
        const tables=sheets(data),latest=current?.index??context.chat.findLastIndex(message=>!message.is_user&&message.TavernDB_ACU_Data);
        const meta=context.chat[latest]?.extra?.independentDatabase;
        const recorded=meta?.kind==='database'?(meta.messageSummaryTo??latest):(meta?.to??latest);
        const check=(parent,label,key)=>{const wrap=el('label','check-field'),control=el('input');control.type='checkbox';control.checked=!!settings[key];control.addEventListener('change',()=>{settings[key]=control.checked;dirty('settings');});wrap.append(control,el('span','',label));parent.append(wrap);};
        const status=el('section','dm-status-card dm-summary-status'),heading=el('div','dm-summary-heading');
        heading.append(el('h2','','数据库状态'));check(heading,'注入提示词','inject');status.append(heading);
        const metrics=el('div','dm-summary-metrics');
        for(const [label,value]of [['数据表',tables.length],['记录',tables.reduce((sum,[,table])=>sum+table.content.length-1,0)],['待总结楼层',Math.max(0,context.chat.length-1-recorded)],['最新快照',latest<0?'模板 / 种子':`#${latest}`]]){const item=el('div','dm-summary-metric');item.append(el('span','note',label),el('strong','',String(value)));metrics.append(item);}
        status.append(metrics);content.append(status);
        const grid=el('div','dm-summary-grid');content.append(grid);
        const card=(title,description)=>{const section=el('section','dm-status-card dm-summary-card');section.append(el('h2','',title),el('p','note',description));grid.append(section);return section;};
        const bindPreset=(parent,label,key)=>{const control=field(parent,label,settings[key],{options:settings.presets.map(preset=>[preset.id,preset.name])});control.addEventListener('change',()=>{settings[key]=control.value;dirty('settings');});};
        const setting=(parent,key,label,type='number',min=0)=>{const control=field(parent,label,settings[key]??'',{type});if(type==='number'){control.min=min;control.step=1;}control.addEventListener('input',()=>{settings[key]=type==='number'?Number(control.value):control.value;dirty('settings');});return control;};
        const run=async callback=>{if(dataDirty)throw Error('请先保存数据');if(statusDirty||settingsDirty)throw Error('请先保存配置，再执行总结。');summaryWorking=true;render();try{await callback();}finally{summaryWorking=false;if(!disposed&&tab==='settings')render();}};
        const message=card('消息总结','将选定楼层的对话整理到数据库。楼层号从 0 开始。');
        bindPreset(message,'消息总结预设','messageSummaryPreset');check(message,'自动总结消息','auto');
        const messageConfig=el('div','dm-config-grid');message.append(messageConfig);
        setting(messageConfig,'autoUpdateFrequency','保留最新 N 层', 'number',0);
        setting(messageConfig,'updateBatchSize','每次总结楼层数','number',1);
        setting(message,'removeTags','删除标签（| 分隔）','text');setting(message,'userMessageTags','用户消息标签（| 分隔）','text');
        const range=el('div','dm-config-grid');message.append(range);
        const from=field(range,'起始楼层',Math.min(Math.max(0,recorded+1),Math.max(0,context.chat.length-1)),{type:'number'}),to=field(range,'结束楼层',Math.max(0,context.chat.length-1),{type:'number'});from.min=to.min=0;from.max=to.max=Math.max(0,context.chat.length-1);from.step=to.step=1;
        for(const control of [from,to])control.addEventListener('input',()=>context.dirty(hasDraft()));
        const messageRun=toolbarButton(message,'总结所选消息','refresh',()=>run(()=>context.fill(Number(from.value),Number(to.value))),'primary');
        const database=card('数据库总结','整理最新快照中的已有记录，合并冗余信息。两个阈值满足任意一个即触发，0 表示关闭该条件。');
        bindPreset(database,'数据库总结预设','databaseSummaryPreset');check(database,'自动总结数据库','databaseSummaryAuto');
        const tokenStatus=el('p','note','最新快照总 Token：统计中…');tokenStatus.setAttribute('role','status');database.append(tokenStatus);
        const refreshTokens=()=>{tokenStatus.textContent='最新快照总 Token：统计中…';Promise.resolve().then(()=>context.countDatabaseTokens?.()).then(count=>{if(!disposed&&tab==='settings'&&revision===statusRevision)tokenStatus.textContent=Number.isFinite(count)?`最新快照总 Token：${count}`:'最新快照总 Token：暂不可用';}).catch(error=>{if(!disposed&&tab==='settings'&&revision===statusRevision)tokenStatus.textContent=`Token 统计失败：${error.message}`;});};refreshTokens();
        setting(database,'databaseSummaryTokens','总 Token 达到');
        const tableOptions=[['','请选择数据表'],...tables.map(([key,table])=>[key,`${table.name||key} · ${table.content.length-1} 条`])];
        if(settings.databaseSummaryTable&&!tables.some(([key])=>key===settings.databaseSummaryTable))tableOptions.push([settings.databaseSummaryTable,`${settings.databaseSummaryTable}（当前不存在）`]);
        const table=field(database,'监测数据表',settings.databaseSummaryTable,{options:tableOptions});table.addEventListener('change',()=>{settings.databaseSummaryTable=table.value;dirty('settings');});
        setting(database,'databaseSummaryRows','该表记录数达到');
        database.append(el('p','note','自动检查在回复保存后执行；消息总结启用时，先完成消息总结，再检查数据库。相同快照总结完成后不重复自动触发。'));
        const databaseRun=toolbarButton(database,'总结最新数据库','refresh',()=>run(()=>context.summarize()),'primary');
        messageRun.disabled=databaseRun.disabled=summaryWorking||!!context.isUpdating?.()||!context.chat.some(message=>!message.is_user);
        const footer=el('div','editor-footer');toolbarButton(footer,'保存配置','edit',saveSettings,'primary');content.append(footer);
    }
    render();
}
