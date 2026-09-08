const test=require("node:test");
const assert=require("node:assert/strict");
const {parseSeniorTimecard,parseDayLine}=require("../src/importers/timecard-reader");

const period={start:"2026-07-31",end:"2026-08-31"};

test("Senior: jornada cadastrada com 2 horários aceita duas marcações reais",()=>{
  const text=`Cartão Ponto\nPeríodo : 31/07/2026 a 31/08/2026\nEmpregado: 000011297 ADALVA GOMES DE LIMA FIGUEIREDO\nCategoria: Mensalista\nHorários: 0064 07:00 12:00 13:00 16:00\n          0005 08:00 12:00\nData Sem Hor Marcações\n01/08 SAB 0005 06:56 11:00 BH 50% 04:00 00:04`;
  const parsed=parseSeniorTimecard(text);
  const day=parsed.employees[0].days[0];
  assert.deepEqual(day.markings,["06:56","11:00"]);
  assert.equal(day.state,"WORKED");
  assert.equal(day.eligibleForAutomaticRest,true);
});

test("Senior: três marcações em escala de quatro usam o par completo e preservam a órfã",()=>{
  const text=`Cartão Ponto
Período : 31/07/2026 a 31/08/2026
Empregado: 000011365 ANDESSON RAFAEL DA SILVA CONCEICAO SILVA
Categoria: Mensalista
Horários: 0056 22:00 00:00 01:00 06:00
Data Sem Hor Marcações
01/08 SAB 0056 19:30 23:08 23:47 BH 50% 02:17 01:30 01:17`;
  const parsed=parseSeniorTimecard(text);
  const day=parsed.employees[0].days[0];
  assert.deepEqual(day.markings,["19:30","23:08"]);
  assert.deepEqual(day.ignoredMarkings,["23:47"]);
  assert.equal(day.state,"WORKED");
  assert.equal(day.eligibleForAutomaticRest,true);
  assert.match(day.occurrence,/Jornada parcialmente calculada/i);
});

test("Senior: total de trabalho não é confundido com quinta marcação",()=>{
  const schedules=new Map([["0064",["07:00","12:00","13:00","16:00"]]]);
  const day=parseDayLine("29/08 SAB 0064 07:00 12:00 13:00 16:00 08:00",period,schedules);
  assert.deepEqual(day.markings,["07:00","12:00","13:00","16:00"]);
  assert.equal(day.state,"WORKED");
  assert.equal(day.eligibleForAutomaticRest,true);
  assert.match(day.occurrence,/Total de trabalho da Senior/i);
});
