const test=require('node:test');
const assert=require('node:assert/strict');
const {buildExpectedStorageSnapshot,normalizeStoredSnapshot,compareStorageSnapshots}=require('../src/importers/timecard-storage-audit');

test('monta snapshot esperado dos dias que serão gravados',()=>{
  const rows=[
    {employeeId:'e1',days:[
      {date:'2026-09-01',workMinutes:420,bhNegativeMinutes:10,bhPositiveMinutes:20,he100Minutes:0,absenceMinutes:0,nightAdditionalMinutes:30,travelMinutes:0},
      {date:'2026-09-02',workMinutes:400,bhNegativeMinutes:0,bhPositiveMinutes:15,he100Minutes:0,absenceMinutes:0,nightAdditionalMinutes:25,travelMinutes:0}
    ]},
    {employeeId:'e2',days:[
      {date:'2026-09-01',workMinutes:0,bhNegativeMinutes:0,bhPositiveMinutes:0,he100Minutes:0,absenceMinutes:420,nightAdditionalMinutes:0,travelMinutes:0}
    ]}
  ];
  const snapshot=buildExpectedStorageSnapshot(rows);
  assert.equal(snapshot.employees,2);
  assert.equal(snapshot.days,3);
  assert.equal(snapshot.minDate,'2026-09-01');
  assert.equal(snapshot.maxDate,'2026-09-02');
  assert.equal(snapshot.totals.workMinutes,820);
  assert.equal(snapshot.totals.bhNegativeMinutes,10);
  assert.equal(snapshot.totals.bhPositiveMinutes,35);
  assert.equal(snapshot.totals.absenceMinutes,420);
});

test('auditoria aprova quando banco reproduz exatamente o aprovado na central',()=>{
  const expected={employees:2,days:3,minDate:'2026-09-01',maxDate:'2026-09-02',totals:{workMinutes:820,bhNegativeMinutes:10,bhPositiveMinutes:35,he100Minutes:0,absenceMinutes:420,nightAdditionalMinutes:55,travelMinutes:0}};
  const stored=normalizeStoredSnapshot({employees:'2',days:'3',min_date:'2026-09-01',max_date:'2026-09-02',work_minutes:'820',bh_negative_minutes:'10',bh_positive_minutes:'35',he_100_minutes:'0',absence_minutes:'420',night_additional_minutes:'55',travel_minutes:'0'});
  const result=compareStorageSnapshots(expected,stored);
  assert.equal(result.ok,true);
  assert.deepEqual(result.differences,[]);
});

test('auditoria bloqueia commit quando qualquer total diverge',()=>{
  const expected={employees:1,days:2,minDate:'2026-09-01',maxDate:'2026-09-02',totals:{workMinutes:800,bhNegativeMinutes:22,bhPositiveMinutes:0,he100Minutes:0,absenceMinutes:0,nightAdditionalMinutes:0,travelMinutes:0}};
  const stored={...expected,totals:{...expected.totals,bhNegativeMinutes:21}};
  const result=compareStorageSnapshots(expected,stored);
  assert.equal(result.ok,false);
  assert.deepEqual(result.differences,[{field:'bhNegativeMinutes',expected:22,stored:21}]);
});
