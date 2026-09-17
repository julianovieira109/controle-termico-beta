function number(value){
  const parsed=Number(value||0);
  return Number.isFinite(parsed)?parsed:0;
}

function sumDays(employees,field){
  return employees.reduce((total,employee)=>total+(employee.days||[]).reduce((subtotal,day)=>subtotal+number(day[field]),0),0);
}

function sumFooters(employees,field){
  return employees.reduce((total,employee)=>total+number(employee.footerTotals?.[field]),0);
}

function rawExtractionLines(text,limit=6000){
  const result=[];
  const pages=String(text||'').split(/\f/);
  for(const [pageIndex,page] of pages.entries()){
    const lines=page.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    for(const [lineIndex,line] of lines.entries()){
      if(result.length>=limit)return {rows:result,total:result.length,truncated:true};
      result.push({page:pageIndex+1,line:lineIndex+1,text:line});
    }
  }
  return {rows:result,total:result.length,truncated:false};
}

function buildStructuredRows(employees){
  return employees.flatMap(employee=>(employee.days||[]).map(day=>({
    page:employee.page||null,
    line:day.sourceLine||null,
    registration:employee.registration,
    employeeName:employee.name,
    date:day.date,
    scheduleCode:day.scheduleCode,
    markings:Array.isArray(day.markings)?day.markings:[],
    ignoredMarkings:Array.isArray(day.ignoredMarkings)?day.ignoredMarkings:[],
    occurrence:day.occurrence||null,
    state:day.state,
    workMinutes:number(day.workMinutes),
    bhNegativeMinutes:number(day.bhNegativeMinutes),
    bhPositiveMinutes:number(day.bhPositiveMinutes),
    he100Minutes:number(day.he100Minutes),
    absenceMinutes:number(day.absenceMinutes),
    nightAdditionalMinutes:number(day.nightAdditionalMinutes),
    travelMinutes:number(day.travelMinutes),
    bhSource:day.bhSource||null,
    bhValidated:Boolean(day.bhValidated),
    sourceText:day.sourceText||null
  })));
}

function buildTimecardAudit({extraction={},parsed={},rows=[],elapsedMs=0}){
  const employees=Array.isArray(parsed.employees)?parsed.employees:[];
  const matchedRows=Array.isArray(rows)?rows:[];
  const dateRows=number(extraction.dateRows);
  const structuredCount=number(extraction.structuredRows);
  const structuralCoverage=dateRows?structuredCount/dateRows:0;
  const validated=employees.filter(item=>item.bhReconciliation?.status==='VALIDATED').length;
  const mismatched=employees.filter(item=>item.bhReconciliation?.status==='MISMATCH').length;
  const unverified=employees.filter(item=>item.bhReconciliation?.status==='UNVERIFIED').length;
  const adjusted=employees.filter(item=>item.bhReconciliation?.adjustments?.length).length;
  const located=matchedRows.filter(item=>item.employeeId).length;
  const notFound=Math.max(0,matchedRows.length-located);
  const reviewDays=number(parsed.totals?.reviewDays);
  const warnings=Array.isArray(parsed.warnings)?parsed.warnings:[];
  const blocked=structuralCoverage<0.95||mismatched>0||unverified>0;
  const hasAlerts=!blocked&&(notFound>0||reviewDays>0||warnings.length>0||adjusted>0);
  const status=blocked?'BLOCKED':hasAlerts?'WARNING':'TRUSTED';
  const statusLabel=status==='TRUSTED'?'Leitura confiável':status==='WARNING'?'Leitura com alertas':'Importação bloqueada';
  const structuralScore=Math.round(Math.min(1,structuralCoverage)*40);
  const reconciliationScore=Math.round((employees.length?validated/employees.length:0)*40);
  const matchingScore=Math.round((matchedRows.length?located/matchedRows.length:0)*20);
  const confidence=Math.max(0,Math.min(100,structuralScore+reconciliationScore+matchingScore));
  const reasons=[];
  if(structuralCoverage<0.95)reasons.push(`${structuredCount} de ${dateRows} linhas diárias foram reconstruídas pelas colunas da Senior.`);
  if(mismatched)reasons.push(`${mismatched} colaborador(es) apresentam divergência entre os dias e o fechamento da Senior.`);
  if(unverified)reasons.push(`${unverified} colaborador(es) não possuem fechamento validável no arquivo.`);
  if(notFound)reasons.push(`${notFound} matrícula(s) do PDF não foram localizadas no cadastro selecionado.`);
  if(reviewDays)reasons.push(`${reviewDays} dia(s) possuem marcações incompletas ou precisam de revisão.`);
  if(adjusted)reasons.push(`${adjusted} colaborador(es) tiveram conciliação controlada de pequenos resíduos de BH-.`);
  if(!reasons.length)reasons.push('Estrutura, matrículas e totais de fechamento foram conciliados.');

  const fields=['workMinutes','bhNegativeMinutes','bhPositiveMinutes','he100Minutes','absenceMinutes'];
  const totals={};
  for(const field of fields){
    const daily=sumDays(employees,field);
    const official=sumFooters(employees,field);
    totals[field]={daily,official,difference:daily-official};
  }
  const raw=rawExtractionLines(extraction.text);
  const structuredRows=buildStructuredRows(employees);
  return {
    status,
    statusLabel,
    canConfirm:!blocked&&located>0,
    confidence,
    reasons,
    elapsedMs:number(elapsedMs),
    extraction:{
      readerUsed:extraction.readerUsed||'pdf2json-senior-columns',
      totalPages:number(extraction.totalPages),
      safePages:number(extraction.safePages),
      dateRows,
      structuredRows:structuredCount,
      structuralCoverage:Number((Math.min(1,structuralCoverage)*100).toFixed(1)),
      rawLines:raw.total,
      rawLinesTruncated:raw.truncated
    },
    matching:{employees:employees.length,located,notFound},
    reconciliation:{validated,mismatched,unverified,adjusted},
    activity:{days:number(parsed.totals?.days),eligibleDays:number(parsed.totals?.eligibleDays),reviewDays,nonWorkDays:number(parsed.totals?.nonWorkDays)},
    totals,
    warnings,
    structuredRows,
    rawLines:raw.rows
  };
}

module.exports={buildTimecardAudit,buildStructuredRows,rawExtractionLines};
