export type Journey={hours:44|42|40;option:1|2|3;start:string;breakAfter:number;breakMinutes:number;effectiveDate:string;nightReduced?:boolean};
export const optionLabels={1:'Mesma entrada da Senior',2:'Entrada antecipada',3:'Entrada posterior'};
export function clockMinutes(s:string){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))return NaN;const [h,m]=s.split(':').map(Number);return h*60+m;}
export function clock(n:number){const t=((n%1440)+1440)%1440;return `${Math.floor(t/60).toString().padStart(2,'0')}:${(t%60).toString().padStart(2,'0')}`;}
export function duration(n:number){return `${Math.floor(n/60)}h${n%60?String(n%60).padStart(2,'0'):''}`;}
function nightMinute(abs:number){const minute=((Math.floor(abs)%1440)+1440)%1440;return minute>=22*60||minute<5*60;}
export function creditedWorkMinutes(from:number,to:number){let total=0;for(let minute=from;minute<to;minute++)total+=nightMinute(minute)?8/7:1;return total;}
function creditedEnd(start:number,breakAfter:number,breakMinutes:number,target:number){
 const breakStart=start+breakAfter,breakEnd=breakStart+breakMinutes;
 let worked=creditedWorkMinutes(start,breakStart),end=breakEnd,guard=0;
 while(worked+1e-9<target&&guard<1200){worked+=nightMinute(end)?8/7:1;end++;guard++;}
 return end;
}
export function isJourney(v:unknown):v is Journey{if(!v||typeof v!=='object')return false;const j=v as Journey;return [44,42,40].includes(j.hours)&&[1,2,3].includes(j.option)&&Number.isFinite(clockMinutes(j.start))&&Number.isInteger(j.breakAfter)&&j.breakAfter>0&&j.breakAfter<j.hours*12&&Number.isInteger(j.breakMinutes)&&j.breakMinutes>=15&&j.breakMinutes<=180&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(j.effectiveDate)&&Number.isFinite(Date.parse(j.effectiveDate+'T12:00:00Z'))&&new Date(j.effectiveDate+'T12:00:00Z').toISOString().slice(0,10)===j.effectiveDate&&(j.nightReduced===undefined||typeof j.nightReduced==='boolean');}
export function journeyTimes(j:Journey){
 const start=clockMinutes(j.start),breakStart=start+j.breakAfter,breakEnd=breakStart+j.breakMinutes;
 const end=j.nightReduced?creditedEnd(start,j.breakAfter,j.breakMinutes,j.hours*12):start+j.hours*12+j.breakMinutes;
 const clockWork=(breakStart-start)+(end-breakEnd);
 return {points:[start,breakStart,breakEnd,end],labels:[start,breakStart,breakEnd,end].map(p=>clock(p)),daily:j.hours*12,total:end-start,clockWork};
}
export function journeyText(j:Journey){const t=journeyTimes(j);return `${t.labels[0]}–${t.labels[1]} / ${t.labels[2]}–${t.labels[3]}`;}
export function selectedJourney(e:{journeys?:Journey[]},date:string){return e.journeys?.filter(j=>j.effectiveDate<=date).sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate))[0];}
export function shiftDefaults(shift:string){return shift==='3º'?{start:'22:00',breakAfter:120}:shift==='2º'?{start:'14:00',breakAfter:240}:{start:'06:00',breakAfter:300};}
export function assignJourney<T extends {id:string;journeys?:Journey[]}>(employees:T[],selected:Set<string>,journey:Journey):T[]{if(!isJourney(journey))throw Error('Confira os horários e a data de vigência.');return employees.map(e=>selected.has(e.id)?{...e,journeys:[...(e.journeys||[]).filter(j=>j.effectiveDate!==journey.effectiveDate),{...journey}].sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate))}:e);}
