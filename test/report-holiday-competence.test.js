const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('relatório carrega feriados pelo ano exato da competência',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');
  assert.match(js,/async function loadReportHolidaysForMonth\(month\)/);
  assert.match(js,/const year=Number\(match\[1\]\)/);
  assert.match(js,/body:JSON\.stringify\(\{year\}\)/);
  assert.match(js,/holidays=Array\.isArray\(result\.holidays\)\?result\.holidays:\[\]/);
});

test('geração do relatório sincroniza feriados antes do cartão de ponto',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');
  const start=js.indexOf('$("report-generate").onclick=async()=>');
  const block=js.slice(start,start+2200);
  const holidayPos=block.indexOf('await loadReportHolidaysForMonth(month)');
  const pointPos=block.indexOf('await applyPointDataToEmployees(month)');
  assert.ok(holidayPos>=0,'sincronização de feriados ausente');
  assert.ok(pointPos>=0,'consulta do ponto ausente');
  assert.ok(holidayPos<pointPos,'feriados devem carregar antes do ponto e da geração');
});

test('prepareReports não usa mais feriados sem ano definido',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');
  const start=js.indexOf('async function prepareReports(){');
  const block=js.slice(start,start+1200);
  assert.doesNotMatch(block,/api\("\/api\/calendar\/holidays"\)/);
});

test('falha ao sincronizar feriados bloqueia geração antes de montar ficha',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');
  const start=js.indexOf('$("report-generate").onclick=async()=>');
  const block=js.slice(start,start+2200);
  assert.match(block,/Não foi possível atualizar os feriados da competência/);
  assert.match(block,/return;/);
});
