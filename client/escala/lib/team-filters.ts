import {employeeArea} from './areas';
import {type Employee} from './roster';
export function isUnclassifiedSchedule(e:Employee){return e.shift==='Outros'&&employeeArea(e)==='Não definida';}
export function matchesTeam(e:Employee,area:string,shift:string){if(area!=='Todas'&&employeeArea(e)!==area)return false;if(shift==='Revisar')return !e.included;if(shift==='Outros')return isUnclassifiedSchedule(e);return shift==='Todos'||e.shift===shift;}
