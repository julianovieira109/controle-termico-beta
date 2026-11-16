const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../src/generated/roster-rules.cjs'),service=require('../src/services/roster-planning');
const notice={workUntil:'2026-11-29',contractEnd:'2026-12-06',settlementDate:'2026-12-16'};
const employee=(id,extra={})=>({id:String(id),officialEmployeeId:'official-'+id,name:'Pessoa '+id,shift:'1º',officialShift:'1º Turno',code:'46',schedule:'06:00-10:00-11:00-15:00',role:'LÍDER',active:true,included:true,off1:'Sab',off2:'Dom',note:'',...extra});
const state=employees=>({employees,overrides:[],history:[]});
test('aviso permite trabalho até o último dia sem confundir contrato ou acerto com disponibilidade',()=>{
 const person=employee(1,{notice});const s=state([person]);
 assert.equal(rules.availableForWork(person,new Date('2026-11-29T12:00:00')),true);
 for(const day of ['2026-11-30','2026-12-06','2026-12-16','2027-01-01']){
  assert.equal(rules.availableForWork(person,new Date(day+'T12:00:00')),false);
  assert.equal(rules.status(person,new Date(day+'T12:00:00'),s),'A');
  assert.equal(rules.compareSchedules([person],day).length,0);
  assert.equal(rules.simpleRoster(s,40,day).count,0);
 }
 assert.equal(person.dismissalDate,undefined);assert.equal(person.active,true);
});
test('após aviso a pessoa deixa de cobrir liderança mesmo se houver marcação antiga de trabalho',()=>{
 const lead=employee(1,{notice}),worker=employee(2,{role:'OPERADOR'});const s=state([lead,worker]);
 s.overrides=[{id:'1',date:'2026-11-30',status:'T',reason:'Marcação antiga'}];
 const before=rules.leaderCoverage(s,[new Date('2026-11-27T12:00:00')],'1º turno')[0];
 const after=rules.leaderCoverage(s,[new Date('2026-11-30T12:00:00')],'1º turno')[0];
 assert.equal(before.leaders,1);assert.equal(after.leaders,0);assert.equal(after.workers,1);assert.ok(after.gapMinutes>0);
});
test('função Supervisor é própria do planejamento e participa da cobertura',()=>{
 const person=employee(1,{role:'ENC. DE ARMAZEM',leader:true,leadershipLevel:'Supervisor'});
 assert.equal(rules.leadershipLabel(person),'Supervisor');assert.equal(person.role,'ENC. DE ARMAZEM');
 assert.equal(rules.leaderCoverage(state([person]),[new Date('2026-11-27T12:00:00')],'1º turno')[0].leaders,1);
});
test('coordenador e aviso são persistidos na 5x2 com identidade e cargo oficiais protegidos',()=>{
 const official={id:'official-1',registration:'1',full_name:'PESSOA 1',status:'ATIVO',admission_date:'2026-01-01',termination_date:null,job_role_name:'ENC. DE ARMAZEM',shift_name:'1º Turno',shift_senior_code:'46',shift_description:'06:00-10:00-11:00-15:00',coordinator_id:'coordinator-source',coordinator_name:'Origem'};
 const baseline=service.project([official],{}),next=structuredClone(baseline.state);
 Object.assign(next.employees[0],{leader:true,leadershipLevel:'Supervisor',planningCoordinator:{id:'planning-coordinator',name:'Responsável conferido'},notice});
 const protectedState=service.protect(next,baseline.state),stored=service.serialize(protectedState,{},baseline),reloaded=service.project([official],stored).state;
 assert.equal(reloaded.employees[0].coordinatorName,'Responsável conferido');assert.equal(reloaded.employees[0].coordinatorSource,'PLANEJAMENTO_5X2');assert.deepEqual(reloaded.employees[0].notice,notice);assert.equal(reloaded.employees[0].role,official.job_role_name);
 const cleared=structuredClone(reloaded);cleared.employees[0].planningCoordinator=null;
 const restored=service.project([official],{state:service.protect(cleared,reloaded)}).state;
 assert.equal(restored.employees[0].coordinatorName,'Origem');
 const forged=structuredClone(next);forged.employees[0].role='CARGO ALTERADO';assert.throws(()=>service.protect(forged,baseline.state),/somente leitura/);
});
test('datas inválidas, prazos fora de ordem e funções desconhecidas são recusados',()=>{
 for(const bad of [{...notice,workUntil:'2026-11-31'},{...notice,contractEnd:'2026-11-28'},{...notice,settlementDate:'2026-12-05'}])assert.equal(rules.validState(state([employee(1,{notice:bad})])),false);
 assert.equal(rules.validState(state([employee(1,{leadershipLevel:'Outro'})])),false);
 assert.equal(rules.validState(state([employee(1,{planningCoordinator:{id:'x',name:''}})])),false);
});

test('aviso encerra a cobertura noturna à meia-noite do último dia, sem prolongamento na madrugada',()=>{
 const extras={shift:'3º',officialShift:'3º Turno',schedule:'20:00-00:00-01:00-06:00',off1:'Seg',off2:'Ter'};
 const lead=employee(1,{...extras,notice}),worker=employee(2,{...extras,role:'OPERADOR'}),s=state([lead,worker]);
 const end=rules.hourlyCoverage(s,s.employees,'2026-11-29',rules.isLeader);
 const next=rules.hourlyCoverage(s,s.employees,'2026-11-30',rules.isLeader);
 assert.equal(end.checked,true);assert.equal(next.checked,true);assert.equal(next.gapMinutes,300);assert.equal(next.gapText,'01:00–06:00');
 const lone=rules.hourlyCoverage(state([lead]),[lead],'2026-11-30',rules.isLeader);assert.equal(lone.hasOperation,false);
 assert.equal(lead.schedule,'20:00-00:00-01:00-06:00');
});
