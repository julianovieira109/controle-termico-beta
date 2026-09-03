const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const reports=fs.readFileSync(path.join(root,"src/routes/reports.js"),"utf8");
const dashboard=fs.readFileSync(path.join(root,"src/routes/dashboard.js"),"utf8");
const client=fs.readFileSync(path.join(root,"public/js/calendar-reports.js"),"utf8");
const occ=fs.readFileSync(path.join(root,"public/js/occurrences-control.js"),"utf8");

test("competência Senior é definida pelo mês final do período",()=>{
  assert.match(reports,/LEFT\(i\.details->'period'->>'end',7\)=\$1/);
  assert.match(client,/function seniorCompetenceFromPeriod/);
  assert.match(client,/end\.slice\(0,7\)/);
});
test("19/08 a 02/09 é tratado como competência setembro",()=>{
  assert.match(client,/19\/08 a 02\/09 = setembro/);
});
test("19/07 a 06/08 é tratado como competência agosto",()=>{
  assert.match(client,/19\/07 a 06\/08 = agosto/);
});
test("ficha exibe competência e período Senior separadamente",()=>{
  assert.match(client,/report-field-label">Competência/);
  assert.match(client,/Período do Cartão de Ponto Senior/);
  assert.match(client,/reportCompetencePeriod/);
});
test("prévia da importação exibe competência calculada e período",()=>{
  assert.match(client,/Competência:<\/strong>/);
  assert.match(client,/Período do Cartão de Ponto Senior:<\/strong>/);
});
test("controle de ocorrências usa a mesma competência Senior",()=>{
  assert.match(dashboard,/LEFT\(i\.details->'period'->>'end',7\)=\$1/);
  assert.match(occ,/Período do Cartão de Ponto Senior/);
});
test("refresh não trata mais todo mês sobreposto como competência",()=>{
  assert.match(client,/currentMonth!==importedMonth/);
  assert.match(client,/await applyPointDataToEmployees\(importedMonth\)/);
});
