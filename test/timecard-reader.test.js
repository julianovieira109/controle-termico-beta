const test=require('node:test');
const assert=require('node:assert/strict');
const {parseSeniorTimecard,parseDayLine,normalizeSeniorBhNegative}=require('../src/importers/timecard-reader');

test('mantém a data oficial impressa pela Senior em jornada que atravessa meia-noite',()=>{
  const text=`Cartão Ponto Período : 19/08/2026 a 20/08/2026 Pág.: 1\nEmpregado: 000005743 ALAX JOHNATHAN DE ALENCAR ARAUJO\nHorários: 0056 22:00 00:00 01:00 06:00\nData Sem Hor Marcações Trabalho BH - BH + HE 100% Falta Ad. Not Viagem\n19/08 QUA 0056 20:10 00:01 01:01 05:20 BH 50% Noturnas ||SENIOR_COLS|| W=07:51;BM=;BP=01:12;HE=;F=;AN=06:51;V=\n20/08 QUI 0056 20:57 00:01 01:10 05:40 BH 50% ||SENIOR_COLS|| W=07:41;BM=00:09;BP=00:43;HE=;F=;AN=06:41;V=\nTrabalho: 15:32 BH - 00:09 BH + 01:55 HE 100%: 00:00 Faltas: 00:00`;
  const parsed=parseSeniorTimecard(text);
  assert.equal(parsed.employees.length,1);
  assert.equal(parsed.employees[0].days[0].date,'2026-08-19');
  assert.deepEqual(parsed.employees[0].days[0].markings,['20:10','00:01','01:01','05:20']);
  assert.equal(parsed.employees[0].bhReconciliation.status,'VALIDATED');
});

test('normaliza Faltas Noturnas da Senior para 80% no BH negativo',()=>{
  const normalized=normalizeSeniorBhNegative(30*60,'Faltas Noturnas',0);
  assert.equal(normalized.minutes,24*60);
  assert.equal(normalized.normalized,true);
  assert.equal(normalized.reason,'SENIOR_NIGHT_ABSENCE_80');
});

test('linha de Faltas Noturnas preserva a falta e aplica o BH- normalizado',()=>{
  const day=parseDayLine('12/09 SAB 0056 Faltas Noturnas ||SENIOR_COLS|| W=;BM=30:00;BP=;HE=;F=07:00;AN=;V=',{start:'2026-08-19',end:'2026-09-13'},new Map());
  assert.equal(day.date,'2026-09-12');
  assert.equal(day.state,'FALTA');
  assert.equal(day.bhNegativeRawMinutes,1800);
  assert.equal(day.bhNegativeMinutes,1440);
  assert.equal(day.absenceMinutes,420);
});

test('interpreta feriado e auxílio-doença como dias não trabalhados sem perder a linha do cartão',()=>{
  const period={start:'2026-08-19',end:'2026-09-13'};
  const holiday=parseDayLine('07/09 SEG 9997 Feriado ||SENIOR_COLS|| W=;BM=;BP=;HE=;F=;AN=;V=',period,new Map());
  const leave=parseDayLine('01/09 TER 0056 Auxílio Doença Noturno ||SENIOR_COLS|| W=;BM=;BP=;HE=;F=;AN=;V=',period,new Map());
  assert.equal(holiday.state,'FERIADO');
  assert.equal(holiday.eligibleForAutomaticRest,false);
  assert.equal(leave.state,'AFASTAMENTO');
  assert.equal(leave.eligibleForAutomaticRest,false);
});

