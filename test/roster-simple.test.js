const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../src/generated/roster-rules.cjs'),service=require('../src/services/roster-planning');
const date='2026-11-16';
const person=(id,extra={})=>({id:String(id),officialEmployeeId:'id-'+id,name:'Pessoa '+id,shift:'1º',officialShift:'1º Turno',code:'46',schedule:'06:00-10:00-11:00-15:00',role:id<=2?'LÍDER':'OPERADOR',coordinatorId:'a',coordinatorName:'Responsável A',active:true,included:false,off1:'',off2:'',note:'',...extra});
const fixture=()=>({employees:Array.from({length:6},(_,i)=>person(i+1)),overrides:[],history:[]});
test('simulação compõe jornada e duas folgas para cada carga sem gravar nem alterar dados oficiais',()=>{
 for(const hours of [40,42,44]){
  const before=fixture(),snapshot=structuredClone(before),result=rules.simpleRoster(before,hours,date);
  assert.equal(result.count,6);assert.equal(result.excluded.length,0);
  for(const employee of result.state.employees){assert.equal(rules.selectedJourney(employee,date).hours,hours);assert.equal(rules.weeklyStatus(employee,'Dom',date),'F');assert.equal(['Seg','Ter','Qua','Qui','Sex','Sab','Dom'].filter(day=>rules.weeklyStatus(employee,day,date)==='F').length,2);}
  assert.doesNotThrow(()=>service.protect(result.state,before));assert.deepEqual(before,snapshot);
 }
});
test('simulação preserva folgas existentes, jornadas futuras, exceções e pessoas especiais',()=>{
 const before=fixture();before.employees[0]=rules.withWeeklyFolgas(before.employees[0],'Dom','Qui','2026-01-01',true);
 before.employees[1].journeys=[{hours:40,option:1,start:'07:00',breakAfter:240,breakMinutes:60,effectiveDate:'2027-01-01'}];
 before.employees.push(person(7,{role:'APRENDIZ',schedule:'14:00-18:00'}),person(8,{schedule:'A conferir'}));
 before.overrides=[{id:'1',date,status:'A',reason:'Ausência registrada'}];
 const result=rules.simpleRoster(before,42,date);
 assert.equal(result.count,6);assert.equal(result.excluded.length,2);
 assert.deepEqual(result.state.employees[0].restRules,before.employees[0].restRules);
 assert.deepEqual(result.state.employees[1].journeys.at(-1),before.employees[1].journeys[0]);
 assert.deepEqual(result.state.employees.slice(6),before.employees.slice(6));assert.deepEqual(result.state.overrides,before.overrides);
 assert.doesNotThrow(()=>service.protect(result.state,before));
});
test('liderança sem cobertura gera avisos e mantém rascunho disponível',()=>{
 const before=fixture();for(const employee of before.employees)employee.role='OPERADOR';
 const result=rules.simpleRoster(before,40,date),alerts=rules.simpleRosterAlerts(result.state,result.ids,date);
 assert.ok(result.count>0);assert.ok(alerts.some(text=>/liderança/.test(text)));
 assert.doesNotThrow(()=>service.protect(result.state,before));
});
test('cobertura de liderança desconta o intervalo e avalia o dia seguinte',()=>{
 const before=fixture();for(const employee of before.employees){employee.shift='3º';employee.schedule=employee.role==='LÍDER'?'20:00-00:00-01:00-06:00':'20:00-00:00-00:30-06:00';}
 const result=rules.simpleRoster(before,40,date),alerts=rules.simpleRosterAlerts(result.state,result.ids,date);
 assert.ok(result.state.employees.every(e=>rules.weeklyStatus(e,'Sab',date)==='F'));
 assert.ok(alerts.some(text=>/00:30–01:00/.test(text)));
});
test('sem elegíveis não sugere jornada ou folgas e data inválida é recusada',()=>{
 const before={employees:[person(1,{schedule:'Incompleto'})],overrides:[],history:[]};
 const result=rules.simpleRoster(before,40,date);assert.equal(result.count,0);assert.deepEqual(result.state,before);
 assert.throws(()=>rules.simpleRoster(before,40,'2026-02-30'),/data válida/);
});
