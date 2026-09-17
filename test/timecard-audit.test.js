const test=require('node:test');
const assert=require('node:assert/strict');
const {buildTimecardAudit}=require('../src/importers/timecard-audit');

function validatedEmployee(registration,work,footerWork){
  return {
    registration,
    days:[{workMinutes:work,bhNegativeMinutes:0,bhPositiveMinutes:0,he100Minutes:0,absenceMinutes:0}],
    footerTotals:{workMinutes:footerWork,bhNegativeMinutes:0,bhPositiveMinutes:0,he100Minutes:0,absenceMinutes:0},
    bhReconciliation:{status:work===footerWork?'VALIDATED':'MISMATCH',adjustments:[]}
  };
}

test('conciliação global compara somente colaboradores com rodapé oficial disponível',()=>{
  const employees=[
    validatedEmployee('1',480,480),
    {registration:'2',days:[{workMinutes:600}],footerTotals:null,bhReconciliation:{status:'UNVERIFIED',adjustments:[]}}
  ];
  const rows=[{employeeId:'a',result:'APTO'},{employeeId:'b',result:'APTO'}];
  const audit=buildTimecardAudit({extraction:{dateRows:2,structuredRows:2,footerRows:1,text:''},parsed:{employees,totals:{}},rows});
  assert.equal(audit.totals.workMinutes.daily,480);
  assert.equal(audit.totals.workMinutes.official,480);
  assert.equal(audit.reconciliation.comparable,1);
  assert.equal(audit.status,'BLOCKED');
});

test('confirmação exige 100% de estrutura e vínculo inequívoco de matrícula/nome',()=>{
  const employees=[validatedEmployee('1',480,480)];
  const auditCoverage=buildTimecardAudit({extraction:{dateRows:100,structuredRows:99,footerRows:1,text:''},parsed:{employees,totals:{}},rows:[{employeeId:'a',result:'APTO'}]});
  assert.equal(auditCoverage.canConfirm,false);
  const auditName=buildTimecardAudit({extraction:{dateRows:1,structuredRows:1,footerRows:1,text:''},parsed:{employees,totals:{}},rows:[{employeeId:'a',result:'CONFERIR_NOME'}]});
  assert.equal(auditName.canConfirm,false);
  assert.equal(auditName.matching.nameMismatch,1);
});
