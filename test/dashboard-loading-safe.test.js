const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('dashboard mostra estado de carregamento antes da consulta',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/admin-access.js'),'utf8');
  assert.match(js,/function setDashboardLoading/);
  assert.match(js,/Carregando dados\.\.\./);
  assert.match(js,/setDashboardLoading\(true\)/);
});

test('dashboard não apresenta zero como substituto de falha',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/admin-access.js'),'utf8');
  assert.match(js,/function showDashboardLoadError/);
  assert.match(js,/Não foi possível carregar os dados/);
  assert.match(js,/dashboard-retry-load/);
});

test('dashboard só encerra carregamento após resumo operações e alertas',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/admin-access.js'),'utf8');
  assert.match(js,/await Promise\.all\(\[loadDashboardOperations\(\),loadDashboardAlerts\(\)\]\)/);
  assert.match(js,/setDashboardLoading\(false\)/);
});
