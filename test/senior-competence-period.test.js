const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const reports=fs.readFileSync(path.join(root,"src/routes/reports.js"),"utf8");
const dashboard=fs.readFileSync(path.join(root,"src/routes/dashboard.js"),"utf8");
const client=fs.readFileSync(path.join(root,"public/js/calendar-reports.js"),"utf8");
const occ=fs.readFileSync(path.join(root,"public/js/occurrences-control.js"),"utf8");

test("relatórios não amarram competência ao mês final do cartão Senior",()=>{
  const start=reports.indexOf('router.get("/point-competence"');
  const block=reports.slice(start,start+3500);
  assert.doesNotMatch(block,/LEFT\(i\.details->'period'->>'end',7\)=\$1/);
  assert.match(block,/INTERVAL '1 month'/);
});

test("cartão 19/08 a 02/09 alcança agosto e setembro",()=>{
  assert.match(client,/function monthsCoveredByPeriod\(period\)/);
  assert.match(client,/months\.push\(month\)/);
});

test("ficha sempre exibe competência mensal e intervalo mensal considerado",()=>{
  assert.match(client,/report-field-label">Competência/);
  assert.match(client,/Dados de ponto considerados/);
  assert.match(client,/reportCompetencePeriod/);
});

test("prévia da importação mostra período Senior e competências alcançadas",()=>{
  assert.match(client,/Período do Cartão de Ponto Senior:<\/strong>/);
  assert.match(client,/Competências alcançadas:<\/strong>/);
});

test("controle de ocorrências continua exibindo o período Senior",()=>{
  assert.match(dashboard,/LEFT\(i\.details->'period'->>'end',7\)=\$1/);
  assert.match(occ,/Período do Cartão de Ponto Senior/);
});

test("refresh considera todas as competências sobrepostas pelo período importado",()=>{
  assert.match(client,/coveredMonths=monthsCoveredByPeriod\(period\)/);
  assert.match(client,/coveredMonths\.includes\(currentMonth\)/);
  assert.match(client,/applyPointDataToEmployees\(currentMonth\)/);
});
