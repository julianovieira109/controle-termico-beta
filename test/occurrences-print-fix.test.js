const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"../public/index.html"),"utf8");
const js=fs.readFileSync(path.join(__dirname,"../public/js/occurrences-control.js"),"utf8");

test("impressão monta documento isolado",()=>{
  assert.match(html,/id="occurrences-print-document"/);
  assert.match(js,/buildPrintDocument/);
  assert.match(js,/printWindowHtml/);
});
test("impressão abre janela própria sem depender do CSS global",()=>{
  assert.match(js,/window\.open\("","_blank"/);
  assert.match(js,/printWindow\.document\.write\(html\)/);
  assert.match(js,/@page\{size:A4 landscape/);
});
test("janela própria imprime após carregar",()=>{
  assert.match(js,/window\.addEventListener\("load"/);
  assert.match(js,/window\.print\(\)/);
});
test("relatório impresso usa todas as linhas carregadas",()=>{
  const start=js.indexOf("function buildPrintDocument");
  const block=js.slice(start,start+6000);
  assert.match(block,/rows\.map/);
  assert.doesNotMatch(block,/visibleRows\(\)/);
});
test("bloqueio de pop-up gera orientação",()=>{
  assert.match(js,/navegador bloqueou a janela de impressão/);
});
