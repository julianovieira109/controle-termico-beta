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


function reviewReason(day){
  const occurrence=String(day?.occurrence||'');
  const markings=Array.isArray(day?.markings)?day.markings:[];
  const ignored=Array.isArray(day?.ignoredMarkings)?day.ignoredMarkings:[];
  if(/JORNADA\s+INCOMPLETA/i.test(occurrence))return {code:'INCOMPLETE_JOURNEY',label:'Jornada incompleta informada pela Senior',priority:'HIGH'};
  if(/MARCA[CÇ][ÃA]O\s+SEM\s+PAR/i.test(occurrence)||ignored.length)return {code:'UNPAIRED_MARKING',label:'Marcação incompleta / batida sem par',priority:'HIGH'};
  if(day?.state==='NO_MARKINGS')return {code:'NO_MARKINGS',label:occurrence?`Sem marcações reconhecidas · ${occurrence}`:'Sem marcações reconhecidas',priority:'HIGH'};
  if(day?.state==='REVIEW'&&markings.length)return {code:'UNUSUAL_MARKINGS',label:`Quantidade incomum de marcações (${markings.length})`,priority:'MEDIUM'};
  return {code:'REVIEW',label:'Revisão necessária',priority:'MEDIUM'};
}

function buildReviewRows(employees){
  const rows=[];
  for(const employee of employees||[]){
    for(const day of employee.days||[]){
      if(day.state!=='REVIEW'&&day.state!=='NO_MARKINGS')continue;
      const reason=reviewReason(day);
      rows.push({
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
        reasonCode:reason.code,
        reason:reason.label,
        priority:reason.priority,
        workMinutes:number(day.workMinutes),
        bhNegativeMinutes:number(day.bhNegativeMinutes),
        bhPositiveMinutes:number(day.bhPositiveMinutes),
        absenceMinutes:number(day.absenceMinutes),
        sourceText:day.sourceText||null
      });
    }
  }
  return rows.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.employeeName||'').localeCompare(String(b.employeeName||''),'pt-BR'));
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
  const interpretedDays=number(parsed.totals?.days);
  const interpretationCoverage=structuredCount?interpretedDays/structuredCount:0;
  const cardPages=number(extraction.cardPages||extraction.totalPages);
  const validated=employees.filter(item=>item.bhReconciliation?.status==='VALIDATED').length;
  const mismatched=employees.filter(item=>item.bhReconciliation?.status==='MISMATCH').length;
  const unverified=employees.filter(item=>item.bhReconciliation?.status==='UNVERIFIED').length;
  const adjusted=employees.filter(item=>item.bhReconciliation?.adjustments?.length).length;
  const comparableEmployees=employees.filter(item=>item.footerTotals);
  const located=matchedRows.filter(item=>item.employeeId).length;
  const notFound=Math.max(0,matchedRows.length-located);
  const nameMismatch=matchedRows.filter(item=>item.employeeId&&item.result==='CONFERIR_NOME').length;
  const reviewDays=number(parsed.totals?.reviewDays);
  const warnings=Array.isArray(parsed.warnings)?parsed.warnings:[];

  // Para confirmação, a estrutura diária precisa estar integralmente
  // reconstruída e todos os colaboradores precisam ter fechamento Senior
  // conciliado e cadastro inequivocamente associado. A partir da Beta.78,
  // se a leitura e a conciliação estiverem corretas, mas houver matrículas
  // sem cadastro, tratamos isso como uma pendência cadastral (e não como erro
  // de leitura). A gravação continua bloqueada até o vínculo ser resolvido.
  const readingBlocked=structuralCoverage<1||interpretationCoverage<1||employees.length<cardPages||mismatched>0||unverified>0;
  const registryBlocked=notFound>0||nameMismatch>0;
  const blocked=readingBlocked||registryBlocked;
  const hasAlerts=!blocked&&(reviewDays>0||warnings.length>0||adjusted>0);
  const status=blocked?'BLOCKED':hasAlerts?'WARNING':'TRUSTED';
  const blockingCategory=readingBlocked?'READING_DIVERGENCE':registryBlocked?'REGISTRY_PENDING':null;
  const statusLabel=blockingCategory==='REGISTRY_PENDING'
    ?'Aguardando vínculo cadastral'
    :status==='TRUSTED'?'Leitura confiável':status==='WARNING'?'Leitura com alertas':'Importação bloqueada';

  // "confidence" mede agora somente a confiança da leitura/conciliação do
  // Cartão Senior. A cobertura cadastral fica separada, para não sugerir que
  // uma matrícula nova significa falha do leitor.
  const structuralScore=Math.floor(Math.min(1,structuralCoverage,interpretationCoverage)*50);
  const employeeBase=Math.max(cardPages,employees.length,1);
  const reconciliationScore=Math.floor(Math.min(1,validated/employeeBase)*50);
  const confidence=Math.max(0,Math.min(100,structuralScore+reconciliationScore));
  const registryBase=Math.max(matchedRows.length,1);
  const registryCoverage=matchedRows.length
    ?Number((Math.max(0,located-nameMismatch)/registryBase*100).toFixed(1))
    :0;
  const reasons=[];
  if(structuralCoverage<1)reasons.push(`${structuredCount} de ${dateRows} linhas diárias foram reconstruídas pelas colunas da Senior. A confirmação exige 100%.`);
  if(interpretationCoverage<1)reasons.push(`${interpretedDays} de ${structuredCount} linhas estruturadas foram interpretadas como dias do cartão. A confirmação exige 100%.`);
  if(employees.length<cardPages)reasons.push(`${employees.length} de ${cardPages} cartões/páginas de colaborador foram identificados. Revise cabeçalhos não reconhecidos.`);
  if(mismatched)reasons.push(`${mismatched} colaborador(es) apresentam divergência entre os dias e o fechamento da Senior.`);
  if(unverified)reasons.push(`${unverified} colaborador(es) não possuem fechamento validável no arquivo.`);
  if(notFound)reasons.push(`${notFound} matrícula(s) do PDF não foram localizadas no cadastro selecionado.`);
  if(nameMismatch)reasons.push(`${nameMismatch} matrícula(s) foram localizadas, mas o nome diverge do cadastro e exige conferência.`);
  if(reviewDays)reasons.push(`${reviewDays} dia(s) possuem marcações incompletas ou precisam de revisão.`);
  if(adjusted)reasons.push(`${adjusted} colaborador(es) tiveram conciliação controlada de pequenos resíduos de BH-.`);
  if(!reasons.length)reasons.push('Estrutura, matrículas, nomes e totais de fechamento foram conciliados.');

  // Nunca comparar universos diferentes. Se apenas parte dos rodapés foi
  // localizada, os totais abaixo usam exclusivamente os colaboradores que
  // possuem fechamento oficial disponível nos dois lados da comparação.
  const fields=['workMinutes','bhNegativeMinutes','bhPositiveMinutes','he100Minutes','absenceMinutes'];
  const totals={};
  for(const field of fields){
    const daily=sumDays(comparableEmployees,field);
    const official=sumFooters(comparableEmployees,field);
    totals[field]={daily,official,difference:daily-official};
  }
  const raw=rawExtractionLines(extraction.text);
  const structuredRows=buildStructuredRows(employees);
  const reviewRows=buildReviewRows(employees);
  return {
    status,
    statusLabel,
    blockingCategory,
    canConfirm:!blocked&&located>0,
    confidence,
    registryCoverage,
    reasons,
    elapsedMs:number(elapsedMs),
    extraction:{
      readerUsed:extraction.readerUsed||'pdf2json-senior-columns',
      totalPages:number(extraction.totalPages),
      cardPages,
      safePages:number(extraction.safePages),
      footerRows:number(extraction.footerRows),
      dateRows,
      structuredRows:structuredCount,
      structuralCoverage:Number((Math.min(1,structuralCoverage)*100).toFixed(1)),
      interpretedRows:interpretedDays,
      interpretationCoverage:Number((Math.min(1,interpretationCoverage)*100).toFixed(1)),
      rawLines:raw.total,
      rawLinesTruncated:raw.truncated
    },
    matching:{employees:employees.length,located,notFound,nameMismatch},
    reconciliation:{validated,mismatched,unverified,adjusted,comparable:comparableEmployees.length},
    activity:{days:number(parsed.totals?.days),eligibleDays:number(parsed.totals?.eligibleDays),reviewDays,nonWorkDays:number(parsed.totals?.nonWorkDays)},
    totals,
    warnings,
    structuredRows,
    reviewRows,
    rawLines:raw.rows
  };
}

module.exports={buildTimecardAudit,buildStructuredRows,buildReviewRows,reviewReason,rawExtractionLines};
