const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const route=fs.readFileSync(path.join(__dirname,'../src/routes/dashboard.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../public/js/competence-compare.js'),'utf8');

test('endpoint compara duas competências',()=>{
  assert.match(route,/router\.get\("\/competence-compare"/);
  assert.match(route,/Promise\.all\(months\.map\(snapshot\)\)/);
});
test('comparação usa dados existentes do cartão de ponto',()=>{
  assert.match(route,/employee_point_days/);
  assert.match(route,/PONTO_SENIOR/);
  assert.match(route,/eligible_for_automatic_rest/);
  assert.match(route,/point_state='REVIEW'/);
});
test('comparador respeita escopo do usuário',()=>{
  const start=route.indexOf('router.get("/competence-compare"');
  const block=route.slice(start,start+6500);
  assert.match(block,/req\.scope\.isAdmin/);
  assert.match(block,/req\.scope\.branchIds/);
});
test('interface permite escolher duas competências',()=>{
  assert.match(html,/id="competence-compare-a"/);
  assert.match(html,/id="competence-compare-b"/);
  assert.match(html,/id="competence-compare-run"/);
});
test('interface mostra oito indicadores comparáveis',()=>{
  assert.equal((js.match(/\["[^"]+","[^"]+"\]/g)||[]).filter(x=>/Importações|Colaboradores|Dias|Faltas|Férias|Atestados/.test(x)).length,8);
});
test('comparador sinaliza piora em revisão cobertura e aptidão',()=>{
  assert.match(js,/dias para revisão aumentaram/);
  assert.match(js,/colaborador\(es\) a menos/);
  assert.match(js,/dias aptos ao repouso reduziram/);
});
