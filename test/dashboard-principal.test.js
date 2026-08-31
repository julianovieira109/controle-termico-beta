const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('dashboard principal possui resumo operacional por competência',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  for(const id of [
    'dashboard-point-imports','dashboard-point-employees','dashboard-point-days',
    'dashboard-point-eligible'
  ]){
    assert.match(html,new RegExp(`id="${id}"`));
  }
});

test('dashboard atualiza resumo operacional junto com alertas',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/admin-access.js'),'utf8');
  assert.match(js,/function loadDashboardOperations/);
  assert.match(js,/\/api\/dashboard\/operations\?month=/);
  assert.match(js,/Promise\.all\(\[loadDashboardOperations\(\),loadDashboardAlerts\(\)\]\)/);
});

test('backend expõe resumo operacional sem alterar regras térmicas',()=>{
  const route=fs.readFileSync(path.join(__dirname,'../src/routes/dashboard.js'),'utf8');
  assert.match(route,/router\.get\("\/operations"/);
  assert.match(route,/PONTO_SENIOR/);
  assert.match(route,/eligible_for_automatic_rest/);
});
