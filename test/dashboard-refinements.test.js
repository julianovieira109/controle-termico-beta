const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('competência única fica no resumo operacional',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  assert.equal((html.match(/id="dashboard-alert-month"/g)||[]).length,1);
  assert.equal((html.match(/id="dashboard-alert-refresh"/g)||[]).length,1);
  const management=html.indexOf('dashboard-management');
  const month=html.indexOf('id="dashboard-alert-month"');
  const alerts=html.indexOf('dashboard-alert-center');
  assert.ok(management>=0 && month>management && month<alerts);
});

test('card sem turno possui status dinâmico',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../public/js/admin-access.js'),'utf8');
  assert.match(html,/id="sum-missing-shift-status"/);
  assert.match(js,/missingShift===0\?"Tudo certo":"Requer atenção"/);
  assert.match(js,/classList\.toggle\("is-clear",missingShift===0\)/);
});

test('última importação usa blocos e revisão possui destaque dinâmico',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../public/js/admin-access.js'),'utf8');
  assert.match(html,/class="dashboard-last-import-meta"/);
  assert.match(html,/id="dashboard-review-card"/);
  assert.match(js,/classList\.toggle\("has-review",reviewDays>0\)/);
});
