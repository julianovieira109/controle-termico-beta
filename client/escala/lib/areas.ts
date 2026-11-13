export type Area='ADM'|'Comercial'|'Não definida';
export function employeeArea(e:{id:string;area?:Area}):Area {return e.area||'Não definida';}
// Horários do cadastro Beta, preservados como referência, sem alterar o texto Senior.
export const scheduleCatalog:Record<string,{label:string;start:string;breakAfter:number;breakMinutes:number}>={
'0046':{label:'06:00–11:00 / 12:00–14:20',start:'06:00',breakAfter:300,breakMinutes:60},
'0096':{label:'14:00–18:00 / 19:00–22:20',start:'14:00',breakAfter:240,breakMinutes:60},
'0056':{label:'22:00–00:00 / 01:00–06:00',start:'22:00',breakAfter:120,breakMinutes:60},
'0064':{label:'07:00–12:00 / 13:00–16:00',start:'07:00',breakAfter:300,breakMinutes:60},
'0026':{label:'08:00–12:00 / 13:00–18:00',start:'08:00',breakAfter:240,breakMinutes:60},
'0007':{label:'08:00–12:00 / 13:30–18:00',start:'08:00',breakAfter:240,breakMinutes:90},
'0106':{label:'08:00–12:00 / 12:15–14:15',start:'08:00',breakAfter:240,breakMinutes:15},
'0116':{label:'04:00–08:00 / 09:00–12:20',start:'04:00',breakAfter:240,breakMinutes:60}
};

export function isApprentice(e:{id:string;fixedWednesday?:boolean}){return e.fixedWednesday===true;}
