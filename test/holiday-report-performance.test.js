const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const js=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');

test('geração de relatório não força sincronização online toda vez',()=>{
  const start=js.indexOf('async function loadReportHolidaysForMonth');
  const block=js.slice(start,start+3800);
  assert.match(block,/reportHolidayCache\.has\(year\)/);
  assert.match(block,/api\/calendar\/holidays\?year=/);
  assert.match(block,/if\(cached\.length\)/);
});

test('ano novo sem cache ainda recebe sincronização inicial de segurança',()=>{
  const start=js.indexOf('async function loadReportHolidaysForMonth');
  const block=js.slice(start,start+3800);
  assert.match(block,/api\/calendar\/holiday-types/);
  assert.match(block,/api\/calendar\/holidays\/generate/);
  assert.match(block,/INITIAL_SYNC/);
});

test('atualização manual do calendário atualiza o cache usado nos relatórios',()=>{
  assert.match(js,/invalidateReportHolidayCache\(year\)/);
  assert.match(js,/reportHolidayCache\.set\(year,holidays\.map/);
});

test('ordem operacional continua feriados antes do cartão de ponto',()=>{
  const start=js.indexOf('$("report-generate").onclick=async()=>');
  const block=js.slice(start,start+3200);
  const holidays=block.indexOf('await loadReportHolidaysForMonth(month)');
  const point=block.indexOf('await applyPointDataToEmployees(month)');
  assert.ok(holidays>=0&&point>=0&&holidays<point);
});
