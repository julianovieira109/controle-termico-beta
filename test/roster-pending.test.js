const {test}=require('node:test');
const assert=require('node:assert/strict');
const service=require('../src/services/roster-planning');
const official=(id,registration,full_name)=>({id,registration,full_name,status:'ATIVO',job_title:'OPERADOR',updated_at:'2026-11-13T12:00:00Z'});
const source=(id,name)=>({id,name,active:true,included:true,code:'0046',schedule:'06:00-10:00-11:00-15:00',shift:'1º',off1:'Dom',off2:'Seg',note:'Origem preservada'});
test('pendência reconferida é aplicada ao novo vínculo explícito e removida da lista',()=>{
 const rows=[official('a','001','ALICE')],input={employees:[source('1','ALICE'),source('2','BOB')],overrides:[{id:'2',date:'2026-11-13',status:'A',reason:'Origem de Bob'}],history:[]};
 const first=service.applyImport(service.previewImport(input,rows,{},{}),rows,{},true);
 assert.equal(first.pending.length,1);
 const expanded=[...rows,official('b','002','BOB')];
 const backup={employees:first.pending.map(p=>p.source),overrides:first.pending.flatMap(p=>p.overrides),history:[]};
 const second=service.applyImport(service.previewImport(backup,expanded,first,{}),expanded,first,false);
 assert.equal(second.pending.length,0);assert.equal(second.state.employees.find(e=>e.officialEmployeeId==='b').included,true);assert.equal(second.state.overrides[0].id,'2');
});
test('vínculo desligado ou retirado da lista ativa sai automaticamente do planejamento e das pendências',()=>{
 const rows=[official('a','001','ALICE')],input={employees:[source('1','ALICE')],overrides:[],history:[]};
 const first=service.applyImport(service.previewImport(input,rows,{},{}),rows,{},false);
 const inactive=[{...rows[0],status:'DEMITIDO',termination_date:'2026-11-20'}];
 const projection=service.project(inactive,first),stored=service.serialize(projection.state,first,projection);
 assert.equal(projection.state.employees.length,0);
 assert.equal(projection.pending.length,0);
 assert.equal(stored.detached.length,1);
 const restored=service.project(rows,stored);
 assert.equal(restored.state.employees.length,1);
 assert.equal(restored.state.employees[0].included,true);
});
