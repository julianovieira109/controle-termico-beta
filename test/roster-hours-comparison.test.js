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
test('noturno conserva referência e identifica saída no dia seguinte nas três cargas',()=>{
 const row=rules.compareSchedules([person('3',{schedule:'20:00-00:00-01:00-06:00',shift:'3º'})],date)[0];
 assert.deepEqual(row.options.map(o=>rules.journeyTimes(o.journey).labels[3]),['05:00 (+1 dia)','05:24 (+1 dia)','05:48 (+1 dia)']);
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
