const crypto=require('node:crypto');
const rules=require('../generated/roster-rules.cjs');
const planningFields=['shift','included','off1','off2','note','journeys','restRules','weeklyPattern','area','leader','leadershipReviewedAt'];
const officialFields=['id','officialEmployeeId','name','code','schedule','role','active','admissionDate','dismissalDate','fixedWednesday'];
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const registration=value=>/^\d{1,12}$/.test(String(value||''))?String(value).replace(/^0+(?=\d)/,''):null;
const name=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,' ').trim().toUpperCase();
const date=value=>value?new Date(value).toISOString().slice(0,10):'';
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pick=(object,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(object,key)).map(key=>[key,object[key]]));
function officialVersion(rows){return digest(rows.map(row=>[row.id,row.registration,row.full_name,row.status,row.admission_date,row.termination_date,row.job_role_name,row.job_title,row.shift_senior_code,row.shift_description,row.updated_at]));}
function valid(state){
 if(!rules.validState(state)||state.history.length>500)throw fail('Planejamento inválido. Confira matrículas, folgas, jornadas, datas e exceções.');
 for(const employee of state.employees){
  for(const key of ['admissionDate','dismissalDate','leadershipReviewedAt'])if(employee[key]&&!rules.validDay(employee[key]))throw fail('Há uma data de cadastro ou conferência inválida.');
  if(employee.note.length>4000||employee.schedule.length>4000||employee.code.length>100)throw fail('Um campo de planejamento ultrapassa o tamanho permitido.');
  for(const rule of employee.restRules||[])if(rule.included!==false&&(!rules.days.includes(rule.off1)||!rules.days.includes(rule.off2)||rule.off1===rule.off2))throw fail('Uma regra de folga não contém dois dias diferentes.');
 }
 for(const item of state.overrides)if(!rules.validDay(item.date)||item.reason.length>2000)throw fail('Há uma exceção com data ou motivo inválidos.');
 return state;
}
function eligible(rows){
 const groups=new Map(),pending=[];
 for(const row of rows){const id=registration(row.registration);if(!id){pending.push({id:row.id,name:row.full_name,reason:'Matrícula ausente ou fora do formato numérico de até 12 dígitos. Regularize no cadastro Beta.'});continue;}if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);}
 const employees=[];
 for(const [id,group] of groups)if(group.length===1)employees.push({id,row:group[0]});else for(const row of group)pending.push({id:row.id,name:row.full_name,reason:'Matrícula ambígua na unidade (incluindo zeros à esquerda). Regularize no cadastro Beta.'});
 return {employees,pending};
}
function project(rows,stored={}){
 const available=eligible(rows),saved=stored.state||{employees:[],overrides:[],history:[]};
 const byOfficial=new Map([...(stored.detached||[]).map(entry=>[entry.employee.officialEmployeeId,entry]),...saved.employees.map(employee=>[employee.officialEmployeeId,{employee,overrides:saved.overrides.filter(o=>o.id===employee.id)}])]);
 const employees=available.employees.map(({id,row})=>{
  const before=byOfficial.get(row.id)?.employee;
  const normalizedShift=name(row.shift_name);
  const shift=/^1 (TURNO|TUR)/.test(normalizedShift)?'1º':/^2 (TURNO|TUR)/.test(normalizedShift)?'2º':/^3 (TURNO|TUR)/.test(normalizedShift)?'3º':'Outros';
  return {...{shift,included:false,off1:'',off2:'',note:'Planejamento de jornada e folgas ainda não definido.',area:'Não definida'},...pick(before||{},planningFields),
   id,officialEmployeeId:row.id,name:row.full_name,code:row.shift_senior_code||'',schedule:row.shift_description||'',role:row.job_role_name||row.job_title||'',
   active:row.status==='ATIVO',admissionDate:date(row.admission_date),dismissalDate:date(row.termination_date),fixedWednesday:before?.fixedWednesday===true};
 });
 const overrides=employees.flatMap(employee=>(byOfficial.get(employee.officialEmployeeId)?.overrides||[]).map(o=>({...o,id:employee.id})));
 const detached=saved.employees.filter(employee=>!employees.some(e=>e.officialEmployeeId===employee.officialEmployeeId));
 const visibleDetached=[...new Map([...(stored.detached||[]).map(entry=>entry.employee),...detached].filter(employee=>!employees.some(e=>e.officialEmployeeId===employee.officialEmployeeId)).map(employee=>[employee.officialEmployeeId,employee])).values()];
 const state=rules.normalizeRoster({employees,overrides,history:saved.history||[],appliedImports:saved.appliedImports||[]});
 return {state,detached,pending:[...available.pending,...visibleDetached.map(e=>({id:e.id,name:e.name,reason:'Vínculo anterior não está disponível no cadastro desta unidade; planejamento preservado para conferência.'})),...(stored.pending||[]).map(p=>({id:p.id,name:p.name,reason:p.reason}))]};
}
function protect(next,before){
 valid(next);
 const byId=new Map(before.employees.map(e=>[e.id,e]));
 if(next.employees.length!==before.employees.length)throw fail('Cadastre ou altere vínculos em Colaboradores no Beta. O planejamento não cria nem remove cadastros oficiais.');
 for(const employee of next.employees){
  const previous=byId.get(employee.id);
  if(!previous||officialFields.some(key=>JSON.stringify(employee[key]??null)!==JSON.stringify(previous[key]??null)))throw fail('Nome, matrícula, vínculo, cargo e horários oficiais são somente leitura. Recarregue o cadastro Beta.',409);
  for(const [day,value] of Object.entries(employee.weeklyPattern||{}))if(value==='A'&&previous.weeklyPattern?.[day]!=='A')throw fail('Ausências novas devem ser registradas somente por data, sem recorrência.');
  for(const rule of employee.restRules||[])for(const [day,value] of Object.entries(rule.pattern))if(value==='A'&&rules.weeklyStatus(previous,day,rule.effectiveDate)!=='A')throw fail('Ausências novas não podem virar uma regra semanal.');
 }
 return rules.normalizeRoster({...next,history:before.history,appliedImports:before.appliedImports});
}
function serialize(next,stored,projection){
 const activeIds=new Set(next.employees.map(e=>e.officialEmployeeId));
 const detached=[...(stored.detached||[]).filter(entry=>!activeIds.has(entry.employee.officialEmployeeId)),...projection.detached.map(employee=>({employee,overrides:(stored.state?.overrides||[]).filter(o=>o.id===employee.id)}))];
 return {...stored,state:next,detached:[...new Map(detached.map(entry=>[entry.employee.officialEmployeeId,entry])).values()]};
}
function previewImport(backup,rows,stored,scope){
 if(!backup||typeof backup!=='object')throw fail('O arquivo não contém um backup de escalas.');
 if(backup.scope&&(backup.scope.companyId!==scope.companyId||backup.scope.branchId!==scope.branchId))throw fail('O backup pertence a outra empresa/filial. Selecione a unidade de origem.');
 const input=valid(backup.state||backup);
 const current=project(rows,stored),byRegistration=new Map(current.state.employees.map(e=>[e.id,e]));
 const sourceGroups=new Map();for(const e of input.employees){const id=registration(e.id);if(!sourceGroups.has(id))sourceGroups.set(id,[]);sourceGroups.get(id).push(e);}
 const details=input.employees.map(source=>{
  const id=registration(source.id),target=byRegistration.get(id);
  const reason=sourceGroups.get(id).length>1?'Matrícula repetida no arquivo após normalizar zeros.':!target?'Não localizado ou matrícula ambígua no cadastro da unidade.':name(source.name)!==name(target.name)?'Nome divergente. Confira matrícula e vínculo no cadastro Beta.':null;
  return {sourceId:source.id,sourceName:source.name,targetName:target?.name||null,targetId:reason?null:target.id,officialEmployeeId:reason?null:target.officialEmployeeId,status:reason?'PENDENTE':'CORRESPONDENCIA',reason};
 });
 const hash=digest(input);if((stored.importedDigests||[]).includes(hash))throw fail('Este backup já foi aplicado nesta unidade.',409);
 return {hash,input,rows:details,summary:{total:details.length,matched:details.filter(r=>r.targetId).length,pending:details.filter(r=>!r.targetId).length}};
}
function applyImport(preview,rows,stored,allowPartial){
 const current=project(rows,stored);const bySource=new Map(preview.input.employees.map(e=>[e.id,e]));
 const pending=preview.rows.filter(row=>!row.targetId);
 if(pending.length&&!allowPartial)throw fail('Há pendências no backup. Confira a prévia e autorize explicitamente a aplicação parcial com preservação dos demais registros.');
 const matched=preview.rows.filter(row=>row.targetId);if(!matched.length)throw fail('Nenhum vínculo correspondente para aplicar.');
 const mappings=new Map(matched.map(row=>[row.sourceId,row.targetId]));
 const matchedIds=new Set(matched.map(row=>row.targetId));
 const employees=current.state.employees.map(employee=>{
  const mapping=matched.find(row=>row.targetId===employee.id);if(!mapping)return employee;
  if(mapping.officialEmployeeId!==employee.officialEmployeeId)throw fail('O vínculo oficial mudou. Confira o backup novamente.',409);
  const source=bySource.get(mapping.sourceId);
  return {...employee,...pick(source,planningFields),fixedWednesday:employee.fixedWednesday||registration(source.id)==='11077'&&name(source.name).includes('ELIZABETY')};
 });
 const state=rules.normalizeRoster({employees,overrides:[...current.state.overrides.filter(o=>!matchedIds.has(o.id)),...preview.input.overrides.filter(o=>mappings.has(o.id)).map(o=>({...o,id:mappings.get(o.id)}))],history:[...current.state.history,...preview.input.history].slice(0,500),appliedImports:[...new Set([...(current.state.appliedImports||[]),...(preview.input.appliedImports||[])])]});
 valid(state);
 const matchedSources=new Set(matched.map(row=>registration(row.sourceId)+'|'+name(row.sourceName)));
 const pendingEntries=[...(stored.pending||[]).filter(row=>!matchedSources.has(registration(row.id)+'|'+name(row.name))),...pending.map(row=>({id:row.sourceId,name:row.sourceName,reason:row.reason,source:bySource.get(row.sourceId),overrides:preview.input.overrides.filter(o=>o.id===row.sourceId)}))];
 return {...serialize(state,stored,current),importedDigests:[...(stored.importedDigests||[]),preview.hash],pending:[...new Map(pendingEntries.map(row=>[registration(row.id)+'|'+name(row.name),row])).values()]};
}
function changes(before,after){
 const previous=new Map(before.employees.map(e=>[e.officialEmployeeId,e]));
 return {employees:after.employees.filter(e=>JSON.stringify(e)!==JSON.stringify(previous.get(e.officialEmployeeId))).map(e=>({officialEmployeeId:e.officialEmployeeId,registration:e.id,before:previous.get(e.officialEmployeeId)||null,after:e})),overrides:{before:before.overrides,after:after.overrides}};
}
module.exports={fail,registration,name,digest,date,officialVersion,valid,project,protect,serialize,previewImport,applyImport,changes};
