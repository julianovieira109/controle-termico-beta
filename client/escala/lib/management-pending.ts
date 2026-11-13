import {businessToday} from './business-date';
import {planned,employed,issues,type State,type Employee} from './roster';
import {selectedJourney} from './journeys';
import {employeeArea} from './areas';
import {specialSchedule} from './planning-reference';
import {officialLeadership,normalizedEmployeeId} from './official-leadership';
import {isLeader} from './leadership';
export type PendingItem={id:string;employee?:Employee;name:string;reason:string;action:'employee'|'journey'|'leadership';kind:'rest'|'review'|'classification'|'official'|'journey'|'leadership';instruction:string;buttonLabel:string};
export function managementPending(state:State,employees:Employee[],dates:Date[],referenceDate=businessToday()):PendingItem[]{
 const result:PendingItem[]=[];
 for(const employee of employees){
  if(!dates.some(date=>employed(employee,date)))continue;
  for(const reason of issues(employee,dates,state)){
   const rest=reason==='Definir horário e folgas';
   result.push({id:employee.id+':'+reason,employee,name:employee.name,reason:rest?'Duas folgas ainda não definidas':reason,action:'employee',kind:rest?'rest':'review',instruction:rest?'Escolha a folga principal, a segunda folga e a vigência. O horário oficial permanece preservado.':'Confira as duas folgas e sua vigência. Ajustes por data e histórico são preservados.',buttonLabel:rest?'Definir folgas':'Revisar folgas'});
  }
  if(planned(employee,referenceDate)&&!specialSchedule(employee)&&!selectedJourney(employee,referenceDate))result.push({id:employee.id+':journey',employee,name:employee.name,reason:'Carga semanal planejada não definida na data de referência',action:'journey',kind:'journey',instruction:'Compare a proposta com a Senior, escolha a carga e a vigência e confirme somente no planejamento.',buttonLabel:'Definir jornada'});
  if(!employee.code)result.push({id:employee.id+':classification',employee,name:employee.name,reason:'Código da escala oficial não informado',action:'employee',kind:'official',instruction:'O código é somente leitura. Confira o cadastro e a importação da Senior; o planejamento não deve inventar esse dado.',buttonLabel:'Consultar cadastro no Beta'});
  else if(!['1º','2º','3º'].includes(employee.shift)&&employeeArea(employee)==='Não definida')result.push({id:employee.id+':classification',employee,name:employee.name,reason:'Conferir área e classificação do planejamento',action:'employee',kind:'classification',instruction:specialSchedule(employee)?'Jornada especial ou reduzida: faça a revisão individual, preservando o horário recebido da Senior.':'Escolha a área e o turno planejados. O código e os horários oficiais são somente leitura.',buttonLabel:'Revisar classificação'});
  if(isLeader(employee)&&!employee.leadershipReviewedAt)result.push({id:employee.id+':leadership',employee,name:employee.name,reason:'Liderança sem conferência atual registrada',action:'leadership',kind:'leadership',instruction:'Confira cargo, turno e coordenador e confirme a liderança no planejamento. Não é necessário mudar o cargo ou desmarcar e remarcar a pessoa.',buttonLabel:'Conferir liderança'});
 }
 for(const reference of officialLeadership)if(!state.employees.some(employee=>normalizedEmployeeId(employee.id)===reference.id))result.push({id:reference.id+':missing',name:reference.name,reason:`Matrícula ${reference.id} da lista de liderança não localizada`,action:'leadership',kind:'official',instruction:'Confira o vínculo no cadastro Beta. A conferência depende de um colaborador localizado nesta unidade.',buttonLabel:'Consultar cadastro no Beta'});
 return result;
}
