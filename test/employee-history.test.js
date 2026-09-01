const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('histórico usa audit_logs existente sem criar nova tabela',()=>{
  const route=fs.readFileSync(path.join(__dirname,'../src/routes/employees.js'),'utf8');
  assert.match(route,/router\.get\("\/:id\/history"/);
  assert.match(route,/FROM audit_logs a/);
  assert.doesNotMatch(route,/CREATE TABLE.*employee_history/is);
});

test('endpoint do histórico é exclusivo do Administrador Master',()=>{
  const route=fs.readFileSync(path.join(__dirname,'../src/routes/employees.js'),'utf8');
  const pos=route.indexOf('router.get("/:id/history"');
  const block=route.slice(pos,pos+900);
  assert.match(block,/req\.user\?\.role!=="ADMIN"/);
  assert.match(block,/req\.user\?\.isMasterAdmin!==true/);
  assert.match(block,/status\(403\)/);
});

test('histórico não aparece mais dentro da edição do colaborador',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const employeeModal=html.slice(html.indexOf('id="employee-modal"'),html.indexOf('id="dismissed-period-filters"'));
  assert.doesNotMatch(employeeModal,/employee-history-open/);
  assert.doesNotMatch(employeeModal,/employee-history-modal/);
});

test('histórico fica somente em Configurações como aba master-only',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  assert.match(html,/class="settings-tab admin-only master-only" data-settings-tab="employee-history"/);
  assert.match(html,/id="settings-employee-history" class="admin-only master-only"/);
});

test('frontend também bloqueia histórico para usuário não Master',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/employee-history-admin.js'),'utf8');
  assert.match(js,/currentUser\?\.role==="ADMIN"/);
  assert.match(js,/currentUser\?\.isMasterAdmin===true/);
  assert.match(js,/tab\.style\.display="none"/);
});

test('edição continua registrando os campos alterados',()=>{
  const route=fs.readFileSync(path.join(__dirname,'../src/routes/employees.js'),'utf8');
  assert.match(route,/employeeChangeDetails\(current\.rows\[0\],rows\[0\]\)/);
  assert.match(route,/changedFields:Object\.keys\(changes\)/);
});
