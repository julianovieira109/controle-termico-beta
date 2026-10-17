const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('public/index.html','utf8');
const js=fs.readFileSync('public/js/competence-compare.js','utf8');
function setup(api){
  const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,{value:'',textContent:'',innerHTML:'',hidden:true,attrs:{},setAttribute(k,v){this.attrs[k]=v;}}]));
  nodes.get('dashboard-alert-month').value='2026-01';
  let init;
  vm.runInNewContext(js,{document:{getElementById:id=>nodes.get(id),addEventListener:(name,fn)=>{if(name==='DOMContentLoaded')init=fn;}},api});
  init();return nodes;
}
test('comparador é carregado e usa competência do Painel ao abrir',()=>{
  assert.match(html,/<script src="\/js\/competence-compare\.js\?v=[^"]+"><\/script>/);
  const nodes=setup(async()=>{});
  assert.equal(nodes.get('competence-compare-a').value,'2025-12');
  assert.equal(nodes.get('competence-compare-b').value,'2026-01');
  nodes.get('dashboard-alert-month').value='2026-09';
  nodes.get('competence-compare-toggle').onclick();
  assert.equal(nodes.get('competence-compare-body').hidden,false);
  assert.equal(nodes.get('competence-compare-toggle').attrs['aria-expanded'],'true');
  assert.equal(nodes.get('competence-compare-a').value,'2026-08');
  assert.equal(nodes.get('competence-compare-b').value,'2026-09');
});
test('comparador consulta a API e apresenta indicadores e alertas',async()=>{
  const urls=[];
  const nodes=setup(async url=>{urls.push(url);return {a:{month:'2025-12',imports:1,employees:8,reviewDays:1,eligibleDays:10},b:{month:'2026-01',imports:1,employees:7,reviewDays:3,eligibleDays:8}};});
  await nodes.get('competence-compare-run').onclick();
  assert.deepEqual(urls,['/api/dashboard/competence-compare?monthA=2025-12&monthB=2026-01']);
  assert.equal((nodes.get('competence-compare-summary').innerHTML.match(/<article>/g)||[]).length,8);
  assert.match(nodes.get('competence-compare-alerts').innerHTML,/dias para revisão aumentaram em 2/);
  assert.match(nodes.get('competence-compare-status').textContent,/Comparação concluída/);
});
test('comparador valida meses iguais antes de consultar e exibe falha da API',async()=>{
  let calls=0;
  const nodes=setup(async()=>{calls++;throw Error('Serviço indisponível');});
  nodes.get('competence-compare-a').value='2026-01';
  await nodes.get('competence-compare-run').onclick();
  assert.equal(calls,0);assert.match(nodes.get('competence-compare-status').textContent,/competências diferentes/);
  nodes.get('competence-compare-a').value='2025-12';
  await nodes.get('competence-compare-run').onclick();
  assert.equal(calls,1);assert.equal(nodes.get('competence-compare-status').className,'feedback error');
  assert.equal(nodes.get('competence-compare-status').textContent,'Serviço indisponível');
});
