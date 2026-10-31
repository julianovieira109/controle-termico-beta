const test=require('node:test');
const assert=require('node:assert/strict');
const {signAdmission,verifyAdmission,admissionPointCard}=require('../src/importers/admitted-integrity');
process.env.JWT_SECRET='isolated-admission-integrity-test-key';
const row={registration:'000000111',fullName:'TESTE PRIMEIRO',admissionDate:'2026-10-09',
  jobCode:'000086',jobTitle:'CARREGADOR',pointCard:'',branchCode:'0002',identitySource:'PDF_COORDINATES'};
const scope={companyId:'company',branchId:'branch',userId:'user'};

test('assinatura vincula cada campo de origem ao usuário, empresa e filial',()=>{
  const signed=signAdmission(row,scope);
  assert.equal(verifyAdmission(signed,scope),true);
  assert.equal(verifyAdmission({...signed,selected:false},scope),true);
  for(const key of Object.keys(row))assert.equal(verifyAdmission({...signed,[key]:String(row[key])+'X'},scope),false,key);
  for(const key of Object.keys(scope))assert.equal(verifyAdmission(signed,{...scope,[key]:'other'}),false,key);
});

test('assinaturas vencidas, ausentes, futuras e malformadas não são aceitas',()=>{
  const now=Date.now(),signed=signAdmission(row,scope,now);
  assert.equal(verifyAdmission(row,scope,now),false);
  assert.equal(verifyAdmission(signed,scope,now+2*60*60*1000+1),false);
  assert.equal(verifyAdmission(signAdmission(row,scope,now+120000),scope,now),false);
  assert.equal(verifyAdmission({...signed,admissionProof:{...signed.admissionProof,signature:'abcd'}},scope),false);
});

test('cartão vazio preserva cartões legítimos e limpa somente artefato comprovado do leitor antigo',()=>{
  const legacy={source:'SENIOR_TIMECARD_ADMITIDOS',full_name:'0002 TESTE SEGUNDO',point_card:'0086'};
  assert.equal(admissionPointCard(legacy,row),null);
  for(const change of [{source:'MANUAL'},{full_name:'TESTE SEGUNDO'},{point_card:'1234'}]){
    const current={...legacy,...change};assert.equal(admissionPointCard(current,row),current.point_card);
  }
  assert.equal(admissionPointCard(legacy,{...row,identitySource:'SAME_SOURCE_LINE'}),'0086');
  assert.equal(admissionPointCard(legacy,{...row,pointCard:'1234'}),'1234');
  assert.equal(admissionPointCard({source:'SENIOR_TIMECARD_ADMITIDOS',full_name:row.fullName,point_card:null},row),null);
});
