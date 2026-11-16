import {applyComparisonHours} from './schedule-comparison';
import {operationalDefaults,generateOperational} from './operational-generator';
import {availableForWork,issues,planned,weeklyRestDays,type State} from './roster';
import {moveDay} from './business-date';
import {hourlyCoverage} from './leadership-hours';
import {isLeader} from './leadership';
export function simpleRoster(state:State,hours:40|42|44,date:string){
 const assigned=applyComparisonHours(state,hours,date);
 const excludedIds=new Set(assigned.excluded.map(e=>e.id));
 const ids=assigned.state.employees.filter(e=>availableForWork(e,new Date(date+'T12:00:00'))&&!excludedIds.has(e.id)).map(e=>e.id);
 const config=operationalDefaults(assigned.state,ids,date,true,true);
 const generated=generateOperational(assigned.state,ids,config);
 return {state:generated.state,ids,count:assigned.count,excluded:assigned.excluded};
}
export function simpleRosterAlerts(state:State,ids:string[],date:string){
 const alerts=new Set<string>(),dates=Array.from({length:7},(_,i)=>new Date(moveDay(date,i)+'T12:00:00'));
 const team=state.employees.filter(e=>ids.includes(e.id));
 for(const employee of team){
  if(!employee.coordinatorId)alerts.add(`${employee.name}: líder/coordenador não vinculado; conferir a equipe.`);
  if(!employee.role?.trim())alerts.add(`${employee.name}: cargo não informado.`);
  if(!planned(employee,date)||weeklyRestDays(employee,date).length!==2)alerts.add(`${employee.name}: confira as duas folgas.`);
  for(const issue of issues(employee,dates,state))alerts.add(`${employee.name}: ${issue}`);
 }
 const groups=new Map<string,typeof team>();
 for(const employee of team){const key=JSON.stringify([employee.shift,employee.coordinatorId||'']);groups.set(key,[...(groups.get(key)||[]),employee]);}
 for(const members of groups.values()){
  const first=members[0],label=`${first.officialShift||first.shift} · ${first.coordinatorName||'Sem líder/coordenador vinculado'}`;
  // A cobertura considera toda a equipe do grupo, inclusive pessoas preservadas.
  const fullTeam=state.employees.filter(e=>e.shift===first.shift&&(e.coordinatorId||'')===(first.coordinatorId||''));
  for(let i=0;i<7;i++){
   const day=moveDay(date,i),coverage=hourlyCoverage(state,fullTeam,day,isLeader);
   if(coverage.gapMinutes)alerts.add(`${label}: cobertura de liderança para revisar em ${day.split('-').reverse().join('/')} (${coverage.gapText}).`);
   if(coverage.unknown)alerts.add(`${label}: há horários incompletos para conferir.`);
  }
 }
 return [...alerts];
}
