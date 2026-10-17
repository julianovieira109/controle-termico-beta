const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/admin-access.js','utf8');
const loader=source.slice(source.indexOf('async function loadDashboard(){'),source.indexOf('// Disponibiliza um ponto de entrada'));

function harness({api,operations,alerts}){
  const loading=[],errors=[],nodes=new Map();
  const context={
    api,loadDashboardOperations:operations,loadDashboardAlerts:alerts,
    dashboardAlertMonthValue:()=> '2026-09',setDashboardLoading:value=>loading.push(value),
    showDashboardLoadError:message=>errors.push(message),renderDashboardGraphs(){},
    currentUser:{name:'Teste'},console:{error(){},warn(){}},
    setTimeout:callback=>{callback();},
    $:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'—',classList:{toggle(){}}});return nodes.get(id);}
  };
  vm.createContext(context);vm.runInContext(loader,context);
  return {context,loading,errors,nodes};
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}

test('painel aguarda operações e alertas antes de encerrar carregamento',async()=>{
  const operations=deferred(),alerts=deferred();
  const h=harness({api:async()=>({employees:7}),operations:()=>operations.promise,alerts:()=>alerts.promise});
  const result=h.context.loadDashboard();
  await Promise.resolve();assert.deepEqual(h.loading,[true]);
  operations.resolve();await Promise.resolve();assert.deepEqual(h.loading,[true]);
  alerts.resolve();assert.equal((await result).partial,false);
  assert.deepEqual(h.loading,[true,false]);assert.equal(h.nodes.get('sum-employees').textContent,7);
});

test('painel repete resumo após falha transitória com URL sem cache',async()=>{
  const urls=[];
  const h=harness({api:async url=>{urls.push(url);if(urls.length===1)throw Error('transitório');return {employees:4};},operations:async()=>{},alerts:async()=>{}});
  assert.equal((await h.context.loadDashboard()).partial,false);
  assert.equal(urls.length,2);assert.ok(urls.every(url=>/^\/api\/dashboard\/summary\?_=[0-9]+$/.test(url)));
  assert.equal(h.nodes.get('sum-employees').textContent,4);
});

test('falha no resumo não impede consultas de operações e alertas',async()=>{
  let operations=0,alerts=0;
  const h=harness({api:async()=>{throw Error('resumo indisponível');},operations:async()=>{operations++;},alerts:async()=>{alerts++;}});
  assert.equal((await h.context.loadDashboard()).partial,true);
  assert.equal(operations,1);assert.equal(alerts,1);assert.deepEqual(h.errors,[]);
  assert.deepEqual(h.loading,[true,false]);
});

test('painel apresenta erro recuperável quando todas as consultas falham',async()=>{
  const fail=async()=>{throw Error('sem conexão');};
  const h=harness({api:fail,operations:fail,alerts:fail});
  assert.equal((await h.context.loadDashboard()).partial,true);
  assert.deepEqual(h.errors,['sem conexão']);assert.deepEqual(h.loading,[true,false]);
});
