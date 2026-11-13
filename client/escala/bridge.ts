type Context={companyId:string;branchId:string;companyName:string;branchName:string;canEdit:boolean;officialVersion:string;onSaving?:(saving:boolean)=>void};
let context:Context={companyId:'',branchId:'',companyName:'',branchName:'',canEdit:false,officialVersion:''};
export function unitContext(){return context;}
export function setUnitContext(next:Context){context=next;}
export function readOnly(){return !context.canEdit;}
export async function apiFetch(path:string,options:RequestInit={}){
 const target=new URL('/api/escalas-5x2'+path,location.origin);
 target.searchParams.set('companyId',context.companyId);target.searchParams.set('branchId',context.branchId);
 const writing=options.method&&options.method!=='GET';const onSaving=context.onSaving;
 if(writing)onSaving?.(true);
 try{return await fetch(target,{...options,headers:{...options.headers,'Content-Type':'application/json',Authorization:`Bearer ${sessionStorage.getItem('token')||''}`},cache:'no-store'});}
 finally{if(writing)onSaving?.(false);}
}
export async function readResponse<T=any>(response:Response):Promise<T>{
 const text=await response.text();let result;
 try{result=JSON.parse(text);}catch{throw Error('O servidor não retornou dados válidos. Confira a versão publicada do Beta.');}
 if(!response.ok)throw Error(result.error||'Não foi possível concluir a operação.');return result;
}
export function requestBackupMigration(file:File){window.dispatchEvent(new CustomEvent('escala:migrate-file',{detail:file}));}
