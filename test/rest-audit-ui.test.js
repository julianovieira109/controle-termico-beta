const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('painel de conferência contém auditoria explicativa',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');
  assert.match(html,/id="report-rest-audit"/);
  assert.match(html,/\/js\/rest-audit\.js/);
  assert.match(js,/RestAudit\.auditDay/);
  assert.match(js,/Por que cada repouso foi gerado\?/);
  assert.match(js,/Somente leitura/);
});

test('auditoria não modifica o módulo oficial de cálculo',()=>{
  const thermal=fs.readFileSync(path.join(__dirname,'../public/js/thermal-schedule.js'),'utf8');
  assert.match(thermal,/const REST_AFTER_MINUTES=100;/);
  assert.match(thermal,/const REST_DURATION_MINUTES=20;/);
  assert.doesNotMatch(thermal,/RestAudit/);
});
