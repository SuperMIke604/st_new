import { sheets, validateDatabase, parseDatabase, databaseSettings, defaultDatabase, defaultFillPrompt, migrateLegacySettings } from './database.js';

export function renderDatabasePanel(body, context) {
    const { el, field, action, notify, pickFile } = context;
    let data = validateDatabase(context.data), settings = databaseSettings(context.settings), tab = context.preview ? 'data' : 'settings', dataDirty = false, settingsDirty = false;
    let activeTable = '';
    const undo = { data: [], template: [] }, pages = new Map();
    let saveTimer, editVersion=0, saveQueue=Promise.resolve(), disposed=false;
    body._dispose = () => { disposed=true; clearTimeout(saveTimer); };
    const dirty = kind => {
        if (kind === 'data') dataDirty = true; else settingsDirty = true; context.dirty(dataDirty || settingsDirty);
        if(kind!=='data') { const version=++editVersion;clearTimeout(saveTimer);saveTimer=setTimeout(()=>{let value;try{value=databaseSettings(settings);}catch{return;}saveQueue=saveQueue.catch(()=>{}).then(()=>{if(!disposed)return context.saveSettings(value);}).then(()=>{if(!disposed&&version===editVersion){settingsDirty=false;context.dirty(dataDirty);}}).catch(error=>notify(error.message,true));},500); }
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
        tabs.replaceChildren();
        for (const [key, label] of (context.preview ? [['data', '聊天数据'], ['template', '模板']] : [['settings', '状态与操作'], ['presets', 'AI 指令预设'], ['api', 'API 与连接'], ['world', '世界书参考'], ['template', '模板']])) {
            const control = action(label, () => { tab = key; render(); }); control.setAttribute('aria-pressed', String(tab === key)); tabs.append(control);
        }
        content.replaceChildren();
        if (tab === 'data' || tab === 'template') renderTables(tab);
        else if (tab === 'presets') renderPresets(); else if(tab==='api')renderAPI();else if(tab==='world')void renderWorld();else renderSettings();
    };
    const note = text => { const node = el('p', 'note', text); content.append(node); return node; };
    const saveSettings = async () => {
        clearTimeout(saveTimer);const version=++editVersion;
        const source = content.querySelector('.db-template-json');
        if (source && source.value !== source.dataset.original) settings.template = parseDatabase(source.value);
        const active = settings.presets.find(item => item.id === settings.activePreset);
        if (active) active.template = structuredClone(settings.template);
        const value=databaseSettings(settings);
        let status=content.querySelector('.db-save-status');if(!status){status=el('p','db-save-status');status.setAttribute('role','status');content.append(status);}status.textContent='保存中…';status.classList.remove('error');
        const task=saveQueue.catch(()=>{}).then(()=>context.saveSettings(value));saveQueue=task;
        try{await task;if(version===editVersion){settingsDirty=false;context.dirty(dataDirty);}if(status.isConnected)status.textContent='已保存';notify('数据库设置已保存');}
        catch(error){if(status.isConnected){status.textContent=`保存失败：${error.message}`;status.classList.add('error');}throw error;}
    };
    const saveData = async () => { data = validateDatabase(data); await context.saveData(data); dataDirty = false; context.dirty(settingsDirty); notify('当前聊天数据库已保存'); render(); };
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
        const toolbar = el('div', 'db-toolbar');
        const select = el('select'); select.setAttribute('aria-label', '数据库填表预设');
        for (const preset of settings.presets) { const option = el('option', '', preset.name); option.value = preset.id; select.append(option); }
        select.value = settings.activePreset; toolbar.append(select); content.append(toolbar);
        select.addEventListener('change', () => { settings.presets.find(item => item.id === settings.activePreset).template = structuredClone(settings.template); settings.activePreset = select.value; settings.template = structuredClone(settings.presets.find(item => item.id === select.value).template || defaultDatabase()); dirty('settings'); render(); });
        const preset = settings.presets.find(item => item.id === settings.activePreset);
        toolbarButton(toolbar, '新增预设', 'plus', () => { preset.template = structuredClone(settings.template); const value = { id: crypto.randomUUID(), name: '新填表预设', messages: [{ role: 'system', content: defaultFillPrompt }], template: defaultDatabase() }; settings.presets.push(value); settings.activePreset = value.id; settings.template = structuredClone(value.template); dirty('settings'); render(); });
        toolbarButton(toolbar, '复制预设', 'copy', () => { preset.template = structuredClone(settings.template); const value = { ...structuredClone(preset), id: crypto.randomUUID(), name: `${preset.name}（副本）` }; settings.presets.push(value); settings.activePreset = value.id; dirty('settings'); render(); });
        toolbarButton(toolbar, '删除预设', 'trash', () => { if (settings.presets.length < 2) throw new Error('至少保留一个填表预设。'); if (!confirm('删除当前填表预设？保存后生效。')) return; settings.presets = settings.presets.filter(item => item !== preset); settings.activePreset = settings.presets[0].id; settings.template = structuredClone(settings.presets[0].template || defaultDatabase()); dirty('settings'); render(); }, 'danger');
        toolbarButton(toolbar, '导出填表预设', 'export', () => download({ name: preset.name, prompt: preset.messages, overviewTemplate: JSON.stringify(settings.template), version: '2.0.0' }, 'database-preset.json'));
        toolbarButton(toolbar, '导入填表预设', 'import', async () => {
            const file = await pickFile('.json'); if (!file) return; const imported = JSON.parse(await file.text());
            const migrated = imported.prompt || imported.charCardPrompts ? migrateLegacySettings(imported.charCardPrompts ? imported : { charCardPrompts: [imported] }) : databaseSettings({ presets: [imported], template: imported.template || defaultDatabase() });
            preset.template = structuredClone(settings.template); const value = { ...migrated.presets[0], id: crypto.randomUUID() }; settings.presets.push(value); settings.activePreset = value.id; settings.template = structuredClone(value.template || migrated.template); dirty('settings'); render(); notify('填表预设已载入，保存后生效');
        });
        const name = field(content, '预设名称', preset.name); name.addEventListener('input', () => { preset.name = name.value; dirty('settings'); });
        note('$0 为当前表格，$1 为选定楼层对话，$4 为可选世界书参考内容。');
        preset.messages.forEach((message, index) => {
            const section = el('section', 'db-sheet'); const heading=el('div','db-prompt-heading'),tools=el('div','db-prompt-tools');section.append(heading); const role = field(heading, '消息角色', message.role, { options: [['system', '系统'], ['user', '用户'], ['assistant', '助手']] }); role.addEventListener('change', () => { message.role = role.value; dirty('settings'); });
            heading.append(tools);
            const text = field(section, '提示词内容', message.content, { multiline: true, rows: 7 }); text.addEventListener('input', () => { message.content = text.value; dirty('settings'); });
            for (const [label, glyph, target] of [['上移', 'up', index - 1], ['下移', 'down', index + 1]]) { const button = toolbarButton(tools, label, glyph, () => { [preset.messages[index], preset.messages[target]] = [preset.messages[target], preset.messages[index]]; dirty('settings'); render(); }); button.disabled = target < 0 || target >= preset.messages.length; }
            const remove = toolbarButton(tools, '删除提示词段', 'trash', () => { preset.messages.splice(index, 1); dirty('settings'); render(); }, 'danger'); remove.disabled = preset.messages.length <= 1; content.append(section);
        });
        toolbarButton(content, '新增提示词段', 'plus', () => { preset.messages.push({ role: 'user', content: '' }); dirty('settings'); render(); }); toolbarButton(content, '保存填表预设', 'edit', saveSettings, 'primary');
    }
    function renderAPI() {
        const mode=field(content,'API 模式',settings.apiMode||'custom',{options:[['custom','自定义 API'],['tavern','酒馆连接预设']]});mode.addEventListener('change',()=>{settings.apiMode=mode.value;dirty('settings');render();});
        if(settings.apiMode==='tavern') {
            const profile=field(content,'酒馆连接预设',settings.tavernProfile||'',{options:context.profiles.map(profile=>[profile.id,profile.name||profile.model])});profile.addEventListener('change',()=>{settings.tavernProfile=profile.value;settings.profileId=profile.value;dirty('settings');});
        } else {
            const config=settings.apiConfig ||= {};
            config.useMainApi=false;
            for(const [key,label,type] of [['url','API 基础地址','text'],['apiKey','API 密钥','password']]){const control=field(content,label,config[key]||'',{type});control.addEventListener('input',()=>{config[key]=control.value;dirty('settings');});}
            const model=field(content,'模型',config.model||'',{options:config.model?[[config.model,config.model]]:[['','请选择模型']]});model.dataset.searchable='true';model.dataset.allowCustom='true';model.addEventListener('change',()=>{config.model=model.value;dirty('settings');});
            const status=el('p','db-api-status');status.setAttribute('role','status');
            const load=toolbarButton(content,'读取模型列表','refresh',async()=>{
                load.disabled=true;status.classList.remove('error');status.textContent='正在读取模型列表…';
                try{const models=await context.models({...config});model.replaceChildren();if(config.model&&!models.some(([id])=>id===config.model))models.unshift([config.model,config.model]);for(const [id,label]of models){const option=el('option','',label);option.value=id;model.append(option);}model.value=config.model||models[0]?.[0]||'';config.model=model.value;dirty('settings');status.textContent=`已读取 ${models.length} 个模型，请在上方选择`;}
                catch(error){status.classList.add('error');status.textContent=`读取失败：${error.message}`;}
                finally{load.disabled=false;}
            });
            toolbarButton(content,'测试 API 连接','plug',async()=>{status.textContent='正在测试连接…';status.classList.remove('error');try{await context.models({...config});status.textContent='API 连接成功';}catch(error){status.classList.add('error');status.textContent=`连接失败：${error.message}`;}});content.append(status);
        }
        for(const [key,label] of [['maxTokens','最大 Tokens'],['temperature','温度']]){const control=field(content,label,settings[key],{type:'number'});control.addEventListener('input',()=>{settings[key]=Number(control.value);dirty('settings');});}
        toolbarButton(content,'保存 API 配置','edit',saveSettings,'primary');
    }
    async function renderWorld() {
        const config=settings.worldbookConfig ||= {source:'character',manualSelection:[],enabledEntries:{}};
        const source=field(content,'世界书来源',config.source,{options:[['character','角色关联世界书'],['manual','手动选择世界书']]});source.addEventListener('change',()=>{config.source=source.value;dirty('settings');render();});
        const target=content;const books=await context.worlds(config);if(tab!=='world'||target!==content)return;
        for(const book of books){
            const section=el('details','dm-world-book'),summary=el('summary','dm-world-heading'),title=el('span','dm-world-title',book.name),tools=el('span','dm-world-tools');summary.append(title,tools);section.append(summary);
            if(config.source==='manual'){const wrap=el('label','check-field dm-world-use'),check=el('input');check.type='checkbox';check.checked=(config.manualSelection||[]).includes(book.name);wrap.append(check,el('span','','使用此世界书'));section.append(wrap);check.addEventListener('change',()=>{const selected=new Set(config.manualSelection||[]);if(check.checked)selected.add(book.name);else selected.delete(book.name);config.manualSelection=[...selected];dirty('settings');});}
            const entries=Object.entries(book.entries||{}),enabled=config.enabledEntries ||= {},list=el('div','dm-world-entries'),checks=[];
            for(const [id,entry]of entries){const uid=String(entry.uid??id),wrap=el('label','dm-world-entry'),check=el('input');check.type='checkbox';check.checked=Array.isArray(enabled[book.name])?enabled[book.name].map(String).includes(uid):!entry.disable;wrap.append(check,el('span','',entry.comment||uid));list.append(wrap);checks.push([uid,check]);check.addEventListener('change',()=>{enabled[book.name]=checks.filter(([,check])=>check.checked).map(([uid])=>uid);dirty('settings');});}
            for(const [label,selected]of [['全选',true],['全不选',false]]){const control=toolbarButton(tools,label,null,()=>{for(const [,check]of checks)check.checked=selected;enabled[book.name]=selected?checks.map(([uid])=>uid):[];dirty('settings');});control.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});}
            section.append(list);content.append(section);
        }
        toolbarButton(content,'保存世界书配置','edit',saveSettings,'primary');
    }
    function renderSettings() {
        const grid=el('div','dm-status-grid'),status=el('section','dm-status-card'),operations=el('section','dm-status-card');
        status.append(el('h2','','数据库状态'));operations.append(el('h2','','核心操作'));grid.append(status,operations);content.append(grid);
        let recorded=0;for(let index=context.chat.length-1;index>0;index--)if(context.chat[index].TavernDB_ACU_Data){recorded=index;break;}
        status.append(el('p','',`${sheets(data).length} 张表 · ${sheets(data).reduce((count,[,table])=>count+Math.max(0,table.content.length-1),0)} 条记录`),el('p','',`上下文总层数：${Math.max(0,context.chat.length-1)}`),el('p','',`尚未记录层数：${Math.max(0,context.chat.length-1-recorded)}`));
        const from=field(operations,'起始楼层',0,{type:'number'}),to=field(operations,'结束楼层',Math.max(0,context.chat.length-1),{type:'number'});from.min=to.min=0;
        operations.append(el('p','note','楼层号从 0 开始'));
        toolbarButton(operations,'按楼层范围更新数据库','refresh',async()=>{if(dataDirty)throw Error('请先保存数据');await saveSettings();context.dirty(false);await context.fill(Number(from.value),Number(to.value));},'primary');
        const check=(label,key)=>{const wrap=el('label','check-field'),control=el('input');control.type='checkbox';control.checked=!!settings[key];control.addEventListener('change',()=>{settings[key]=control.checked;dirty('settings');});wrap.append(control,el('span','',label));operations.append(wrap);};
        check('启用自动更新','auto');check('数据整理完成后自动隐藏相关楼层','autoHideMessages');check('将当前聊天数据库注入提示词','inject');
        const config=el('section','dm-status-card');config.append(el('h2','','更新配置'));const fields=el('div','dm-config-grid');config.append(fields);content.append(config);
        for(const [key,label,type,min] of [['autoUpdateFrequency','最新 N 层不更新','number',0],['updateBatchSize','每次更新楼层数','number',1],['removeTags','自定义删除标签（| 分隔）','text'],['userMessageTags','用户消息标签（| 分隔）','text']]){
            const group=el('div','dm-config-item'),control=field(group,label,settings[key]??'',{type});if(type==='number'){control.min=min;control.step=1;}control.addEventListener('input',()=>{settings[key]=type==='number'?Number(control.value):control.value;dirty('settings');});toolbarButton(group,'保存',null,saveSettings);fields.append(group);
        }
    }
    render();
}
