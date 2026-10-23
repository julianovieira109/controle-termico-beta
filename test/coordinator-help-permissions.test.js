const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/js/help-manual.js'),'utf8');
const start=source.indexOf('function hasEffectivePermission('),end=source.indexOf('\nfunction applyHelpScope(',start);
function permits(user,rule){return vm.runInNewContext(source.slice(start,end)+'\nhasEffectivePermission(rule)',{currentUser:user,rule});}

test('ajuda de equipes segue a autorização exclusiva de Ocorrências',()=>{
  assert.equal(permits({role:'ADMIN',isMasterAdmin:true},'occurrences.view'),true);
  assert.equal(permits({role:'ADMIN',permissions:{'occurrences.view':true}},'occurrences.view'),true);
  assert.equal(permits({role:'ADMIN',permissions:{}},'occurrences.view'),false);
  assert.equal(permits({role:'COORDINATOR',permissions:{'occurrences.view':true}},'occurrences.view'),false);
});
test('ajuda de equipes não amplia acesso às demais funções protegidas',()=>{
  const user={role:'ADMIN',permissions:{'occurrences.view':true}};
  assert.equal(permits(user,'master'),false);
  assert.equal(permits(user,'reports.view'),true);
  assert.equal(permits({role:'COORDINATOR',permissions:{'reports.view':true}},'reports.view'),true);
  assert.equal(permits({role:'COORDINATOR',permissions:{}},'employees.manage'),false);
});
