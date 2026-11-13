import {type Employee,type State} from './roster';
export type LeadershipLevel='Líder'|'Encarregado'|'Coordenador';
export const leadershipSourceId='beta-planning';
export const officialLeadership:{id:string;name:string;role:string;level:LeadershipLevel}[]=[];
export const normalizedEmployeeId=(id:string)=>id.replace(/^0+(?=\d)/,'');
export function officialLeadershipRecord(_e:Pick<Employee,'id'>):{level:LeadershipLevel}|undefined{return undefined;}
export function applyOfficialLeadership(original:State):State{return original;}
