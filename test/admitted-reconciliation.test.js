const test=require('node:test');
const assert=require('node:assert/strict');
const {reconcileAdmittedPreview,admittedParsingIssues}=require('../src/importers/admitted-reconciliation');

test('nomes deslocados são corrigidos pela matrícula existente, preservando o vínculo e o turno',()=>{
  const source=[
    {registration:'000011687',fullName:'IZACO LOPES GERONIMO GUAJAJARA',admissionDate:'2026-10-09',jobTitle:'CARREGADOR',possibleReadmission:true,previousRegistration:'000011734'},
    {registration:'000011734',fullName:'JOSE HENRIQUE SILVA DOS SANTOS',admissionDate:'2026-10-21',jobTitle:'CARREGADOR',possibleReadmission:true,previousRegistration:'000011687'}
  ];
  const employees=[
    {id:'existing-izaco-registration',registration:'000011687',full_name:'0002 JOSE HENRIQUE SILVA DOS SANTOS',admission_date:'2026-10-21',shift_id:'night',current_shift:'3º Turno'},
    {id:'existing-jose-registration',registration:'000011734',full_name:'0002 IZACO LOPES GERONIMO GUAJAJARA',admission_date:'2026-10-09',shift_id:'morning',current_shift:'1º Turno'}
  ];
  const seen=[];
  const rows=reconcileAdmittedPreview(source,employees,(existing,row)=>{
    seen.push([existing.id,row.registration]);return ['nome','admissão'];
  });
  assert.deepEqual(rows.map(row=>[row.registration,row.employeeId,row.currentShiftId]),[
    ['000011687','existing-izaco-registration','night'],['000011734','existing-jose-registration','morning']
  ]);
  assert.deepEqual(rows.map(row=>row.fullName),source.map(row=>row.fullName));
  assert.ok(rows.every(row=>row.result==='ATUALIZAR'&&row.hasShift&&row.systemMatch&&row.matchBasis==='MATRICULA'));
  assert.ok(rows.every(row=>row.possibleReadmission===false&&row.previousRegistration===null));
  assert.deepEqual(seen,[['existing-izaco-registration','000011687'],['existing-jose-registration','000011734']]);
  assert.equal(rows[0].currentName,'0002 JOSE HENRIQUE SILVA DOS SANTOS');
  assert.equal(employees[0].full_name,'0002 JOSE HENRIQUE SILVA DOS SANTOS','A prévia não grava nem modifica o cadastro');
});

test('nome igual com outra matrícula nunca se transforma em associação automática',()=>{
  const [row]=reconcileAdmittedPreview(
    [{registration:'000011687',fullName:'COLABORADOR DE TESTE'}],
    [{id:'other-contract',registration:'000011894',full_name:'COLABORADOR DE TESTE',shift_id:'night'}],
    ()=>{throw new Error('Outra matrícula não pode ser tratada como o mesmo cadastro');}
  );
  assert.equal(row.registration,'000011687');
  assert.equal(row.employeeId,null);
  assert.equal(row.systemMatch,false);
  assert.equal(row.registrationExists,false);
});

test('reconferir a mesma matrícula sem diferenças é idempotente na prévia',()=>{
  const [row]=reconcileAdmittedPreview(
    [{registration:'000011687',fullName:'COLABORADOR DE TESTE',pointCard:''}],
    [{id:'stable-id',registration:'000011687',full_name:'COLABORADOR DE TESTE',point_card:'1234',shift_id:null}],
    ()=>[]
  );
  assert.equal(row.result,'CONFERIDO');
  assert.equal(row.employeeId,'stable-id');
  assert.equal(row.pointCard,'');
  assert.equal(row.hasShift,false);
});

test('diagnósticos incompletos impedem gravação de identidades parcialmente reconstruídas',()=>{
  assert.deepEqual(admittedParsingIssues({unresolvedCount:0,criticalAssociationIssueCount:0,admissionParsing:{complete:true}}),[]);
  assert.equal(admittedParsingIssues({unresolvedCount:1}).length,1);
  assert.equal(admittedParsingIssues({criticalAssociationIssueCount:1}).length,1);
  assert.equal(admittedParsingIssues({admissionParsing:{complete:false}}).length,1);
});
