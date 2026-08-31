const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const BlankCopyStatus=require('../public/js/blank-copy-status.js');

test('refeição manual marca somente folga semanal configurada',()=>{
  const employee={
    weekly_days_off:[6],
    specific_days_off:[],
    point_states:{'2026-08-01':'FALTA'}
  };
  assert.equal(BlankCopyStatus.status(employee,{iso:'2026-08-01',weekDay:6}),'FOLGA / SEM JORNADA');
});

test('refeição manual ignora falta, atestado, férias e DSR do ponto',()=>{
  const employee={
    weekly_days_off:[],
    specific_days_off:[],
    point_states:{
      '2026-08-03':'FALTA',
      '2026-08-04':'ATESTADO',
      '2026-08-05':'FERIAS',
      '2026-08-06':'DSR'
    }
  };
  for(const iso of Object.keys(employee.point_states)){
    assert.equal(BlankCopyStatus.status(employee,{iso,weekDay:1}),'');
  }
});

test('gerador de refeição usa exclusivamente BlankCopyStatus',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');
  const start=source.indexOf('function buildMealSheet');
  const end=source.indexOf('async function prepareReports',start);
  const meal=source.slice(start,end);
  assert.match(meal,/BlankCopyStatus\.status\(employee,d\)/);
  assert.doesNotMatch(meal,/point_states/);
  assert.doesNotMatch(meal,/pointLabels/);
});
