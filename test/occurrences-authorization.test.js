const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const auth=fs.readFileSync(path.join(__dirname,"../src/middleware/auth.js"),"utf8");
const dashboard=fs.readFileSync(path.join(__dirname,"../src/routes/dashboard.js"),"utf8");
const admin=fs.readFileSync(path.join(__dirname,"../src/routes/admin.js"),"utf8");
const html=fs.readFileSync(path.join(__dirname,"../public/index.html"),"utf8");
const core=fs.readFileSync(path.join(__dirname,"../public/js/core.js"),"utf8");
const users=fs.readFileSync(path.join(__dirname,"../public/js/admin-access.js"),"utf8");

test("Controle de Ocorrências usa permissão própria",()=>{
  assert.match(html,/data-special-permission="occurrences\.view"/);
  assert.doesNotMatch(html,/data-view="occurrences" data-permission="reports\.view"/);
});
test("Master possui acesso permanente e ADM exige autorização",()=>{
  assert.match(auth,/isMasterAdmin===true/);
  assert.match(auth,/permissions\?\.\["occurrences\.view"\]===true/);
  assert.match(auth,/requireOccurrencesAccess/);
});
test("endpoint de ocorrências é protegido no backend",()=>{
  assert.match(dashboard,/router\.get\("\/occurrences",requireOccurrencesAccess/);
});
test("autorização aparece no cadastro de usuário",()=>{
  assert.match(html,/id="user-occurrences-permission"/);
  assert.match(html,/id="user-occurrences-access"/);
  assert.match(html,/Acessar Controle de Ocorrências/);
});
test("somente Master pode conceder autorização a administrador",()=>{
  assert.match(admin,/Somente o Administrador Master pode autorizar o Controle de Ocorrências/);
  assert.match(users,/currentUser\?\.isMasterAdmin===true&&isAdminProfile/);
});
test("permissão é individual e não liberada para RH",()=>{
  assert.match(admin,/permission_key='occurrences\.view'/);
  assert.match(users,/occurrencesAccess:role==="ADMIN"/);
  assert.match(users,/!isAdminProfile/);
});
test("menu e navegação escondem ocorrências sem autorização",()=>{
  assert.match(core,/hasOccurrencesAccess=isMasterAdmin/);
  assert.match(core,/view==="occurrences"/);
  assert.match(core,/não possui autorização para acessar o Controle de Ocorrências/);
});
