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
  const occurrence=String(day?.occurrence||'').trim();
  const markings=Array.isArray(day?.markings)?day.markings:[];
  const ignored=Array.isArray(day?.ignoredMarkings)?day.ignoredMarkings:[];
  const hasSeniorTotals=[day?.workMinutes,day?.bhNegativeMinutes,day?.bhPositiveMinutes,day?.absenceMinutes]
    .some(value=>Number(value||0)>0);
  const hourlyMedical=Boolean(day?.hourlyMedical)||/ATESTADO(?:\s+NOTURNO)?\s+EM\s+HORAS/i.test(occurrence)||/ATESTADO.*\bHORAS\b/i.test(occurrence);
  const earlyExit=Boolean(day?.explicitEarlyExit)||/SA[ÍI]DA\s+ANTECIPADA/i.test(occurrence);
  const bankMovement=/\bBH\b|BANCO\s+DE\s+HORAS/i.test(occurrence);

  if(/JORNADA\s+INCOMPLETA/i.test(occurrence)){
    return {
      code:'INCOMPLETE_JOURNEY',
      label:'Jornada incompleta informada pela Senior',
      priority:'HIGH',
      explainedBySenior:false,
      context:'A Senior sinalizou a jornada como incompleta; confira a marcação faltante antes de usar o dia operacionalmente.'
    };
  }

  if(hourlyMedical){
    return {
      code:'MEDICAL_HOURS',
      label:'Atestado em horas — ocorrência reconhecida pela Senior',
      priority:'MEDIUM',
      explainedBySenior:true,
      context:'A ausência de parte das marcações pode decorrer do atestado em horas. Os valores oficiais da Senior são preservados.'
    };
  }

  if(earlyExit){
    return {
      code:'EARLY_EXIT',
      label:'Saída antecipada — ocorrência reconhecida pela Senior',
      priority:'MEDIUM',
      explainedBySenior:true,
      context:'A jornada terminou antes do horário-base. O sistema preserva as batidas e os valores calculados pela Senior.'
    };
  }

  if(/MARCA[CÇ][ÃA]O\s+SEM\s+PAR/i.test(occurrence)||ignored.length){
    return {
      code:'UNPAIRED_MARKING',
      label:'Marcação incompleta / batida sem par',
      priority:'HIGH',
      explainedBySenior:false,
      context:'Existe batida sem par confirmado. O sistema não inventa a marcação ausente.'
    };
  }

  if(day?.state==='NO_MARKINGS'){
    if(occurrence||hasSeniorTotals){
      const suffix=occurrence?` · ${occurrence}`:'';
      return {
        code:'SENIOR_CONSOLIDATED_NO_MARKINGS',
        label:`Lançamento Senior sem marcações completas${suffix}`,
        priority:'MEDIUM',
        explainedBySenior:true,
        context:bankMovement
          ?'A Senior trouxe horas/lançamento de banco sem batidas individuais. Pode ocorrer quando o colaborador não registrou o ponto e o tratamento foi lançado na Senior.'
          :'A Senior trouxe valores consolidados sem batidas individuais. Confira o contexto operacional, mas não trate como falha do leitor.'
      };
    }
    return {
      code:'NO_MARKINGS_UNEXPLAINED',
      label:'Sem marcações e sem justificativa explícita — conferir possível falta de batida',
      priority:'HIGH',
      explainedBySenior:false,
      context:'Não há marcações nem ocorrência suficiente para explicar o dia.'
    };
  }

  if(day?.state==='REVIEW'&&markings.length){
    if(bankMovement){
      return {
        code:'PARTIAL_MARKINGS_WITH_SENIOR_EVENT',
        label:`Marcações parciais com lançamento Senior · ${occurrence||'BH'}`,
        priority:'MEDIUM',
        explainedBySenior:true,
        context:'As batidas não formam a jornada-base completa, mas a Senior registrou a ocorrência e os totais. Nenhuma batida é inventada.'
      };
    }
    return {
      code:'UNUSUAL_MARKINGS',
      label:`Quantidade incomum de marcações (${markings.length})`,
      priority:'MEDIUM',
      explainedBySenior:false,
      context:'Confira se houve falta de batida, saída antecipada ou outro tratamento ainda não identificado no texto da Senior.'
    };
  }

  return {code:'REVIEW',label:'Revisão necessária',priority:'MEDIUM',explainedBySenior:false,context:'Conferência operacional necessária.'};
}

function reviewRestPolicy(day){
  if(day?.eligibleForAutomaticRest){
    if(day?.requiresReview){
      return {
        code:'CONFIRMED_INTERVAL_ONLY',
        label:'Repouso automático somente nos intervalos confirmados pelas marcações',
        allowed:true
      };
    }
    return {code:'AUTO_ALLOWED',label:'Repouso automático permitido pelas marcações confirmadas',allowed:true};
  }
  return {
    code:'NO_AUTO_REST_INSUFFICIENT_MARKINGS',
    label:'Não gerar repouso automaticamente — horários insuficientes ou jornada não confirmada',
    allowed:false
  };
}

function buildReviewRows(employees){
  const rows=[];
  for(const employee of employees||[]){
    for(const day of employee.days||[]){
      if(day.requiresReview!==true&&day.state!=='REVIEW'&&day.state!=='NO_MARKINGS')continue;
      const reason=reviewReason(day);
      const restPolicy=reviewRestPolicy(day);
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
        explainedBySenior:Boolean(reason.explainedBySenior),
        reviewContext:reason.context||null,
        expectedMarkingsCount:number(day.expectedMarkingsCount),
        incompleteAgainstSchedule:Boolean(day.incompleteAgainstSchedule),
        restPolicyCode:restPolicy.code,
        restPolicy:restPolicy.label,
        automaticRestAllowed:Boolean(restPolicy.allowed),
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
    requiresReview:Boolean(day.requiresReview),
    expectedMarkingsCount:number(day.expectedMarkingsCount),
    incompleteAgainstSchedule:Boolean(day.incompleteAgainstSchedule),
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
  if(reviewDays){
    const provisionalReviewRows=buildReviewRows(employees);
    const high=provisionalReviewRows.filter(item=>item.priority==='HIGH').length;
    const explained=provisionalReviewRows.filter(item=>item.explainedBySenior).length;
    reasons.push(`${reviewDays} dia(s) estão na fila de conferência: ${high} de alta prioridade e ${explained} com ocorrência/lançamento já reconhecido pela Senior.`);
  }
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

module.exports={buildTimecardAudit,buildStructuredRows,buildReviewRows,reviewReason,reviewRestPolicy,rawExtractionLines};
