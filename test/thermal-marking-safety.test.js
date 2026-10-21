const test=require('node:test');
const assert=require('node:assert/strict');
const {parseDayLine}=require('../src/importers/timecard-reader');

const period={start:'2026-10-01',end:'2026-10-31'};
const columns='||SENIOR_COLS|| W=07:20;BM=00:30;BP=01:00;HE=00:15;F=00:00;AN=00:00;V=';
function read(punches,{base=['08:00','17:00'],event='BH 50%'}={}){
  return parseDayLine(`01/10 QUI 0046 ${punches} ${event} ${columns}`,period,new Map([['0046',base]]));
}

test('batidas iguais não viram jornada de 24 horas em escala de duas, quatro ou sem escala',()=>{
  for(const base of [['08:00','17:00'],['08:00','12:00','13:00','17:00'],[]]){
    const day=read('08:00 08:00',{base});
    assert.equal(day.state,'REVIEW');
    assert.equal(day.requiresReview,true);
    assert.equal(day.eligibleForAutomaticRest,false);
    assert.deepEqual(day.reportedMarkings,['08:00','08:00']);
    assert.deepEqual(day.markings,['08:00','08:00']);
    assert.equal(day.occurrence,'BH 50%');
  }
});

test('quatro batidas com adjacências iguais, dia inteiro ou mais de uma virada exigem revisão',()=>{
  for(const punches of [
    '08:00 08:00 13:00 17:00',
    '08:00 12:00 12:00 17:00',
    '08:00 12:00 13:00 13:00',
    '08:00 12:00 13:00 08:00',
    '22:00 02:00 01:00 06:00'
  ]){
    const day=read(punches);
    assert.equal(day.state,'REVIEW',punches);
    assert.equal(day.requiresReview,true,punches);
    assert.equal(day.eligibleForAutomaticRest,false,punches);
    assert.deepEqual(day.reportedMarkings,punches.split(' '));
  }
});

test('relógio inválido permanece na origem sem promover o par restante a repouso',()=>{
  for(const punches of ['24:00 12:00','08:00 23:61','08:00 12:00 25:00']){
    const day=read(punches);
    assert.ok(day,punches);
    assert.equal(day.state,'REVIEW',punches);
    assert.equal(day.requiresReview,true,punches);
    assert.equal(day.eligibleForAutomaticRest,false,punches);
    assert.deepEqual(day.reportedMarkings,punches.split(' '));
  }
});

test('duas batidas distintas continuam elegíveis em escala de quatro marcações',()=>{
  const day=read('08:00 12:00',{base:['08:00','12:00','13:00','17:00']});
  assert.equal(day.state,'WORKED');
  assert.equal(day.eligibleForAutomaticRest,true);
  assert.deepEqual(day.markings,['08:00','12:00']);
});

test('virada noturna legítima é preservada com dois ou quatro horários reais',()=>{
  for(const punches of ['22:00 06:00','22:00 02:00 03:00 06:00']){
    const day=read(punches);
    assert.equal(day.date,'2026-10-01');
    assert.equal(day.state,'WORKED');
    assert.equal(day.eligibleForAutomaticRest,true);
    assert.deepEqual(day.markings,punches.split(' '));
  }
});

test('pares completos de marcações ímpares continuam utilizáveis sem inventar saída para a órfã',()=>{
  for(const punches of ['22:00 02:00 03:00','08:00 12:00 13:00 17:00 18:00']){
    const day=read(punches);
    const reported=punches.split(' ');
    assert.equal(day.state,'WORKED');
    assert.equal(day.eligibleForAutomaticRest,true);
    assert.deepEqual(day.reportedMarkings,reported);
    assert.deepEqual(day.markings,reported.slice(0,-1));
    assert.deepEqual(day.ignoredMarkings,[reported.at(-1)]);
    assert.match(day.occurrence,/Marcação sem par desconsiderada/);
  }
  const orphan=read('08:00');
  assert.equal(orphan.state,'REVIEW');
  assert.equal(orphan.eligibleForAutomaticRest,false);
  assert.deepEqual(orphan.markings,['08:00']);
});

test('não corta sequências longas para transformar as primeiras batidas em jornada válida',()=>{
  const reported=['01:00','02:00','03:00','04:00','05:00','06:00','07:00','08:00','09:00'];
  const day=read(reported.join(' '));
  assert.equal(day.state,'REVIEW');
  assert.equal(day.eligibleForAutomaticRest,false);
  assert.deepEqual(day.reportedMarkings,reported);
  assert.deepEqual(day.markings,reported);
  assert.equal(day.reportedMarkingsCount,reported.length);
});

test('classificação explícita da Senior prevalece mesmo quando as batidas são inválidas',()=>{
  for(const [event,state] of [['FALTA','FALTA'],['Atestado EM HORAS','ATESTADO'],['Jornada Incompleta','REVIEW']]){
    const day=read('08:00 08:00',{event});
    assert.equal(day.state,state);
    assert.equal(day.eligibleForAutomaticRest,false);
    assert.equal(day.occurrence,event);
    assert.deepEqual(day.reportedMarkings,['08:00','08:00']);
    if(state!=='REVIEW')assert.equal(day.requiresReview,false);
  }
});

test('bloqueio de marcações não altera os valores de Trabalho, BH, extras e faltas da Senior',()=>{
  const day=read('08:00 08:00');
  assert.equal(day.workMinutes,440);
  assert.equal(day.bhNegativeRawMinutes,30);
  assert.equal(day.bhNegativeMinutes,30);
  assert.equal(day.bhPositiveMinutes,60);
  assert.equal(day.he100Minutes,15);
  assert.equal(day.absenceMinutes,0);
});
