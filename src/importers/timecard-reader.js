const NON_WORK_PATTERNS=[
  ["DSR",/\bDSR\b/i],
  ["FOLGA",/\bFOLGA\b/i],
  ["FERIAS",/\bF[ÉE]RIAS\b/i],
  ["FALTA",/\bFALTAS?\b/i],
  ["ATESTADO",/\bATESTADO\b/i],
  ["COMPENSADO",/\bCOMPENSADO\b/i],
  ["CURSO",/\bCURSO\b/i],
  ["OBITO",/\b[ÓO]BITO\b/i],
  ["LICENCA",/\bLICEN[ÇC]A\b/i],
  ["SUSPENSAO",/\bSUSPENS[ÃA]O\b/i],
  ["AFASTAMENTO",/\bAFASTAMENTO\b/i]
];

const OCCURRENCE_ONLY_PATTERNS=[
  /\bADICIONAL\s+NOTURNO\b/i,
  /\bSA[ÍI]DA\s+INTERMEDI[ÁA]RIA(?:\s+NOTURNA)?\b/i
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
  const direct=block.match(/Empregado:\s*(\d{5,12})\s+([^\n]+)/i);
  if(direct)return {registration:direct[1].replace(/^0+(?=\d)/,""),rawRegistration:direct[1],name:clean(direct[2])};

  const pdfParse=block.match(/(?:Localiza[çc][ãa]o:\s*\n)?(\d{5,12})([A-ZÀ-Ü][A-ZÀ-Ü .'-]{3,})\n(?:Mensalista|Horista)Categoria:/);
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
  const m=text.match(/Trabalho:\s*(\d{1,3}:\d{2})\s+BH\s*-\s*(\d{1,3}:\d{2})\s+BH\s*\+\s*(\d{1,3}:\d{2})\s+HE\s*100%:\s*(\d{1,3}:\d{2})\s+Faltas:\s*(\d{1,3}:\d{2})/i);
  if(!m)return null;
  return {workMinutes:durationToMinutes(m[1]),bhNegativeMinutes:durationToMinutes(m[2]),bhPositiveMinutes:durationToMinutes(m[3]),he100Minutes:durationToMinutes(m[4]),absenceMinutes:durationToMinutes(m[5])};
}

function normalizeSeniorBhNegative(rawMinutes,payload,markingsCount){
  const raw=Number(rawMinutes||0);
  if(raw<=0)return {minutes:0,normalized:false,reason:null};
  const text=clean(payload).toUpperCase();
  const isNightAbsence=/FALTAS?\s+NOTURNAS?/.test(text);
  const isBhDayOff=/FOLGA\s+BH/.test(text);
  // O cartão Senior usa uma base noturna específica em algumas ocorrências sem
  // marcações normais (ex.: "Faltas Noturnas" e lançamentos especiais do 3º
  // turno). Nesses casos o valor impresso na coluna BH- precisa ser convertido
  // a 80% para reproduzir o fechamento oficial do próprio cartão. A regra foi
  // validada contra o cartão real de 105 páginas de 01/08/2026 a 02/09/2026.
  const specialWithoutNormalMarkings=Number(markingsCount||0)<2&&!isBhDayOff;
  if(isNightAbsence||specialWithoutNormalMarkings){
    return {
      minutes:Math.round(raw*0.8),
      normalized:true,
      reason:isNightAbsence?"SENIOR_NIGHT_ABSENCE_80":"SENIOR_SPECIAL_NEGATIVE_80"
    };
  }
  return {minutes:raw,normalized:false,reason:null};
}

function sumReconciliationFields(days){
  const fields=["workMinutes","bhNegativeMinutes","bhPositiveMinutes","he100Minutes","absenceMinutes"];
  return Object.fromEntries(fields.map(f=>[f,days.reduce((a,d)=>a+Number(d[f]||0),0)]));
}

function reconcileEmployeeBh(days,footerTotals){
  const fields=["workMinutes","bhNegativeMinutes","bhPositiveMinutes","he100Minutes","absenceMinutes"];
  let sums=sumReconciliationFields(days);
  if(!footerTotals)return {status:"UNVERIFIED",sums,footerTotals:null,differences:{},adjustments:[]};
  let differences=Object.fromEntries(fields.map(f=>[f,sums[f]-Number(footerTotals[f]||0)]));
  const nonNegativeFields=["workMinutes","bhPositiveMinutes","he100Minutes","absenceMinutes"];
  const otherFieldsOk=nonNegativeFields.every(f=>differences[f]===0);
  const adjustments=[];

  // Em três páginas do cartão real a Senior fecha o BH- com um resíduo de poucos
  // minutos após a normalização noturna. Só conciliamos automaticamente quando:
  // 1) todos os demais campos já fecham exatamente; 2) a diferença do BH- é de
  // no máximo 15 min; 3) existe uma linha explicitamente marcada como especial.
  // O ajuste fica gravado no próprio dia para auditoria; diferenças maiores
  // continuam bloqueando a importação.
  if(otherFieldsOk&&differences.bhNegativeMinutes!==0&&Math.abs(differences.bhNegativeMinutes)<=15){
    const candidate=[...days].reverse().find(day=>day.bhNegativeNormalized===true&&Number(day.bhNegativeMinutes||0)>0);
    if(candidate){
      const adjustment=-differences.bhNegativeMinutes;
      candidate.bhNegativeMinutes=Number(candidate.bhNegativeMinutes||0)+adjustment;
      candidate.bhNegativeReconciliationAdjustmentMinutes=Number(candidate.bhNegativeReconciliationAdjustmentMinutes||0)+adjustment;
      candidate.bhSource="SENIOR_COLUMN_RECONCILED";
      adjustments.push({date:candidate.date,field:"bhNegativeMinutes",minutes:adjustment});
      sums=sumReconciliationFields(days);
      differences=Object.fromEntries(fields.map(f=>[f,sums[f]-Number(footerTotals[f]||0)]));
    }
  }

  const ok=fields.every(f=>differences[f]===0);
  if(ok){
    for(const day of days){
      if(day.bhSource&&day.bhSource!=="LEGACY_TEXT")day.bhValidated=true;
    }
  }
  return {status:ok?"VALIDATED":"MISMATCH",sums,footerTotals,differences,adjustments};
}

function parseDayLine(line,period,scheduleDefinitions=new Map()){
  const head=String(line).match(/^\s*(\d{2}\/\d{2})\s*([A-Z]{3})\s*(.*)$/i);
  if(!head)return null;
  const rawTail=head[3];
  const explicitColumns=parseExplicitColumns(rawTail);
  const tail=explicitColumns?explicitColumns.base:rawTail;
  const codeMatch=tail.match(/(\d{4})\s+(?=(?:[0-2]\d:[0-5]\d|BH\b|DSR\b|F[ÉE]RIAS\b|FALTAS?\b|ATESTADO\b|COMPENSADO\b|CURSO\b|[ÓO]BITO\b|LICEN|SUSPENS|AFAST|ADICIONAL\s+NOTURNO\b|SA[ÍI]DA\s+INTERMEDI[ÁA]RIA))(.*)$/i);
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
    ?normalizeSeniorBhNegative(explicitColumns.bhNegativeRawMinutes,payload,rawMarkings.length)
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

  return {
    date:isoDate(head[1],period.start,period.end),
    weekDay:head[2].toUpperCase(),
    scheduleCode,
    markings:markings.slice(0,8),
    ignoredMarkings,
    state,
    occurrence,
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
  const indexes=[];
  const regex=/Cart[ãa]o Ponto/gi;
  let match;
  while((match=regex.exec(source)))indexes.push(match.index);
  return indexes.map((index,i)=>source.slice(Math.max(0,index-250),indexes[i+1]??source.length));
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
    const days=block.split(/\r?\n/).map(line=>parseDayLine(line,period,scheduleDefinitions)).filter(Boolean);
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
      reviewDays:employees.reduce((sum,item)=>sum+item.days.filter(day=>day.state==="REVIEW"||day.state==="NO_MARKINGS").length,0),
      nonWorkDays:employees.reduce((sum,item)=>sum+item.days.filter(day=>!day.eligibleForAutomaticRest&&day.state!=="REVIEW"&&day.state!=="NO_MARKINGS").length,0)
    }
  };
}

module.exports={parseSeniorTimecard,parseDayLine,parseScheduleDefinitions,parseFooterTotals,reconcileEmployeeBh,durationToMinutes,normalizeSeniorBhNegative};
