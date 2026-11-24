"use strict";

function clean(value){return String(value||"").replace(/\s+/g," ").trim();}
function minutesOfClock(value){
  const match=String(value||"").match(/^(\d{2}):(\d{2})$/);
  return match?Number(match[1])*60+Number(match[2]):null;
}
function dayKey(registration,date){return `${registration}|${date}`;}
function daySignature(day){
  return JSON.stringify({
    scheduleCode:day.scheduleCode||null,
    markings:Array.isArray(day.markings)?day.markings:[],
    state:day.state||null,
    occurrence:day.occurrence||null
  });
}
function issueFromDay(employee,day){
  const occurrence=clean(day.occurrence);
  const hasOccurrence=/(JORNADA INCOMPLETA|FALTA DE MARCA|MARCAÇÃO SEM PAR|INTERVALO INTRAJORNADA|SA[ÍI]DA ANTECIPADA)/i.test(occurrence);
  const stateIssue=["REVIEW","NO_MARKINGS","FALTA"].includes(day.state);
  if(!stateIssue&&!hasOccurrence)return null;
  return {
    key:dayKey(employee.registration,day.date),
    registration:employee.registration,
    name:employee.name,
    date:day.date,
    state:day.state,
    markings:Array.isArray(day.markings)?day.markings:[],
    occurrence:occurrence||null,
    type:stateIssue?day.state:"OCORRENCIA"
  };
}
function absoluteSpan(day){
  if(!Array.isArray(day.markings)||day.markings.length<2)return null;
  const base=Date.parse(day.date+"T00:00:00Z")/60000;
  if(!Number.isFinite(base))return null;
  const values=day.markings.map(minutesOfClock);
  if(values.some(value=>value===null))return null;
  let offset=0;
  const absolute=[base+values[0]];
  for(let i=1;i<values.length;i++){
    if(values[i]<values[i-1])offset+=1440;
    absolute.push(base+values[i]+offset);
  }
  return {start:absolute[0],end:absolute.at(-1)};
}
function interjourneyIssues(employees){
  const issues=[];
  for(const employee of employees){
    const spans=(employee.days||[])
      .map(day=>({day,span:absoluteSpan(day)}))
      .filter(item=>item.span)
      .sort((a,b)=>a.span.start-b.span.start);
    for(let i=1;i<spans.length;i++){
      const previous=spans[i-1],current=spans[i];
      const gap=current.span.start-previous.span.end;
      if(gap>=0&&gap<660){
        issues.push({
          key:`${employee.registration}|${current.day.date}|INTERJORNADA`,
          registration:employee.registration,
          name:employee.name,
          date:current.day.date,
          state:"INTERJORNADA",
          markings:current.day.markings,
          occurrence:`Interjornada de ${Math.floor(gap/60)}h${String(gap%60).padStart(2,"0")} (mínimo 11h)`,
          type:"INTERJORNADA",
          minutes:gap
        });
      }
    }
  }
  return issues;
}
function buildMonitorSnapshot(employees,previousSummary={}){
  const snapshot={};
  const issues=[];
  for(const employee of employees){
    for(const day of employee.days||[]){
      snapshot[dayKey(employee.registration,day.date)]=daySignature(day);
      const issue=issueFromDay(employee,day);
      if(issue)issues.push(issue);
    }
  }
  issues.push(...interjourneyIssues(employees));

  const previousSnapshot=previousSummary?.snapshot&&typeof previousSummary.snapshot==="object"
    ?previousSummary.snapshot:{};
  const previousIssues=new Set(Array.isArray(previousSummary?.issueKeys)?previousSummary.issueKeys:[]);
  const changed=[];
  for(const [key,signature] of Object.entries(snapshot)){
    if(previousSnapshot[key]!==undefined&&previousSnapshot[key]!==signature)changed.push(key);
  }
  const newIssues=issues.filter(item=>!previousIssues.has(item.key));
  return {
    checkedEmployees:employees.length,
    checkedDays:Object.keys(snapshot).length,
    currentIssueCount:issues.length,
    newIssueCount:newIssues.length,
    changedDayCount:changed.length,
    newIssues:newIssues.slice(0,80),
    changedDays:changed.slice(0,80),
    issueKeys:issues.map(item=>item.key),
    snapshot
  };
}

module.exports={buildMonitorSnapshot,interjourneyIssues,daySignature};
