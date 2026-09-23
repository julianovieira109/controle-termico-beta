const NON_WORK_PATTERNS=[
  ["DSR",/\bDSR\b/i],
  ["FERIADO",/\bFERIADO\b/i],
  ["FOLGA",/\bFOLGA\b/i],
  ["FERIAS",/\bF[ÉE]RIAS\b/i],
  ["FALTA",/\bFALTAS?\b/i],
  ["ATESTADO",/\bATESTADO\b/i],
  ["COMPENSADO",/\bCOMPENSADO\b/i],
  ["CURSO",/\bCURSO\b/i],
  ["OBITO",/\b[ÓO]BITO\b/i],
  ["LICENCA",/\bLICEN[ÇC]A\b/i],
  ["SUSPENSAO",/\bSUSPENS[ÃA]O\b/i],
  ["AFASTAMENTO",/\b(?:AFASTAMENTO|AUX[ÍI]LIO\s+DOEN[ÇC]A)\b/i]
];

const OCCURRENCE_ONLY_PATTERNS=[
  /\bADICIONAL\s+NOTURNO\b/i,
  /\bSA[ÍI]DA\s+INTERMEDI[ÁA]RIA(?:\s+NOTURNA)?\b/i,
  /\bJORNADA\s+INCOMPLETA\b/i
];

function clean(value){
  return String(value||"").replace(/\s+/g," ").trim();
}

