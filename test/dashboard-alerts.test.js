const test=require('node:test');
const assert=require('node:assert/strict');
const alerts=require('../src/lib/dashboard-alerts');

function employee(overrides={}){
  return {
    id:'e1',company_id:'c1',branch_id:'b1',full_name:'Teste',registration:'123',
    company_name:'Empresa',branch_name:'Filial',shift_name:'1º turno',report_policy:'BOTH',
    ...overrides
  };
}

test('sem turno é alerta crítico',()=>{
  const r=alerts.classify({employees:[employee({shift_name:''})],imports:[{branch_id:'b1'}],pointRows:[]});
  assert.equal(r.groups.missingShift.length,1);
  assert.equal(r.summary.critical,1);
});

test('modo manual não cobra Cartão de Ponto',()=>{
  const r=alerts.classify({
    employees:[employee()],
    imports:[],
    pointRows:[],
    thermalConfig:{mode:'MANUAL',scopeMode:'ALL'}
  });
  assert.equal(r.groups.missingPointImport.length,0);
});

test('escopo selecionado não gera alerta fora da autorização',()=>{
  const r=alerts.classify({
    employees:[employee()],
    imports:[],
    pointRows:[],
    thermalConfig:{mode:'AUTOMATIC',scopeMode:'SELECTED',authorizedBranchIds:['b2']}
  });
  assert.equal(r.groups.missingPointImport.length,0);
});

test('filial automática sem ponto importado é crítica',()=>{
  const r=alerts.classify({
    employees:[employee()],
    imports:[],
    pointRows:[],
    thermalConfig:{mode:'AUTOMATIC',scopeMode:'ALL'}
  });
  assert.equal(r.groups.missingPointImport.length,1);
  assert.equal(r.summary.critical,1);
});

test('colaborador ausente do ponto importado gera aviso',()=>{
  const r=alerts.classify({
    employees:[employee()],
    imports:[{branch_id:'b1'}],
    pointRows:[],
    thermalConfig:{mode:'AUTOMATIC',scopeMode:'ALL'}
  });
  assert.equal(r.groups.missingPointRows.length,1);
  assert.equal(r.summary.warnings,1);
});

test('regra NONE não exige ponto e PENDING é somente aviso de configuração',()=>{
  const r=alerts.classify({
    employees:[employee({id:'e1',report_policy:'NONE'}),employee({id:'e2',report_policy:'PENDING'})],
    imports:[],
    pointRows:[],
    thermalConfig:{mode:'AUTOMATIC',scopeMode:'ALL'}
  });
  assert.equal(r.groups.missingPointImport.length,0);
  assert.equal(r.groups.pendingPolicy.length,1);
});
