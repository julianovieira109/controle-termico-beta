const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('dias para revisar aparece dentro do gráfico de dias importados',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  assert.match(html,/id="chart-review-callout"/);
  assert.match(html,/id="chart-review-days"/);
  assert.doesNotMatch(html,/id="dashboard-review-card"/);
});

test('frontend atualiza o destaque de revisão no gráfico',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/admin-access.js'),'utf8');
  assert.match(js,/chart-review-days/);
  assert.match(js,/classList\.toggle\("is-clear",review===0\)/);
});
