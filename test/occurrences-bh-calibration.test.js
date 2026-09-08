const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const route=fs.readFileSync('src/routes/dashboard.js','utf8');
const ui=fs.readFileSync('public/js/occurrences-control.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');

test('BH gerencial usa tempo acumulado e separa positivo e negativo',()=>{
  assert.match(route,/function parseBhMinutes\(occurrence\)/);
  assert.match(route,/row\.bh_positive_minutes=bhPositiveMinutes/);
  assert.match(route,/row\.bh_negative_minutes=bhNegativeMinutes/);
  assert.match(route,/row\.bh_net_minutes=bhNetMinutes/);
  assert.match(html,/BH líquido/);
  assert.match(html,/BH \(\+ \/ -\)/);
  assert.match(ui,/bh_positive_minutes/);
  assert.match(ui,/bh_negative_minutes/);
});

test('quantidade de dias com BH nao torna colaborador vermelho por si so',()=>{
  const classification=route.slice(route.indexOf('const critical=[]'),route.indexOf("row.indicator_status=critical.length"));
  assert.doesNotMatch(classification,/if\(bankHours>=/);
  assert.match(classification,/bhNegativeMinutes>=240/);
  assert.match(classification,/bhPositiveMinutes>=600/);
  assert.match(classification,/Math\.abs\(bhNetMinutes\)>30/);
});