function isoDate(dayMonth,start,end){
  const [day,month]=dayMonth.split("/").map(Number);
  const startMonth=Number(start.slice(5,7));
  const startYear=Number(start.slice(0,4));
  const endYear=Number(end.slice(0,4));
  const year=month>=startMonth?startYear:endYear;
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

function parsePeriod(block){
  const match=block.match(/Per[íi]odo\s*:\s*(\d{2})\/(\d{2})\/(\d{4})\s*a\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if(!match)return null;
  return {
    start:`${match[3]}-${match[2]}-${match[1]}`,
    end:`${match[6]}-${match[5]}-${match[4]}`
  };
}

function parseEmployee(block){
  const source=String(block||"");
  const direct=source.match(/Empregado:\s*(\d{5,12})\s+([^\n]+)/i);
  if(direct)return {registration:direct[1].replace(/^0+(?=\d)/,""),rawRegistration:direct[1],name:clean(direct[2])};

  // O pdf2json pode separar o rótulo "Empregado:" da matrícula/nome em
  // páginas específicas (observado inclusive na última página de relatórios
  // reais da Senior). Por isso, o cabeçalho é analisado linha a linha antes
  // da tabela diária, procurando uma matrícula longa seguida de nome.
  const header=source.split(/Data\s+Sem\s+Hor\s+Marcações/i)[0]||source;
  const lines=header.split(/\r?\n/).map(clean).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    let match=line.match(/(?:Empregado:\s*)?(\d{5,12})\s+([A-ZÀ-Ü][A-ZÀ-Ü .'-]{3,})(?:\s+CPF:.*)?$/i);
    if(match){
      const rawRegistration=match[1];
      return {registration:rawRegistration.replace(/^0+(?=\d)/,""),rawRegistration,name:clean(match[2])};
    }
    // Variante em que matrícula e nome também foram quebrados em duas linhas.
    if(/^\d{5,12}$/.test(line)&&i+1<lines.length&&/^[A-ZÀ-Ü][A-ZÀ-Ü .'-]{3,}$/i.test(lines[i+1])){
      const rawRegistration=line;
      return {registration:rawRegistration.replace(/^0+(?=\d)/,""),rawRegistration,name:clean(lines[i+1])};
    }
  }

  const pdfParse=source.match(/(?:Localiza[çc][ãa]o:\s*\n)?(\d{5,12})\s*([A-ZÀ-Ü][A-ZÀ-Ü .'-]{3,})\n(?:Mensalista|Horista)Categoria:/i);
  if(!pdfParse)return null;
  return {
    registration:pdfParse[1].replace(/^0+(?=\d)/,""),
    rawRegistration:pdfParse[1],
    name:clean(pdfParse[2])
  };
}

function parseScheduleDefinitions(block){
  const definitions=new Map();
  const header=String(block||"").split(/Data\s+Sem\s+Hor\s+Marcações/i)[0]||"";
  for(const line of header.split(/\r?\n/)){
    const match=line.match(/(?:Horários:\s*)?(\d{4})\s+((?:(?:[01]\d|2[0-3]):[0-5]\d\s*){2,6})/i);
    if(!match)continue;
    const times=match[2].match(/(?:[01]\d|2[0-3]):[0-5]\d/g)||[];
    if(times.length>=2)definitions.set(match[1],times);
  }
  return definitions;
}

function minutesBetweenPairs(markings){
  let total=0;
  for(let i=0;i+1<markings.length;i+=2){
    const [ah,am]=markings[i].split(":").map(Number);
    const [bh,bm]=markings[i+1].split(":").map(Number);
    let start=ah*60+am,end=bh*60+bm;
    if(end<start)end+=1440;
    total+=end-start;
  }
  return total;
}

function hhmmDuration(minutes){
  return `${String(Math.floor(minutes/60)).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}`;
}


function durationToMinutes(value){
  const match=String(value||"").trim().match(/^(\d{1,3}):(\d{2})$/);
  if(!match)return 0;
  return Number(match[1])*60+Number(match[2]);
}

function parseExplicitColumns(payload){
  const marker="||SENIOR_COLS||";
  const index=String(payload||"").indexOf(marker);
  if(index<0)return null;
  const base=String(payload).slice(0,index).trim();
  const encoded=String(payload).slice(index+marker.length).trim();
  const values={};
  for(const part of encoded.split(";")){
    const [key,...rest]=part.split("=");
    if(key)values[key.trim()]=rest.join("=").trim();
  }
  return {
    base,
    workMinutes:durationToMinutes(values.W),
    bhNegativeMinutes:durationToMinutes(values.BM),
    bhNegativeRawMinutes:durationToMinutes(values.BM),
    bhPositiveMinutes:durationToMinutes(values.BP),
    he100Minutes:durationToMinutes(values.HE),
    absenceMinutes:durationToMinutes(values.F),
    nightAdditionalMinutes:durationToMinutes(values.AN),
    travelMinutes:durationToMinutes(values.V),
    bhSource:"SENIOR_COLUMN",
    bhValidated:false
  };
}

function parseFooterTotals(block){
  const text=String(block||"").replace(/\s+/g," ");
  const m=text.match(/Trabalho:\s*(\d{1,5}:\d{2})\s+BH\s*-\s*(\d{1,5}:\d{2})\s+BH\s*\+\s*(\d{1,5}:\d{2})\s+HE\s*100%:\s*(\d{1,5}:\d{2})\s+Faltas?:\s*(\d{1,5}:\d{2})/i);
  if(!m)return null;
  return {workMinutes:durationToMinutes(m[1]),bhNegativeMinutes:durationToMinutes(m[2]),bhPositiveMinutes:durationToMinutes(m[3]),he100Minutes:durationToMinutes(m[4]),absenceMinutes:durationToMinutes(m[5])};
}

function normalizeSeniorBhNegative(rawMinutes,payload,markingsCount,absenceMinutes=0){
  const raw=Number(rawMinutes||0);
  if(raw<=0)return {minutes:0,normalized:false,reason:null};
  const text=clean(payload).toUpperCase();
  const isNightAbsence=/FALTAS?\s+NOTURNAS?/.test(text);
  const isBhDayOff=/FOLGA\s+BH/.test(text);
  const specialWithoutNormalMarkings=Number(markingsCount||0)<2&&!isBhDayOff;

  // "Faltas Noturnas" tem uma base própria da Senior e permanece em 80%.
  // Essa regra é comprovada nos cartões reais já usados como referência.
  if(isNightAbsence){
    return {minutes:Math.round(raw*0.8),normalized:true,reason:"SENIOR_NIGHT_ABSENCE_80"};
  }

  // Em lançamentos especiais sem marcações normais, a coluna BH- pode vir
  // acompanhada de uma parcela na coluna Falta. Nesse formato a Senior fecha
  // o BH- líquido descontando exatamente essa parcela de falta, e não aplicando
  // 80% cegamente. Exemplo real: Matheus Lopes, 15/09/2026, BH- 07:19 e
  // Falta 01:06 => BH- efetivo 06:13. Isso elimina o resíduo de -00:22 do
  // fechamento 19/08/2026 a 17/09/2026 sem criar tolerância artificial.
  if(specialWithoutNormalMarkings){
    const absence=Math.max(0,Number(absenceMinutes||0));
    if(absence>0&&absence<raw){
      return {
        minutes:raw-absence,
        normalized:true,
        reason:"SENIOR_SPECIAL_NEGATIVE_MINUS_ABSENCE"
      };
    }
    return {minutes:Math.round(raw*0.8),normalized:true,reason:"SENIOR_SPECIAL_NEGATIVE_80"};
  }

  return {minutes:raw,normalized:false,reason:null};
}

function sumReconciliationFields(days){
  const fields=["workMinutes","bhNegativeMinutes","bhPositiveMinutes","he100Minutes","absenceMinutes"];
  return Object.fromEntries(fields.map(f=>[f,days.reduce((a,d)=>a+Number(d[f]||0),0)]));
}

function reconcileEmployeeBh(days,footerTotals){
  const fields=["workMinutes","bhNegativeMinutes","bhPositiveMinutes","he100Minutes","absenceMinutes"];
  const sums=sumReconciliationFields(days);
  if(!footerTotals)return {status:"UNVERIFIED",sums,footerTotals:null,differences:{},adjustments:[]};
  const differences=Object.fromEntries(fields.map(f=>[f,sums[f]-Number(footerTotals[f]||0)]));

  // Beta.85 — princípio de fonte oficial Senior:
  // a conciliação é estritamente comparativa. Nenhum resíduo é compensado,
  // nenhuma hora é acrescentada/removida e nenhum dia é alterado para "fazer
  // fechar" com o rodapé. Se houver diferença, o diagnóstico permanece como
  // MISMATCH e a correção precisa nascer na Senior e voltar em nova importação.
  const ok=fields.every(f=>differences[f]===0);
  if(ok){
    for(const day of days){
      if(day.bhSource&&day.bhSource!=="LEGACY_TEXT")day.bhValidated=true;
    }
  }
  return {status:ok?"VALIDATED":"MISMATCH",sums,footerTotals,differences,adjustments:[]};
}

function parseDayLine(line,period,scheduleDefinitions=new Map()){
  const head=String(line).match(/^\s*(\d{2}\/\d{2})\s*([A-Z]{3})\s*(.*)$/i);
  if(!head)return null;
  const rawTail=head[3];
  const explicitColumns=parseExplicitColumns(rawTail);
  const tail=explicitColumns?explicitColumns.base:rawTail;
  const codeMatch=tail.match(/(\d{4})\s+(?=(?:[0-2]\d:[0-5]\d|BH\b|DSR\b|FERIADO\b|F[ÉE]RIAS\b|FALTAS?\b|ATESTADO\b|COMPENSADO\b|CURSO\b|[ÓO]BITO\b|LICEN|SUSPENS|AFAST|AUX[ÍI]LIO\s+DOEN[ÇC]A|ADICIONAL\s+NOTURNO\b|SA[ÍI]DA\s+INTERMEDI[ÁA]RIA))(.*)$/i);
  if(!codeMatch)return null;
  const scheduleCode=codeMatch[1];
  const payload=clean(codeMatch[2]);
  const statusMatch=NON_WORK_PATTERNS.find(([,pattern])=>pattern.test(payload));
  const firstEventIndex=[
    ...NON_WORK_PATTERNS.map(([,pattern])=>payload.search(pattern)),
    ...OCCURRENCE_ONLY_PATTERNS.map(pattern=>payload.search(pattern)),
    payload.search(/\bBH\b/i)
  ].filter(index=>index>=0).sort((a,b)=>a-b)[0];
  const markingPart=firstEventIndex===undefined?payload:payload.slice(0,firstEventIndex);
  const rawMarkings=markingPart.match(/(?:[01]\d|2[0-3]):[0-5]\d/g)||[];
  let occurrence=payload.replace(markingPart,"").trim()||null;
  let markings=rawMarkings.slice(0,8);
  let ignoredMarkings=[];
  const negativeNormalization=explicitColumns
    ?normalizeSeniorBhNegative(explicitColumns.bhNegativeRawMinutes,payload,rawMarkings.length,explicitColumns.absenceMinutes)
    :{minutes:null,normalized:false,reason:null};

  // Em algumas extrações do PDF, quando não há texto de ocorrência entre as
  // marcações e a coluna "Trabalho", o total trabalhado pode aparecer como
  // uma quinta hora. Se ele for exatamente a soma dos dois pares anteriores,
  // trata-se do total da Senior e não de uma quinta batida.
  if(!occurrence&&markings.length===5){
    const expectedTotal=hhmmDuration(minutesBetweenPairs(markings.slice(0,4)));
    if(markings[4]===expectedTotal){
      ignoredMarkings=[markings[4]];
      markings=markings.slice(0,4);
      occurrence=`Total de trabalho da Senior desconsiderado como marcação: ${ignoredMarkings[0]}`;
    }
  }

  // Alguns cartões da Senior registram BH (-) / Saída Antecipada após uma
  // quantidade ímpar de batidas. Nesse formato, a última batida fica sem par
  // e os horários depois da ocorrência são totais/indicadores da Senior, não
  // novas marcações. Para não inventar uma saída, usamos somente os pares
  // completos já confirmados antes da ocorrência e preservamos a batida órfã
  // na ocorrência para auditoria.
  const earlyExit=/(?:BH\s*\(-\)|SA[ÍI]DA\s+ANTECIPADA)/i.test(occurrence||"");
  if(earlyExit&&(markings.length===3||markings.length===5)){
    ignoredMarkings=[markings[markings.length-1]];
    markings=markings.slice(0,-1);
    occurrence=`${occurrence||"BH (-) Saída Antecipada"} | Marcação sem par desconsiderada no cálculo automático: ${ignoredMarkings.join(", ")}`;
  }

  // Quando a Senior traz 3 ou 5 batidas sem uma ocorrência que explique a
  // marcação órfã, ainda podemos calcular com segurança os períodos que estão
  // fechados por pares. A última batida permanece preservada para auditoria,
  // mas nunca é usada para inventar uma saída. Ex.: 19:30 23:08 23:47 usa
  // somente 19:30–23:08 no cálculo dos repousos.
  let partialFromOdd=false;
  if(!earlyExit&&(markings.length===3||markings.length===5)){
    partialFromOdd=true;
    const orphan=markings[markings.length-1];
    ignoredMarkings=[...ignoredMarkings,orphan];
    markings=markings.slice(0,-1);
    const note=`Jornada parcialmente calculada | Marcação sem par desconsiderada no cálculo automático: ${orphan}`;
    occurrence=occurrence?`${occurrence} | ${note}`:note;
  }

  const plannedMarkings=scheduleDefinitions.get(scheduleCode)||[];
  const confirmedTwoMarkSchedule=markings.length===2&&plannedMarkings.length===2;
  const confirmedPartial=markings.length===2&&(earlyExit||partialFromOdd);
  let state="WORKED";
  if(statusMatch)state=statusMatch[0];
  else if(markings.length===0)state="NO_MARKINGS";
  else if(markings.length!==4&&!confirmedPartial&&!confirmedTwoMarkSchedule)state="REVIEW";

  // Beta.83: a fila do DP diferencia falha de leitura de uma exceção já
  // explicada pela própria Senior. Saída antecipada e atestado em horas podem
  // produzir uma jornada com menos batidas que o horário-base sem significar
  // que o PDF foi lido errado. Esses casos continuam visíveis para conferência,
  // mas não viram alta prioridade automaticamente.
  const expectedMarkingsCount=plannedMarkings.length;
  const incompleteAgainstSchedule=expectedMarkingsCount>0&&markings.length<expectedMarkingsCount;
  const hourlyMedical=/ATESTADO(?:\s+NOTURNO)?\s+EM\s+HORAS/i.test(payload)||/ATESTADO.*\bHORAS\b/i.test(payload);
  const explicitEarlyExit=/SA[ÍI]DA\s+ANTECIPADA/i.test(occurrence||payload);
  // A fila permanece restrita às exceções que já exigiam conferência.
  // Atestado em horas e saída antecipada, quando a Senior já os explica e
  // as batidas são utilizáveis, não criam uma pendência nova por si só.
  const requiresReview=state==="REVIEW"||state==="NO_MARKINGS";

  return {
    date:isoDate(head[1],period.start,period.end),
    weekDay:head[2].toUpperCase(),
    scheduleCode,
    markings:markings.slice(0,8),
    ignoredMarkings,
    state,
    occurrence,
    expectedMarkingsCount,
    incompleteAgainstSchedule,
    hourlyMedical,
    explicitEarlyExit,
    requiresReview,
    eligibleForAutomaticRest:state==="WORKED"&&(markings.length===4||confirmedPartial||confirmedTwoMarkSchedule),
    workMinutes:explicitColumns?.workMinutes??null,
    bhNegativeMinutes:explicitColumns?negativeNormalization.minutes:null,
    bhNegativeRawMinutes:explicitColumns?.bhNegativeRawMinutes??null,
    bhNegativeNormalized:Boolean(negativeNormalization.normalized),
    bhNegativeNormalizationReason:negativeNormalization.reason,
    bhNegativeReconciliationAdjustmentMinutes:0,
    bhPositiveMinutes:explicitColumns?.bhPositiveMinutes??null,
    he100Minutes:explicitColumns?.he100Minutes??null,
    absenceMinutes:explicitColumns?.absenceMinutes??null,
    nightAdditionalMinutes:explicitColumns?.nightAdditionalMinutes??null,
    travelMinutes:explicitColumns?.travelMinutes??null,
    bhSource:explicitColumns
      ?(negativeNormalization.normalized?"SENIOR_COLUMN_NORMALIZED":"SENIOR_COLUMN")
      :"LEGACY_TEXT",
    bhValidated:false
  };
}

function splitBlocks(text){
  const source=String(text||"");

  // A extração estrutural preserva o separador físico de páginas. Como o
  // Cartão Ponto Senior usa um colaborador por página, essa é a fronteira mais
  // segura e impede tanto contaminação entre rodapés quanto perda da última
  // página do arquivo.
  const physicalPages=source.split(/\f/).map(page=>page.trim()).filter(Boolean);
  const cardPages=physicalPages.filter(page=>/Cart[ãa]o\s*Ponto/i.test(page));
  if(cardPages.length)return cardPages;

  // Compatibilidade com textos legados sem form-feed.
  const indexes=[];
  const regex=/Cart[ãa]o\s*Ponto/gi;
  let match;
  while((match=regex.exec(source)))indexes.push(match.index);
  return indexes.map((index,i)=>source.slice(index,indexes[i+1]??source.length));
}

function parseSeniorTimecard(text){
  const employees=[];
  const warnings=[];
  for(const [pageIndex,block] of splitBlocks(text).entries()){
    const period=parsePeriod(block);
    const employee=parseEmployee(block);
    if(!period||!employee){
      warnings.push({page:pageIndex+1,message:"Cabeçalho do colaborador ou período não reconhecido."});
      continue;
    }
    const scheduleDefinitions=parseScheduleDefinitions(block);
    const days=block.split(/\r?\n/).map((line,index)=>{
      const day=parseDayLine(line,period,scheduleDefinitions);
      return day?{...day,sourceLine:index+1,sourceText:clean(line)}:null;
    }).filter(Boolean);
    const footerTotals=parseFooterTotals(block);
    const bhReconciliation=reconcileEmployeeBh(days,footerTotals);
    if(bhReconciliation.status!=="VALIDATED")warnings.push({page:pageIndex+1,registration:employee.registration,message:bhReconciliation.status==="MISMATCH"?"Totais diários não conferem com o fechamento oficial da Senior.":"Fechamento da Senior não pôde ser validado pelas colunas do PDF."});
    else if(bhReconciliation.adjustments?.length)warnings.push({page:pageIndex+1,registration:employee.registration,message:`BH- conciliado com o fechamento Senior (${bhReconciliation.adjustments.map(item=>`${item.date}: ${item.minutes>0?"+":""}${item.minutes} min`).join(", ")}).`});
    employees.push({...employee,period,days,page:pageIndex+1,footerTotals,bhReconciliation});
  }
  return {
    reportType:"SENIOR_TIMECARD",
    employees,
    warnings,
    totals:{
      employees:employees.length,
      days:employees.reduce((sum,item)=>sum+item.days.length,0),
      eligibleDays:employees.reduce((sum,item)=>sum+item.days.filter(day=>day.eligibleForAutomaticRest).length,0),
      reviewDays:employees.reduce((sum,item)=>sum+item.days.filter(day=>day.requiresReview===true).length,0),
      nonWorkDays:employees.reduce((sum,item)=>sum+item.days.filter(day=>!day.eligibleForAutomaticRest&&!day.requiresReview).length,0)
    }
  };
}

module.exports={parseSeniorTimecard,parseDayLine,parseScheduleDefinitions,parseFooterTotals,reconcileEmployeeBh,durationToMinutes,normalizeSeniorBhNegative};
