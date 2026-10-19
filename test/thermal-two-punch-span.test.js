const test=require('node:test');
const assert=require('node:assert/strict');
const {parseDayLine}=require('../src/importers/timecard-reader');
const thermal=require('../public/js/thermal-schedule');
const period={start:'2026-08-19',end:'2026-10-18'};
const schedules=new Map([['0104',['09:30','12:00','13:00','17:50']]]);
function parse(date,punches,event='BH 50%'){
  return parseDayLine(`${date} SAB 0104 ${punches} ${event} ||SENIOR_COLS|| W=03:35;BM=03:45;BP=01:00;HE=;F=;AN=;V=`,period,schedules);
}
function plan(day){
  const employee={id:'one',shift_description:'09:30-12:00-13:00-17:50',point_schedules:{},point_states:{[day.date]:day.state}};
  if(day.eligibleForAutomaticRest)employee.point_schedules[day.date]=day.markings.join('-');
  return thermal.buildMonthPlan([employee],[{iso:day.date,day:Number(day.date.slice(-2))}],{usePointData:true}).get(`one|${day.date}`)||[];
}
test('05/09 e 12/09 aceitam duas batidas reais em escala de quatro sem inventar intervalo',()=>{
  for(const [date,punches,start,end] of [['05/09','07:30 12:05',450,725],['12/09','08:01 12:03',481,723]]){
    const day=parse(date,punches);
    assert.equal(day.state,'WORKED');assert.equal(day.eligibleForAutomaticRest,true);
    assert.equal(day.expectedMarkingsCount,4);assert.equal(day.incompleteAgainstSchedule,true);
    assert.deepEqual(day.markings,punches.split(' '));assert.equal(day.occurrence,'BH 50%');
    assert.equal(day.workMinutes,215);assert.equal(day.bhNegativeMinutes,225);assert.equal(day.bhPositiveMinutes,60);
    const rests=plan(day);assert.ok(rests.length>0);
    for(const rest of rests){assert.ok(rest.start>=start);assert.ok(rest.end<=end);assert.equal(rest.end-rest.start,20);}
  }
});
test('duas batidas com menos de 100 minutos não geram repouso',()=>{
  const day=parse('05/09','08:00 09:30');assert.equal(day.eligibleForAutomaticRest,true);assert.deepEqual(plan(day),[]);
});
test('par real atravessando meia-noite limita os repousos à saída registrada',()=>{
  const day=parse('05/09','22:00 02:10');const rests=plan(day);assert.ok(rests.length>0);
  for(const rest of rests){assert.ok(rest.start>=1320);assert.ok(rest.end<=1570);}
});
test('uma batida, ausência de batidas e batidas iguais não habilitam cálculo',()=>{
  for(const punches of ['07:30','','07:30 07:30']){
    const day=parse('05/09',punches);assert.equal(day.eligibleForAutomaticRest,false);assert.deepEqual(plan(day),[]);
  }
});
test('Falta e Jornada Incompleta da Senior continuam preservadas',()=>{
  for(const [event,state] of [['FALTA','FALTA'],['Jornada Incompleta','REVIEW'],['Atestado DIA TODO','ATESTADO']]){
    const day=parse('05/09','07:30 12:05',event);assert.equal(day.state,state);assert.equal(day.eligibleForAutomaticRest,false);assert.deepEqual(plan(day),[]);
  }
});
