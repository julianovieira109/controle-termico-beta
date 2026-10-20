const {registration}=require('../importers/senior-bh');
function periodRange(value,mode='month',basis='closing'){
  if(!['month','year'].includes(mode)||!['closing','calendar'].includes(basis))throw new Error('Tipo de comparação inválido.');
  const pattern=mode==='month'?/^\d{4}-(0[1-9]|1[0-2])$/:/^\d{4}$/;
  if(!pattern.test(String(value)))throw new Error('Selecione mês/ano válidos para os dois períodos.');
  const year=Number(value.slice(0,4));if(year<2000||year>2100)throw new Error('Ano fora do intervalo permitido (2000 a 2100).');
  const month=mode==='year'?1:Number(value.slice(5,7));
  const iso=(y,m,d)=>new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10);
  if(basis==='closing')return {label:value,start:iso(year,month-1,19),end:iso(year,mode==='year'?12:month,18)};
  return {label:value,start:iso(year,month,1),end:iso(year,mode==='year'?13:month+1,0)};
}
const personKey=r=>`${r.company_id}|${r.branch_id}|${registration(r.registration)}`;
function occurrenceTypes(row){
  const state=String(row.point_state||'').toUpperCase(),text=String(row.occurrence||'').split(' | ')[0].trim();
  const labels={FOLGA:'Folga',FALTA:'Falta',ABSENT:'Falta',ATESTADO:'Atestado',MEDICAL:'Atestado',FERIAS:'Férias','FÉRIAS':'Férias',VACATION:'Férias',DSR:'DSR',LICENCA:'Licença','LICENÇA':'Licença',LICENSE:'Licença',AFASTAMENTO:'Afastamento',LEAVE:'Afastamento',COMPENSADO:'Compensado',CURSO:'Curso',OBITO:'Óbito','ÓBITO':'Óbito',REVIEW:'Para revisar',NO_MARKINGS:'Para revisar'};
  const types=[];
  if(labels[state])types.push(labels[state]);
  if(Number(row.bh_positive_minutes||0)>0||Number(row.bh_negative_minutes||0)>0)types.push('Banco de horas');
  if(/SA[ÍI]DA\s+ANTECIPADA/i.test(text))types.push('Saída antecipada');
  return types;
}
function occurrenceType(row){return occurrenceTypes(row).join(' · ')||null;}
function compareSnapshot(range,points,reports){
  const inRange=date=>date>=range.start&&date<=range.end;
  points=points.filter(p=>inRange(p.work_date));
  const analytic=reports.filter(r=>r.report_type==='ANALYTIC'&&r.period_start<=range.end&&r.period_end>=range.start);
  const synthetic=reports.filter(r=>r.report_type==='SYNTHETIC'&&r.period_end===range.end);
  // Most recent confirmed revision wins for each covered bank/day, even if that day has no event.
  const daily=new Map(),balances=new Map(),ledgerBalances=new Map();
  for(const report of [...analytic].reverse()){
    for(const r of report.records){
      const key=personKey({...report,registration:r.registration});
      const events=new Map();
      for(const e of r.events){if(!events.has(e.date))events.set(e.date,[]);events.get(e.date).push(e);}
      const start=report.period_start>range.start?report.period_start:range.start;
      const end=report.period_end<range.end?report.period_end:range.end;
      for(let date=start;date<=end;date=new Date(Date.parse(date)+86400000).toISOString().slice(0,10)){
        const list=events.get(date)||[];
        daily.set(`${key}|${r.bank}|${date}`,{key,date,bank:r.bank,events:list,reportId:report.id,file:report.file_name,page:list[0]?.page||r.page});
      }
      if(report.period_end===range.end)ledgerBalances.set(`${key}|${r.bank}`,{value:r.final,reportId:report.id,file:report.file_name,page:r.page,ledgerDifference:r.ledgerDifference});
    }
  }
  for(const report of [...synthetic].reverse())for(const r of report.records){
    const key=personKey({...report,registration:r.registration});balances.set(`${key}|${r.bank}`,{value:r.final,reportId:report.id,file:report.file_name,page:r.page,name:r.name});
  }
  const byPersonDay=new Map();let credits=0,debits=0,closingEntries=0,otherEntries=0;
  for(const row of daily.values()){
    const key=`${row.key}|${row.date}`;
    const aggregate=byPersonDay.get(key)||{positive:0,negative:0,sources:[]};
    aggregate.sources.push({file:row.file,page:row.page,bank:row.bank});
    for(const e of row.events){
      if(e.closing||e.origin!=='A'){if(e.closing||e.origin==='G')closingEntries++;else otherEntries++;continue;}
      if(e.minutes>=0){credits+=e.minutes;aggregate.positive+=e.minutes;}else{debits-=e.minutes;aggregate.negative-=e.minutes;}
    }
    byPersonDay.set(key,aggregate);
  }
  const mismatches=[],occurrences=new Map(),monthly=new Map();let comparedDays=0,matchingDays=0,unvalidatedDays=0;
  let workMinutes=0,unknownWorkDays=0,pointPositive=0,pointNegative=0,unknownBhDays=0;
  const employees=new Set();
  for(const p of points){
    employees.add(p.employee_id);if(p.work_minutes===null)unknownWorkDays++;else workMinutes+=Number(p.work_minutes||0);
    if(p.bh_validated){pointPositive+=Number(p.bh_positive_minutes||0);pointNegative+=Number(p.bh_negative_minutes||0);}else unknownBhDays++;
    const types=occurrenceTypes(p);for(const type of types)occurrences.set(type,(occurrences.get(type)||0)+1);
    const label=p.work_date.slice(0,7);const m=monthly.get(label)||{month:label,days:0,workMinutes:0,occurrences:0,unknownWorkDays:0};m.days++;m.workMinutes+=Number(p.work_minutes||0);if(p.work_minutes===null)m.unknownWorkDays++;m.occurrences+=types.length;monthly.set(label,m);
    const bh=byPersonDay.get(`${personKey(p)}|${p.work_date}`);if(!bh)continue;
    if(!p.bh_validated){unvalidatedDays++;continue;}
    comparedDays++;
    if(Number(p.bh_positive_minutes||0)===bh.positive&&Number(p.bh_negative_minutes||0)===bh.negative)matchingDays++;
    else mismatches.push({employeeId:p.employee_id,registration:p.registration,name:p.full_name,date:p.work_date,
      pointPositive:Number(p.bh_positive_minutes||0),pointNegative:Number(p.bh_negative_minutes||0),bhPositive:bh.positive,bhNegative:bh.negative,
      occurrence:occurrenceType(p),pointFile:p.source_file,bhSources:bh.sources});
  }
  const balanceMismatches=[];let balanceCompared=0;
  for(const [key,balance] of balances){
    const ledger=ledgerBalances.get(key);if(!ledger)continue;balanceCompared++;
    if(balance.value!==ledger.value||ledger.ledgerDifference)balanceMismatches.push({name:balance.name,bank:key.split('|').at(-1),registration:key.split('|')[2],analytic:ledger.value,synthetic:balance.value,ledgerDifference:ledger.ledgerDifference,analyticFile:ledger.file,syntheticFile:balance.file});
  }
  const used=new Set([...daily.values(),...balances.values(),...ledgerBalances.values()].map(r=>r.reportId));
  return {range,hasPoint:points.length>0,hasBh:analytic.length>0,hasBalance:balances.size>0,
    employees:employees.size,days:points.length,workMinutes:points.length&&!unknownWorkDays?workMinutes:null,knownWorkMinutes:workMinutes,unknownWorkDays,
    pointPositive:points.length&&!unknownBhDays?pointPositive:null,pointNegative:points.length&&!unknownBhDays?pointNegative:null,
    bhPositive:analytic.length?credits:null,bhNegative:analytic.length?debits:null,
    balance:balances.size?[...balances.values()].reduce((s,r)=>s+r.value,0):null,balanceDate:range.end,balanceRecords:balances.size,balanceCompared,balanceMismatches,
    comparedDays,matchingDays,unvalidatedDays,missingBhDays:points.length-comparedDays-unvalidatedDays,mismatchCount:mismatches.length,mismatches,
    closingEntries,otherEntries,occurrences:[...occurrences].map(([type,count])=>({type,count})),monthly:[...monthly.values()].sort((a,b)=>a.month.localeCompare(b.month)),
    sources:reports.filter(r=>used.has(r.id)).map(r=>({id:r.id,file:r.file_name,type:r.report_type,start:r.period_start,end:r.period_end})).filter(r=>r.start<=range.end&&r.end>=range.start)};
}
function guidance(a,b){
  const messages=[];
  for(const [label,s] of [['Período A',a],['Período B',b]]){
    if(!s.hasPoint)messages.push(`${label}: sem ponto confirmado; ausência de informação não significa zero.`);
    if(!s.hasBh)messages.push(`${label}: sem BH Analítico para comparar. Importe o relatório em Importações → Banco de Horas.`);
    if(s.missingBhDays)messages.push(`${label}: ${s.missingBhDays} dias de ponto sem cobertura de BH; não são divergências confirmadas.`);
    if(s.unvalidatedDays)messages.push(`${label}: ${s.unvalidatedDays} dias com BH do ponto não validado; confira a leitura antes de comparar.`);
    if(s.mismatchCount)messages.push(`${label}: ${s.mismatchCount} diferenças por matrícula/data. Confira os valores e códigos de situação na Senior; uma ocorrência no mesmo dia não comprova a causa.`);
    if(s.closingEntries||s.otherEntries)messages.push(`${label}: ${s.closingEntries+s.otherEntries} movimentos de fechamento/outras origens preservados no histórico e excluídos da comparação com o ponto.`);
    if(!s.hasBalance)messages.push(`${label}: sem BH Sintético na data ${s.range.end}; o saldo não foi estimado nem somado entre meses.`);
    if(s.balanceMismatches.length)messages.push(`${label}: ${s.balanceMismatches.length} saldos exigem conferência com o Analítico.`);
    if(s.hasBalance&&s.balanceCompared<s.balanceRecords)messages.push(`${label}: ${s.balanceRecords-s.balanceCompared} saldos sem Analítico encerrado na mesma data.`);
    if(s.comparedDays&&!s.mismatchCount)messages.push(`${label}: os valores de BH coincidem nos ${s.comparedDays} dias comparáveis.`);
  }
  if(a.hasPoint&&b.hasPoint){
    const types=new Set([...a.occurrences,...b.occurrences].map(r=>r.type));
    for(const type of types){const av=a.occurrences.find(r=>r.type===type)?.count||0,bv=b.occurrences.find(r=>r.type===type)?.count||0;if(av!==bv)messages.push(`${type}: ${av} → ${bv} dias (${bv>av?'aumento':'redução'} de ${Math.abs(bv-av)}). Os totais podem refletir cobertura e quantidade de colaboradores diferentes.`);}
  }
  return messages;
}
module.exports={periodRange,compareSnapshot,guidance,occurrenceType,occurrenceTypes};
