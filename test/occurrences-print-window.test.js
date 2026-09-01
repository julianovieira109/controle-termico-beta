const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const js=fs.readFileSync(path.join(__dirname,"../public/js/occurrences-control.js"),"utf8");
const template=fs.readFileSync(path.join(__dirname,"../public/js/occurrences-print-template.js"),"utf8");
const printCss=fs.readFileSync(path.join(__dirname,"../public/css/occurrences-print.css"),"utf8");
test("relatório contém indicadores gráficos e tabela na janela de impressão",()=>{
  assert.match(template,/<body>\$\{content\}/);
  assert.match(printCss,/occurrences-charts-grid/);
  assert.match(printCss,/occurrences-table/);
  assert.match(printCss,/A4 landscape/);
});
test("janela fecha somente após o diálogo de impressão",()=>{
  assert.match(template,/afterprint/);
  assert.match(template,/window\.close\(\)/);
});
