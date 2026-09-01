const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Dashboard não possui botão manual Atualizar na competência',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  assert.doesNotMatch(html,/id="dashboard-alert-refresh"/);
});

test('mudança da competência continua atualizando automaticamente',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/admin-access.js'),'utf8');
  assert.match(js,/\$\("dashboard-alert-month"\)\.onchange=/);
  assert.match(js,/loadDashboardOperations\(\)/);
  assert.match(js,/loadDashboardAlerts\(\)/);
});
