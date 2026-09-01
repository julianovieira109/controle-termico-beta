const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('consulta master filtra colaboradores sem nome válido',()=>{
  const route=fs.readFileSync(path.join(__dirname,'../src/routes/employees.js'),'utf8');
  assert.match(route,/req\.query\.historyMode==="master"/);
  assert.match(route,/TRIM\(e\.full_name\)<>'-'/);
});

test('histórico usa mensagem clara para auditoria antiga sem detalhes',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/employee-history-admin.js'),'utf8');
  assert.match(js,/Alteração anterior — detalhes não disponíveis nesta versão\./);
  assert.doesNotMatch(js,/Registro de auditoria preservado pelo sistema\./);
});

test('seleção do colaborador usa destaque institucional',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/employee-history-admin.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'../public/css/enhancements.css'),'utf8');
  assert.match(js,/Selecionado/);
  assert.match(js,/aria-pressed/);
  assert.match(css,/\.employee-history-person\.active/);
  assert.match(css,/border-left-color:var\(--primary\)/);
});

test('lista de histórico ficou mais compacta',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../public/css/enhancements.css'),'utf8');
  assert.match(css,/\.employee-history-person\{[\s\S]*padding:8px 10px/);
  assert.match(css,/\.employee-history-employee-list\{[\s\S]*gap:5px/);
});
