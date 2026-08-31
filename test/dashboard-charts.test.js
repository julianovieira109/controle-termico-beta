const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('dashboard possui quatro indicadores gráficos',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  for(const id of [
    'chart-errors-bars','chart-days-donut','chart-coverage-fill','dashboard-correction-actions'
  ]){
    assert.match(html,new RegExp(`id="${id}"`));
  }
});

test('gráficos usam dados reais já carregados no dashboard',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/admin-access.js'),'utf8');
  assert.match(js,/dashboardOperationsSnapshot/);
  assert.match(js,/dashboardAlertsSnapshot/);
  assert.match(js,/renderDashboardGraphs/);
  assert.match(js,/missingShift/);
  assert.match(js,/eligibleDays/);
  assert.match(js,/dashboardActiveEmployees/);
});

test('ações de correção correspondem às categorias de alerta',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/admin-access.js'),'utf8');
  assert.match(js,/Definir turno/);
  assert.match(js,/Importar Cartão de Ponto/);
  assert.match(js,/Completar matrícula/);
  assert.match(js,/Definir regra de relatório/);
  assert.match(js,/Conferir não localizados/);
});
