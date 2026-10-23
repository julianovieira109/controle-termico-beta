const {randomUUID}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES=new Set(['INTERNAL','PJ','EXTERNAL']);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>String(value??'').trim().toLowerCase();
const name=value=>String(value??'').trim().replace(/\s+/g,' ');
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
function empty(){return {coordinators:[],shiftCoordinators:{},employeeCoordinators:{},version:0};}
function reference(value){return id(object(value)?value.id:value);}

function normalizeState(raw={},employees=[]){
  const byEmployee=new Map(employees.map(employee=>[id(employee.id),employee]));
  const registry=new Map();
  for(const entry of Array.isArray(raw.coordinators)?raw.coordinators:[]){
    const coordinatorId=id(entry.id),employeeId=id(entry.employeeId);
    registry.set(coordinatorId,{id:coordinatorId,name:name(byEmployee.get(employeeId)?.full_name||entry.name),type:TYPES.has(entry.type)?entry.type:'INTERNAL',...(employeeId?{employeeId}:{}),active:employeeId&&!byEmployee.has(employeeId)?false:entry.active!==false});
  }
  const maps={};
  for(const key of ['shiftCoordinators','employeeCoordinators']){
    const entries=object(raw[key])?Object.entries(raw[key]):[];
    const mapEntries=[];
    for(const [target,value] of entries){
      const coordinatorId=reference(value);
      if(!registry.has(coordinatorId)){
        const employee=byEmployee.get(coordinatorId);
        // Existing links survive RH dismissal/inactivation. An unavailable
        // legacy employee is retained explicitly, never silently discarded.
        registry.set(coordinatorId,{id:coordinatorId,name:name(employee?.full_name||value?.name),type:'INTERNAL',employeeId:coordinatorId,active:employee?true:false});
      }
      mapEntries.push([id(target),{id:coordinatorId,name:registry.get(coordinatorId).name}]);
    }
    maps[key]=Object.fromEntries(mapEntries);
  }
  return {coordinators:[...registry.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.id.localeCompare(b.id)),...maps,version:Number.isSafeInteger(raw.version)&&raw.version>=0?raw.version:0};
}

