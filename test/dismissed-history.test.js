const test=require('node:test');
const assert=require('node:assert/strict');
const {canCreateHistoricalDismissed,reconcileDismissedWithEmployee}=require('../src/importers/dismissed-reader');
const valid={registration:'000011057',fullName:'AILTON OLIVEIRA DA SILVA',terminationDate:'2026-08-31',jobTitle:'AUXILIAR'};
test('histórico ausente oferece cadastro sem seleção automática',()=>{
 const row=reconcileDismissedWithEmployee(valid,null);
 assert.equal(row.canCreateHistorical,true);assert.equal(row.selected,false);assert.equal(row.systemMatch,false);
});
test('não cria histórico com causa no lugar do nome, matrícula nula ou data inválida',()=>{
 for(const patch of [{fullName:'02'},{fullName:''},{registration:'000000000'},{terminationDate:'2026-02-31'},{terminationDate:'31/08/2026'},{terminationDate:''}]){
  assert.equal(canCreateHistoricalDismissed({...valid,...patch}),false,JSON.stringify(patch));
 }
});
test('vínculo existente mantém nome cadastrado e não propõe inclusão',()=>{
 const row=reconcileDismissedWithEmployee(valid,{full_name:'NOME CADASTRADO',job_title:'AUXILIAR'});
 assert.equal(row.fullName,'NOME CADASTRADO');assert.equal(row.systemMatch,true);assert.equal(row.selected,true);assert.ok(!row.canCreateHistorical);
});
