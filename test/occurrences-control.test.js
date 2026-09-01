const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const route=fs.readFileSync(path.join(__dirname,"../src/routes/dashboard.js"),"utf8");
const html=fs.readFileSync(path.join(__dirname,"../public/index.html"),"utf8");
const js=fs.readFileSync(path.join(__dirname,"../public/js/occurrences-control.js"),"utf8");

test("menu possui aba própria de ocorrências",()=>{
  assert.match(html,/data-view="occurrences"/);
  assert.match(html,/>Ocorrências<\/span>/);
  assert.match(html,/id="occurrences" class="view"/);
});
test("controle possui os doze indicadores solicitados",()=>{
  for(const label of ["Folgas","Faltas","BH / Banco de Horas","Atestados","Férias","DSR","Licenças","Afastamentos","Compensados","Curso","Óbito","Dias para revisão"]){
    assert.ok(html.includes(label),`indicador ausente: ${label}`);
  }
});
test("endpoint detalha ocorrências por colaborador e respeita escopo",()=>{
  const start=route.indexOf('router.get("/occurrences"');
  assert.ok(start>=0);
  const block=route.slice(start,start+7000);
  assert.match(block,/GROUP BY e\.id,e\.full_name,e\.registration/);
  assert.match(block,/req\.scope\.isAdmin/);
  assert.match(block,/req\.scope\.branchIds/);
});
test("BH é lido da ocorrência importada da Senior",()=>{
  const start=route.indexOf('router.get("/occurrences"');
  const block=route.slice(start,start+7000);
  assert.match(block,/p\.occurrence/);
  assert.match(block,/BH/);
});
test("dias para revisão considera revisão e ausência de marcações",()=>{
  const start=route.indexOf('router.get("/occurrences"');
  const block=route.slice(start,start+7000);
  assert.match(block,/'REVIEW','NO_MARKINGS'/);
});
test("tabela permite busca e filtro por indicador",()=>{
  assert.match(html,/id="occurrences-search"/);
  assert.match(js,/selectKey/);
  assert.match(js,/visibleRows/);
  assert.match(html,/id="occurrences-clear-filter"/);
});
test("controle informa se existe cartão de ponto confirmado",()=>{
  assert.match(html,/id="occurrences-import-status"/);
  assert.match(route,/PONTO_SENIOR/);
  assert.match(js,/Nenhum Cartão de Ponto confirmado/);
});
