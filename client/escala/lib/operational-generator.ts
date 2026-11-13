import {moveDay,validDay} from './business-date';
import {days,employed,planned,restRule,status,weeklyRestDays,withWeeklyFolgas,type Employee,type State} from './roster';
import {isLeader} from './leadership';
import {workIntervals} from './leadership-hours';
import {specialSchedule} from './planning-reference';
import {sectionOf} from './roster-groups';
export type RoleMinimum={key:string;name:string;count:number;minimum:number};
export type TeamMinimum={key:string;name:string;primary:string;count:number;leaders:number;minimumPeople:number;minimumLeaders:number;roles:RoleMinimum[]};
export type OperationalConfig={effectiveDate:string;includeOffice:boolean;preferConsecutive:boolean;teams:TeamMinimum[]};
export type OperationalIssue={team:string;date?:string;reason:string};
export type OperationalChange={id:string;name:string;team:string;role:string;leader:boolean;off1:string;off2:string};
export type OperationalResult={state:State;changes:OperationalChange[];excluded:{id:string;name:string;reason:string}[];issues:OperationalIssue[];warnings:string[];coverage:{team:string;date:string;operating:boolean;people:number;leaders:number;minimumPeople:number;minimumLeaders:number;shortages:string[]}[];groups:{team:string;pair:string;people:number;leaders:string[]}[];canApply:boolean};
const norm=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toUpperCase();
const roleKey=(employee:Employee)=>norm(employee.role||'');
const teamKey=(employee:Employee)=>JSON.stringify([sectionOf(employee),employee.coordinatorId||'']);
const teamName=(employee:Employee)=>sectionOf(employee)+' · '+(employee.coordinatorName||'Sem coordenador vinculado');
export const fixedRestDay=(employee:Employee)=>employee.shift==='3º'?'Sab':'Dom';
const weekday=(date:string)=>days[(new Date(date+'T12:00:00Z').getUTCDay()+6)%7];
const at=(date:string)=>new Date(date+'T12:00:00');
function configured(employee:Employee){return employee.included||Boolean(employee.off1||employee.off2||employee.restRules?.length||employee.weeklyPattern&&Object.keys(employee.weeklyPattern).length);}
function exclusion(state:State,employee:Employee,date:string,includeOffice:boolean){
 if(!employee.active||!employed(employee,at(date)))return 'Sem vínculo ativo na vigência';
 if(configured(employee))return 'Grupo e planejamento existentes preservados';
 if(!includeOffice&&!['1º','2º','3º'].includes(employee.shift))return 'Comercial / ADM / outros horários fora deste lote';
 if(specialSchedule(employee))return 'Aprendiz ou jornada reduzida: revisão individual';
 if(!employee.coordinatorId)return 'Coordenador não vinculado: conferir equipe';
 if(!employee.role?.trim())return 'Cargo não informado';
 if(!workIntervals(employee,date))return 'Horário incompleto: conferir referência Senior';
 if(state.overrides.some(item=>item.id===employee.id&&item.date>=date))return 'Exceções por data preservadas: revisão individual';
 return '';
}
function scope(state:State,ids:string[],date:string,includeOffice:boolean){
 const selected=new Set(ids);const excluded:OperationalResult['excluded']=[],candidates:Employee[]=[];
 for(const employee of state.employees.filter(employee=>selected.has(employee.id))){const reason=exclusion(state,employee,date,includeOffice);if(reason)excluded.push({id:employee.id,name:employee.name,reason});else candidates.push(employee);}
 const keys=new Set(candidates.map(teamKey));
 const members=state.employees.filter(employee=>keys.has(teamKey(employee))&&!specialSchedule(employee)&&employed(employee,at(date))&&(candidates.some(item=>item.id===employee.id)||planned(employee,date)||employee.restRules?.some(rule=>rule.effectiveDate>=date&&rule.effectiveDate<=moveDay(date,27)&&rule.included!==false)));
 return {candidates,members,excluded};
}
export function operationalDefaults(state:State,ids:string[],effectiveDate:string,includeOffice=false):OperationalConfig{
 if(!validDay(effectiveDate))throw Error('Informe uma vigência válida.');
 const {members}=scope(state,ids,effectiveDate,includeOffice);const map=new Map<string,Employee[]>();
 for(const employee of members){const key=teamKey(employee);map.set(key,[...(map.get(key)||[]),employee]);}
 const teams=[...map].map(([key,team])=>{
  const leaders=team.filter(isLeader).length;const groups=Math.max(2,Math.min(6,leaders));const roles=new Map<string,Employee[]>();
  for(const employee of team){const key=roleKey(employee);roles.set(key,[...(roles.get(key)||[]),employee]);}
  return {key,name:teamName(team[0]),primary:fixedRestDay(team[0]),count:team.length,leaders,minimumPeople:Math.max(1,team.length-Math.ceil(team.length/groups)),minimumLeaders:1,roles:[...roles].map(([key,people])=>({key,name:people[0].role||'Cargo não informado',count:people.length,minimum:people.every(isLeader)?0:Math.max(1,people.length-Math.ceil(people.length/groups))})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))};
 }).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
 return {effectiveDate,includeOffice,preferConsecutive:true,teams};
}
export function generateOperational(state:State,ids:string[],config:OperationalConfig):OperationalResult{
 if(!validDay(config.effectiveDate))throw Error('Informe uma vigência válida.');
 const {candidates,members,excluded}=scope(state,ids,config.effectiveDate,config.includeOffice);
 if(candidates.length>400)throw Error('Filtre por turno ou coordenador para gerar até 400 pessoas por prévia.');
 const defaults=operationalDefaults(state,ids,config.effectiveDate,config.includeOffice);
 if(new Set(config.teams.map(team=>team.key)).size!==config.teams.length||defaults.teams.length!==config.teams.length||defaults.teams.some(team=>!config.teams.some(item=>item.key===team.key)))throw Error('A equipe mudou. Gere novamente os parâmetros.');
 for(const team of config.teams){const expected=defaults.teams.find(item=>item.key===team.key)!;
  if(team.primary!==expected.primary||!Number.isInteger(team.minimumPeople)||team.minimumPeople<1||!Number.isInteger(team.minimumLeaders)||team.minimumLeaders<1||team.minimumPeople>2000||team.minimumLeaders>2000||new Set(team.roles.map(role=>role.key)).size!==team.roles.length||team.roles.length!==expected.roles.length||team.roles.some(role=>!expected.roles.some(item=>item.key===role.key)||!Number.isInteger(role.minimum)||role.minimum<0||role.minimum>2000))throw Error('Revise os mínimos de equipe, liderança e função.');
 }
 const assignments=new Map<string,string>();const changes:OperationalChange[]=[];const issues:OperationalIssue[]=[];const warnings:string[]=[];
 for(const item of excluded)if(/^(Coordenador|Cargo não|Horário incompleto)/.test(item.reason))issues.push({team:'Dados para conferência',reason:item.name+': '+item.reason});
 const candidateIds=new Set(candidates.map(employee=>employee.id));
 for(const policy of config.teams){
  const team=members.filter(employee=>teamKey(employee)===policy.key),pending=candidates.filter(employee=>teamKey(employee)===policy.key);
  if(policy.minimumPeople*6>team.length*5)issues.push({team:policy.name,reason:'Capacidade semanal de equipe insuficiente para o mínimo escolhido em seis dias de operação por turno.'});
  if(policy.minimumLeaders*6>team.filter(isLeader).length*5)issues.push({team:policy.name,reason:'Capacidade semanal de liderança insuficiente: o descanso de um único líder exige substituição no grupo.'});
  for(const role of policy.roles){const available=team.filter(employee=>roleKey(employee)===role.key).length;if(role.minimum*6>available*5)issues.push({team:policy.name,reason:`${role.name}: ${available} pessoas em 5x2 não cobrem o mínimo ${role.minimum} em seis dias; revisar cobertura habilitada.`});}
  const primary=policy.primary;const choices=days.filter(day=>day!==primary);const sample=Array.from({length:7},(_,i)=>moveDay(config.effectiveDate,i));
  const works=(employee:Employee,date:string)=>candidateIds.has(employee.id)?weekday(date)!==primary&&weekday(date)!==assignments.get(employee.id):status(employee,at(date),state)==='T';
  const groupOf=(employee:Employee)=>candidateIds.has(employee.id)?assignments.get(employee.id):weeklyRestDays(employee,config.effectiveDate).filter(day=>day!==primary)[0];
  function score(){let total=0;const counts:number[]=[];
   for(const date of sample){if(weekday(date)===primary)continue;const working=team.filter(employee=>works(employee,date));const leaders=working.filter(isLeader).length;const deficit=Math.max(0,policy.minimumPeople-working.length)+Math.max(0,policy.minimumLeaders-leaders);
    total+=deficit*100000;for(const role of policy.roles)total+=Math.max(0,role.minimum-working.filter(employee=>roleKey(employee)===role.key).length)*100000;counts.push(team.length-working.length);
   }
   const grouped=new Map<string,Employee[]>();for(const employee of team){const off=groupOf(employee);if(off)grouped.set(off,[...(grouped.get(off)||[]),employee]);}
   for(const people of grouped.values())if(!people.some(isLeader))total+=500000;
   total+=counts.reduce((sum,count)=>sum+count*count,0)*10;
   if(config.preferConsecutive)for(const employee of pending){const second=assignments.get(employee.id);if(second){const distance=Math.abs(days.indexOf(primary)-days.indexOf(second));if(distance!==1&&distance!==6)total+=1;}}
   return total;
  }
  function choose(employee:Employee,allowed:string[]){let best=allowed[0],cost=Infinity;for(const day of allowed){assignments.set(employee.id,day);const current=score();if(current<cost){cost=current;best=day;}}assignments.set(employee.id,best);}
  const leaders=pending.filter(isLeader).sort((a,b)=>a.id.localeCompare(b.id,'pt-BR'));for(const employee of leaders)choose(employee,choices);
  const anchorDays=()=>[...new Set(team.filter(isLeader).map(groupOf).filter((day):day is string=>Boolean(day)&&choices.includes(day!)))];
  const anchored=anchorDays();
  const workers=pending.filter(employee=>!isLeader(employee)).sort((a,b)=>{const size=(employee:Employee)=>team.filter(person=>roleKey(person)===roleKey(employee)).length;return size(a)-size(b)||roleKey(a).localeCompare(roleKey(b),'pt-BR')||a.id.localeCompare(b.id,'pt-BR');});
  for(const employee of workers)choose(employee,anchored.length?anchored:choices);
  for(let pass=0;pass<3;pass++){let changed=false;for(const employee of [...leaders,...workers]){const previous=assignments.get(employee.id)!;const before=score();const currentAnchors=anchorDays();choose(employee,isLeader(employee)?choices:currentAnchors.length?currentAnchors:choices);if(score()>=before)assignments.set(employee.id,previous);else changed=true;}if(!changed)break;}
  for(const employee of pending)changes.push({id:employee.id,name:employee.name,team:policy.name,role:employee.role||'',leader:isLeader(employee),off1:primary,off2:assignments.get(employee.id)!});
 }
 const byId=new Map(changes.map(change=>[change.id,change]));
 const next={...state,employees:state.employees.map(employee=>{const change=byId.get(employee.id);return change?withWeeklyFolgas(employee,change.off1,change.off2,config.effectiveDate,true):employee;})};
 const coverage:OperationalResult['coverage']=[];const groups:OperationalResult['groups']=[];const dates=Array.from({length:28},(_,i)=>moveDay(config.effectiveDate,i));
 const seen=new Set<string>();const addIssue=(issue:OperationalIssue)=>{const key=JSON.stringify(issue);if(!seen.has(key)){seen.add(key);issues.push(issue);}};
 for(const policy of config.teams){
  const team=next.employees.filter(employee=>members.some(person=>person.id===employee.id)&&teamKey(employee)===policy.key);
  for(const date of dates){
   const working=team.filter(employee=>status(employee,at(date),next)==='T');const leaders=working.filter(isLeader).length;const closed=weekday(date)===policy.primary;const shortages:string[]=[];
   if(closed){if(working.length){const reason='Há trabalho já planejado na folga fixa do turno; revisar individualmente sem alterar o grupo automaticamente.';shortages.push(reason);addIssue({team:policy.name,date,reason});}}
   else{
    if(working.length<policy.minimumPeople)shortages.push(`Equipe: ${working.length}/${policy.minimumPeople}`);
    if(leaders<policy.minimumLeaders)shortages.push(`Líderes: ${leaders}/${policy.minimumLeaders}`);
    for(const role of policy.roles){const present=working.filter(employee=>roleKey(employee)===role.key).length;if(present<role.minimum)shortages.push(`${role.name}: ${present}/${role.minimum}`);}
    const intervals=working.flatMap(employee=>{const periods=workIntervals(employee,date);if(!periods){addIssue({team:policy.name,date,reason:`Horário sem referência completa: ${employee.name}`});return [];}return periods.map(([from,to])=>({from,to,employee}));});
    const reference=team.flatMap(employee=>(workIntervals(employee,date)||[]).map(([from,to])=>({from,to,employee})));
    const boundaries=[...new Set([...intervals,...reference].flatMap(period=>[period.from,period.to]))].sort((a,b)=>a-b);
    let unled=0;const functionGaps=new Map<string,number>();
    for(let i=0;i<boundaries.length-1;i++){
     const from=boundaries[i],to=boundaries[i+1];const expected=reference.filter(period=>period.from<to&&period.to>from);if(!expected.length)continue;
     const present=intervals.filter(period=>period.from<to&&period.to>from);
     if(new Set(present.filter(period=>isLeader(period.employee)).map(period=>period.employee.id)).size<policy.minimumLeaders)unled+=to-from;
     for(const role of policy.roles)if(role.minimum>0&&expected.some(period=>roleKey(period.employee)===role.key)&&new Set(present.filter(period=>roleKey(period.employee)===role.key).map(period=>period.employee.id)).size<role.minimum)functionGaps.set(role.name,(functionGaps.get(role.name)||0)+to-from);
    }
    if(unled)shortages.push(`${unled} minutos sem o mínimo de líderes na janela de referência, inclusive após meia-noite`);
    for(const [role,minutes]of functionGaps)shortages.push(`${role}: ${minutes} minutos abaixo do mínimo na janela do cargo`);
    for(const shortage of shortages)addIssue({team:policy.name,date,reason:shortage});
   }
   coverage.push({team:policy.name,date,operating:!closed,people:working.length,leaders,minimumPeople:policy.minimumPeople,minimumLeaders:policy.minimumLeaders,shortages});
  }
  for(const date of [dates[0],dates[7],dates[14],dates[21]]){
   const map=new Map<string,Employee[]>();for(const employee of team){if(!planned(employee,date))continue;const rest=weeklyRestDays(employee,date);if(rest.length!==2)addIssue({team:policy.name,date,reason:`Grupo existente sem duas folgas semanais: ${employee.name}`});const pair=rest.join('/');map.set(pair,[...(map.get(pair)||[]),employee]);}
   for(const [pair,people]of map){const leaders=people.filter(isLeader).map(employee=>employee.name);if(!leaders.length)addIssue({team:policy.name,date,reason:`Grupo ${pair||'sem folgas válidas'} sem líder próprio. Grupos existentes não foram alterados.`});if(date===dates[0])groups.push({team:policy.name,pair,people:people.length,leaders});}
  }
  for(const employee of team){let consecutive=0;for(let i=-6;i<28;i++){const date=moveDay(config.effectiveDate,i);consecutive=status(employee,at(date),next)==='T'?consecutive+1:0;if(i>=0&&consecutive>5){addIssue({team:policy.name,date,reason:`Mais de cinco dias seguidos no planejamento: ${employee.name}`});break;}}}
 }
 const nonConsecutive=changes.filter(change=>{const distance=Math.abs(days.indexOf(change.off1)-days.indexOf(change.off2));return distance!==1&&distance!==6;}).length;
 if(nonConsecutive)warnings.push(`${nonConsecutive} propostas usam folgas não consecutivas para distribuir a equipe.`);
 if(!changes.length)warnings.push('Nenhuma pessoa elegível. Grupos existentes, jornadas especiais e dados incompletos ficam preservados.');
 warnings.push('O gerador define folgas e preserva a duração da jornada. Confira a carga semanal em Jornadas e reavalie a cobertura após mudanças de horários ou equipe.');
 warnings.push('Pessoas são contadas por dia de entrada; funções e líderes também são conferidos nas janelas dos horários cadastrados. Férias, atestados e ausências não informados no planejamento não entram nesta simulação.');
 return {state:next,changes,excluded,issues,warnings,coverage,groups,canApply:changes.length>0&&issues.length===0};
}
