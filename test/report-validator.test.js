const test=require('node:test');
const assert=require('node:assert/strict');
const validator=require('../public/js/report-validator.js');

const employee=(overrides={})=>({id:1,full_name:'Colaborador Teste',registration:'0001',status:'ATIVO',report_policy:'BOTH',shift_name:'1º Turno',branch_id:10,company_id:1,point_schedules:{'2026-08-03':'08:00-12:00-13:00-17:00'},point_states:{},...overrides});
const cfg={mode:'AUTOMATIC',scopeMode:'ALL',authorizedCompanyIds:[],authorizedBranchIds:[]};

test('competência ausente bloqueia a validação',()=>{
  const r=validator.validate({employees:[employee()],thermalConfig:cfg,pointCompetenceBranches:['10']});
  assert.equal(r.valid,false); assert.ok(r.blockers.some(x=>x.code==='MONTH_REQUIRED'));
});

test('colaborador válido com ponto confirmado é aprovado',()=>{
  const r=validator.validate({month:'2026-08',employees:[employee()],thermalConfig:cfg,pointCompetenceBranches:['10']});
  assert.equal(r.valid,true); assert.equal(r.blockers.length,0); assert.equal(r.ok.length,1);
});

test('automático sem ponto confirmado da filial é bloqueado',()=>{
  const r=validator.validate({month:'2026-08',employees:[employee()],thermalConfig:cfg,pointCompetenceBranches:[]});
  assert.equal(r.valid,false); assert.ok(r.blockers.some(x=>x.code==='POINT_COMPETENCE_MISSING'));
});

test('sem turno gera aviso e não bloqueio global',()=>{
  const r=validator.validate({month:'2026-08',employees:[employee({shift_name:''})],thermalConfig:cfg,pointCompetenceBranches:['10']});
  assert.equal(r.valid,true); assert.ok(r.warnings.some(x=>x.code==='NO_SHIFT'));
});

test('regra PENDING não duplica aviso da lista de colaboradores sem ficha',()=>{
  const r=validator.validate({month:'2026-08',employees:[employee({report_policy:'PENDING'})],thermalConfig:cfg,pointCompetenceBranches:['10']});
  assert.equal(r.valid,true);
  assert.equal(r.warnings.some(x=>x.code==='POLICY_BLOCKED'),false);
});

test('matrícula ausente é sinalizada como aviso',()=>{
  const r=validator.validate({month:'2026-08',employees:[employee({registration:''})],thermalConfig:cfg,pointCompetenceBranches:['10']});
  assert.equal(r.valid,true); assert.ok(r.warnings.some(x=>x.code==='NO_REGISTRATION'));
});

test('filial com competência mas colaborador sem linhas de ponto gera aviso',()=>{
  const r=validator.validate({month:'2026-08',employees:[employee({point_schedules:{},point_states:{}})],thermalConfig:cfg,pointCompetenceBranches:['10']});
  assert.equal(r.valid,true); assert.ok(r.warnings.some(x=>x.code==='NO_POINT_ROWS'));
});


test('bloqueio de ponto ausente é agrupado por filial',()=>{
  const employees=[
    employee({id:1,full_name:'A',branch_id:10,branch_name:'TRANZILOG'}),
    employee({id:2,full_name:'B',branch_id:10,branch_name:'TRANZILOG'}),
    employee({id:3,full_name:'C',branch_id:10,branch_name:'TRANZILOG'})
  ];
  const r=validator.validate({month:'2026-08',employees,thermalConfig:cfg,pointCompetenceBranches:[]});
  const missing=r.blockers.filter(x=>x.code==='POINT_COMPETENCE_MISSING');
  assert.equal(missing.length,1);
  assert.match(missing[0].message,/TRANZILOG/);
  assert.match(missing[0].message,/3 colaboradores afetados/);
  assert.equal(r.counts.blockers,1);
});

test('ponto ausente em filiais diferentes gera um bloqueio por filial',()=>{
  const employees=[
    employee({id:1,full_name:'A',branch_id:10,branch_name:'FILIAL A'}),
    employee({id:2,full_name:'B',branch_id:20,branch_name:'FILIAL B'})
  ];
  const r=validator.validate({month:'2026-08',employees,thermalConfig:cfg,pointCompetenceBranches:[]});
  const missing=r.blockers.filter(x=>x.code==='POINT_COMPETENCE_MISSING');
  assert.equal(missing.length,2);
});
