const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const reports=fs.readFileSync(path.join(__dirname,"../src/routes/reports.js"),"utf8");
const dashboard=fs.readFileSync(path.join(__dirname,"../src/routes/dashboard.js"),"utf8");
const ui=fs.readFileSync(path.join(__dirname,"../public/js/calendar-reports.js"),"utf8");

test("competência é o mês em que termina o período Senior",()=>{
  const start=reports.indexOf('router.get("/point-competence"');
  const block=reports.slice(start,start+3500);
  assert.match(block,/LEFT\(i\.details->'period'->>'end',7\)=\$1/);
});
test("período cruzado permanece registrado separadamente da competência",()=>{
  assert.match(ui,/seniorCompetenceFromPeriod/);
  assert.match(ui,/pointPeriodForEmployee/);
  assert.match(ui,/Período do Cartão de Ponto Senior/);
});
test("refresh usa a competência calculada pela data final",()=>{
  const start=ui.indexOf("async function refreshReportsAfterPointImport");
  const block=ui.slice(start,start+4000);
  assert.match(block,/seniorCompetenceFromPeriod\(period\)/);
  assert.match(block,/await applyPointDataToEmployees\(importedMonth\)/);
  assert.match(block,/currentMonth!==importedMonth/);
});
test("fichas da competência correta podem ser regeneradas após nova importação",()=>{
  const start=ui.indexOf("async function refreshReportsAfterPointImport");
  const block=ui.slice(start,start+4000);
  assert.match(block,/hadGeneratedSheets/);
  assert.match(block,/report-generate/);
});
test("controle de ocorrências aplica a mesma competência Senior",()=>{
  const start=dashboard.indexOf('router.get("/occurrences"');
  const block=dashboard.slice(start,start+13000);
  assert.match(block,/LEFT\(i\.details->'period'->>'end',7\)=\$1/);
  assert.match(block,/period_start/);
  assert.match(block,/period_end/);
});
