const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const js=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');

test('relatório extrai o ano exato da competência',()=>{
  assert.match(js,/const year=Number\(match\[1\]\)/);
});

test('relatório consulta primeiro os feriados já salvos',()=>{
  const start=js.indexOf('async function loadReportHolidaysForMonth');
  const block=js.slice(start,start+3600);
  const getPos=block.indexOf('`/api/calendar/holidays?year=${year}`');
  const syncPos=block.indexOf('"/api/calendar/holidays/generate"');
  assert.ok(getPos>=0);
  assert.ok(syncPos>=0);
  assert.ok(getPos<syncPos);
});

test('sincronização online só ocorre quando o ano ainda não possui cache',()=>{
  const start=js.indexOf('async function loadReportHolidaysForMonth');
  const block=js.slice(start,start+3600);
  assert.match(block,/if\(cached\.length\)/);
  assert.match(block,/DATABASE_CACHE/);
  assert.match(block,/Primeira utilização de um ano ainda não sincronizado/);
});

test('cache em memória evita nova consulta na mesma sessão',()=>{
  assert.match(js,/const reportHolidayCache=new Map\(\)/);
  assert.match(js,/reportHolidayCache\.has\(year\)/);
  assert.match(js,/MEMORY_CACHE/);
});

test('falha ao carregar feriados continua bloqueando geração',()=>{
  const start=js.indexOf('$("report-generate").onclick=async()=>');
  const block=js.slice(start,start+3000);
  assert.match(block,/await loadReportHolidaysForMonth\(month\)/);
  assert.match(block,/Não foi possível carregar os feriados da competência/);
  assert.match(block,/return;/);
});
