const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('dashboard não exibe botão Atualizar',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  assert.doesNotMatch(html,/id="dashboard-alert-refresh"/);
  assert.match(html,/id="dashboard-alert-month"/);
});

test('troca de competência atualiza operações e alertas automaticamente',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/admin-access.js'),'utf8');
  assert.match(js,/\$\("dashboard-alert-month"\)\.onchange=/);
  assert.match(js,/Promise\.all\(\[loadDashboardOperations\(\),loadDashboardAlerts\(\)\]\)/);
  assert.doesNotMatch(js,/dashboard-alert-refresh/);
});
