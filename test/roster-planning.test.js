const {test}=require('node:test');
const assert=require('node:assert/strict');
const service=require('../src/services/roster-planning');
const rules=require('../src/generated/roster-rules.cjs');
function official(extra={}){return {id:'employee-a',registration:'000011447',full_name:'ALICE DE TESTE',status:'ATIVO',admission_date:'2026-01-01',termination_date:null,updated_at:'2026-11-13T12:00:00Z',job_title:'OPERADOR',shift_name:'1º Turno',shift_senior_code:'0046',shift_description:'08:00-12:00-13:00-17:00',...extra};}
function source(extra={}){return {id:'11447',name:'ALICE DE TESTE',code:'9999',schedule:'06:00-10:00-11:00-15:00',shift:'1º',included:true,off1:'Dom',off2:'Seg',note:'Origem conferida',active:true,role:'Cargo antigo',journeys:[{hours:40,option:1,start:'06:00',breakAfter:240,breakMinutes:60,effectiveDate:'2026-11-01'}],...extra};}
const scope={companyId:'company-a',branchId:'branch-a'};
test('leitura não inventa planejamento nem aplica listas históricas',()=>{
 const result=service.project([official()]);assert.equal(result.state.employees[0].included,false);assert.equal(result.state.employees[0].off1,'');assert.equal(result.state.employees[0].area,'Não definida');assert.equal(result.state.employees[0].fixedWednesday,false);
 assert.equal(rules.status(result.state.employees[0],new Date('2026-11-13T12:00:00'),result.state),'REV');assert.deepEqual(result.state.history,[]);
});
test('migração preserva cadastro oficial e importa somente planejamento',()=>{
 const backup={state:{employees:[source()],overrides:[{id:'11447',date:'2026-11-13',status:'A',reason:'Planejado'}],history:[{at:'2026-11-01',action:'Histórico original'}],appliedImports:['source-1']}};
 const preview=service.previewImport(backup,[official()],{},scope);const payload=service.applyImport(preview,[official()],{},false);
 const employee=payload.state.employees[0];assert.equal(employee.name,official().full_name);assert.equal(employee.role,'OPERADOR');assert.equal(employee.schedule,official().shift_description);assert.equal(employee.officialEmployeeId,'employee-a');assert.equal(employee.journeys[0].start,'06:00');assert.equal(employee.off1,'Dom');assert.equal(payload.state.overrides.length,1);assert.equal(payload.state.history[0].action,'Histórico original');assert.deepEqual(payload.state.appliedImports,['source-1']);
});
test('não localizados, nomes divergentes e matrículas ambíguas não são vinculados',()=>{
 const backup={employees:[source(),source({id:'999',name:'OUTRO'})],overrides:[],history:[]};
 const preview=service.previewImport(backup,[official({full_name:'NOME DIFERENTE'})],{},scope);assert.equal(preview.summary.matched,0);assert.equal(preview.summary.pending,2);
 const ambiguous=service.project([official(),official({id:'employee-b',registration:'11447',full_name:'OUTRO'})]);assert.equal(ambiguous.state.employees.length,0);assert.equal(ambiguous.pending.length,2);
 assert.throws(()=>service.previewImport({...backup,scope:{companyId:'other',branchId:'other'}},[official()],{},scope),/outra empresa/);
});
test('pendências são preservadas integralmente e aplicação parcial exige escolha explícita',()=>{
 const missing=source({id:'999',name:'SEM CADASTRO'}),backup={employees:[source(),missing],overrides:[],history:[]};
 const preview=service.previewImport(backup,[official()],{},scope);
 assert.throws(()=>service.applyImport(preview,[official()],{},false),/autorize explicitamente/);
 const result=service.applyImport(preview,[official()],{},true);assert.equal(result.pending[0].source.name,'SEM CADASTRO');assert.equal(result.state.employees.length,1);
 assert.throws(()=>service.previewImport(backup,[official()],result,scope),/já foi aplicado/);
});
test('readmissão ou reaproveitamento de matrícula não transfere planejamento do UUID anterior',()=>{
 const previous=service.applyImport(service.previewImport({employees:[source()],overrides:[{id:'11447',date:'2026-11-13',status:'A',reason:'Origem'}],history:[]},[official()],{},scope),[official()],{},false);
 const result=service.project([official({id:'employee-new'})],previous);assert.equal(result.state.employees[0].included,false);assert.equal(result.state.overrides.length,0);assert.equal(result.detached.length,1);
 const saved=service.serialize(result.state,previous,result);assert.equal(saved.detached[0].employee.officialEmployeeId,'employee-a');assert.equal(saved.detached[0].overrides.length,1);
 const restored=service.project([official()],saved);assert.equal(restored.state.employees[0].included,true);assert.equal(restored.state.overrides.length,1);
});
test('alterar somente matrícula do mesmo UUID preserva exceções e jornadas',()=>{
 const saved=service.applyImport(service.previewImport({employees:[source()],overrides:[{id:'11447',date:'2026-11-13',status:'F',reason:'Origem'}],history:[]},[official()],{},scope),[official()],{},false);
 const next=service.project([official({registration:'000099999'})],saved);assert.equal(next.state.employees[0].id,'99999');assert.equal(next.state.overrides[0].id,'99999');assert.equal(next.state.employees[0].journeys.length,1);
});
test('PUT rejeita alteração de campos oficiais e ausência recorrente nova',()=>{
 const current=service.project([official()]).state;
 for(const [key,value] of [['name','OUTRO'],['active',false],['role','CARGO'],['schedule','00:00'],['officialEmployeeId','other'],['fixedWednesday',true]]){
  const next=structuredClone(current);next.employees[0][key]=value;assert.throws(()=>service.protect(next,current),/somente leitura/);
 }
 const invalid=structuredClone(current);invalid.employees[0].weeklyPattern={Ter:'A'};assert.throws(()=>service.protect(invalid,current),/Ausências novas/);
 const dated=structuredClone(current);dated.overrides=[{id:'11447',date:'2026-11-13',status:'A',reason:'Ausência planejada por data'}];assert.equal(service.protect(dated,current).overrides.length,1);
});
test('regra futura mantém o passado e as exceções por data',()=>{
 const employee=source({officialEmployeeId:'employee-a'});const state={employees:[employee],overrides:[{id:'11447',date:'2026-12-07',status:'A',reason:'Exceção preservada'}],history:[]};
 const next={...state,employees:[rules.withWeeklyFolgas(employee,'Dom','Ter','2026-12-01')]};
 assert.equal(rules.status(next.employees[0],new Date('2026-11-23T12:00:00'),next),'F');assert.equal(rules.status(next.employees[0],new Date('2026-12-08T12:00:00'),next),'F');assert.equal(rules.status(next.employees[0],new Date('2026-12-07T12:00:00'),next),'A');
 assert.throws(()=>rules.withWeeklyFolgas(employee,'Dom','Dom','2026-12-01'));
});
test('quarta fixa só é aplicada ao vínculo explicitamente migrado',()=>{
 const ordinary=service.project([official({registration:'11077'})]).state.employees[0];assert.equal(ordinary.fixedWednesday,false);
 const row=official({registration:'11077',full_name:'ELIZABETY DE TESTE'}),backup={employees:[source({id:'11077',name:'ELIZABETY DE TESTE',area:'Comercial'})],overrides:[],history:[]};
 const payload=service.applyImport(service.previewImport(backup,[row],{},scope),[row],{},false);const employee=payload.state.employees[0];
 assert.equal(employee.fixedWednesday,true);assert.equal(employee.area,'Comercial');assert.equal(rules.status(employee,new Date('2026-11-18T12:00:00'),payload.state),'F');
});
test('jornadas 44/42/40 e passagem da meia-noite mantêm horas de relógio',()=>{
 for(const hours of [44,42,40]){const journey={hours,option:1,start:'22:00',breakAfter:120,breakMinutes:60,effectiveDate:'2026-11-01'};assert.equal(rules.isJourney(journey),true);const result=rules.journeyTimes(journey);assert.equal(result.daily,hours*12);assert.ok(result.labels.at(-1).includes('(+1 dia)'));}
 const week=rules.displayedCalendarDays('2026-11','week','2026-11-13');assert.equal(week.length,7);
});
test('classifica Comercial pelo turno oficial e protege coordenador/turno de referência',()=>{
 const employee=service.project([official({shift_name:'1º Turno Comercial',coordinator_id:'coordinator-a',coordinator_name:'Coordenador A',coordinator_source:'TURNO'})]).state.employees[0];
 assert.equal(employee.area,'Comercial');assert.equal(employee.shift,'Outros');assert.equal(employee.coordinatorName,'Coordenador A');
 const before={employees:[employee],overrides:[],history:[]};
 for(const key of ['officialShift','coordinatorId','coordinatorName','coordinatorSource']){const forged=structuredClone(before);forged.employees[0][key]='alterado';assert.throws(()=>service.protect(forged,before),/somente leitura/);}
 assert.notEqual(service.officialVersion([official({coordinator_id:'a'})]),service.officialVersion([official({coordinator_id:'b'})]));
});
test('separa equipes por turno, coordenador e grupo de folgas sem mesclar responsáveis',()=>{
 const first=source({coordinatorId:'a',coordinatorName:'Coordenador A'}),second=source({id:'99',name:'BOB',coordinatorId:'b',coordinatorName:'Coordenador B'}),third=source({id:'98',name:'CAROL'});
 const grouped=rules.groupRoster([first,second,third],'2026-11-13');assert.equal(grouped.length,1);assert.equal(grouped[0].groups.length,3);assert.equal(new Set(grouped[0].groups.map(g=>g.coordinatorName)).size,3);
 assert.equal(rules.sectionOf(source({area:'ADM'})),'ADM');
});
test('proposta usa entrada e intervalo reais da Senior, incluindo terceiro turno às 20h',()=>{
 const employee=source({schedule:'20:00-00:00-01:00-06:00',role:'OPERADOR'});
 assert.deepEqual(rules.referenceSchedule(employee),{start:'20:00',breakAfter:240,breakMinutes:60,daily:540});
 const proposal=rules.referenceProposal(employee,40,'2026-12-01');assert.equal(proposal.start,'20:00');assert.equal(rules.journeyTimes(proposal).labels[3],'05:00 (+1 dia)');assert.equal(employee.schedule,'20:00-00:00-01:00-06:00');
 assert.equal(rules.referenceProposal(source({schedule:'06:00-12:00-13:00-14:20'}),44,'2026-12-01').breakAfter,360);
 assert.equal(rules.referenceProposal(source({schedule:'08:00-12PRE13:30PRE18:00'}),40,'2026-12-01'),undefined);
 assert.equal(rules.referenceProposal(source({schedule:'14:00-18:00',role:'APRENDIZ'}),40,'2026-12-01'),undefined);
 assert.equal(rules.specialSchedule(source({schedule:'08:00-12:00-12:15-14:15'})),true);
});
test('regra nova de 5x2 exige duas folgas, preserva legado e permite exceção por data',()=>{
 const before={employees:[source({officialEmployeeId:'employee-a'})],overrides:[],history:[]};
 const three=structuredClone(before);three.employees[0].weeklyPattern={Sex:'F'};assert.throws(()=>service.protect(three,before),/duas folgas semanais/);
 const one=structuredClone(before);one.employees[0].weeklyPattern={Seg:'T'};assert.throws(()=>service.protect(one,before),/duas folgas semanais/);
 const legacy=structuredClone(three);assert.doesNotThrow(()=>service.protect(legacy,legacy));
 const dated=structuredClone(before);dated.overrides=[{id:'11447',date:'2026-11-13',status:'F',reason:'Exceção desta data'}];assert.equal(service.protect(dated,before).overrides.length,1);
});
