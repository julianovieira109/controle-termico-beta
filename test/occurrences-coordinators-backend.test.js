const test=require('node:test');
const assert=require('node:assert/strict');
const management=require('../src/lib/occurrences-management');
const key=value=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`;
const employeeA=key(101),employeeB=key(102),foreignEmployee=key(999),shiftA=key(201),shiftB=key(202),coordinatorA=key(301),coordinatorB=key(302);
const employees=[{id:employeeA,full_name:'Nome atual do RH',registration:'123',shift_id:shiftA,status:'ATIVO',active:true},{id:employeeB,full_name:'Outra pessoa',registration:'456',shift_id:shiftB,status:'ATIVO',active:true}];
const shifts=[{id:shiftA,name:'1º Turno'},{id:shiftB,name:'2º Turno'}];
const catalog={employees,shifts};
function state(extra={}){
  return management.normalizeState({coordinators:[{id:coordinatorA,name:'Coordenadora PJ',type:'PJ',active:true}],shiftCoordinators:{[shiftA]:{id:coordinatorA,name:'Nome antigo'}},employeeCoordinators:{[employeeA]:{id:coordinatorA,name:'Nome antigo'}},version:4,...extra},employees);
}
const fails=(run,status)=>assert.throws(run,error=>error.status===status);

test('legado mantém identificador e vínculo quando o coordenador foi demitido ou inativado no RH',()=>{
  const inactive=[{...employees[0],full_name:'Nome corrigido',status:'DEMITIDO',active:false}];
  const value=management.normalizeState({shiftCoordinators:{[shiftA]:{id:employeeA,name:'Nome antigo'}},employeeCoordinators:{[employeeA]:{id:employeeA,name:'Nome antigo'}}},inactive);
  assert.equal(value.version,0);
  assert.deepEqual(value.coordinators,[{id:employeeA,name:'Nome corrigido',type:'INTERNAL',employeeId:employeeA,active:true}]);
  assert.deepEqual(value.shiftCoordinators[shiftA],{id:employeeA,name:'Nome corrigido'});
  const saved=management.prepareUpdate(value,{version:0},{employees:inactive,shifts});
  assert.deepEqual(saved.employeeCoordinators,value.employeeCoordinators);
});

test('coordenador PJ independente pode receber turno e colaboradores sem possuir matrícula',()=>{
  const saved=management.prepareUpdate(management.empty(),{version:0,coordinators:[{id:coordinatorA,name:'Prestadora de serviços',type:'PJ'}],shiftCoordinators:{[shiftA]:{id:coordinatorA,name:'Nome forjado'}},employeeCoordinators:{[employeeB]:{id:coordinatorA}}},catalog);
  assert.equal(saved.version,1);
  assert.deepEqual(saved.coordinators,[{id:coordinatorA,name:'Prestadora de serviços',type:'PJ',active:true}]);
  assert.deepEqual(saved.shiftCoordinators[shiftA],{id:coordinatorA,name:'Prestadora de serviços'});
  assert.equal(saved.employeeCoordinators[employeeB].id,coordinatorA);
});

test('renomear somente o cadastro preserva os dois mapas e atualiza seus nomes canônicos',()=>{
  const current=state(),snapshot=JSON.stringify(current);
  const saved=management.prepareUpdate(current,{version:4,coordinators:[{...current.coordinators[0],name:'Nome atualizado'}]},catalog);
  assert.equal(saved.shiftCoordinators[shiftA].id,coordinatorA);
  assert.equal(saved.employeeCoordinators[employeeA].id,coordinatorA);
  assert.equal(saved.shiftCoordinators[shiftA].name,'Nome atualizado');
  assert.equal(saved.employeeCoordinators[employeeA].name,'Nome atualizado');
  assert.equal(JSON.stringify(current),snapshot,'a operação não altera o estado anterior');
});

test('alterar um mapa preserva cadastro e o outro mapa; limpar mapa é explícito',()=>{
  const current=state();
  const saved=management.prepareUpdate(current,{version:4,shiftCoordinators:{}},catalog);
  assert.deepEqual(saved.coordinators,current.coordinators);
  assert.deepEqual(saved.shiftCoordinators,{});
  assert.deepEqual(saved.employeeCoordinators,current.employeeCoordinators);
});

test('versão ausente é rejeitada e versão antiga gera conflito sem sobrescrever equipes',()=>{
  const current=state();
  for(const version of [undefined,null,'4',-1,1.2])fails(()=>management.prepareUpdate(current,{version},catalog),400);
  fails(()=>management.prepareUpdate(current,{version:3,shiftCoordinators:{}},catalog),409);
  const saved=management.prepareUpdate(current,{version:4},catalog);
  assert.equal(saved.version,5);
  fails(()=>management.prepareUpdate(saved,{version:4,coordinators:[]},catalog),409);
});

test('ids de colaboradores ou turnos fora do catálogo selecionado não são removidos silenciosamente',()=>{
  const current=state();
  for(const body of [{employeeCoordinators:{[foreignEmployee]:{id:coordinatorA}}},{shiftCoordinators:{[key(998)]:{id:coordinatorA}}},{employeeCoordinators:{invalid:{id:coordinatorA}}}]){
    fails(()=>management.prepareUpdate(current,{version:4,...body},catalog),400);
  }
});

test('coordenador de outra filial não pode ser importado por id nem usado numa atribuição',()=>{
  const current=state();
  fails(()=>management.prepareUpdate(current,{version:4,coordinators:[...current.coordinators,{id:coordinatorB,name:'De outra unidade',type:'EXTERNAL'}]},{...catalog,forbiddenCoordinatorIds:[coordinatorB]}),400);
  fails(()=>management.prepareUpdate(current,{version:4,employeeCoordinators:{[employeeA]:{id:coordinatorB}}},catalog),400);
  fails(()=>management.prepareUpdate(current,{version:4,coordinators:[...current.coordinators,{id:coordinatorB,type:'INTERNAL',employeeId:foreignEmployee,name:'Outro'}]},catalog),400);
});

test('registro interno vinculado usa nome atual do RH e não o nome enviado pelo navegador',()=>{
  const saved=management.prepareUpdate(management.empty(),{version:0,coordinators:[{id:coordinatorA,name:'Nome adulterado',type:'INTERNAL',employeeId:employeeA}]},catalog);
  assert.equal(saved.coordinators[0].name,'Nome atual do RH');
  assert.equal(saved.coordinators[0].employeeId,employeeA);
  assert.equal(management.resolveCoordinator(saved,{id:coordinatorA},[{...employees[0],full_name:'Atualização posterior'}]).name,'Atualização posterior');
});

test('inativar coordenador preserva as equipes atuais e impede novas atribuições',()=>{
  const current=state();
  const inactive=management.prepareUpdate(current,{version:4,coordinators:[{...current.coordinators[0],active:false}]},catalog);
  assert.deepEqual(inactive.shiftCoordinators,current.shiftCoordinators);
  assert.deepEqual(inactive.employeeCoordinators,current.employeeCoordinators);
  fails(()=>management.prepareUpdate(inactive,{version:5,employeeCoordinators:{...inactive.employeeCoordinators,[employeeB]:{id:coordinatorA}}},catalog),400);
  fails(()=>management.prepareUpdate(inactive,{version:5,shiftCoordinators:{...inactive.shiftCoordinators,[shiftB]:{id:coordinatorA}}},catalog),400);
});

test('remover coordenador associado exige desvincular explicitamente suas equipes',()=>{
  const current=state();
  fails(()=>management.prepareUpdate(current,{version:4,coordinators:[]},catalog),400);
  const saved=management.prepareUpdate(current,{version:4,coordinators:[],shiftCoordinators:{},employeeCoordinators:{}},catalog);
  assert.deepEqual(saved.coordinators,[]);
  assert.deepEqual(saved.shiftCoordinators,{});
  assert.deepEqual(saved.employeeCoordinators,{});
});

test('cadastros malformados, duplicados, tipos e mapas inválidos são rejeitados',()=>{
  const current=state();
  for(const coordinators of [{},[null],[{id:'bad',name:'Teste',type:'PJ'}],[{id:coordinatorA,name:'Teste',type:'UNKNOWN'}],[{id:coordinatorA,name:'',type:'EXTERNAL'}],[{id:coordinatorA,name:'Teste',type:'PJ',active:'true'}],[...current.coordinators,...current.coordinators]]){
    fails(()=>management.prepareUpdate(current,{version:4,coordinators},catalog),400);
  }
  fails(()=>management.prepareUpdate(current,{version:4,shiftCoordinators:[]},catalog),400);
  fails(()=>management.prepareUpdate(current,{version:4,employeeCoordinators:null},catalog),400);
});

test('novo cadastro pode receber uuid no servidor e esse id permanece estável após renomear',()=>{
  const first=management.prepareUpdate(management.empty(),{version:0,coordinators:[{name:'Externo',type:'EXTERNAL'}]},catalog);
  assert.ok(management.UUID.test(first.coordinators[0].id));
  const second=management.prepareUpdate(first,{version:1,coordinators:[{...first.coordinators[0],name:'Externo atualizado'}]},catalog);
  assert.equal(second.coordinators[0].id,first.coordinators[0].id);
});

test('resolução de nomes prioriza cadastro atual e mantém resolução de legado por matrícula interna',()=>{
  const value=state();
  assert.deepEqual(management.resolveCoordinator(value,{id:coordinatorA,name:'Cache antigo'},employees),{id:coordinatorA,name:'Coordenadora PJ'});
  assert.deepEqual(management.resolveCoordinator({}, {id:employeeA,name:'Cache antigo'},employees),{id:employeeA,name:'Nome atual do RH'});
  assert.equal(management.resolveCoordinator(value,null,employees),null);
});

test('coordenador legado transferido ou indisponível mantém vínculos históricos sem bloquear outro cadastro',()=>{
  const localEmployees=[employees[1]],unavailable=employeeA;
  const current=management.normalizeState({shiftCoordinators:{[shiftA]:{id:unavailable,name:'Nome histórico'}},employeeCoordinators:{[employeeB]:{id:unavailable,name:'Nome histórico'}}},localEmployees);
  assert.deepEqual(current.coordinators,[{id:unavailable,name:'Nome histórico',type:'INTERNAL',employeeId:unavailable,active:false}]);
  const saved=management.prepareUpdate(current,{version:0,coordinators:[...current.coordinators,{id:coordinatorA,name:'Nova coordenadora PJ',type:'PJ'}]},{employees:localEmployees,shifts,forbiddenCoordinatorIds:[unavailable]});
  assert.deepEqual(saved.shiftCoordinators,current.shiftCoordinators);
  assert.deepEqual(saved.employeeCoordinators,current.employeeCoordinators);
  assert.equal(saved.coordinators.find(entry=>entry.id===unavailable).active,false);
  fails(()=>management.prepareUpdate(saved,{version:1,shiftCoordinators:{...saved.shiftCoordinators,[shiftB]:{id:unavailable}}},{employees:localEmployees,shifts}),400);
  for(const patch of [{name:'Nome modificado'},{active:true},{employeeId:foreignEmployee}]){
    fails(()=>management.prepareUpdate(current,{version:0,coordinators:[{...current.coordinators[0],...patch}]},{employees:localEmployees,shifts,forbiddenCoordinatorIds:[unavailable]}),400);
  }
});

test('alvo histórico indisponível é preservado apenas com o mesmo coordenador',()=>{
  const current=state({employeeCoordinators:{[foreignEmployee]:{id:coordinatorA,name:'Nome histórico'}}});
  const saved=management.prepareUpdate(current,{version:4,coordinators:[...current.coordinators,{id:coordinatorB,name:'Outra coordenadora',type:'EXTERNAL'}]},catalog);
  assert.equal(saved.employeeCoordinators[foreignEmployee].id,coordinatorA);
  fails(()=>management.prepareUpdate(saved,{version:5,employeeCoordinators:{[foreignEmployee]:{id:coordinatorB}}},catalog),400);
});

test('falha ao obter conexão no PUT segue para o middleware de erro sem deixar a requisição pendente',async()=>{
  const express=require('express'),{once}=require('node:events'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
  const filename=path.resolve(__dirname,'../src/routes/dashboard.js'),normalRequire=Module.createRequire(filename);
  const originalError=new Error('Conexão indisponível');
  const loaded=new Module(filename,module);
  loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
  const pass=(_req,_res,next)=>next();
  loaded.require=request=>{
    if(request==='../db/pool')return {connect:async()=>{throw originalError;}};
    if(request==='../db/audit')return async()=>{};
    if(request==='../middleware/auth')return {authenticate:pass,applyScope:(req,_res,next)=>{req.scope={isAdmin:true};next();},requirePermission:()=>pass,requireOccurrencesAccess:pass};
    return normalRequire(request);
  };
  loaded._compile(fs.readFileSync(filename,'utf8'),filename);
  const app=express();app.use(express.json());app.use('/api/dashboard',loaded.exports);
  let observedError;
  app.use((error,_req,res,_next)=>{observedError=error;res.status(500).json({error:error.message});});
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard/occurrences/management`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:key(1),branchId:key(2),version:0}),signal:AbortSignal.timeout(2000)});
    assert.equal(response.status,500);
    assert.equal(observedError,originalError);
    assert.deepEqual(await response.json(),{error:'Conexão indisponível'});
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
});
