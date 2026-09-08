const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const reports=fs.readFileSync(path.join(root,"src/routes/reports.js"),"utf8");
const client=fs.readFileSync(path.join(root,"public/js/calendar-reports.js"),"utf8");

test("point-days busca o mês-calendário e inclui um dia anterior para o 3º turno",()=>{
  const start=reports.indexOf('router.get("/point-days"');
  const block=reports.slice(start,start+3200);
  assert.match(block,/p\.work_date>=\(\$1::date - INTERVAL '1 day'\)/);
  assert.match(block,/p\.work_date<\(\$1::date \+ INTERVAL '1 month'\)/);
  assert.doesNotMatch(block,/LEFT\(i\.details->'period'->>'end',7\)=\$1/);
});

test("ficha térmica automática usa sempre o mês-calendário selecionado",()=>{
  assert.match(client,/function reportThermalDays\(employee,month\)\{[\s\S]*?return reportMonthDays\(month\);/);
  assert.match(client,/function buildThermalSheet[\s\S]*?const days=reportThermalDays\(employee,month\)/);
});

test("planejamento automático usa somente os dias da competência mensal",()=>{
  assert.match(client,/function reportPlanningDays\(employees,month\)\{[\s\S]*?return reportMonthDays\(month\);/);
  assert.match(client,/const monthDays=reportPlanningDays\(automaticEmployees,month\)/);
});

test("após o deslocamento do 3º turno, somente datas da competência entram na ficha",()=>{
  const start=client.indexOf("async function applyPointDataToEmployees");
  const block=client.slice(start,start+3500);
  assert.match(block,/const monthStart=`\$\{month\}-01`/);
  assert.match(block,/const monthEnd=reportMonthDays\(month\)/);
  assert.match(block,/date<monthStart\|\|date>monthEnd/);
});

test("cabeçalho informa os dados considerados do primeiro ao último dia do mês",()=>{
  assert.match(client,/Dados de ponto considerados/);
  assert.match(client,/periodLabel:`\$\{formatApiDate\(start\)\} a \$\{formatApiDate\(end\)\}`/);
});
