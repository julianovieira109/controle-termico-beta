const test=require('node:test');
const assert=require('node:assert/strict');
const RestAudit=require('../public/js/rest-audit.js');

test('auditoria preserva regra oficial de 100/20',()=>{
  assert.equal(RestAudit.RULE_WORK_MINUTES,100);
  assert.equal(RestAudit.RULE_REST_MINUTES,20);
});

test('auditoria separa jornada por refeição',()=>{
  const audit=RestAudit.auditDay(
    '08:00-12:00-13:00-17:00',
    [{start:600,end:620},{start:900,end:920}],
    '08:00-12:00-13:00-17:00'
  );
  assert.equal(audit.periods.length,2);
  assert.equal(RestAudit.formatMinutes(audit.meal.start),'12:00');
  assert.equal(RestAudit.formatMinutes(audit.meal.end),'13:00');
});

test('auditoria explica cada repouso sem recalcular horários',()=>{
  const rests=[{start:540,end:560},{start:900,end:920}];
  const audit=RestAudit.auditDay('08:00-12:00-13:00-17:00',rests,'08:00-12:00-13:00-17:00');
  assert.equal(audit.items.length,2);
  assert.equal(audit.items[0].start,540);
  assert.equal(audit.items[0].end,560);
  assert.equal(audit.items[0].status,'Conforme');
  assert.equal(audit.items[0].periodLabel,'08:00 – 12:00');
});

test('hora extra pode elevar limite diário para quarto repouso',()=>{
  const audit=RestAudit.auditDay(
    '08:00-12:00-13:00-19:00',
    [],
    '08:00-12:00-13:00-17:00'
  );
  assert.equal(audit.overtimeMinutes,120);
  assert.equal(audit.dailyLimit,4);
});
