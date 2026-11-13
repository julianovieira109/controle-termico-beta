const {test}=require('node:test');const assert=require('node:assert/strict');
const rules=require('../src/generated/roster-rules.cjs');const service=require('../src/services/roster-planning');
const day='2026-11-16';
function person(id,extra={}){return {id:String(id),officialEmployeeId:'official-'+id,name:'PESSOA '+id,code:'46',officialShift:'1º Turno',schedule:'06:00-10:00-11:00-15:00',shift:'1º',area:'Não definida',role:Number(id)<=2?'LÍDER':'OPERADOR',active:true,admissionDate:'2026-01-01',included:false,off1:'',off2:'',note:'',coordinatorId:'coord-a',coordinatorName:'COORDENADOR A',coordinatorSource:'TURNO',...extra};}
function fixture(extra={}){return {employees:Array.from({length:6},(_,i)=>person(i+1,extra)),overrides:[],history:[]};}
function generate(state,edit=x=>x){const ids=state.employees.map(e=>e.id);const config=edit(rules.operationalDefaults(state,ids,day));return rules.generateOperational(state,ids,config);}
test('gera cinco dias/duas folgas com domingo fixo, líderes por grupo e funções preservadas',()=>{
 const before=fixture(),snapshot=structuredClone(before),result=generate(before);assert.equal(result.canApply,true,JSON.stringify(result.issues));assert.equal(result.changes.length,6);assert.ok(result.changes.every(change=>change.off1==='Dom'&&change.off2!=='Dom'));assert.ok(result.groups.every(group=>group.leaders.length>0));assert.equal(result.coverage.length,28);assert.ok(result.coverage.filter(row=>row.operating).every(row=>row.people>=row.minimumPeople&&row.leaders>=row.minimumLeaders));
 for(const e of result.state.employees){assert.equal(['Seg','Ter','Qua','Qui','Sex','Sab','Dom'].filter(d=>rules.weeklyStatus(e,d,day)==='F').length,2);assert.equal(e.role,before.employees.find(p=>p.id===e.id).role);}
 assert.deepEqual(before,snapshot);assert.doesNotThrow(()=>service.protect(result.state,before));assert.deepEqual(generate(before),result);
});
test('terceiro turno mantém sábado fixo e referência da escala 56, inclusive após meia-noite',()=>{
 const before=fixture({shift:'3º',officialShift:'3º Turno',code:'56',schedule:'20:00-00:00-01:00-06:00'}),result=generate(before);assert.equal(result.canApply,true,JSON.stringify(result.issues));assert.ok(result.changes.every(change=>change.off1==='Sab'));assert.ok(result.state.employees.every(e=>e.schedule==='20:00-00:00-01:00-06:00'&&e.code==='56'));
 assert.ok(result.coverage.filter(row=>new Date(row.date+'T12:00:00Z').getUTCDay()===6).every(row=>!row.operating&&row.people===0));
});
test('grupos existentes e planejamentos futuros não são redistribuídos',()=>{
 const before=fixture();before.employees[0]=rules.withWeeklyFolgas(before.employees[0],'Dom','Seg','2026-11-01',true);before.employees[2]=rules.withWeeklyFolgas(before.employees[2],'Dom','Seg','2026-11-01',true);const future=person(10,{restRules:[{effectiveDate:'2027-01-01',off1:'Dom',off2:'Ter',included:true,pattern:{}}]});before.employees.push(future);
 const result=generate(before);for(const id of ['1','3','10'])assert.deepEqual(result.state.employees.find(e=>e.id===id),before.employees.find(e=>e.id===id));assert.ok(result.excluded.some(item=>item.id==='10'));assert.equal(result.canApply,true,JSON.stringify(result.issues));
});
test('função de uma única pessoa gera alerta, sem inventar substituição; mínimo pode ser conferido',()=>{
 const before=fixture();before.employees[2].role='EMPILHADEIRISTA';const blocked=generate(before);assert.equal(blocked.canApply,false);assert.ok(blocked.issues.some(issue=>issue.reason.includes('EMPILHADEIRISTA')));
 const acknowledged=generate(before,config=>({...config,teams:config.teams.map(team=>({...team,roles:team.roles.map(role=>({...role,minimum:role.name==='EMPILHADEIRISTA'?0:role.minimum}))}))}));assert.equal(acknowledged.canApply,true,JSON.stringify(acknowledged.issues));assert.equal(before.employees[2].included,false);
});
test('sem líderes suficientes a sugestão fica bloqueada e não troca coordenadores',()=>{
 const before=fixture();before.employees[1].role='OPERADOR';const result=generate(before);assert.equal(result.canApply,false);assert.ok(result.issues.some(issue=>/Líderes|líder/.test(issue.reason)));assert.ok(result.state.employees.every(e=>e.coordinatorId==='coord-a'));
});
test('alerta horário noturno sem líder após o retorno antecipado do intervalo',()=>{
 const before=fixture({shift:'3º',officialShift:'3º Turno',code:'56',schedule:'20:00-00:00-01:00-06:00'});for(const e of before.employees.filter(e=>e.role==='OPERADOR'))e.schedule='20:00-00:00-00:30-06:00';const result=generate(before);assert.equal(result.canApply,false);assert.ok(result.issues.some(issue=>issue.reason.includes('minutos sem o mínimo de líderes')));
});
test('coordenação distinta não empresta líderes e contratos especiais ficam preservados',()=>{
 const before=fixture();before.employees[5].coordinatorId='coord-b';before.employees[5].coordinatorName='COORDENADOR B';const apprentice=person(9,{role:'JOVEM APRENDIZ',schedule:'14:00-18:00'});before.employees.push(apprentice);const result=generate(before);assert.equal(result.canApply,false);assert.ok(result.issues.some(issue=>issue.team.includes('COORDENADOR B')&&/líder|Líder/.test(issue.reason)));assert.deepEqual(result.state.employees.find(e=>e.id==='9'),apprentice);
});
test('dados incompletos, mínimos inválidos e grupos legados sem duas folgas são explicitados',()=>{
 const before=fixture();before.employees[3].schedule='Horário a conferir';const result=generate(before);assert.equal(result.canApply,false);assert.ok(result.issues.some(issue=>issue.reason.includes('Horário incompleto')));
 const clean=fixture();const config=rules.operationalDefaults(clean,clean.employees.map(e=>e.id),day);config.teams[0].minimumLeaders=0;assert.throws(()=>rules.generateOperational(clean,clean.employees.map(e=>e.id),config),/mínimos/);
 const legacy=fixture();legacy.employees[0]={...legacy.employees[0],included:true,off1:'Dom',off2:'Seg',weeklyPattern:{Ter:'F'}};assert.equal(generate(legacy).canApply,false);assert.deepEqual(generate(legacy).state.employees[0],legacy.employees[0]);
});
test('função é conferida por horário, não apenas pela presença em algum momento do dia',()=>{
 const before=fixture();before.employees[2].schedule='08:00-12:00-13:00-17:00';const result=generate(before);assert.equal(result.canApply,false);assert.ok(result.issues.some(issue=>issue.reason.includes('minutos abaixo do mínimo na janela do cargo')));
});
