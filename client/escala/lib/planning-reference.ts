import {clockMinutes,creditedWorkMinutes,type Journey} from './journeys';
import type {Employee} from './roster';
function codeOf(employee:Pick<Employee,'code'>){return String(employee.code||'').replace(/^0+(?=\d)/,'');}
export function referenceSchedule(employee:Pick<Employee,'schedule'|'code'>){
 const times=employee.schedule.match(/(?<!\d)(?:[01]\d|2[0-3]):[0-5]\d(?!\d)/g)||[];
 if(times.length!==4)return undefined;
 const points=times.map(clockMinutes);for(let i=1;i<4;i++)while(points[i]<=points[i-1])points[i]+=1440;
 const breakAfter=points[1]-points[0],breakMinutes=points[2]-points[1],daily=breakAfter+points[3]-points[2];
 const nightExtension=codeOf(employee)==='56'&&times[0]==='22:00'&&points[3]>=(24*60+6*60);
 const creditedDaily=creditedWorkMinutes(points[0],points[1],nightExtension,points[0])+creditedWorkMinutes(points[2],points[3],nightExtension,points[0]);
 if(breakMinutes<15||breakMinutes>180||daily<=0||points[3]-points[0]>960)return undefined;
 return {start:times[0],breakAfter,breakMinutes,daily,creditedDaily,nightReduced:creditedDaily>daily+0.001,nightExtension};
}
export function specialSchedule(employee:Pick<Employee,'schedule'|'code'|'role'|'fixedWednesday'>){
 const role=(employee.role||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
 return employee.fixedWednesday===true||/APRENDIZ|ESTAGIARI/.test(role)||(employee.schedule.match(/(?<!\d)(?:[01]\d|2[0-3]):[0-5]\d(?!\d)/g)||[]).length===2||(referenceSchedule(employee)?.daily||Infinity)<=360;
}
export function commonReference(employees:Employee[]){
 if(!employees.length)return undefined;
 const bases=employees.map(referenceSchedule);if(bases.some(base=>!base))return undefined;
 const first=bases[0]!;return bases.every(base=>base!.start===first.start&&base!.breakAfter===first.breakAfter&&base!.breakMinutes===first.breakMinutes&&base!.nightReduced===first.nightReduced&&base!.nightExtension===first.nightExtension)?first:undefined;
}
export function referenceProposal(employee:Employee,hours:40|42|44,effectiveDate:string):Journey|undefined{
 const base=referenceSchedule(employee);if(!base||specialSchedule(employee)||base.breakAfter>=hours*12)return undefined;
 return {hours,option:1,start:base.start,breakAfter:base.breakAfter,breakMinutes:base.breakMinutes,effectiveDate,nightReduced:base.nightReduced||undefined,nightExtension:base.nightExtension||undefined};
}
