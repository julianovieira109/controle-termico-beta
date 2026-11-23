import {displaySchedule,referenceProposal,referenceSchedule,specialSchedule} from './planning-reference';
import {journeyText,isJourney,type Journey} from './journeys';
import {availableForWork,type Employee} from './roster';
import {validDay} from './business-date';
export const comparisonHours=[40,42,44] as const;
export function legalWeeklyLimit(date:string):40|42|44{
 if(!validDay(date))throw Error('Informe uma data válida para a sugestão.');
 return date>='2027-12-16'?40:date>='2026-12-16'?42:44;
}
export function legalNote(hours:40|42|44,date:string){
 const limit=legalWeeklyLimit(date);
 if(hours>limit)return `Indisponível nesta vigência: limite normal de ${limit}h semanais pela EC 141/2026.`;
 if(date>='2026-12-16'&&date<'2027-12-16'&&hours===42)return '42h/semana: na ausência de acordo ou convenção coletiva até 15/12/2026, a cautelar do STF admite distribuição em 5 dias de até 8h24 durante a transição; conferir norma coletiva e atualizações aplicáveis.';
 if(hours>40)return 'Jornada distribuída em 5 dias: observar o regime de compensação aplicável.';
 return '';
}
export function compareSchedules(employees:Employee[],date:string){
 const limit=legalWeeklyLimit(date);
 return employees.filter(employee=>availableForWork(employee,new Date(date+'T12:00:00'))).map(employee=>({
  employee,
  options:comparisonHours.map(hours=>{
   if(hours>limit)return {hours,journey:undefined,text:legalNote(hours,date),allowed:false,legalNote:legalNote(hours,date)};
   const journey=referenceProposal(employee,hours,date);
   return {hours,journey:journey&&isJourney(journey)?journey:undefined,allowed:true,legalNote:legalNote(hours,date),
    text:journey&&isJourney(journey)?journeyText(journey):specialSchedule(employee)?'Jornada especial / reduzida — revisão individual':'Horário incompleto ou incompatível — conferir'};
  })
 }));
}
export function comparisonCsv(rows:ReturnType<typeof compareSchedules>,date:string){
 const escape=(value:unknown)=>{let text=String(value??'');if(/^[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 const data=[['Status','Referência','Matrícula','Colaborador','Turno','Líder / coordenador vinculado','Horário atual','Carga semanal','Trabalho diário','Novo horário sugerido','Observação legal','Dias de trabalho','Dias de folga'],
 ...rows.flatMap(row=>row.options.map(option=>[option.allowed?'SUGESTÃO 5x2 — SEM APLICAÇÃO':'NÃO DISPONÍVEL NESTA VIGÊNCIA',date,row.employee.id,row.employee.name,row.employee.officialShift||row.employee.shift,row.employee.coordinatorName||'Sem vínculo informado',displaySchedule(row.employee.schedule),option.hours+'h',option.hours===40?'8h':option.hours===42?'8h24':'8h48',option.text,option.legalNote,5,2]))];
 return '\uFEFF'+data.map(row=>row.map(escape).join(';')).join('\r\n');
}
function staleFutureOfficialJourney(employee:Employee,prior:Journey,date:string){
 if(prior.effectiveDate<=date||prior.option!==1)return false;
 const code=String(employee.code||'').replace(/^0+(?=\d)/,'');
 const base=referenceSchedule(employee);if(!base)return false;
 return code==='56'&&prior.start==='20:00'&&base.start==='22:00'&&prior.breakAfter===240&&base.breakAfter===120;
}
export function applyComparisonHours(state:import('./roster').State,hours:40|42|44,date:string){
 if(!comparisonHours.includes(hours))throw Error('Escolha uma jornada de 40h, 42h ou 44h.');
 const limit=legalWeeklyLimit(date);if(hours>limit)throw Error(`A vigência escolhida permite no máximo ${limit}h semanais de jornada normal.`);
 const rows=compareSchedules(state.employees,date);
 const proposals=new Map(rows.flatMap(row=>{const journey=row.options.find(option=>option.hours===hours)?.journey;return journey?[[row.employee.id,journey] as const]:[];}));
 const excluded=rows.filter(row=>!proposals.has(row.employee.id)).map(row=>({id:row.employee.id,name:row.employee.name,reason:row.options.find(option=>option.hours===hours)!.text}));
 return {count:proposals.size,excluded,state:{...state,employees:state.employees.map(employee=>{
  const journey=proposals.get(employee.id);if(!journey)return employee;
  return {...employee,journeys:[...(employee.journeys||[]).filter(prior=>prior.effectiveDate!==date&&!staleFutureOfficialJourney(employee,prior,date)),{...journey}].sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate))};
 })}};
}
