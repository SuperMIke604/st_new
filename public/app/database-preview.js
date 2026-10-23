import { referencePreviewRows, referencePagination } from './database-reference.js';
export function renderDatabasePreview(body, context) {
 const {el,action,field}=context;
 let data=structuredClone(context.data), active=0,page=1,search='',diffMode=!!context.settings?.previewOnlyShowChanges,fontSize=Number(context.settings?.dpFontSize)||14;
 const awaitPreference = patch => { if(context.savePreferences)void context.savePreferences(patch).catch(error=>context.notify?.(error.message,true)); };
 const undo=[];
 const tables=()=>Object.entries(data).filter(([key,value])=>key.startsWith('sheet_')&&Array.isArray(value.content)).map(([key,value])=>({key,name:value.name,headers:value.content[0],rows:value.content.slice(1)}));
 const commit=async change=>{const previous=structuredClone(data);change();try{await context.saveData(data);undo.push(previous);render();context.dirty?.(false);}catch(error){data=previous;throw error;}};
 const button=(parent,label,callback,glyph)=>{const control=action(label,callback,glyph);control.title=label;parent.append(control);return control;};
 const render=()=>{
  const scrollTop=body.scrollTop, oldGrid=body.querySelector('.reference-preview-grid'), gridLeft=oldGrid?.scrollLeft||0, oldTabs=body.querySelector('.db-table-tabs'), tabsLeft=oldTabs?.scrollLeft||0;
  body.replaceChildren();const all=tables();active=Math.min(active,Math.max(0,all.length-1));const table=all[active];
  const tabs=el('nav','db-table-tabs');all.forEach((item,index)=>{const control=button(tabs,item.name,()=>{active=index;page=1;render();});control.setAttribute('aria-pressed',String(index===active));});body.append(tabs);
  if(!table){body.append(el('p','note','没有聊天数据库数据'));return;}
  const controls=el('div','reference-preview-toolbar');
  const toggle=el('label','check-field'),check=el('input');check.type='checkbox';check.checked=diffMode;check.addEventListener('change',()=>{diffMode=check.checked;awaitPreference({previewOnlyShowChanges:diffMode});page=1;render();});toggle.append(check,el('span','','仅显示变化'));controls.append(toggle);
  button(controls,'字体大小',()=>{const value=prompt('字体大小',String(fontSize));if(value===null)return;const size=Number(value);if(!Number.isFinite(size)||size<10||size>30)throw Error('请输入 10–30 的字号');fontSize=size;awaitPreference({dpFontSize:size});render();},'tools');
  const undoButton=button(controls,'撤销',async()=>{const previous=undo.at(-1);if(!previous)return;await context.saveData(previous);data=undo.pop();render();context.dirty?.(false);},'history');undoButton.disabled=!undo.length;body.append(controls);
  const rows=referencePreviewRows(table,{search,diffMode,previousData:context.previousData});const pages=Math.max(1,Math.ceil(rows.length/20));page=Math.min(page,pages);
  body.append(el('p','note',`${table.name} · 楼层 ${context.index} · ${(page-1)*20+1}–${Math.min(page*20,rows.length)} / 共 ${rows.length} 项`));
  const grid=el('div','reference-preview-grid');grid.style.fontSize=`${fontSize}px`;
  for(const item of rows.slice((page-1)*20,page*20)){
   const card=el('article',`reference-preview-card ${item.diffType}`);
   const head=el('header','reference-card-head');head.append(el('small','',`#${item.realIndex+1}`),el('strong','',String(item.row.slice(1).find(value=>value&&String(value).trim()) || item.row[0] || `条目 ${item.realIndex+1}`)));
   if(item.diffType)head.append(el('span',`reference-diff-badge ${item.diffType}`,({added:'新增',deleted:'删除',modified:'修改'})[item.diffType]));card.append(head);
   for(let column=1;column<table.headers.length;column++){
    const cell=el('div','reference-preview-cell');if(item.changedCols[column])cell.classList.add('modified');cell.append(el('small','',String(table.headers[column]||`字段 ${column}`)));
    const editCell=()=>{if(item.diffType==='deleted'||cell.querySelector('.reference-cell-editor'))return;const editor=el('section','reference-cell-editor');cell.classList.add('is-editing');const input=field(editor,'编辑内容',item.row[column]??'',{multiline:true,rows:7});input.setAttribute('aria-label',`编辑 ${table.headers[column]||column}`);input.dataset.savedValue=String(item.row[column]??'');input.addEventListener('input',()=>context.dirty?.([...body.querySelectorAll('.reference-cell-editor textarea')].some(control=>control.value!==control.dataset.savedValue)));const actions=el('div','reference-editor-actions');editor.append(actions);button(actions,'保存',async()=>{await commit(()=>{data[table.key].content[item.realIndex+1][column]=input.value;});});button(actions,'取消',()=>{editor.remove();cell.classList.remove('is-editing');context.dirty?.([...body.querySelectorAll('.reference-cell-editor textarea')].some(control=>control.value!==control.dataset.savedValue));});cell.append(editor);input.focus();}; const text=el('div','reference-cell-value',String(item.row[column]??'')||'空');cell.append(text);if(item.diffType!=='deleted'){cell.tabIndex=0;cell.setAttribute('role','button');cell.setAttribute('aria-label',`编辑 ${table.headers[column]||column}`);cell.addEventListener('click',event=>{if(!event.target.closest('.reference-cell-editor'))editCell();});cell.addEventListener('keydown',event=>{if(event.target===cell&&(event.key==='Enter'||event.key===' ')){event.preventDefault();editCell();}});}card.append(cell);
   }
   if(item.diffType!=='deleted'){const remove=button(head,'删除整行',async()=>{if(!confirm(`删除第 ${item.realIndex+1} 行？`))return;await commit(()=>data[table.key].content.splice(item.realIndex+1,1));},'trash');remove.classList.add('reference-delete');remove.setAttribute('aria-label','删除整行');}grid.append(card);
  }
  if(!rows.length)grid.append(el('p','note','没有匹配的数据'));body.append(grid);
  const pager=el('div','db-pager');for(const number of referencePagination(page,pages)){if(number==='...'){pager.append(el('span','','…'));continue;}const control=button(pager,String(number),()=>{page=number;render();});control.disabled=number===page;}body.append(pager);
  body.scrollTop=scrollTop;grid.scrollLeft=gridLeft;tabs.scrollLeft=tabsLeft;
 };
 render();
}
