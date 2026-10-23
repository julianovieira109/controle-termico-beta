const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');

function harness(){
  const changes=[];
  const rows=[{id:'visual',setting_key:'visual',setting_value:{systemName:'Teste'}},{id:'team',setting_key:'occurrences-management',setting_value:{coordinators:[{id:'pj',name:'Responsável PJ',type:'PJ'}]}}];
  const connection={async query(sql){changes.push(sql);return {rows:[]};},release(){}};
  const filename=path.join(__dirname,'../src/routes/settings.js');
  const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  mod.require=name=>name==='../db/pool'?{async query(){return {rows};},async connect(){return connection;}}
    :name==='../db/audit'?async()=>{throw new Error('Configuração gerencial não deve ser gravada por esta rota');}
    :name==='../middleware/auth'?{authenticate:(_req,_res,next)=>next()}:Module.prototype.require.call(mod,name);
  mod._compile(fs.readFileSync(filename,'utf8'),filename);
  const handler=(route,method)=>mod.exports.stack.find(layer=>layer.route?.path===route&&layer.route.methods[method]).route.stack.at(-1).handle;
  return {handler,changes};
}
function response(){return {statusCode:200,value:null,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;}};}

for(const user of [{role:'COORDINATOR',permissions:{'dashboard.view':true}},{role:'ADMIN',isMasterAdmin:false,permissions:{}}]){
  test(`catálogo genérico não expõe coordenadores a ${user.role} sem autorização de Ocorrências`,async()=>{
    const {handler}=harness(),res=response();
    await handler('/','get')({user},res,error=>{throw error;});
    assert.equal(res.value.length,1);
    assert.equal(res.value[0].setting_key,'visual');
    assert.doesNotMatch(JSON.stringify(res.value),/Responsável PJ|coordinators/);
  });
}
for(const user of [{role:'ADMIN',isMasterAdmin:true},{role:'ADMIN',permissions:{'occurrences.view':true}}]){
  test(`leitura genérica preserva configuração gerencial para administrador autorizado (Master=${!!user.isMasterAdmin})`,async()=>{
    const {handler}=harness(),res=response();
    await handler('/','get')({user},res,error=>{throw error;});
    assert.equal(res.value.length,2);
    assert.equal(res.value.find(row=>row.setting_key==='occurrences-management').setting_value.coordinators[0].type,'PJ');
  });
}
test('nem Master pode contornar validação de equipes pelo salvamento genérico de configurações',async()=>{
  for(const key of ['occurrences-management','OCCURRENCES-MANAGEMENT']){
    const {handler,changes}=harness(),res=response();
    await handler('/:key','put')({user:{role:'ADMIN',isMasterAdmin:true},params:{key},body:{companyId:'outra-empresa',branchId:'outra-filial',value:{coordinators:[{id:'pj',name:'Inserção sem validação',type:'PJ'}]}}},res,error=>{throw error;});
    assert.equal(res.statusCode,400);
    assert.match(res.value.error,/Gerenciar Equipes/);
    assert.deepEqual(changes,[]);
  }
});
