const test=require('node:test');
const assert=require('node:assert/strict');
const {buildOperationalIndicators}=require('../src/importers/timecard-audit');
const {reconcileEmployeeBh}=require('../src/importers/timecard-reader');

test('Falta sem marcações vira indicador de possível ausência integral',()=>{
  const rows=buildOperationalIndicators([{registration:'1',name:'TESTE',days:[{
    date:'2026-09-10',state:'FALTA',occurrence:'FALTA',markings:[],ignoredMarkings:[],sourceLine:1,sourceText:'10/09 QUI 0046 FALTA 07:20'
  }]}]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].code,'ABSENCE_WITHOUT_MARKINGS');
  assert.equal(rows[0].priority,'MEDIUM');
  assert.match(rows[0].label,/possível ausência integral/i);
});

test('Falta com marcações vira indicador de possível intervalo incompleto sem inferir batida',()=>{
  const rows=buildOperationalIndicators([{registration:'2',name:'TESTE DOIS',days:[{
    date:'2026-09-11',state:'FALTA',occurrence:'FALTA',markings:['06:00','12:00','14:20'],ignoredMarkings:[],sourceLine:2,sourceText:'11/09 SEX 0046 06:00 12:00 14:20 FALTA'
  }]}]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].code,'ABSENCE_WITH_PARTIAL_MARKINGS');
  assert.equal(rows[0].priority,'HIGH');
  assert.deepEqual(rows[0].markings,['06:00','12:00','14:20']);
  assert.match(rows[0].label,/intervalo incompleto/i);
});

test('interjornada abaixo de 11h é somente aviso calculado pelas marcações reais',()=>{
  const rows=buildOperationalIndicators([{registration:'3',name:'TESTE TRES',days:[
    {date:'2026-09-14',state:'WORKED',requiresReview:false,markings:['14:00','18:00','19:00','22:20'],ignoredMarkings:[]},
    {date:'2026-09-15',state:'WORKED',requiresReview:false,markings:['08:00','12:00','13:00','16:00'],ignoredMarkings:[]}
  ]}]);
  const alert=rows.find(row=>row.code==='INTERJOURNEY_UNDER_11H');
  assert.ok(alert);
  assert.equal(alert.restMinutes,580); // 9h40
  assert.match(alert.guidance,/Somente aviso/i);
});

test('interjornada não é estimada quando uma jornada está incompleta',()=>{
  const rows=buildOperationalIndicators([{registration:'4',name:'TESTE QUATRO',days:[
    {date:'2026-09-14',state:'REVIEW',requiresReview:true,markings:['22:00'],ignoredMarkings:[]},
    {date:'2026-09-15',state:'WORKED',requiresReview:false,markings:['06:00','12:00','13:00','14:20'],ignoredMarkings:[]}
  ]}]);
  assert.equal(rows.filter(row=>row.code==='INTERJOURNEY_UNDER_11H').length,0);
});

test('conciliação nunca altera BH para forçar fechamento',()=>{
  const days=[{date:'2026-09-01',workMinutes:480,bhNegativeMinutes:60,bhPositiveMinutes:0,he100Minutes:0,absenceMinutes:0,bhNegativeNormalized:true,bhSource:'SENIOR_COLUMN_NORMALIZED'}];
  const before=days[0].bhNegativeMinutes;
  const result=reconcileEmployeeBh(days,{workMinutes:480,bhNegativeMinutes:70,bhPositiveMinutes:0,he100Minutes:0,absenceMinutes:0});
  assert.equal(result.status,'MISMATCH');
  assert.equal(days[0].bhNegativeMinutes,before);
  assert.deepEqual(result.adjustments,[]);
});
