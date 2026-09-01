const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const html=fs.readFileSync(path.join(__dirname,"../public/index.html"),"utf8");
const js=fs.readFileSync(path.join(__dirname,"../public/js/occurrences-control.js"),"utf8");
const css=fs.readFileSync(path.join(__dirname,"../public/css/enhancements.css"),"utf8");

test("impressão usa documento isolado fora do aplicativo",()=>{
  assert.match(html,/id="occurrences-print-document"/);
  assert.match(js,/buildPrintDocument/);
  assert.match(js,/holder\.replaceChildren\(header,summary,charts,detail\)/);
});
test("documento isolado é o único conteúdo visível durante impressão",()=>{
  assert.match(css,/body\.occurrences-print-active > \*:not\(#occurrences-print-document\)\{display:none!important\}/);
  assert.match(css,/body\.occurrences-print-active #occurrences-print-document/);
  assert.match(css,/display:block!important/);
});
test("impressão espera a renderização do documento antes de abrir preview",()=>{
  assert.match(js,/requestAnimationFrame\(\(\)=>requestAnimationFrame\(\(\)=>window\.print\(\)\)\)/);
});
test("relatório impresso usa todas as linhas carregadas e não apenas o filtro visual",()=>{
  const start=js.indexOf("function buildPrintDocument");
  const block=js.slice(start,start+5000);
  assert.match(block,/rows\.length/);
  assert.match(block,/rows\.map/);
  assert.doesNotMatch(block,/visibleRows\(\)/);
});
test("documento de impressão é limpo após finalizar",()=>{
  assert.match(js,/holder\.replaceChildren\(\)/);
  assert.match(js,/aria-hidden","true"/);
});
