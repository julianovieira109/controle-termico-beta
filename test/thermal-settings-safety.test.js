const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const vm=require('node:vm');
const ThermalSchedule=require('../public/js/thermal-schedule');
const ShiftSchedule=require('../public/js/shift-schedule');

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
  const router=settingsRouter({mode:'AUTOMATIC_AND_BLANK',scopeMode:'SELECTED',authorizedBranchIds:['b1'],restMinutes:5,maxRestMinutes:60,variationMinutes:30,cycleDays:31,restCount:4,fontSizePt:8.4});
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
  const req={user:{role:'ADMIN',isMasterAdmin:true},params:{key:'thermal-rest'},body:{value:{mode:'MANUAL',scopeMode:'SELECTED',authorizedCompanyIds:[' c1 ','c1'],authorizedBranchIds:['b1','b1',''],minWorkMinutes:60,workMinutes:120,restMinutes:60,maxRestMinutes:60,variationMinutes:15,cycleDays:31,restCount:4,fontSizePt:99}}};
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

function shiftPreview(description,engine=ThermalSchedule,sourceReader=ShiftSchedule){
  const source=fs.readFileSync(path.join(__dirname,'../public/js/settings-system.js'),'utf8');
  const start=source.indexOf('function renderThermalShiftList(');
  const end=source.indexOf('\nif($("thermal-rest-form"))',start);
  const body={innerHTML:''};
  const context={
    ThermalSchedule:engine,
    catalogs:{shifts:[{name:'Teste',description}]},
    $:id=>id==='thermal-shifts-list'?body:null,
    escapeHtml:value=>String(value??'')
  };
  if(sourceReader)context.ShiftSchedule=sourceReader;
  vm.runInNewContext(source.slice(start,end)+'\nrenderThermalShiftList({});',context);
  return body.innerHTML;
}

test('prévia de jornada longa preserva cinco pausas sem teto diário artificial',()=>{
  const preview=shiftPreview('08:00-12:00-13:00-20:00');
  assert.match(preview,/R5:/);
  assert.match(preview,/Prévia de planejamento/);
  assert.doesNotMatch(preview,/máximo 4|Revisar jornada|Jornada curta/);
});

test('prévia diferencia jornada curta de plano incompleto ou não calculável',()=>{
  const description='08:00-12:00-13:00-17:00';
  const incomplete={...ThermalSchedule,baseThermalRests:()=>[]};
  const failed=shiftPreview(description,incomplete);
  assert.match(failed,/Revisar jornada: não foi possível distribuir todos os repousos/);
  assert.doesNotMatch(failed,/Jornada curta|Prévia de planejamento/);
  const short=shiftPreview('08:00-09:00');
  assert.match(short,/Jornada curta: sem repouso calculado/);
  assert.doesNotMatch(short,/Revisar jornada|R\d+:/);
});

test('prévia informa revisão quando refeição curta não permite reiniciar a contagem',()=>{
  const preview=shiftPreview('08:00-10:00-10:05-12:00');
  assert.match(preview,/Revisar jornada/);
  assert.match(preview,/20/);
  assert.doesNotMatch(preview,/Jornada curta|Prévia de planejamento|R\d+:/);
  const short=shiftPreview('08:00-08:40-08:45-09:25');
  assert.match(short,/Jornada curta: sem repouso calculado/);
  assert.doesNotMatch(short,/Revisar jornada|R\d+:/);
});

test('prévia não interpreta horários PRE cuja descrição original exige preservação',()=>{
  const engine={
    ...ThermalSchedule,
    assessShiftPlanning(){throw new Error('A descrição abreviada não deve chegar ao cálculo térmico.');},
    baseThermalRests(){throw new Error('A descrição abreviada não deve gerar horários calculados.');}
  };
  for(const description of ['08:00-12PRE-13:PRE-17:00','08:0012PRE13:30PRE18:00 SEG A SEX']){
    const preview=shiftPreview(description,engine,ShiftSchedule);
    assert.ok(preview.includes(description));
    assert.match(preview,/Sem horário interpretado/);
    assert.match(preview,/Descrição Senior preservada/);
    assert.doesNotMatch(preview,/R\d+:|Prévia de planejamento/);
  }
});

test('prévia PRE com minutos completos continua usando o cálculo térmico',()=>{
  const preview=shiftPreview('08:00PRE12:00PRE13:30PRE17:00',ThermalSchedule,ShiftSchedule);
  assert.match(preview,/R1:/);
  assert.match(preview,/Prévia de planejamento/);
  assert.doesNotMatch(preview,/Sem horário interpretado|Descrição Senior preservada/);
});

test('prévia sem validador de turnos não chama o cálculo térmico nem interpreta PRE',()=>{
  const engine={
    ...ThermalSchedule,
    assessShiftPlanning(){throw new Error('Não deve calcular sem validar a descrição de origem.');},
    baseThermalRests(){throw new Error('Não deve gerar horários sem validar a descrição de origem.');}
  };
  for(const missingReader of [null,{}]){
    for(const description of ['08:00-12PRE-13:30-17:00','6PRE-10:00-11:00-15:00','08:00-12:00']){
      const preview=shiftPreview(description,engine,missingReader);
      assert.match(preview,/Revisar horário: validador indisponível\. Atualize a página/);
      assert.doesNotMatch(preview,/R\d+:|Prévia de planejamento/);
    }
  }
});
