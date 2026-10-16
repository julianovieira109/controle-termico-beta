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


function markingMinutes(value){
  const match=String(value||'').match(/^(\d{2}):(\d{2})$/);
  if(!match)return null;
  const hour=Number(match[1]);
  const minute=Number(match[2]);
  if(hour>23||minute>59)return null;
  return hour*60+minute;
}

function dayMarkingMoments(day){
  const markings=Array.isArray(day?.markings)?day.markings:[];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day?.date||''))||markings.length<2)return null;
  const base=Math.floor(Date.parse(`${day.date}T00:00:00Z`)/60000);
  let rollover=0;
  let previous=null;
  const moments=[];
  for(const marking of markings){
    const minute=markingMinutes(marking);
    if(minute==null)return null;
    if(previous!=null&&minute<previous)rollover+=1440;
    moments.push(base+rollover+minute);
    previous=minute;
  }
  return moments;
}

function reportedMarkings(day){
  if(Array.isArray(day?.reportedMarkings))return day.reportedMarkings;
  const used=Array.isArray(day?.markings)?day.markings:[];
  const ignored=Array.isArray(day?.ignoredMarkings)?day.ignoredMarkings:[];
  return [...used,...ignored];
}

function confirmedJourneyBoundary(day){
  const markings=Array.isArray(day?.markings)?day.markings:[];
  const original=reportedMarkings(day);
  const ignored=Array.isArray(day?.ignoredMarkings)?day.ignoredMarkings:[];
  const occurrence=String(day?.occurrence||'');
  return day?.state==='WORKED'
    &&markings.length>=2
    &&markings.length%2===0
    &&original.length===markings.length
    &&!ignored.length
    &&day?.requiresReview!==true
    &&day?.incompleteAgainstSchedule!==true
    &&!/JORNADA\s+INCOMPLETA|\bFALTAS?\b/i.test(occurrence);
}