test('não contamina o fechamento do colaborador seguinte com o rodapé da página anterior',()=>{
  const p1=`Cartão Ponto Período : 19/08/2026 a 19/08/2026 Pág.: 1\nEmpregado: 000000001 TESTE UM\nHorários: 0046 06:00 12:00 13:00 14:20\n19/08 QUA 0046 06:00 12:00 13:00 14:20 Trabalhando ||SENIOR_COLS|| W=07:20;BM=;BP=;HE=;F=;AN=;V=\nTrabalho: 07:20 BH - 00:00 BH + 00:00 HE 100%: 00:00 Faltas: 00:00`;
  const p2=`Cartão Ponto Período : 19/08/2026 a 19/08/2026 Pág.: 2\nEmpregado: 000000002 TESTE DOIS\nHorários: 0046 06:00 12:00 13:00 14:20\n19/08 QUA 0046 06:00 12:00 13:00 15:20 BH 50% ||SENIOR_COLS|| W=07:20;BM=;BP=01:00;HE=;F=;AN=;V=\nTrabalho: 07:20 BH - 00:00 BH + 01:00 HE 100%: 00:00 Faltas: 00:00`;
  const parsed=parseSeniorTimecard(`${p1}\n\f\n${p2}`);
  assert.equal(parsed.employees.length,2);
  assert.equal(parsed.employees[0].bhReconciliation.status,'VALIDATED');
  assert.equal(parsed.employees[1].bhReconciliation.status,'VALIDATED');
  assert.equal(parsed.employees[1].footerTotals.bhPositiveMinutes,60);
});

test('identifica colaborador quando o pdf2json separa Empregado, matrícula e nome na última página',()=>{
  const p1=`Cartão Ponto Período : 19/07/2026 a 18/08/2026 Pág.: 103\nEmpregado: 000000001 TESTE PENULTIMO\n19/07 DOM 9999 DSR ||SENIOR_COLS|| W=;BM=;BP=;HE=;F=;AN=;V=\nTrabalho: 00:00 BH - 00:00 BH + 00:00 HE 100%: 00:00 Faltas: 00:00`;
  const p2=`Cartão Ponto Período : 19/07/2026 a 18/08/2026 Pág.: 104\nEmpregado:\n000008510\nZENILDO FILHO SANTOS TEIXEIRA\nCargo: CONFERENTE DE CARGA E DESCARGA\nHorários: 0046 06:00 12:00 13:00 14:20\n18/08 TER 0046 06:00 12:00 13:02 14:33 BH 50% ||SENIOR_COLS|| W=07:18;BM=00:02;BP=00:13;HE=;F=;AN=;V=\nTrabalho: 07:18 BH - 00:02 BH + 00:13 HE 100%: 00:00 Faltas: 00:00`;
  const parsed=parseSeniorTimecard(`${p1}\n\f\n${p2}`);
  assert.equal(parsed.employees.length,2);
  assert.equal(parsed.employees[1].rawRegistration,'000008510');
  assert.equal(parsed.employees[1].name,'ZENILDO FILHO SANTOS TEIXEIRA');
  assert.equal(parsed.employees[1].bhReconciliation.status,'VALIDATED');
});

test('lançamento especial sem marcações desconta a coluna Falta do BH- em vez de aplicar 80% cegamente',()=>{
  const normalized=normalizeSeniorBhNegative(7*60+19,'BH (-) Saída Antecipada Noturn',0,66);
  assert.equal(normalized.minutes,6*60+13);
  assert.equal(normalized.normalized,true);
  assert.equal(normalized.reason,'SENIOR_SPECIAL_NEGATIVE_MINUS_ABSENCE');
});

test('reproduz o caso real de Matheus Lopes em 15/09/2026',()=>{
  const day=parseDayLine('15/09 TER 0056 BH (-) Saída Antecipada Noturn ||SENIOR_COLS|| W=03:06;BM=07:19;BP=;HE=;F=01:06;AN=03:06;V=',{start:'2026-08-19',end:'2026-09-17'},new Map());
  assert.equal(day.bhNegativeRawMinutes,7*60+19);
  assert.equal(day.absenceMinutes,66);
  assert.equal(day.bhNegativeMinutes,6*60+13);
  assert.equal(day.bhNegativeNormalizationReason,'SENIOR_SPECIAL_NEGATIVE_MINUS_ABSENCE');
});

test('mantém 80% para Faltas Noturnas mesmo quando existe valor na coluna Falta',()=>{
  const normalized=normalizeSeniorBhNegative(27*60+15,'Faltas Noturnas',0,7*60);
  assert.equal(normalized.minutes,21*60+48);
  assert.equal(normalized.reason,'SENIOR_NIGHT_ABSENCE_80');
});
