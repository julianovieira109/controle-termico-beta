const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function loadReader(fail=false){
  const events=[];
  const doc={numPages:2,getPage:async n=>({
    getViewport:()=>({height:800}),
    getTextContent:async options=>{assert.equal(options.disableCombineTextItems,true);return {items:[{str:'Trabalho BH -',transform:[1,0,0,1,160,640]},{str:' ',transform:[1,0,0,1,0,0]}]};},
    cleanup:()=>events.push(`cleanup${n}`)
  }),destroy:async()=>events.push('destroy')};
  const sandbox={module:{exports:{}},require:()=>({getDocument:async()=>doc})};
  vm.runInNewContext(fs.readFileSync('src/importers/senior-pdf-text.js','utf8'),sandbox);
  return {reader:sandbox.module.exports.readSeniorPdfPages,events};
}
test('leitor de coordenadas processa páginas em sequência e libera cada página',async()=>{
  const {reader,events}=loadReader();
  await reader(Buffer.from('test'),page=>{
    events.push('read');assert.equal(page.Texts.length,1);
    assert.equal(page.Texts[0].x,10);assert.equal(page.Texts[0].y,10);
    assert.equal(decodeURIComponent(page.Texts[0].R[0].T),'Trabalho BH -');
  });
  assert.deepEqual(events,['read','cleanup1','read','cleanup2','destroy']);
});
test('falha de processamento também libera a página e o documento',async()=>{
  const {reader,events}=loadReader();
  await assert.rejects(reader(Buffer.from('test'),()=>{throw Error('falha controlada');}),/falha controlada/);
  assert.deepEqual(events,['cleanup1','destroy']);
});
test('lançamentos sem batidas preservam o total Trabalho e Jornada Incompleta',()=>{
  const {parseDayLine,durationToMinutes}=require('../src/importers/timecard-reader');
  const period={start:'2026-04-01',end:'2026-09-18'};
  const worked=parseDayLine('04/04 SAB 0056 Trabalhando ||SENIOR_COLS|| W=07:00;BM=;BP=;HE=;F=;AN=;V=',period);
  assert.equal(worked.workMinutes,420);assert.equal(worked.state,'NO_MARKINGS');assert.equal(worked.eligibleForAutomaticRest,false);
  const incomplete=parseDayLine('07/07 TER 0026 Jornada Incompleta ||SENIOR_COLS|| W=;BM=;BP=;HE=;F=;AN=;V=',period);
  assert.equal(incomplete.state,'REVIEW');assert.equal(incomplete.eligibleForAutomaticRest,false);
  assert.equal(durationToMinutes('1030:12'),61812);
});
test('Folga Abonada preserva o BH negativo oficial, sem redução de 80%',()=>{
  const {parseDayLine}=require('../src/importers/timecard-reader');
  const day=parseDayLine('04/06 QUI 0026 BH (-) Folga Abonada ||SENIOR_COLS|| W=;BM=09:00;BP=;HE=;F=;AN=;V=',{start:'2026-04-01',end:'2026-09-18'});
  assert.equal(day.bhNegativeMinutes,540);assert.equal(day.bhNegativeRawMinutes,540);assert.equal(day.bhNegativeNormalized,false);
});
test('resposta HTTP sem JSON fornece status e orienta conferir histórico',async()=>{
  const source=fs.readFileSync('public/js/calendar-reports.js','utf8');
  const fn=source.slice(source.indexOf('async function sendPointImport('),source.indexOf('function renderPointImportPreview('));
  const sandbox={FormData,token:'test',$:id=>id==='point-import-file'?{files:[new Blob(['test'],{type:'application/pdf'})]}:{value:'test'},fetch:async()=>({status:502,json:async()=>{throw Error('HTML');}})};
  vm.createContext(sandbox);vm.runInContext(fn,sandbox);
  await assert.rejects(sandbox.sendPointImport('/api/imports/timecard-preview'),error=>{
    assert.match(error.message,/HTTP 502/);assert.match(error.message,/Confira o histórico/);return true;
  });
});
