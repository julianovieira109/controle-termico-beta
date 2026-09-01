const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=rel=>fs.readFileSync(path.join(root,rel),"utf8");

test("Controle de Ocorrências possui CSS próprio",()=>{
  assert.ok(fs.existsSync(path.join(root,"public/css/occurrences.css")));
  assert.match(read("public/index.html"),/\/css\/occurrences\.css/);
});
test("template de impressão de ocorrências é módulo próprio",()=>{
  assert.ok(fs.existsSync(path.join(root,"public/js/occurrences-print-template.js")));
  assert.match(read("public/index.html"),/occurrences-print-template\.js/);
  assert.match(read("public/js/occurrences-control.js"),/OccurrencesPrintTemplate/);
});
test("enhancements não carrega mais o bloco completo de ocorrências",()=>{
  assert.doesNotMatch(read("public/css/enhancements.css"),/V1\.0\.31 beta\.4 — filtros, gráficos e impressão do Controle de Ocorrências/);
});
test("estrutura documenta regra de modularização",()=>{
  assert.match(read("STRUCTURE.md"),/Estrutura modular/);
  assert.match(read("STRUCTURE.md"),/Não duplicar regra de negócio/);
});
test("auditoria de tamanho está disponível",()=>{
  assert.ok(fs.existsSync(path.join(root,"tools/check-file-sizes.js")));
  assert.equal(require(path.join(root,"package.json")).scripts["check:sizes"],"node tools/check-file-sizes.js");
});
