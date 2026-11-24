"use strict";

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

function clean(value){return String(value||"").replace(/\s+/g," ").trim();}
function normalizeRegistration(value){return String(value??"").trim().replace(/^0+(?=\d)/,"");}
function minutes(value){
  const match=String(value||"").match(/^(\d{1,5}):(\d{2})$/);
  return match?Number(match[1])*60+Number(match[2]):0;
}
function todaySaoPaulo(){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const get=type=>parts.find(part=>part.type===type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function thermalMarkingsValid(markings){
  if(![2,4].includes(markings.length))return false;
  if(markings.some(value=>!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)))return false;
  const values=markings.map(value=>{const [h,m]=value.split(":").map(Number);return h*60+m;});
  let offset=0;
  for(let i=1;i<values.length;i++){
    if(values[i]===values[i-1])return false;
    if(values[i]<values[i-1])offset+=1440;
    if(values[i]+offset-values[0]>=1440)return false;
  }
  return true;
}
function situationDescriptions(day){
  return (Array.isArray(day?.situacoesApuradas)?day.situacoesApuradas:[])
    .map(item=>clean(item?.situacao?.descricao))
    .filter(Boolean);
}
function incidentDescriptions(day){
  return (Array.isArray(day?.incidentes)?day.incidentes:[])
    .map(item=>clean(item?.descricao))
    .filter(Boolean);
}
function sumSituationMinutes(day,predicate){
  return (Array.isArray(day?.situacoesApuradas)?day.situacoesApuradas:[])
    .reduce((sum,item)=>predicate(clean(item?.situacao?.descricao),item)?sum+minutes(item?.quantidadeHoras):sum,0);
}
function normalizeSeniorDay(day,{today=todaySaoPaulo()}={}){
  const workDate=String(day?.dataApuracao||day?.dataInicial||"").slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(workDate))return null;
  if(today&&workDate>today)return null;

  const scheduleCode=String(day?.horario?.codigo??day?.escala?.codigo??"").trim()||null;
  const scheduleDescription=clean(day?.horario?.descricao||day?.escala?.descricao);
  const situations=situationDescriptions(day);
  const incidents=incidentDescriptions(day);
  const officialClassificationText=[scheduleDescription,...situations].join(" | ");
  const diagnosticText=[officialClassificationText,...incidents].join(" | ");
  const explicit=NON_WORK_PATTERNS.find(([,pattern])=>pattern.test(officialClassificationText));
  const jornadaIncompleta=/JORNADA\s+INCOMPLETA/i.test(diagnosticText);

  const reported=(Array.isArray(day?.marcacoes)?day.marcacoes:[])
    .map(item=>clean(item?.horaAcesso||item?.hora||item))
    .filter(Boolean);
  let markings=reported.slice();
  const notes=[...situations.filter(x=>!/^(?:TRABALHANDO)$/i.test(x)),...incidents];

  if((markings.length===3||markings.length===5)&&markings.every(value=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))){
    const orphan=markings.at(-1);
    markings=markings.slice(0,-1);
    notes.push(`Marcação sem par preservada para revisão: ${orphan}`);
  }

  let state="WORKED";
  if(explicit)state=explicit[0];
  else if(jornadaIncompleta)state="REVIEW";
  else if(markings.length===0)state="NO_MARKINGS";
  else if(reported.length===1)state="FALTA";
  else if(!thermalMarkingsValid(markings))state="REVIEW";

  const eligible=state==="WORKED"&&thermalMarkingsValid(markings);
  const occurrence=[...new Set(notes.filter(Boolean))].join(" | ")||null;

  return {
    date:workDate,
    scheduleCode,
    markings,
    state,
    occurrence,
    eligibleForAutomaticRest:eligible,
    workMinutes:sumSituationMinutes(day,description=>/^TRABALHANDO$/i.test(description)),
    bhNegativeMinutes:sumSituationMinutes(day,description=>/BH\s*\(-\)|\bATRASO\b|SA[ÍI]DA\s+ANTECIPADA/i.test(description)),
    bhPositiveMinutes:sumSituationMinutes(day,description=>/\bBH\s*(?:\+|50%|100%)/i.test(description)),
    he100Minutes:sumSituationMinutes(day,description=>/\bHE\s*100%/i.test(description)),
    absenceMinutes:sumSituationMinutes(day,description=>/\bFALTAS?\b/i.test(description)),
    nightAdditionalMinutes:sumSituationMinutes(day,description=>/ADICIONAL\s+NOTURNO/i.test(description)),
    travelMinutes:sumSituationMinutes(day,description=>/VIAGEM/i.test(description)),
    bhSource:"SENIOR_API",
    bhValidated:false
  };
}

function normalizeSeniorEmployee(item,options={}){
  const colaborador=item?.colaborador||item?.employee||item||{};
  const registration=normalizeRegistration(colaborador.numeroCadastro??colaborador.registration);
  const name=clean(colaborador.nome||colaborador.name);
  const apuracao=Array.isArray(item?.apuracao)?item.apuracao:Array.isArray(item?.days)?item.days:[];
  return {
    seniorId:clean(colaborador.id),
    registration,
    name,
    days:apuracao.map(day=>normalizeSeniorDay(day,options)).filter(Boolean)
  };
}

function validatePayload(payload={}){
  const periodStart=String(payload.periodStart||"").slice(0,10);
  const periodEnd=String(payload.periodEnd||"").slice(0,10);
  const calculationCode=String(payload.calculationCode||"").trim();
  const employees=Array.isArray(payload.employees)?payload.employees:[];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)||!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)||periodEnd<periodStart){
    throw Object.assign(new Error("Período da Senior inválido."),{status:400});
  }
  if(!calculationCode)throw Object.assign(new Error("Código de cálculo da Senior não informado."),{status:400});
  if(!employees.length)throw Object.assign(new Error("Nenhum colaborador foi recebido da Senior."),{status:400});
  if(employees.length>500)throw Object.assign(new Error("Quantidade de colaboradores acima do limite de segurança."),{status:400});
  return {periodStart,periodEnd,calculationCode,employees,seniorCompanyNumber:String(payload.seniorCompanyNumber||"").trim()};
}

module.exports={
  NON_WORK_PATTERNS,
  normalizeRegistration,
  thermalMarkingsValid,
  normalizeSeniorDay,
  normalizeSeniorEmployee,
  validatePayload,
  todaySaoPaulo
};
