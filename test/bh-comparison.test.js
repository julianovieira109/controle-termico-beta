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

test('arquivo com empresas diferentes continua bloqueado',()=>{
 assert.throws(()=>parseBhText(head+'0002 OUTRA EMPRESA Pág.: 2'),/mais de uma empresa/);
});

function partialBlock(start,end,date,hours,initial,final){return `0001 EMPRESA TESTE Pág.: 1\nBanco de Horas Analítico\nPeríodo: ${start} a ${end}\n1 000000123 NOME DE TESTE\nBanco 001 BANCO Saldo Inicial: ${initial}\n${date} 301 A 00000:00 18/02/2027 ${hours} ${final}\nTotal do Banco 001 BANCO ${final}\nTotal Colaboradores 00001\n`;}
test('BH lê intervalos parciais distintos sem impor fechamento e sem preencher o intervalo vazio',()=>{
 const parsed=parseBhText(partialBlock('03/09/2026','05/09/2026','04/09/2026','001:00','010:00','011:00')+partialBlock('21/09/2026','22/09/2026','21/09/2026','000:30-','011:00','010:30'));
 assert.equal(parsed.errors.length,0);assert.equal(parsed.records.length,2);assert.equal(parsed.periods.length,2);assert.equal(parsed.start,'2026-09-03');assert.equal(parsed.end,'2026-09-22');
 const rows=[{...point,work_date:'2026-09-04',bh_positive_minutes:60,bh_negative_minutes:0},{...point,work_date:'2026-09-14',bh_positive_minutes:0,bh_negative_minutes:0},{...point,work_date:'2026-09-21',bh_positive_minutes:0,bh_negative_minutes:30}];
 const s=compareSnapshot(periodRange('2026-09','month','calendar'),rows,[{...report,period_start:parsed.start,period_end:parsed.end,records:parsed.records}]);
 assert.equal(s.comparedDays,2);assert.equal(s.missingBhDays,1);assert.equal(s.matchingDays,2);assert.equal(s.bhPositive,60);assert.equal(s.bhNegative,30);
});
test('Sintético com referências distintas usa somente saldo da data gerencial exata',()=>{
 const parsed=parseBhText('Banco de Horas Sintético\nReferência: 05/09/2026\n1 000000123 NOME DE TESTE 001 BANCO 00000:00 00001:00\nReferência: 18/10/2026\n1 000000123 NOME DE TESTE 001 BANCO 00000:00 00001:30');
 assert.equal(parsed.records.length,2);assert.equal(parsed.errors.length,0);
 const file={...report,report_type:'SYNTHETIC',period_start:parsed.start,period_end:parsed.end,records:parsed.records};
 assert.equal(compareSnapshot({start:'2026-09-01',end:'2026-09-05'},[],[file]).balance,60);
 assert.equal(compareSnapshot(periodRange('2026-09'),[],[file]).balance,null);
 assert.equal(compareSnapshot(range,[],[file]).balance,90);
});
test('revisão parcial substitui só seu bloco, mantendo dados anteriores fora da cobertura',()=>{
 const newer={...report,id:'new',period_start:'2026-09-01',period_end:'2026-10-31',records:[{...record,periodStart:'2026-09-21',periodEnd:'2026-09-22',events:[]}]};
 const s=compareSnapshot(range,[point,{...point,work_date:'2026-09-21',bh_positive_minutes:0,bh_negative_minutes:0}],[newer,report]);
 assert.equal(s.comparedDays,2);assert.equal(s.matchingDays,2);assert.equal(s.bhPositive,60);assert.equal(s.bhNegative,30);
});

test('blocos sobrepostos no mesmo PDF são lidos mas não podem ser confirmados como revisões',()=>{
 const p=parseBhText(partialBlock('01/09/2026','10/09/2026','08/09/2026','001:00','000:00','001:00')+partialBlock('08/09/2026','12/09/2026','08/09/2026','000:30','000:00','000:30'));
 assert.equal(p.records.length,2);assert.ok(p.errors.some(e=>e.includes('blocos sobrepostos')));
});

test('cabeçalho com datas quebradas em linhas mantém a leitura por bloco',()=>{
 const p=parseBhText(partialBlock('03/09/2026','05/09/2026','04/09/2026','001:00','000:00','001:00').replace('a 05/09/2026','a\n05/09/2026'));
 assert.equal(p.errors.length,0);assert.equal(p.records[0].periodStart,'2026-09-03');assert.equal(p.records[0].periodEnd,'2026-09-05');
 const s=parseBhText('Banco de Horas Sintético\nReferência:\n18/10/2026\n1 000000123 NOME DE TESTE 001 BANCO 00000:00 00010:30-');
 assert.equal(s.records[0].periodEnd,'2026-10-18');
});

test('bloco com cabeçalho incompleto não herda as datas do bloco anterior',()=>{
 const first=partialBlock('03/09/2026','05/09/2026','04/09/2026','001:00','000:00','001:00');
 const incomplete=partialBlock('21/09/2026','22/09/2026','21/09/2026','000:30','001:00','001:30').replace('Período: 21/09/2026 a 22/09/2026','Período: não identificado');
 assert.throws(()=>parseBhText(first+incomplete),/Datas de BH/);
 assert.throws(()=>parseBhText('Banco de Horas Sintético\nReferência: 18/10/2026\n1 000000123 NOME DE TESTE 001 BANCO 00000:00 00001:00\nReferência: não identificada\n1 000000456 OUTRO NOME 001 BANCO 00000:00 00001:30'),/Datas de BH/);
});
