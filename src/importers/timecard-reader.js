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

function parseDayLine(line,period){
  const head=String(line).match(/^\s*(\d{2}\/\d{2})\s*([A-Z]{3})\s*(.*)$/i);
  if(!head)return null;
  const tail=head[3];
  const codeMatch=tail.match(/(\d{4})\s+(?=(?:[0-2]\d:[0-5]\d|BH\b|DSR\b|F[ÉE]RIAS\b|FALTAS?\b|ATESTADO\b|COMPENSADO\b|CURSO\b|[ÓO]BITO\b|LICEN|SUSPENS|AFAST))(.*)$/i);
  if(!codeMatch)return null;
  const scheduleCode=codeMatch[1];
  const payload=clean(codeMatch[2]);
  const statusMatch=NON_WORK_PATTERNS.find(([,pattern])=>pattern.test(payload));
  const firstEventIndex=[...NON_WORK_PATTERNS.map(([,pattern])=>payload.search(pattern)),payload.search(/\bBH\b/i)]
    .filter(index=>index>=0)
    .sort((a,b)=>a-b)[0];
  const markingPart=firstEventIndex===undefined?payload:payload.slice(0,firstEventIndex);
  const markings=markingPart.match(/(?:[01]\d|2[0-3]):[0-5]\d/g)||[];
  let state="WORKED";
  if(statusMatch)state=statusMatch[0];
  else if(markings.length===0)state="NO_MARKINGS";
  else if(markings.length!==4)state="REVIEW";

  return {
    date:isoDate(head[1],period.start,period.end),
    weekDay:head[2].toUpperCase(),
    scheduleCode,
    markings:markings.slice(0,8),
    state,
    occurrence:payload.replace(markingPart,"").trim()||null,
    eligibleForAutomaticRest:state==="WORKED"&&markings.length===4
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
    const days=block.split(/\r?\n/).map(line=>parseDayLine(line,period)).filter(Boolean);
    employees.push({...employee,period,days,page:pageIndex+1});
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

module.exports={parseSeniorTimecard,parseDayLine};
