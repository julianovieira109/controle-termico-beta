const test=require("node:test");
const assert=require("node:assert/strict");
const {backupDigest,attachIntegrity,verifyIntegrity}=require("../src/services/backup-integrity");

test("gera SHA-256 determinístico para os dados do backup",()=>{
  const data={employees:[{id:1,name:"Teste"}]};
  assert.equal(backupDigest(data),backupDigest(data));
  assert.equal(backupDigest(data).length,64);
});

test("backup V1.0.22 recebe assinatura de integridade válida",()=>{
  const backup=attachIntegrity({format:"controle-termico-backup",data:{companies:[{id:1}]}});
  assert.equal(backup.integrity.algorithm,"sha256");
  assert.equal(verifyIntegrity(backup).valid,true);
});

test("alteração posterior nos dados invalida o backup",()=>{
  const backup=attachIntegrity({format:"controle-termico-backup",data:{employees:[{id:1,status:"ACTIVE"}]}});
  backup.data.employees[0].status="INACTIVE";
  const result=verifyIntegrity(backup);
  assert.equal(result.valid,false);
  assert.match(result.reason,/alterado|corrompido/i);
});

test("backup legado continua aceito com identificação de legado",()=>{
  const result=verifyIntegrity({format:"controle-termico-backup",data:{}});
  assert.equal(result.valid,true);
  assert.equal(result.legacy,true);
});
