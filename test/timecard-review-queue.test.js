const test=require('node:test');
const assert=require('node:assert/strict');
const {buildReviewRows,reviewReason,reviewRestPolicy}=require('../src/importers/timecard-audit');
const {parseDayLine}=require('../src/importers/timecard-reader');

test('fila de revisão mantém jornada incompleta e batida sem par como alta prioridade',()=>{
  const employees=[{
    registration:'123',name:'COLABORADOR TESTE',page:7,days:[
      {date:'2026-09-14',scheduleCode:'0045',state:'NO_MARKINGS',requiresReview:true,occurrence:'Jornada Incompleta',markings:[],ignoredMarkings:[],sourceLine:20,sourceText:'14/09 SEG 0045 Jornada Incompleta',bhNegativeMinutes:0,bhPositiveMinutes:0,absenceMinutes:0,eligibleForAutomaticRest:false},
      {date:'2026-09-15',scheduleCode:'0056',state:'REVIEW',requiresReview:true,occurrence:'Jornada parcialmente calculada | Marcação sem par desconsiderada no cálculo automático: 05:10',markings:['21:00','00:00'],ignoredMarkings:['05:10'],sourceLine:21,sourceText:'15/09 TER ...',bhNegativeMinutes:15,bhPositiveMinutes:0,absenceMinutes:0,eligibleForAutomaticRest:false},
      {date:'2026-09-16',scheduleCode:'0046',state:'WORKED',requiresReview:false,occurrence:null,markings:['06:00','12:00','13:00','14:20'],ignoredMarkings:[],sourceLine:22,sourceText:'16/09 QUA ...',eligibleForAutomaticRest:true}
    ]
  }];
  const rows=buildReviewRows(employees);
  assert.equal(rows.length,2);
  assert.equal(rows[0].reasonCode,'INCOMPLETE_JOURNEY');
  assert.equal(rows[0].priority,'HIGH');
  assert.equal(rows[0].automaticRestAllowed,false);
  assert.equal(rows[1].reasonCode,'UNPAIRED_MARKING');
  assert.equal(rows[1].priority,'HIGH');
  assert.deepEqual(rows[1].ignoredMarkings,['05:10']);
});

test('NO_MARKINGS com lançamento Senior deixa de ser erro de leitura e vira atenção explicada',()=>{
  const result=reviewReason({state:'NO_MARKINGS',occurrence:'BH 50%',markings:[],ignoredMarkings:[],workMinutes:314,bhPositiveMinutes:62});
  assert.equal(result.code,'SENIOR_CONSOLIDATED_NO_MARKINGS');
  assert.equal(result.priority,'MEDIUM');
  assert.equal(result.explainedBySenior,true);
  assert.match(result.label,/Lançamento Senior sem marcações completas/);
});

test('sem marcações e sem justificativa explícita continua alta prioridade',()=>{
  const result=reviewReason({state:'NO_MARKINGS',occurrence:null,markings:[],ignoredMarkings:[],workMinutes:0,bhNegativeMinutes:0,bhPositiveMinutes:0,absenceMinutes:0});
  assert.equal(result.code,'NO_MARKINGS_UNEXPLAINED');
  assert.equal(result.priority,'HIGH');
  assert.equal(result.explainedBySenior,false);
});

test('saída antecipada reconhecida pela Senior é atenção operacional e não falha do leitor',()=>{
  const result=reviewReason({state:'WORKED',requiresReview:true,explicitEarlyExit:true,occurrence:'BH (-) Saída Antecipada',markings:['06:00','12:00'],ignoredMarkings:[]});
  assert.equal(result.code,'EARLY_EXIT');
  assert.equal(result.priority,'MEDIUM');
  assert.equal(result.explainedBySenior,true);
});

test('atestado em horas é ocorrência explicada e não gera repouso sem jornada confirmada',()=>{
  const day={state:'ATESTADO',requiresReview:true,hourlyMedical:true,occurrence:'Atestado EM HORAS',markings:[],ignoredMarkings:[],eligibleForAutomaticRest:false};
  const result=reviewReason(day);
  const rest=reviewRestPolicy(day);
  assert.equal(result.code,'MEDICAL_HOURS');
  assert.equal(result.priority,'MEDIUM');
  assert.equal(result.explainedBySenior,true);
  assert.equal(rest.allowed,false);
  assert.equal(rest.code,'NO_AUTO_REST_INSUFFICIENT_MARKINGS');
});

test('repouso pode usar apenas intervalo confirmado quando a exceção ainda possui marcações suficientes',()=>{
  const rest=reviewRestPolicy({requiresReview:true,eligibleForAutomaticRest:true});
  assert.equal(rest.allowed,true);
  assert.equal(rest.code,'CONFIRMED_INTERVAL_ONLY');
});


test('reproduz Gilson 21/08: BH 50% sem batidas é lançamento Senior explicado e sem repouso automático',()=>{
  const day=parseDayLine('21/08 SEX 0120 BH 50% ||SENIOR_COLS|| W=05:14;BM=;BP=01:02;HE=;F=;AN=;V=',{start:'2026-08-19',end:'2026-09-17'},new Map([['0120',['08:00','12:00','13:00','17:00']]]));
  const reason=reviewReason(day);
  const rest=reviewRestPolicy(day);
  assert.equal(day.state,'NO_MARKINGS');
  assert.equal(day.requiresReview,true);
  assert.equal(day.workMinutes,314);
  assert.equal(day.bhPositiveMinutes,62);
  assert.equal(reason.code,'SENIOR_CONSOLIDATED_NO_MARKINGS');
  assert.equal(reason.priority,'MEDIUM');
  assert.equal(reason.explainedBySenior,true);
  assert.equal(rest.allowed,false);
});
