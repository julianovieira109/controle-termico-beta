const test=require('node:test');
const assert=require('node:assert/strict');
const blank=require('../public/js/blank-copy-status.js');

test('cópia manual marca folga semanal configurada',()=>{
  const employee={weekly_days_off:[0],specific_days_off:[],point_states:{'2026-08-02':'ATESTADO'}};
  assert.equal(blank.status(employee,{iso:'2026-08-02',weekDay:0}),'FOLGA / SEM JORNADA');
});

test('cópia manual marca folga específica configurada',()=>{
  const employee={weekly_days_off:[],specific_days_off:[{date:'2026-08-15',description:'Folga especial'}],point_states:{'2026-08-15':'FALTA'}};
  assert.equal(blank.status(employee,{iso:'2026-08-15',weekDay:6}),'FOLGA / SEM JORNADA');
});

test('ocorrências do ponto não aparecem na cópia manual quando não existe folga configurada',()=>{
  for(const state of ['FALTA','ATESTADO','FERIAS','DSR','LICENCA','AFASTAMENTO','SUSPENSAO']){
    const employee={weekly_days_off:[],specific_days_off:[],point_states:{'2026-08-10':state}};
    assert.equal(blank.status(employee,{iso:'2026-08-10',weekDay:1}),'');
  }
});
