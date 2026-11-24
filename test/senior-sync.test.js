"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  normalizeSeniorDay,
  normalizeSeniorEmployee,
  thermalMarkingsValid,
  validatePayload
}=require("../src/services/senior-sync");

function day(overrides={}){
  return {
    dataApuracao:"2026-11-10",
    escala:{codigo:46,descricao:"06:00-11:00-12:00-14:20sgAsb-E"},
    horario:{codigo:46,descricao:"06:00 - 12:00 - 13:00 - 14:20"},
    marcacoes:[
      {horaAcesso:"05:55"},{horaAcesso:"12:00"},{horaAcesso:"13:00"},{horaAcesso:"14:25"}
    ],
    situacoesApuradas:[
      {quantidadeHoras:"07:20",situacao:{codigo:1,descricao:"Trabalhando"}}
    ],
    incidentes:[],
    ...overrides
  };
}

test("Senior API: quatro marcações válidas ficam aptas ao repouso",()=>{
  const value=normalizeSeniorDay(day(),{today:"2026-11-24"});
  assert.equal(value.state,"WORKED");
  assert.equal(value.eligibleForAutomaticRest,true);
  assert.deepEqual(value.markings,["05:55","12:00","13:00","14:25"]);
  assert.equal(value.workMinutes,440);
});

test("Senior API: duas marcações reais podem delimitar o período trabalhado",()=>{
  const value=normalizeSeniorDay(day({
    marcacoes:[{horaAcesso:"07:30"},{horaAcesso:"12:05"}],
    incidentes:[{descricao:"Falta de Marcações"}]
  }),{today:"2026-11-24"});
  assert.equal(value.state,"WORKED");
  assert.equal(value.eligibleForAutomaticRest,true);
  assert.deepEqual(value.markings,["07:30","12:05"]);
  assert.match(value.occurrence,/Falta de Marcações/);
});

test("Senior API: uma marcação é classificada como falta",()=>{
  const value=normalizeSeniorDay(day({marcacoes:[{horaAcesso:"06:00"}],situacoesApuradas:[]}),{today:"2026-11-24"});
  assert.equal(value.state,"FALTA");
  assert.equal(value.eligibleForAutomaticRest,false);
});

test("Senior API: DSR e feriado não geram repouso",()=>{
  const dsr=normalizeSeniorDay(day({horario:{codigo:9999,descricao:"DSR"},marcacoes:[],situacoesApuradas:[]}),{today:"2026-11-24"});
  const holiday=normalizeSeniorDay(day({horario:{codigo:9997,descricao:"Feriado"},marcacoes:[],situacoesApuradas:[]}),{today:"2026-11-24"});
  assert.equal(dsr.state,"DSR");
  assert.equal(holiday.state,"FERIADO");
  assert.equal(dsr.eligibleForAutomaticRest,false);
  assert.equal(holiday.eligibleForAutomaticRest,false);
});

test("Senior API: terceiro turno preserva a ordem com virada de meia-noite",()=>{
  const markings=["22:00","23:30","00:30","06:00"];
  assert.equal(thermalMarkingsValid(markings),true);
  const value=normalizeSeniorDay(day({marcacoes:markings.map(horaAcesso=>({horaAcesso}))}),{today:"2026-11-24"});
  assert.deepEqual(value.markings,markings);
  assert.equal(value.state,"WORKED");
});

test("Senior API: marcação órfã é preservada como revisão sem inventar saída",()=>{
  const value=normalizeSeniorDay(day({marcacoes:[{horaAcesso:"19:30"},{horaAcesso:"23:08"},{horaAcesso:"23:47"}]}),{today:"2026-11-24"});
  assert.deepEqual(value.markings,["19:30","23:08"]);
  assert.equal(value.eligibleForAutomaticRest,true);
  assert.match(value.occurrence,/23:47/);
});

test("Senior API: datas futuras são ignoradas",()=>{
  const value=normalizeSeniorDay(day({dataApuracao:"2026-11-25"}),{today:"2026-11-24"});
  assert.equal(value,null);
});

test("Senior API: normaliza colaborador e valida payload",()=>{
  const employee=normalizeSeniorEmployee({
    colaborador:{id:"1-1-08348",numeroCadastro:"08348",nome:"  ADRIAN   TESTE "},
    apuracao:[day()]
  },{today:"2026-11-24"});
  assert.equal(employee.registration,"8348");
  assert.equal(employee.name,"ADRIAN TESTE");
  assert.equal(employee.days.length,1);

  const payload=validatePayload({
    periodStart:"2026-10-19",
    periodEnd:"2026-11-18",
    calculationCode:"654",
    seniorCompanyNumber:"1",
    employees:[{colaborador:{numeroCadastro:8348}}]
  });
  assert.equal(payload.calculationCode,"654");
});
