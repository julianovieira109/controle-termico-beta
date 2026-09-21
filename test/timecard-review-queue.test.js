const test=require('node:test');
const assert=require('node:assert/strict');
const {buildReviewRows,reviewReason}=require('../src/importers/timecard-audit');

test('fila de revisão inclui somente REVIEW e NO_MARKINGS com motivo auditável',()=>{
  const employees=[{
    registration:'123',name:'COLABORADOR TESTE',page:7,days:[
      {date:'2026-09-14',scheduleCode:'0045',state:'NO_MARKINGS',occurrence:'Jornada Incompleta',markings:[],ignoredMarkings:[],sourceLine:20,sourceText:'14/09 SEG 0045 Jornada Incompleta',bhNegativeMinutes:0,bhPositiveMinutes:0,absenceMinutes:0},
      {date:'2026-09-15',scheduleCode:'0056',state:'REVIEW',occurrence:'Jornada parcialmente calculada | Marcação sem par desconsiderada no cálculo automático: 05:10',markings:['21:00','00:00'],ignoredMarkings:['05:10'],sourceLine:21,sourceText:'15/09 TER ...',bhNegativeMinutes:15,bhPositiveMinutes:0,absenceMinutes:0},
      {date:'2026-09-16',scheduleCode:'0046',state:'WORKED',occurrence:null,markings:['06:00','12:00','13:00','14:20'],ignoredMarkings:[],sourceLine:22,sourceText:'16/09 QUA ...'}
    ]
  }];
  const rows=buildReviewRows(employees);
  assert.equal(rows.length,2);
  assert.equal(rows[0].reasonCode,'INCOMPLETE_JOURNEY');
  assert.equal(rows[0].priority,'HIGH');
  assert.equal(rows[1].reasonCode,'UNPAIRED_MARKING');
  assert.deepEqual(rows[1].ignoredMarkings,['05:10']);
});

test('motivo NO_MARKINGS preserva a ocorrência para conferência',()=>{
  const result=reviewReason({state:'NO_MARKINGS',occurrence:'Ocorrência especial',markings:[],ignoredMarkings:[]});
  assert.equal(result.code,'NO_MARKINGS');
  assert.match(result.label,/Ocorrência especial/);
});
