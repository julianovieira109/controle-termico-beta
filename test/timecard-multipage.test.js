const test=require('node:test');
const assert=require('node:assert/strict');
const {parseSeniorTimecard,canContinueTimecard,parseDayLine}=require('../src/importers/timecard-reader');
const {buildTimecardAudit}=require('../src/importers/timecard-audit');
const {timecardPeriod,timecardPeriods,replacementRanges,coversTimecardDate}=require('../src/importers/timecard-periods');
const {buildExpectedStorageSnapshot}=require('../src/importers/timecard-storage-audit');
const footer=hours=>`Trabalho: ${hours}:00 BH - 00:00 BH + 00:00 HE 100%: 00:00 Faltas: 00:00`;
function page(n,{employee=true,registration='000000001',start='19/09/2026',end='18/10/2026',company='11.111.111/0001-11',date='19/09',closing=false}={}){
 return `Cartão Ponto Período : ${start} a ${end} Pág.: ${n}\nCGC: ${company}\n${employee?`Empregado: ${registration} PESSOA DE TESTE\nHorários: 0046 06:00 10:00 11:00 15:00\n`:''}Data Sem Hor Marcações Trabalho BH - BH +\n${date} SEG 0046 06:00 10:00 11:00 15:00 Trabalhando ||SENIOR_COLS|| W=08:00;BM=;BP=;HE=;F=;AN=;V=\n${closing?footer('24'):''}`;
}
test('três páginas do mesmo cartão são conciliadas juntas, sem perder dias',()=>{
 const text=[page(1),page(2,{employee:false,date:'20/09'}),page(3,{employee:false,date:'21/09',closing:true})].join('\f');
 const parsed=parseSeniorTimecard(text);
 assert.equal(parsed.employees.length,1);assert.equal(parsed.totals.days,3);
 assert.equal(parsed.employees[0].bhReconciliation.status,'VALIDATED');
 assert.deepEqual(parsed.employees[0].days.map(day=>day.sourcePage),[1,2,3]);
 const audit=buildTimecardAudit({extraction:{cardPages:1,totalPages:3,dateRows:3,structuredRows:3},parsed,rows:[{employeeId:'one',result:'APTO'}]});
 assert.equal(audit.confidence,100);assert.equal(audit.canConfirm,true);
});
test('não herda cartão em outra empresa, período, matrícula ou página ausente',()=>{
 const first=page(1);
 for(const current of [page(2,{employee:false,company:'22.222.222/0001-22'}),page(2,{employee:false,start:'01/10/2026'}),page(2,{registration:'000000002'}),page(3,{employee:false})]){
  assert.equal(canContinueTimecard(first,current),false);
 }
 assert.equal(canContinueTimecard(first+'\n'+footer('08'),page(2,{employee:false})),false);
});
test('continuação sem rodapé permanece bloqueada e não tem valores ajustados',()=>{
 const parsed=parseSeniorTimecard(page(1)+'\f'+page(2,{employee:false,date:'20/09'}));
 assert.equal(parsed.employees[0].days.length,2);
 assert.equal(parsed.employees[0].bhReconciliation.status,'UNVERIFIED');
 assert.deepEqual(parsed.employees[0].bhReconciliation.adjustments,[]);
});
test('cartões completos do mesmo colaborador em períodos parciais distintos ficam separados',()=>{
 const first=page(1,{start:'01/09/2026',end:'01/09/2026',date:'01/09'})+'\n'+footer('08');
 const second=page(2,{start:'10/10/2026',end:'10/10/2026',date:'10/10'})+'\n'+footer('08');
 const parsed=parseSeniorTimecard(first+'\f'+second);
 assert.equal(parsed.employees.length,2);assert.ok(parsed.employees.every(e=>e.bhReconciliation.status==='VALIDATED'));
 const rows=parsed.employees.map(e=>({...e,employeeId:'one'}));
 assert.deepEqual(timecardPeriod(rows),{start:'2026-09-01',end:'2026-10-10'});
 assert.equal(timecardPeriods(rows).length,2);assert.equal(replacementRanges(rows).length,2);
 assert.equal(coversTimecardDate(rows,'one','2026-09-15'),false);
 assert.equal(coversTimecardDate(rows,'one','2026-10-10'),true);
 assert.equal(buildExpectedStorageSnapshot(rows).employees,1);
 assert.equal(buildExpectedStorageSnapshot(rows).days,2);
});
test('lançamentos oficiais sem batidas usam bases distintas, preservando o valor bruto',()=>{
 const period={start:'2026-08-19',end:'2026-10-18'};
 for(const [event,raw,absence,night,expected] of [
  ['BH 50%','00:22','','',22],
  ['BH 50%','07:45','02:33','05:05',372],
  ['BH 50%','10:05','03:01','04:33',484],
  ['Adicional Noturno','21:40','04:53','01:54',1040],
  ['Adicional Noturno','21:40','04:24','01:54',1040]
 ]){
  const day=parseDayLine(`16/10 SEX 0056 ${event} ||SENIOR_COLS|| W=05:05;BM=${raw};BP=;HE=;F=${absence};AN=${night};V=`,period);
  assert.equal(day.bhNegativeMinutes,expected);
  const [h,m]=raw.split(':').map(Number);assert.equal(day.bhNegativeRawMinutes,h*60+m);
 }
});
