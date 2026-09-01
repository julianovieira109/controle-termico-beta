const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const js=fs.readFileSync(path.join(__dirname,"../public/js/occurrences-control.js"),"utf8");
test("relatório contém indicadores gráficos e tabela na janela de impressão",()=>{
  assert.match(js,/<body>\$\{content\}/);
  assert.match(js,/occurrences-charts-grid/);
  assert.match(js,/occurrences-table/);
  assert.match(js,/A4 landscape/);
});
test("janela fecha somente após o diálogo de impressão",()=>{
  assert.match(js,/afterprint/);
  assert.match(js,/window\.close\(\)/);
});
