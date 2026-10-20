const test=require('node:test');const assert=require('node:assert/strict');
const {parseBhText}=require('../src/importers/senior-bh');
const {periodRange,compareSnapshot,guidance}=require('../src/lib/period-comparison');
const head='0001 EMPRESA TESTE Pág.: 1\nBanco de Horas Analítico\nPeríodo: 01/09/2026 a 18/10/2026\n1 000000123 NOME DE TESTE\nBanco 001 BANCO Saldo Inicial: 0000010:00\n';
test('leitor preserva sinais separados, fechamento e soma de movimentos sem descartar repetidos',()=>{
 const x=parseBhText(head+'19/09/2026 101 A 00000:00 18/02/2027 00000:30 - 00009:30\n19/09/2026 301 A 00000:00 18/02/2027 00001:00 00010:30\n* 20/09/2026 101 G 00000:00 18/02/2027 00010:30- 00000:00\nTotal do Banco 001 BANCO 0000000:00\nTotal Colaboradores 00001');
 assert.equal(x.errors.length,0);assert.equal(x.records[0].events.length,3);assert.equal(x.records[0].events[0].minutes,-30);assert.equal(x.records[0].events[2].closing,true);assert.equal(x.records[0].ledgerDifference,0);
});
test('leitura incompleta fica bloqueada, data inválida ou quantidade divergente é sinalizada',()=>{
 const x=parseBhText(head+'19/09/2026 linha ilegível\nTotal Colaboradores 00002');assert.ok(x.errors.length>=2);
 assert.throws(()=>parseBhText(head.replace('01/09/2026','31/02/2026')));
});
test('Sintético lê saldo na referência sem convertê-lo em movimento mensal',()=>{
 const x=parseBhText('Banco de Horas Sintético\nReferência: 18/10/2026\n1 000000123 NOME DE TESTE 001 BANCO 00000:00 00010:30-');
 assert.equal(x.records[0].final,-630);assert.equal(x.records[0].initial,null);assert.equal(x.records[0].events.length,0);
});
test('fechamentos e anos respeitam fronteiras e ano bissexto',()=>{
 assert.deepEqual(periodRange('2026-01'),{label:'2026-01',start:'2025-12-19',end:'2026-01-18'});
 assert.deepEqual(periodRange('2026','year'),{label:'2026',start:'2025-12-19',end:'2026-12-18'});
 assert.equal(periodRange('2024-02','month','calendar').end,'2024-02-29');
 for(const v of ['2026-00','2026-13','foo'])assert.throws(()=>periodRange(v));
});
const range=periodRange('2026-10');
const point={company_id:'c',branch_id:'b',registration:'000000123',employee_id:'e',full_name:'NOME DE TESTE',work_date:'2026-09-19',work_minutes:420,bh_validated:true,bh_positive_minutes:60,bh_negative_minutes:30,point_state:'WORKED',occurrence:'BH 50%',source_file:'ponto.pdf'};
const record={registration:'123',name:'NOME DE TESTE',bank:'001',initial:0,final:30,ledgerDifference:0,page:1,events:[{date:'2026-09-19',minutes:60,origin:'A'},{date:'2026-09-19',minutes:-30,origin:'A'}]};
const report={id:'r',company_id:'c',branch_id:'b',period_start:'2026-09-19',period_end:'2026-10-18',report_type:'ANALYTIC',file_name:'BH.pdf',records:[record]};
test('normaliza matrícula e compara créditos e débitos separadamente',()=>{
 const s=compareSnapshot(range,[point],[report]);assert.equal(s.matchingDays,1);assert.equal(s.bhPositive,60);assert.equal(s.bhNegative,30);assert.equal(s.balance,null);
});
test('revisão mais recente substitui cobertura sobreposta sem somar arquivos',()=>{
 const newer={...report,id:'new',records:[{...record,events:[]}]};
 const s=compareSnapshot(range,[point],[newer,report]);assert.equal(s.bhPositive,0);assert.equal(s.mismatchCount,1);assert.deepEqual(s.sources.map(r=>r.id),['new']);
});
test('saldos são snapshots exatos no fechamento e não soma mensal',()=>{
 const synth={...report,id:'s',report_type:'SYNTHETIC',period_start:'2026-10-18',records:[{...record,final:30,events:[]}]};
 const old={...synth,id:'old',period_start:'2026-09-18',period_end:'2026-09-18',records:[{...record,final:1000}]};
 const s=compareSnapshot(range,[point],[synth,report,old]);assert.equal(s.balance,30);assert.equal(s.balanceCompared,1);assert.equal(s.balanceMismatches.length,0);
});
test('ausência de dados, BH não validado e outra unidade não viram coincidência',()=>{
 const none=compareSnapshot(range,[],[]);assert.equal(none.workMinutes,null);assert.equal(none.bhPositive,null);assert.ok(guidance(none,none).some(x=>x.includes('não significa zero')));
 const s=compareSnapshot(range,[{...point,bh_validated:false,work_minutes:null},{...point,employee_id:'e2',branch_id:'other'}],[report]);
 assert.equal(s.comparedDays,0);assert.equal(s.unvalidatedDays,1);assert.equal(s.missingBhDays,1);assert.equal(s.workMinutes,null);
});
test('movimentos de fechamento são preservados e não usados como horas do cartão',()=>{
 const r={...report,records:[{...record,events:[...record.events,{date:'2026-09-19',origin:'G',closing:true,minutes:-900}]}]};
 const s=compareSnapshot(range,[point],[r]);assert.equal(s.bhNegative,30);assert.equal(s.closingEntries,1);assert.equal(s.matchingDays,1);
});
test('ocorrências são dias classificados uma vez, sem atribuir causalidade ao BH',()=>{
 const s=compareSnapshot(range,[{...point,occurrence:'BH (-) Saída Antecipada'}],[report]);assert.deepEqual(s.occurrences,[{type:'Banco de horas',count:1},{type:'Saída antecipada',count:1}]);
});

test('arquivo com empresas ou referências diferentes não mistura cobertura',()=>{
 assert.throws(()=>parseBhText(head+'0002 OUTRA EMPRESA Pág.: 2'),/mais de uma empresa/);
 assert.throws(()=>parseBhText(head+'Período: 01/01/2026 a 18/02/2026'),/referências diferentes/);
});
