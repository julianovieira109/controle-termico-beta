"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {buildMonitorSnapshot,interjourneyIssues}=require("../src/services/senior-monitor");

function employee(days){
  return {registration:"1234",name:"COLABORADOR TESTE",days};
}
function day(date,markings,state="WORKED",occurrence=null){
  return {date,markings,scheduleCode:"46",state,occurrence};
}

test("Monitor Senior: primeira leitura sinaliza pendência nova",()=>{
  const summary=buildMonitorSnapshot([
    employee([day("2026-11-24",["08:00"],"FALTA","Uma marcação")])
  ],{});
  assert.equal(summary.currentIssueCount,1);
  assert.equal(summary.newIssueCount,1);
  assert.equal(summary.changedDayCount,0);
});

test("Monitor Senior: mesma pendência não é repetida como nova",()=>{
  const first=buildMonitorSnapshot([
    employee([day("2026-11-24",["08:00"],"FALTA","Uma marcação")])
  ],{});
  const second=buildMonitorSnapshot([
    employee([day("2026-11-24",["08:00"],"FALTA","Uma marcação")])
  ],first);
  assert.equal(second.currentIssueCount,1);
  assert.equal(second.newIssueCount,0);
  assert.equal(second.changedDayCount,0);
});

test("Monitor Senior: mudança de marcação aparece como dia alterado",()=>{
  const first=buildMonitorSnapshot([
    employee([day("2026-11-24",["08:00","12:00"],"WORKED")])
  ],{});
  const second=buildMonitorSnapshot([
    employee([day("2026-11-24",["08:00","12:05"],"WORKED")])
  ],first);
  assert.equal(second.changedDayCount,1);
});

test("Monitor Senior: interjornada inferior a 11h é sinalizada",()=>{
  const issues=interjourneyIssues([
    employee([
      day("2026-11-23",["14:00","22:00"]),
      day("2026-11-24",["07:00","15:00"])
    ])
  ]);
  assert.equal(issues.length,1);
  assert.equal(issues[0].type,"INTERJORNADA");
  assert.equal(issues[0].minutes,540);
});

test("Monitor Senior: terceiro turno atravessando meia-noite mantém cálculo da interjornada",()=>{
  const issues=interjourneyIssues([
    employee([
      day("2026-11-23",["22:00","23:30","00:30","06:00"]),
      day("2026-11-24",["22:00","23:30","00:30","06:00"])
    ])
  ]);
  assert.equal(issues.length,0);
});
