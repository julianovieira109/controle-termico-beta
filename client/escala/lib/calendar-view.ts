export type CalendarView='month'|'week';
export function calendarKey(d:Date){return `${String(d.getFullYear()).padStart(4,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function parseDay(value:string){const d=new Date(value+'T12:00:00');if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(d.getTime())||calendarKey(d)!==value)throw Error('Data inválida');return d;}
export function moveCalendarDays(anchor:string,offset:number){const d=parseDay(anchor);d.setDate(d.getDate()+offset);return calendarKey(d);}
export function displayedCalendarDays(month:string,view:CalendarView,anchor:string){if(view==='week'){const start=parseDay(anchor);start.setDate(start.getDate()-(start.getDay()+6)%7);return Array.from({length:7},(_,i)=>parseDay(moveCalendarDays(calendarKey(start),i)));}const start=parseDay(month+'-01');const last=new Date(start.getTime());last.setMonth(last.getMonth()+1,0);return Array.from({length:last.getDate()},(_,i)=>parseDay(moveCalendarDays(month+'-01',i)));}
export function weekCaption(ds:Date[]){return `${ds[0].toLocaleDateString('pt-BR')} a ${ds[ds.length-1].toLocaleDateString('pt-BR')}`;}
