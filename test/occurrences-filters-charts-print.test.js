const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const route=fs.readFileSync(path.join(__dirname,"../src/routes/dashboard.js"),"utf8");
const html=fs.readFileSync(path.join(__dirname,"../public/index.html"),"utf8");
const js=fs.readFileSync(path.join(__dirname,"../public/js/occurrences-control.js"),"utf8");
const css=fs.readFileSync(path.join(__dirname,"../public/css/enhancements.css"),"utf8");

test("Controle de Ocorrências filtra por empresa filial e competência",()=>{
  assert.match(html,/id="occurrences-company"/);
  assert.match(html,/id="occurrences-branch"/);
  assert.match(html,/id="occurrences-month"/);
  const start=route.indexOf('router.get("/occurrences"');
  const block=route.slice(start,start+9000);
  assert.match(block,/companyId/);
  assert.match(block,/branchId/);
  assert.match(block,/p\.company_id/);
  assert.match(block,/p\.branch_id/);
});
test("filiais são filtradas pela empresa selecionada",()=>{
  assert.match(js,/fillBranches/);
  assert.match(js,/item\.company_id/);
  assert.match(js,/occurrences-company/);
});
test("área possui indicadores gráficos",()=>{
  assert.match(html,/id="occurrences-bar-chart"/);
  assert.match(html,/id="occurrences-donut"/);
  assert.match(html,/id="occurrences-kpi-employees"/);
  assert.match(html,/id="occurrences-kpi-total"/);
  assert.match(js,/renderCharts/);
  assert.match(js,/conic-gradient/);
});
test("impressão inclui relatório de ocorrências",()=>{
  assert.match(html,/id="occurrences-print"/);
  assert.match(html,/Relatório de Controle de Ocorrências/);
  assert.match(js,/window\.print\(\)/);
  assert.match(js,/occurrences-print-active/);
  assert.match(css,/body\.occurrences-print-active/);
});
test("cabeçalho impresso registra competência empresa filial e emissão",()=>{
  assert.match(html,/id="occurrences-print-reference"/);
  assert.match(html,/id="occurrences-print-company"/);
  assert.match(html,/id="occurrences-print-branch"/);
  assert.match(html,/id="occurrences-print-generated"/);
  assert.match(js,/updatePrintHeader/);
});
test("gráficos são preparados para impressão em cores",()=>{
  assert.match(css,/print-color-adjust:exact/);
  assert.match(css,/occurrences-charts-grid/);
  assert.match(css,/occurrences-donut/);
});
