const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('regularização de novatos usa o leitor especializado FPRE004/PDFium',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/routes/imports.js'),'utf8');
  const start=source.indexOf('router.post("/timecard-resolve-new-hires"');
  const end=source.indexOf('router.post("/timecard-confirm"',start);
  assert.ok(start>=0,'rota timecard-resolve-new-hires não encontrada');
  const route=source.slice(start,end>start?end:undefined);
  assert.match(route,/extractSeniorMovementPdfText\(req\.file\.buffer\)/);
  assert.doesNotMatch(route,/const extraction=await extractPdfText\(req\.file\.buffer\);/);
});

test('detecção da Relação de Admitidos aceita a assinatura estável FPRE004.COL',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/routes/imports.js'),'utf8');
  const start=source.indexOf('function detectImportType(text)');
  const end=source.indexOf('function buildImportDiagnostics',start);
  assert.ok(start>=0,'detectImportType não encontrada');
  const detector=source.slice(start,end);
  assert.match(detector,/FPRE004/);
  assert.match(detector,/return "ADMITIDOS"/);
});
