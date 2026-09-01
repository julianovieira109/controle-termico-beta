const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('histórico usa audit_logs existente sem criar nova tabela',()=>{
  const route=fs.readFileSync(path.join(__dirname,'../src/routes/employees.js'),'utf8');
  assert.match(route,/router\.get\("\/:id\/history"/);
  assert.match(route,/FROM audit_logs a/);
  assert.match(route,/a\.entity='employees'/);
  assert.doesNotMatch(route,/CREATE TABLE.*employee_history/is);
});

test('edição registra campos alterados no audit log',()=>{
  const route=fs.readFileSync(path.join(__dirname,'../src/routes/employees.js'),'utf8');
  assert.match(route,/employeeChangeDetails\(current\.rows\[0\],rows\[0\]\)/);
  assert.match(route,/changedFields:Object\.keys\(changes\)/);
});

test('cadastro possui acesso ao histórico apenas em edição',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../public/js/employees-imports.js'),'utf8');
  assert.match(html,/id="employee-history-open" hidden/);
  assert.match(html,/id="employee-history-modal"/);
  assert.match(js,/\$\("employee-history-open"\)\.hidden=false/);
  assert.match(js,/\/api\/employees\/\$\{id\}\/history/);
});

test('histórico mostra origem, data e alterações anterior para novo',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/employees-imports.js'),'utf8');
  assert.match(js,/actor_name/);
  assert.match(js,/toLocaleString\("pt-BR"\)/);
  assert.match(js,/change\.from/);
  assert.match(js,/change\.to/);
});
