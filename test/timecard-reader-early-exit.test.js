const test=require("node:test");
const assert=require("node:assert/strict");
const {parseDayLine}=require("../src/importers/timecard-reader");

const period={start:"2026-08-01",end:"2026-08-31"};

test("Senior: 3 batidas + BH (-) Saída Antecipada usa apenas o par completo",()=>{
  const day=parseDayLine("17/08 SEG 0045 13:34 17:42 18:34 BH (-) Saída Antecipada 04:08 03:12",period);
  assert.ok(day);
  assert.equal(day.date,"2026-08-17");
  assert.equal(day.scheduleCode,"0045");
  assert.deepEqual(day.markings,["13:34","17:42"]);
  assert.deepEqual(day.ignoredMarkings,["18:34"]);
  assert.equal(day.state,"WORKED");
  assert.equal(day.eligibleForAutomaticRest,true);
  assert.match(day.occurrence,/BH \(-\) Saída Antecipada/i);
  assert.match(day.occurrence,/Marcação sem par desconsiderada.*18:34/i);
});

test("Senior: horários após a ocorrência não viram batidas de ponto",()=>{
  const day=parseDayLine("17/08 SEG 0045 13:34 17:42 18:34 BH (-) Saída Antecipada 04:08 03:12",period);
  assert.doesNotMatch(day.markings.join(" "),/04:08|03:12/);
});

test("linha ímpar sem Saída Antecipada continua em revisão",()=>{
  const day=parseDayLine("17/08 SEG 0045 13:34 17:42 18:34",period);
  assert.ok(day);
  assert.equal(day.state,"REVIEW");
  assert.equal(day.eligibleForAutomaticRest,false);
});
