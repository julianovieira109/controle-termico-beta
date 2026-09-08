const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const reports=fs.readFileSync(path.join(__dirname,"../src/routes/reports.js"),"utf8");
const dashboard=fs.readFileSync(path.join(__dirname,"../src/routes/dashboard.js"),"utf8");
const ui=fs.readFileSync(path.join(__dirname,"../public/js/calendar-reports.js"),"utf8");

test("cartões Senior são reconhecidos por sobreposição com a competência mensal",()=>{
  const start=reports.indexOf('router.get("/point-competence"');
  const block=reports.slice(start,start+3500);
  assert.match(block,/period'->>'start'\)::date < \(\$1::date \+ INTERVAL '1 month'\)/);
  assert.match(block,/period'->>'end'\)::date >= \(\$1::date - INTERVAL '1 day'\)/);
  assert.doesNotMatch(block,/LEFT\(i\.details->'period'->>'end',7\)=\$1/);
});

test("período cruzado pode cobrir mais de uma competência",()=>{
  assert.match(ui,/function monthsCoveredByPeriod\(period\)/);
  assert.match(ui,/coveredMonths\.includes\(currentMonth\)/);
});

test("refresh recarrega a competência atualmente aberta quando ela é coberta pelo cartão",()=>{
  const start=ui.indexOf("async function refreshReportsAfterPointImport");
  const block=ui.slice(start,start+4000);
  assert.match(block,/monthsCoveredByPeriod\(period\)/);
  assert.match(block,/await applyPointDataToEmployees\(currentMonth\)/);
  assert.match(block,/!coveredMonths\.includes\(currentMonth\)/);
});

test("fichas abertas podem ser regeneradas após nova importação",()=>{
  const start=ui.indexOf("async function refreshReportsAfterPointImport");
  const block=ui.slice(start,start+4000);
  assert.match(block,/hadGeneratedSheets/);
  assert.match(block,/report-generate/);
});

test("controle de ocorrências mantém sua regra própria de competência Senior",()=>{
  const start=dashboard.indexOf('router.get("/occurrences"');
  const block=dashboard.slice(start,start+13000);
  assert.match(block,/LEFT\(i\.details->'period'->>'end',7\)=\$1/);
  assert.match(block,/period_start/);
  assert.match(block,/period_end/);
});
