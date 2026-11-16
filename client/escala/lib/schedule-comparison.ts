import {referenceProposal,specialSchedule} from './planning-reference';
import {journeyText,isJourney} from './journeys';
import {employed,type Employee} from './roster';
import {validDay} from './business-date';
export const comparisonHours=[40,42,44] as const;
export function compareSchedules(employees:Employee[],date:string){
 if(!validDay(date))throw Error('Informe uma data válida para a sugestão.');
 return employees.filter(employee=>employed(employee,new Date(date+'T12:00:00'))).map(employee=>({
  employee,
  options:comparisonHours.map(hours=>{
   const journey=referenceProposal(employee,hours,date);
   return {hours,journey:journey&&isJourney(journey)?journey:undefined,
    text:journey&&isJourney(journey)?journeyText(journey):specialSchedule(employee)?'Jornada especial / reduzida — revisão individual':'Horário incompleto ou incompatível — conferir'};
  })
 }));
}
export function comparisonCsv(rows:ReturnType<typeof compareSchedules>,date:string){
 const escape=(value:unknown)=>{let text=String(value??'');if(/^[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 const data=[['Status','Referência','Matrícula','Colaborador','Turno','Líder / coordenador vinculado','Horário atual','Carga semanal','Trabalho diário','Novo horário sugerido','Dias de trabalho','Dias de folga'],
 ...rows.flatMap(row=>row.options.map(option=>['SUGESTÃO 5x2 — SEM APLICAÇÃO',date,row.employee.id,row.employee.name,row.employee.officialShift||row.employee.shift,row.employee.coordinatorName||'Sem vínculo informado',row.employee.schedule,option.hours+'h',option.hours===40?'8h':option.hours===42?'8h24':'8h48',option.text,5,2]))];
 return '\uFEFF'+data.map(row=>row.map(escape).join(';')).join('\r\n');
}
