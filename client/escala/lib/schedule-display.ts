import {selectedJourney,journeyText} from './journeys';
import {planned,employed,key,type Employee} from './roster';
export type ScheduleSegment={label:string;time:string;from:string;to:string};
const shortDate=(s:string)=>s.slice(8,10)+'/'+s.slice(5,7);
/** Use only registered journeys effective on each displayed date; never infer weekly hours. */
export function scheduleSegments(e:Employee,dates:Date[]):ScheduleSegment[]{
 const segments:ScheduleSegment[]=[];
 for(const date of dates){if(!employed(e,date))continue;const dateKey=key(date);const j=selectedJourney(e,dateKey);
  const code=e.code?' · Escala '+e.code:'';
  const label=j?`${planned(e,dateKey)?'5x2 · ':''}${j.hours}h/semana${code}`:`${planned(e,dateKey)?'5x2 · ':''}Escala ${e.code||'não informada'}`;
  const time=j?journeyText(j):e.schedule.trim()||'Horário não informado';
  const previous=segments[segments.length-1];
  if(previous&&previous.label===label&&previous.time===time)previous.to=dateKey;
  else segments.push({label,time,from:dateKey,to:dateKey});
 }
 return segments;
}
export function scheduleDescription(e:Employee,dates:Date[]){const segments=scheduleSegments(e,dates);return segments.map(s=>`${segments.length>1?shortDate(s.from)+' a '+shortDate(s.to)+': ':''}${s.label}\n${s.time}`).join('\n');}
export function sectionSchedules(employees:Employee[],dates:Date[]){return [...new Set(employees.map(e=>scheduleDescription(e,dates)).filter(Boolean))];}
