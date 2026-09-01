const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const reports=fs.readFileSync(path.join(__dirname,"../src/routes/reports.js"),"utf8");
const dashboard=fs.readFileSync(path.join(__dirname,"../src/routes/dashboard.js"),"utf8");
const ui=fs.readFileSync(path.join(__dirname,"../public/js/calendar-reports.js"),"utf8");

test("competência considera importação que sobrepõe o mês mesmo terminando no mês seguinte",()=>{
  const start=reports.indexOf('router.get("/point-competence"');
  const block=reports.slice(start,start+3500);
  assert.match(block,/period'->>'start'\)::date < \(\(\$1\|\|'-01'\)::date \+ INTERVAL '1 month'\)/);
  assert.match(block,/period'->>'end'\)::date >= \(\$1\|\|'-01'\)::date/);
  assert.doesNotMatch(block,/LEFT\(COALESCE\(i\.details->'period'->>'end'/);
});

test("refresh reconhece que um PDF pode cobrir agosto e setembro",()=>{
  assert.match(ui,/function reportMonthWithinImportedPeriod/);
  assert.match(ui,/start<nextMonth&&end>=monthStart/);
  assert.match(ui,/coveredMonths/);
});

test("competência aberta tem prioridade quando está dentro do período importado",()=>{
  const start=ui.indexOf("async function refreshReportsAfterPointImport");
  const block=ui.slice(start,start+4500);
  assert.match(block,/reportMonthWithinImportedPeriod\(currentMonth,period\)/);
  assert.match(block,/\?currentMonth/);
  assert.match(block,/await applyPointDataToEmployees\(targetMonth\)/);
});

test("fichas de agosto são regeneradas após PDF que vai até setembro",()=>{
  const start=ui.indexOf("async function refreshReportsAfterPointImport");
  const block=ui.slice(start,start+4500);
  assert.match(block,/hadGeneratedSheets/);
  assert.match(block,/report-generate/);
  assert.match(block,/formatApiDate\(period\.start\)/);
  assert.match(block,/formatApiDate\(period\.end\)/);
});

test("controle de ocorrências também considera importação sobreposta",()=>{
  const start=dashboard.indexOf('router.get("/occurrences"');
  const block=dashboard.slice(start,start+9000);
  assert.match(block,/period'->>'start'/);
  assert.match(block,/period'->>'end'/);
  assert.match(block,/INTERVAL '1 month'/);
});
