const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('public/index.html','utf8');
const source=fs.readFileSync('public/js/imports-center.js','utf8');
function setup({allowed=true,fail=false}={}){
  const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,{hidden:false,textContent:'',value:'',classList:{toggle(){}},setAttribute(){}}]));
  const buttons=['point','employees','shifts'].map(tab=>({dataset:{importTab:tab},classList:{toggle(){}},setAttribute(){}}));
  const calls=[];
  const context={currentUser:{role:'RH',permissions:allowed?{'imports.manage':true}:{}},
    document:{querySelectorAll:()=>buttons},$:id=>nodes.get(id),window:{},companies:[],branches:[],toast:message=>calls.push(message),
    api:async path=>{calls.push(path);if(fail)throw Error('Sem conexão');return {companies:[{id:'c'}],branches:[{id:'b'}]};},
    preparePointImportSelectors:()=>calls.push('point'),loadPointImportHistory:async()=>calls.push('point-history'),
    preparePdfImport:async()=>calls.push('employees'),fillShiftImportCompanies:()=>calls.push('shifts'),
    loadEmployees:async()=>calls.push('load-employees'),loadDashboard:async()=>calls.push('load-dashboard')};
  vm.createContext(context);vm.runInContext(source,context);
  return {context,nodes,calls,buttons};
}
test('menu Importações usa permissão própria e abriga os três formulários sem duplicar IDs',()=>{
  assert.match(html,/data-view="imports" data-permission="imports.manage"/);
  const view=html.slice(html.indexOf('<section id="imports"'),html.indexOf('<section id="reports"'));
  for(const id of ['point-import-form','pdf-import-form','shift-import-panel'])assert.ok(view.includes(`id="${id}"`));
  const ids=[...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>id);
  assert.equal(new Set(ids).size,ids.length);
});
test('troca de abas preserva seleção e prepara cada módulo só uma vez',async()=>{
  const h=setup();
  await h.context.prepareImports();
  h.nodes.get('point-import-company').value='c';
  await h.context.setImportModule('employees');
  assert.equal(h.nodes.get('imports-point-panel').hidden,true);
  assert.equal(h.nodes.get('employee-import-area').hidden,false);
  await h.context.setImportModule('shifts');
  assert.equal(h.nodes.get('shift-import-panel').hidden,false);
  await h.context.setImportModule('point');
  assert.equal(h.nodes.get('point-import-company').value,'c');
  assert.equal(h.calls.filter(x=>x==='point').length,1);
  for(const name of ['point-history','employees','shifts'])assert.ok(h.calls.includes(name));
});
test('perfil sem imports.manage não carrega dados nem abre importadores',async()=>{
  const h=setup({allowed:false});await h.context.prepareImports();
  assert.equal(h.calls.some(x=>x.startsWith('/api/')),false);
  assert.match(h.calls[0],/não possui permissão/);
});
test('falha de carregamento permite nova tentativa sem marcar módulo como preparado',async()=>{
  const h=setup({fail:true});await h.context.prepareImports();
  assert.equal(h.nodes.get('imports-retry').hidden,false);
  assert.equal(h.nodes.get('imports-feedback').textContent,'Sem conexão');
  h.context.api=async()=>({companies:[],branches:[]});
  await h.nodes.get('imports-retry').onclick();
  assert.equal(h.nodes.get('imports-retry').hidden,true);assert.ok(h.calls.includes('point'));
});
test('importador não tenta atualizar áreas proibidas ao perfil',async()=>{
  const h=setup();await h.context.refreshImportRelatedViews();
  assert.equal(h.calls.length,0);
  h.context.currentUser.permissions['employees.view']=true;
  await h.context.refreshImportRelatedViews();assert.deepEqual(h.calls,['load-employees']);
});
