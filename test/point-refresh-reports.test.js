const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const imports=fs.readFileSync(path.join(__dirname,"../src/routes/imports.js"),"utf8");
const reports=fs.readFileSync(path.join(__dirname,"../src/routes/reports.js"),"utf8");
const ui=fs.readFileSync(path.join(__dirname,"../public/js/calendar-reports.js"),"utf8");

test("nova importação substitui os dias do mesmo período antes de salvar",()=>{
  const start=imports.indexOf('router.post("/timecard-confirm"');
  const block=imports.slice(start,start+9000);
  assert.match(block,/DELETE FROM employee_point_days/);
  assert.match(block,/work_date BETWEEN \$4::date AND \$5::date/);
  assert.match(block,/importedPeriod\.start/);
  assert.match(block,/importedPeriod\.end/);
});
test("substituição fica dentro da mesma transação da importação",()=>{
  const start=imports.indexOf('router.post("/timecard-confirm"');
  const block=imports.slice(start,start+9000);
  assert.ok(block.indexOf('client.query("BEGIN")') < block.indexOf("DELETE FROM employee_point_days"));
  assert.ok(block.indexOf("DELETE FROM employee_point_days") < block.indexOf('client.query("COMMIT")'));
});
test("após confirmar ponto a tela recarrega as marcações do banco",()=>{
  assert.match(ui,/refreshReportsAfterPointImport/);
  assert.match(ui,/await applyPointDataToEmployees\(importedMonth\)/);
  assert.match(ui,/invalidateReportValidation\(\)/);
});
test("fichas abertas são invalidadas e regeneradas",()=>{
  const start=ui.indexOf("async function refreshReportsAfterPointImport");
  const block=ui.slice(start,start+4000);
  assert.match(block,/querySelector\("\.report-sheet"\)/);
  assert.match(block,/output\.innerHTML=""/);
  assert.match(block,/\$\("report-generate"\)\?\.click\(\)/);
});
test("consultas do ponto não usam cache",()=>{
  assert.match(ui,/_=\$\{Date\.now\(\)\}/);
  assert.match(reports,/Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate"/);
});
test("importação registra que o período anterior foi substituído",()=>{
  assert.match(imports,/replacedPeriod:true/);
  assert.match(imports,/period:importedPeriod/);
});
