const test=require('node:test');
const assert=require('node:assert/strict');
const rules=require('../src/generated/roster-rules.cjs');
const person=(id,extra={})=>({id,name:'Pessoa '+id,code:'46',schedule:'06:00-10:00-11:00-15:00',shift:'1º',officialShift:'1º Turno',coordinatorId:'leader-a',coordinatorName:'Responsável A',role:'OPERADOR',active:true,included:false,off1:'',off2:'',note:'',...extra});
const date='2026-11-16';
test('compara 40/42/44 por pessoa mantendo entrada, intervalo, turno e vínculo sem mutações',()=>{
 const employees=[person('1'),person('2')],before=structuredClone(employees);
 const rows=rules.compareSchedules(employees,date);
 assert.equal(rows.length,2);
 for(const row of rows){
  assert.deepEqual(row.options.map(o=>o.hours),[40,42,44]);
  assert.deepEqual(row.options.map(o=>rules.journeyTimes(o.journey).daily),[480,504,528]);
  assert.deepEqual(row.options.map(o=>rules.journeyTimes(o.journey).labels),[
   ['06:00','10:00','11:00','15:00'],['06:00','10:00','11:00','15:24'],['06:00','10:00','11:00','15:48']]);
  assert.equal(row.employee.coordinatorId,'leader-a');
 }
 assert.deepEqual(employees,before);
});
test('escala 0056 aplica a hora noturna reduzida nas três cargas',()=>{
 const row=rules.compareSchedules([person('3',{code:'56',schedule:'22:00-00:00-01:00-06:00',shift:'3º',officialShift:'3º Turno'})],date)[0];
 assert.deepEqual(row.options.map(o=>rules.journeyTimes(o.journey).labels),[
  ['22:00','00:00','01:00','06:09'],['22:00','00:00','01:00','06:33'],['22:00','00:00','01:00','06:57']
 ]);
 assert.ok(row.options.every(o=>o.journey.nightReduced===true));
});
test('dados incompletos e jornadas especiais não bloqueiam sugestões dos demais',()=>{
 const rows=rules.compareSchedules([person('1'),person('2',{schedule:'Não informado'}),person('3',{role:'APRENDIZ',schedule:'14:00-18:00'})],date);
 assert.ok(rows[0].options.every(o=>o.journey));
 assert.ok(rows[1].options.every(o=>!o.journey&&/incompleto/.test(o.text)));
 assert.ok(rows[2].options.every(o=>!o.journey&&/individual/.test(o.text)));
});
test('respeita vínculo na data, valida data e exporta três opções com texto protegido',()=>{
 assert.throws(()=>rules.compareSchedules([], '2026-02-30'),/data válida/);
 const rows=rules.compareSchedules([person('1',{name:'=formula;"nome"'}),person('2',{admissionDate:'2027-01-01'})],date);
 assert.equal(rows.length,1);
 const csv=rules.comparisonCsv(rows,date);
 assert.equal(csv.split('\r\n').length,4);
 assert.ok(csv.includes("'=formula;\"\"nome\"\""));
 for(const hours of [40,42,44])assert.ok(csv.includes('"'+hours+'h"'));
 assert.ok(csv.includes('Responsável A'));
 assert.ok(csv.includes('SEM APLICAÇÃO'));
});

test('aplica cada uma das três cargas em todos os turnos mantendo referências individuais e dados oficiais',()=>{
 const service=require('../src/services/roster-planning');
 const employees=[person('1'),person('2',{schedule:'14:00-18:00-19:00-23:00',shift:'2º'}),person('3',{schedule:'20:00-00:00-01:00-06:00',shift:'3º'})];
 for(const hours of [40,42,44]){
  const state={employees:structuredClone(employees),overrides:[],history:[]},before=structuredClone(state);
  const result=rules.applyComparisonHours(state,hours,date);
  assert.equal(result.count,3);assert.equal(result.excluded.length,0);
  assert.deepEqual(result.state.employees.map(e=>rules.selectedJourney(e,date).start),['06:00','14:00','20:00']);
  for(const e of result.state.employees)assert.equal(rules.selectedJourney(e,date).hours,hours);
  assert.doesNotThrow(()=>service.protect(result.state,state));
  assert.deepEqual(state,before);
  for(let i=0;i<employees.length;i++){
   const {journeys,...other}=result.state.employees[i];assert.deepEqual(other,employees[i]);
  }
 }
});
test('aplicação preserva jornadas de outras vigências, exceções e pessoas não elegíveis',()=>{
 const prior={hours:40,option:1,start:'06:00',breakAfter:240,breakMinutes:60,effectiveDate:'2026-01-01'};
 const same={...prior,effectiveDate:date},future={...prior,effectiveDate:'2027-01-01'};
 const state={employees:[person('1',{journeys:[prior,same,future]}),person('2',{schedule:'Não informado'}),person('3',{role:'APRENDIZ',schedule:'14:00-18:00'}),person('4',{admissionDate:'2027-01-01'})],overrides:[{id:'1',date,status:'F',reason:'Exceção'}],history:[]};
 const before=structuredClone(state),result=rules.applyComparisonHours(state,44,date);
 assert.equal(result.count,1);assert.equal(result.excluded.length,2);
 assert.equal(result.state.employees[0].journeys.length,3);
 assert.equal(rules.selectedJourney(result.state.employees[0],date).hours,44);
 assert.deepEqual(result.state.employees[0].journeys[0],prior);
 assert.deepEqual(result.state.employees[0].journeys[2],future);
 assert.deepEqual(result.state.employees.slice(1),before.employees.slice(1));
 assert.deepEqual(result.state.overrides,before.overrides);
 assert.deepEqual(state,before);
 assert.throws(()=>rules.applyComparisonHours(state,36,date),/Escolha uma jornada/);
 assert.throws(()=>rules.applyComparisonHours(state,40,'2026-02-30'),/data válida/);
});
test('EC 141 limita opções pela vigência e remove jornada futura obsoleta baseada em referência antiga',()=>{
 assert.equal(rules.legalWeeklyLimit('2026-12-15'),44);
 assert.equal(rules.legalWeeklyLimit('2026-12-16'),42);
 assert.equal(rules.legalWeeklyLimit('2027-12-16'),40);
 assert.throws(()=>rules.applyComparisonHours({employees:[person('1')],overrides:[],history:[]},44,'2026-12-16'),/no máximo 42h/);
 const oldFuture={hours:40,option:1,start:'20:00',breakAfter:240,breakMinutes:60,effectiveDate:'2026-12-31'};
 const state={employees:[person('56',{code:'56',schedule:'22:00-00:00-01:00-06:00',shift:'3º',journeys:[oldFuture]})],overrides:[],history:[]};
 const result=rules.applyComparisonHours(state,40,'2026-11-23');
 assert.equal(result.state.employees[0].journeys.some(j=>j.effectiveDate==='2026-12-31'),false);
 assert.equal(rules.selectedJourney(result.state.employees[0],'2026-11-23').start,'22:00');
 assert.equal(rules.journeyTimes(rules.selectedJourney(result.state.employees[0],'2026-11-23')).labels[3],'06:09');
});
test('sem elegíveis não produz alterações para aplicação coletiva',()=>{
 const state={employees:[person('1',{schedule:'Não informado'})],overrides:[],history:[]};
 const result=rules.applyComparisonHours(state,40,date);
 assert.equal(result.count,0);assert.deepEqual(result.state,state);
});