function buildOperationalIndicators(employees){
  const rows=[];
  for(const employee of employees||[]){
    const days=[...(employee.days||[])].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));

    // Beta.86 — a ocorrência oficial da Senior vem primeiro. A quantidade de
    // marcações serve apenas para contextualizar o indicador e nunca para
    // substituir/reclassificar Falta, Jornada Incompleta, BH- ou outra
    // ocorrência emitida pela Senior.
    for(const day of days){
      const occurrence=String(day?.occurrence||'');
      const original=reportedMarkings(day);
      const count=Number(day?.reportedMarkingsCount??original.length);
      const isAbsence=day?.state==='FALTA'||/\bFALTAS?\b/i.test(occurrence);
      const isIncomplete=/JORNADA\s+INCOMPLETA/i.test(occurrence)||day?.seniorClassification==='JORNADA_INCOMPLETA';

      if(isAbsence){
        let code='ABSENCE_WITH_PARTIAL_MARKINGS';
        let label='Falta com marcações — ocorrência informada pela Senior';
        let evidence=`A Senior trouxe Falta com ${count} marcação(ões). O Controle Térmico preserva essa classificação.`;
        let priority='HIGH';

        if(count===0){
          code='ABSENCE_WITHOUT_MARKINGS';
          label='Falta sem marcações — informação da Senior';
          evidence='A Senior trouxe Falta sem nenhuma marcação no dia.';
          priority='MEDIUM';
        }else if(count===1){
          code='ABSENCE_WITH_SINGLE_MARKING';
          label='Falta com 1 marcação — classificação da Senior';
          evidence=`A Senior trouxe Falta com a marcação ${original[0]||'registrada'}. O Controle Térmico não transforma essa batida em jornada nem cria a batida ausente.`;
        }else{
          evidence=`A Senior trouxe Falta com ${count} marcação(ões). Esse cenário pode estar relacionado a ausência de hora/batida no intervalo ou na jornada, mas somente a Senior define e corrige o ponto.`;
        }

        rows.push({
          category:'ABSENCE',
          code,
          priority,
          registration:employee.registration,
          employeeName:employee.name,
          page:employee.page||null,
          line:day.sourceLine||null,
          date:day.date,
          scheduleCode:day.scheduleCode,
          markings:original,
          occurrence:day.occurrence||'Falta',
          label,
          evidence,
          guidance:'Somente indicador. Se houver necessidade de ajuste, a correção deve ser feita exclusivamente na Senior e validada em nova importação.',
          sourceText:day.sourceText||null
        });
      }

      if(isIncomplete){
        rows.push({
          category:'INCOMPLETE_JOURNEY',
          code:'INCOMPLETE_JOURNEY_SENIOR',
          priority:'HIGH',
          registration:employee.registration,
          employeeName:employee.name,
          page:employee.page||null,
          line:day.sourceLine||null,
          date:day.date,
          scheduleCode:day.scheduleCode,
          markings:original,
          occurrence:day.occurrence||'Jornada Incompleta',
          bhNegativeMinutes:number(day.bhNegativeMinutes),
          label:'Jornada Incompleta — classificação da Senior',
          evidence:`A Senior trouxe Jornada Incompleta com ${count} marcação(ões)${number(day.bhNegativeMinutes)>0?` e BH- de ${Math.floor(number(day.bhNegativeMinutes)/60)}h${String(number(day.bhNegativeMinutes)%60).padStart(2,'0')}`:''}. Os valores são apenas preservados e exibidos.`,
          guidance:'Não completar batidas e não recalcular BH-. Qualquer correção deve ocorrer na Senior e retornar por nova leitura do relatório.',
          sourceText:day.sourceText||null
        });
      }
    }

    // Interjornada: somente indicador entre duas jornadas consecutivas que
    // estejam integralmente confirmadas pelas marcações reais da Senior. Um
    // dia incompleto nunca é ignorado para "pular" até outra jornada e nunca
    // fornece entrada/saída presumida.
    for(let index=1;index<days.length;index++){
      const previous=days[index-1];
      const current=days[index];
      if(!confirmedJourneyBoundary(previous)||!confirmedJourneyBoundary(current))continue;
      const previousMoments=dayMarkingMoments(previous);
      const currentMoments=dayMarkingMoments(current);
      if(!previousMoments||!currentMoments)continue;
      const restMinutes=currentMoments[0]-previousMoments[previousMoments.length-1];
      if(restMinutes<0||restMinutes>=11*60)continue;
      rows.push({
        category:'INTERJOURNEY',
        code:'INTERJOURNEY_UNDER_11H',
        priority:'MEDIUM',
        registration:employee.registration,
        employeeName:employee.name,
        page:employee.page||null,
        date:current.date,
        previousDate:previous.date,
        scheduleCode:current.scheduleCode,
        markings:[previous.markings[previous.markings.length-1],current.markings[0]],
        occurrence:null,
        restMinutes,
        label:'Descanso entre jornadas inferior a 11 horas — aviso informativo',
        evidence:`Fim anterior ${previous.markings[previous.markings.length-1]} · próxima entrada ${current.markings[0]} · descanso ${Math.floor(restMinutes/60)}h${String(restMinutes%60).padStart(2,'0')}.`,
        guidance:'Somente aviso. Qualquer análise ou correção deve ser feita na Senior; o Controle Térmico não altera horários.',
        sourceText:null
      });
    }
  }
  return rows.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.employeeName||'').localeCompare(String(b.employeeName||''),'pt-BR'));
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
      explainedBySenior:true,
      context:'A Senior classificou a jornada como incompleta. O Controle Térmico preserva as marcações e o BH- informado pela Senior, sem completar batidas nem recalcular valores.'
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
        reportedMarkings:reportedMarkings(day),
        reportedMarkingsCount:Number(day.reportedMarkingsCount??reportedMarkings(day).length),
        ignoredMarkings:Array.isArray(day.ignoredMarkings)?day.ignoredMarkings:[],
        occurrence:day.occurrence||null,
        seniorClassification:day.seniorClassification||null,
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
        interjourneyValidation:confirmedJourneyBoundary(day)
          ?'Pode ser calculada somente pelas marcações reais da Senior'
          :'Interjornada não validada neste dia: nenhuma entrada ou saída é presumida a partir de jornada incompleta',
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
    reportedMarkings:reportedMarkings(day),
    reportedMarkingsCount:Number(day.reportedMarkingsCount??reportedMarkings(day).length),
    ignoredMarkings:Array.isArray(day.ignoredMarkings)?day.ignoredMarkings:[],
    occurrence:day.occurrence||null,
    seniorClassification:day.seniorClassification||null,
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
  const indicatorRows=buildOperationalIndicators(employees);
  const indicatorSummary={
    absenceWithoutMarkings:indicatorRows.filter(item=>item.code==='ABSENCE_WITHOUT_MARKINGS').length,
    absenceWithSingleMarking:indicatorRows.filter(item=>item.code==='ABSENCE_WITH_SINGLE_MARKING').length,
    absenceWithPartialMarkings:indicatorRows.filter(item=>item.code==='ABSENCE_WITH_PARTIAL_MARKINGS').length,
    incompleteJourneySenior:indicatorRows.filter(item=>item.code==='INCOMPLETE_JOURNEY_SENIOR').length,
    interjourneyUnder11h:indicatorRows.filter(item=>item.code==='INTERJOURNEY_UNDER_11H').length
  };

  // Para confirmação, a estrutura diária precisa estar integralmente
  // reconstruída e todos os colaboradores precisam ter fechamento Senior
  // conciliado e cadastro inequivocamente associado. A partir da Beta.78,
  // se a leitura e a conciliação estiverem corretas, mas houver matrículas
  // sem cadastro, tratamos isso como uma pendência cadastral (e não como erro
  // de leitura). A gravação continua bloqueada até o vínculo ser resolvido.
  const readingBlocked=structuralCoverage<1||interpretationCoverage<1||employees.length<cardPages||mismatched>0||unverified>0;
  const registryBlocked=notFound>0||nameMismatch>0;
  const blocked=readingBlocked||registryBlocked;
  const hasAlerts=!blocked&&(reviewDays>0||warnings.length>0||indicatorRows.length>0);
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
  if(indicatorSummary.absenceWithSingleMarking)reasons.push(`${indicatorSummary.absenceWithSingleMarking} ocorrência(s) de Falta possuem exatamente 1 marcação e permanecem classificadas conforme a Senior.`);
  if(indicatorSummary.absenceWithPartialMarkings)reasons.push(`${indicatorSummary.absenceWithPartialMarkings} ocorrência(s) de Falta possuem mais de uma marcação; a ocorrência da Senior é preservada e deve ser conferida nela.`);
  if(indicatorSummary.incompleteJourneySenior)reasons.push(`${indicatorSummary.incompleteJourneySenior} ocorrência(s) de Jornada Incompleta foram informadas pela Senior; marcações e BH- são exibidos sem qualquer recalculo.`);
  if(indicatorSummary.interjourneyUnder11h)reasons.push(`${indicatorSummary.interjourneyUnder11h} aviso(s) de descanso entre jornadas abaixo de 11 horas foram identificados. São apenas indicadores; nenhum horário foi alterado.`);
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
    sourcePolicy:{sourceOfTruth:'SENIOR',indicatorOnly:true,mutatesPoint:false,label:'Senior é a fonte oficial · Controle Térmico somente lê, confere e sinaliza'},
    indicators:{summary:indicatorSummary,rows:indicatorRows},
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

module.exports={buildTimecardAudit,buildStructuredRows,buildReviewRows,buildOperationalIndicators,reviewReason,reviewRestPolicy,rawExtractionLines};
