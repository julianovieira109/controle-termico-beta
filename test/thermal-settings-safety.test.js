const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');

function settingsRouter(stored){
  let persisted=null;
  const queries=[];
  const client={
    async query(sql,params){
      queries.push(sql);
      if(sql.includes('INSERT INTO system_settings')){
        persisted=JSON.parse(params[3]);
        return {rows:[{id:'setting',setting_value:persisted}]};
      }
      return {rows:[]};
    },
    release(){}
  };
  const fakePool={
    async query(){return {rows:stored===undefined?[]:[{setting_value:stored}]};},
    async connect(){return client;}
  };
  const filename=path.join(__dirname,'../src/routes/settings.js');
  const mod=new Module(filename,module);
  mod.filename=filename;
  mod.paths=Module._nodeModulePaths(path.dirname(filename));
  mod.require=name=>name==='../db/pool'?fakePool:name==='../db/audit'?async()=>{}:name==='../middleware/auth'?{authenticate:(_req,_res,next)=>next()}:Module.prototype.require.call(mod,name);
  mod._compile(fs.readFileSync(filename,'utf8'),filename);
  return {
    handler(route,method){return mod.exports.stack.find(layer=>layer.route?.path===route&&layer.route.methods[method]).route.stack.at(-1).handle;},
    get persisted(){return persisted;},
    queries
  };
}

function response(){
  return {statusCode:200,value:null,status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;}};
}

const fixed={minWorkMinutes:100,workMinutes:100,restMinutes:20,maxRestMinutes:20,variationMinutes:0,cycleDays:1,restCount:0};
function assertFixed(value){for(const [key,expected] of Object.entries(fixed))assert.equal(value[key],expected,key);}

test('configuração térmica legada é lida pela mesma regra fixa da geração',async()=>{
  const router=settingsRouter({mode:'AUTOMATIC_AND_BLANK',scopeMode:'SELECTED',authorizedBranchIds:['b1'],restMinutes:5,maxRestMinutes:60,variationMinutes:30,cycleDays:31,restCount:3,fontSizePt:8.4});
  const res=response();
  await router.handler('/thermal-rest','get')({},res,error=>{throw error;});
  assertFixed(res.value);
  assert.equal(res.value.mode,'AUTOMATIC_AND_BLANK');
  assert.equal(res.value.scopeMode,'SELECTED');
  assert.deepEqual(res.value.authorizedBranchIds,['b1']);
  assert.equal(res.value.fontSizePt,8.4);
});

test('salvar parâmetros divergentes não muda 100/20 nem cria limite diário de pausas',async()=>{
  const router=settingsRouter();
  const req={user:{role:'ADMIN',isMasterAdmin:true},params:{key:'thermal-rest'},body:{value:{mode:'MANUAL',scopeMode:'SELECTED',authorizedCompanyIds:[' c1 ','c1'],authorizedBranchIds:['b1','b1',''],minWorkMinutes:60,workMinutes:120,restMinutes:60,maxRestMinutes:60,variationMinutes:15,cycleDays:31,restCount:1,fontSizePt:99}}};
  const res=response();
  await router.handler('/:key','put')(req,res,error=>{throw error;});
  assert.equal(res.value.saved,true);
  assertFixed(router.persisted);
  assert.deepEqual(res.value.value,router.persisted);
  assert.equal(router.persisted.mode,'MANUAL');
  assert.deepEqual(router.persisted.authorizedCompanyIds,['c1']);
  assert.deepEqual(router.persisted.authorizedBranchIds,['b1']);
  assert.equal(router.persisted.fontSizePt,10);
});

test('administrador sem Master continua impedido de salvar repouso térmico',async()=>{
  const router=settingsRouter(),res=response();
  await router.handler('/:key','put')({user:{role:'ADMIN',isMasterAdmin:false},params:{key:'thermal-rest'},body:{value:{mode:'MANUAL'}}},res,error=>{throw error;});
  assert.equal(res.statusCode,403);
  assert.equal(router.persisted,null);
  assert.equal(router.queries.length,0);
});
