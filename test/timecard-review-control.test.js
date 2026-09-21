const test=require('node:test');
const assert=require('node:assert/strict');
const {
  normalizeReviewControlStatus,
  reviewControlStatusLabel,
  reviewControlKey,
  nextStatusWhenIssueSeen
}=require('../src/importers/timecard-review-control');

test('controle de revisão aceita somente estados operacionais editáveis pelo DP',()=>{
  assert.equal(normalizeReviewControlStatus('REVIEWED'),'REVIEWED');
  assert.equal(normalizeReviewControlStatus('PENDING_SENIOR_CORRECTION'),'PENDING_SENIOR_CORRECTION');
  assert.equal(normalizeReviewControlStatus('RESOLVED_BY_NEW_IMPORT'),null);
  assert.equal(normalizeReviewControlStatus('RESOLVED_BY_NEW_IMPORT',{allowResolved:true}),'RESOLVED_BY_NEW_IMPORT');
});

test('nova leitura reabre pendência que reapareceu e devolve correção ainda presente para Senior',()=>{
  assert.equal(nextStatusWhenIssueSeen('RESOLVED_BY_NEW_IMPORT'),'UNREVIEWED');
  assert.equal(nextStatusWhenIssueSeen('SENIOR_CORRECTED_WAITING_IMPORT'),'PENDING_SENIOR_CORRECTION');
  assert.equal(nextStatusWhenIssueSeen('REVIEWED'),'REVIEWED');
});

test('rótulos e chave de controle permanecem estáveis',()=>{
  assert.equal(reviewControlStatusLabel('PENDING_SENIOR_CORRECTION'),'Aguardando correção na Senior');
  assert.equal(reviewControlStatusLabel('RESOLVED_BY_NEW_IMPORT'),'Resolvido após nova leitura');
  assert.equal(reviewControlKey('abc','2026-09-14T00:00:00.000Z'),'abc|2026-09-14');
});

test('rota de acompanhamento nunca altera os dados do ponto',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../src/routes/imports.js'),'utf8');
  const start=source.indexOf('router.post("/timecard-review-control"');
  const end=source.indexOf('router.post("/timecard-resolve-new-hires"',start);
  assert.ok(start>=0&&end>start,'rota de acompanhamento não encontrada');
  const route=source.slice(start,end);
  assert.doesNotMatch(route,/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+employee_point_days\b/i);
  assert.match(route,/TRACKING_ONLY_NO_POINT_MUTATION/);
});
