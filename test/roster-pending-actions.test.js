const {test}=require('node:test');
const assert=require('node:assert/strict');
const rules=require('../src/generated/roster-rules.cjs');
const service=require('../src/services/roster-planning');
const reference='2026-10-19';
const dates=rules.displayedCalendarDays('2026-10','week',reference);
const employee=(extra={})=>({id:'100',name:'PESSOA DE TESTE',officialEmployeeId:'employee-a',code:'56',officialShift:'3º Turno',schedule:'20:00-00:00-01:00-06:00',shift:'3º',area:'Não definida',role:'OPERADOR',active:true,included:false,off1:'',off2:'',note:'',...extra});
const state=person=>({employees:[person],overrides:[],history:[]});
const pending=source=>rules.managementPending(source,source.employees,dates,reference);
test('folgas e jornada têm etapas distintas, com instrução acionável e sem configuração automática',()=>{
 const before=state(employee());const item=pending(before)[0];assert.equal(item.kind,'rest');assert.equal(item.buttonLabel,'Definir folgas');assert.match(item.instruction,/vigência/);assert.equal(before.employees[0].included,false);
 const withRest=state(rules.withWeeklyFolgas(before.employees[0],'Sab','Dom',reference,true));assert.equal(pending(withRest).some(item=>item.kind==='rest'),false);assert.equal(pending(withRest)[0].kind,'journey');
 const completed={...withRest,employees:rules.assignJourney(withRest.employees,new Set(['100']),rules.referenceProposal(before.employees[0],40,reference))};assert.deepEqual(pending(completed),[]);
 assert.equal(before.employees[0].off1,'');assert.equal(completed.employees[0].schedule,before.employees[0].schedule);
});
test('liderança pode ser conferida sem alterar o cargo nem desmarcar a identificação',()=>{
 const before=state(employee({role:'LÍDER DE EXPEDIÇÃO'}));assert.equal(pending(before).filter(item=>item.kind==='leadership').length,1);
 const after=state({...before.employees[0],leader:true,leadershipReviewedAt:'2026-11-13'});assert.doesNotThrow(()=>service.protect(after,before));assert.equal(pending(after).some(item=>item.kind==='leadership'),false);assert.equal(after.employees[0].role,before.employees[0].role);
 assert.equal(pending(before).filter(item=>item.kind==='leadership').length,1);
});
test('jornada reduzida não gera indicação incorreta para definir carga coletiva',()=>{
 const source=state(employee({schedule:'14:00-18:00',role:'JOVEM APRENDIZ',included:true,off1:'Sab',off2:'Dom'}));assert.equal(pending(source).some(item=>item.kind==='journey'),false);
});
test('código oficial ausente direciona ao cadastro e não a uma edição de dado protegido',()=>{
 const source=state(employee({code:''}));const item=pending(source).find(item=>item.kind==='official');assert.equal(item.buttonLabel,'Consultar cadastro no Beta');assert.match(item.instruction,/somente leitura/);
});