function prepareUpdate(current,body,{employees=[],shifts=[],forbiddenCoordinatorIds=[]}={}){
  if(!Number.isSafeInteger(body.version)||body.version<0)throw failure('Recarregue a gestão de equipes antes de salvar. A versão da configuração é obrigatória.');
  if(body.version!==current.version)throw failure('As equipes foram alteradas em outra tela. Recarregue a gestão de equipes antes de salvar novamente.',409);
  const employeesById=new Map(employees.map(employee=>[id(employee.id),employee]));
  const shiftIds=new Set(shifts.map(shift=>id(shift.id)));
  const forbidden=new Set(forbiddenCoordinatorIds.map(id));
  const prior=new Map(current.coordinators.map(coordinator=>[coordinator.id,coordinator]));
  const requested=own(body,'coordinators')?body.coordinators:current.coordinators;
  if(!Array.isArray(requested)||requested.length>1000)throw failure('Informe uma lista válida de até 1000 coordenadores.');
  const coordinators=[],registry=new Map(),linkedEmployees=new Set();
  for(const entry of requested){
    if(!object(entry))throw failure('Cadastro de coordenador inválido.');
    const coordinatorId=entry.id===undefined?randomUUID():id(entry.id);
    if(!UUID.test(coordinatorId)||(!prior.has(coordinatorId)&&forbidden.has(coordinatorId)))throw failure('Identificador de coordenador inválido ou pertencente a outra filial.');
    if(registry.has(coordinatorId))throw failure('Há coordenadores com identificadores repetidos.');
    const type=String(entry.type||'').toUpperCase();
    if(!TYPES.has(type))throw failure('Selecione um tipo válido de coordenador: Interno, PJ ou Externo.');
    const employeeId=id(entry.employeeId),previous=prior.get(coordinatorId);
    const orphan=!!employeeId&&!employeesById.has(employeeId);
    const preserveOrphan=orphan&&previous?.employeeId===employeeId&&previous.type===type&&name(entry.name)===previous.name&&entry.active!==true;
    if(employeeId&&(!UUID.test(employeeId)||(orphan&&!preserveOrphan)))throw failure('O colaborador vinculado ao coordenador não pertence à empresa e filial selecionadas. Um vínculo histórico indisponível só pode ser preservado inativo e sem alterações.');
    if(employeeId&&type!=='INTERNAL')throw failure('O vínculo com colaborador é permitido somente para coordenador Interno.');
    if(employeeId&&linkedEmployees.has(employeeId))throw failure('Este colaborador já possui um cadastro de coordenador nesta filial.');
    if(employeeId)linkedEmployees.add(employeeId);
    if(!prior.has(coordinatorId)&&employeesById.has(coordinatorId)&&employeeId!==coordinatorId)throw failure('Este identificador já pertence a um colaborador. Vincule o cadastro interno correto.');
    if(entry.active!==undefined&&typeof entry.active!=='boolean')throw failure('A situação do coordenador precisa ser ativa ou inativa.');
    const coordinatorName=preserveOrphan?previous.name:employeeId?name(employeesById.get(employeeId).full_name):name(entry.name);
    if(!coordinatorName||coordinatorName.length>180||/[\u0000-\u001f\u007f]/.test(String(entry.name||'')))throw failure('Informe um nome de coordenador com até 180 caracteres.');
    const coordinator={id:coordinatorId,name:coordinatorName,type,...(employeeId?{employeeId}:{}),active:preserveOrphan?false:entry.active??prior.get(coordinatorId)?.active??true};
    registry.set(coordinatorId,coordinator);coordinators.push(coordinator);
  }
  const maps={};
  for(const [key,targets] of [['shiftCoordinators',shiftIds],['employeeCoordinators',new Set(employeesById.keys())]]){
    const requestedMap=own(body,key)?body[key]:current[key];
    if(!object(requestedMap)||Object.keys(requestedMap).length>10000)throw failure('Informe vínculos válidos por turno ou colaborador.');
    maps[key]={};
    for(const [rawTarget,rawCoordinator] of Object.entries(requestedMap)){
      const target=id(rawTarget),coordinatorId=reference(rawCoordinator);
      const unchangedHistoricalTarget=own(current[key]||{},target)&&reference(current[key][target])===coordinatorId;
      if(!UUID.test(target)||(!targets.has(target)&&!unchangedHistoricalTarget))throw failure(key==='shiftCoordinators'?'O turno não pertence à empresa selecionada.':'O colaborador não pertence à empresa e filial selecionadas.');
      const coordinator=registry.get(coordinatorId);
      if(!coordinator)throw failure('Coordenador não localizado nesta filial. Desvincule suas equipes antes de remover o cadastro.');
      if(!coordinator.active&&reference(current[key]?.[target])!==coordinatorId)throw failure('Um coordenador inativo não pode receber novos vínculos de equipe.');
      maps[key][target]={id:coordinator.id,name:coordinator.name};
    }
  }
  return {coordinators:coordinators.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.id.localeCompare(b.id)),...maps,version:current.version+1};
}

function resolveCoordinator(raw,value,employees=[]){
  if(!value)return null;
  const coordinatorId=reference(value);
  const registry=Array.isArray(raw.coordinators)?raw.coordinators:[];
  const coordinator=registry.find(entry=>id(entry.id)===coordinatorId);
  const linkedId=id(coordinator?.employeeId||(!coordinator?coordinatorId:''));
  const employee=employees.find(entry=>id(entry.id)===linkedId);
  const coordinatorName=name(employee?.full_name||coordinator?.name||value?.name);
  return coordinatorId&&coordinatorName?{id:coordinatorId,name:coordinatorName}:null;
}
module.exports={UUID,empty,normalizeState,prepareUpdate,resolveCoordinator};
