const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');

function loadImportApi(existing=[],options={}){
  const queries=[],created=[],updates=[],histories=[];
  const shifts=new Map(existing.map(shift=>[shift.code,{id:shift.id||`shift-${shift.code}`,name:shift.name||`Turno ${shift.code}`,weekly_days_off:[]} ]));
  const client={
    release(){},
    async query(sql,values=[]){
      const query=sql.replace(/\s+/g,' ').trim();queries.push({query,values});
      if(/^(?:BEGIN|COMMIT|ROLLBACK)$/.test(query))return {rows:[]};
      if(query.startsWith('SELECT c.id FROM companies'))return {rows:options.branchMatches===false?[]:[{id:values[0]}]};
      if(query.startsWith('SELECT id,name')&&query.includes('FROM shifts'))return {rows:shifts.has(values[1])?[shifts.get(values[1])]:[]};
      if(query.startsWith('INSERT INTO shifts')){
        const record={companyId:values[0],name:values[1],description:values[2],code:values[3],id:`created-${values[3]}`,weekly_days_off:values[4]};
        created.push(record);shifts.set(record.code,record);return {rows:[record]};
      }
      if(query.startsWith('UPDATE employees')){
        updates.push(values);
        return {rows:values[1]==='employee-other-branch'?[]:[{id:values[1]}]};
      }
      if(query.startsWith('INSERT INTO employee_imports')){histories.push(JSON.parse(values[7]));return {rows:[]};}
      throw new Error(`Unexpected query: ${query}`);
    }
  };
  const filename=path.resolve('src/routes/imports.js');
  const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  mod.require=function(name){
    if(name==='../db/pool')return {connect:async()=>{if(options.connectError)throw new Error('Banco indisponível');return client;}};
    if(name==='../db/audit')return async()=>{};
    return Module.prototype.require.call(this,name);
  };
  mod._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports={router,extractSeniorSchedule,buildUnknownShiftProposals,parseSeniorShiftRows};',filename);
  const api=mod.exports;
  const confirm=api.router.stack.find(layer=>layer.route?.path==='/shift-confirm').route.stack.at(-1).handle;
  async function call(body,scope={isAdmin:true}){
    const output={status:200};
    const res={status(status){output.status=status;return this;},json(value){output.body=value;return this;}};
    await confirm({body:{companyId:'company-a',branchId:'branch-a',fileName:'turnos.pdf',rows:[{employeeId:'employee-a',registration:'1',shiftCode:'9',selected:true,result:'ATUALIZAR'}],...body},scope,user:{sub:'admin'}},res,error=>{output.error=error;output.status=error.status||500;});
    return output;
  }
  return {...api,call,queries,created,updates,histories};
}

test('propostas do FPRE011 aceitam aprendizes de dois horários e preservam PRE para revisão',()=>{
  const api=loadImportApi();
  const source=`Empregados por Escala\n000010462 TESTE APRENDIZ 0009 - 14:00 - 18:00 APRENDIZsgAsx-E\n000009444 TESTE MANHA 0005 - 08:00-12:00 - APRENDIZsgAsx\n000006532 TESTE PRE 0001 - 08:00-12PRE-13:PRE-17:00sgAs\n000002416 TESTE COMERCIAL 0007 - 08:0012PRE13:30PRE18:00sgAsb-E`;
  const rows=api.parseSeniorShiftRows(source,['9','5','1','7']);
  assert.equal(rows.length,4);
  const proposals=new Map(api.buildUnknownShiftProposals(rows,['9','5','1','7']).map(proposal=>[proposal.code,proposal]));
  for(const code of ['9','5']){
    assert.equal(proposals.get(code).canCreate,true);
    assert.equal(proposals.get(code).type,'CONTINUOUS');
    assert.equal(proposals.get(code).hasMealBreak,false);
    assert.ok(proposals.get(code).rawDescription);
  }
  for(const code of ['1','7']){
    assert.equal(proposals.get(code).canCreate,true);
    assert.equal(proposals.get(code).requiresReview,true);
    assert.equal(proposals.get(code).type,'SOURCE_ONLY');
    assert.equal(proposals.get(code).hasMealBreak,null);
    assert.equal(proposals.get(code).scheduleNeedsReview,true);
    assert.equal(proposals.get(code).preserveSource,true);
    assert.equal(proposals.get(code).description,proposals.get(code).rawDescription);
    assert.equal(proposals.get(code).normalizedDescription,null);
    assert.match(proposals.get(code).rawDescription,/PRE/);
    assert.match(proposals.get(code).reason,/exatamente como veio/);
  }
});

test('código com horários divergentes exige revisão mesmo quando um horário é mais frequente',()=>{
  const api=loadImportApi();
  const rows=['08:00-12:00','08:00-12:00','14:00-18:00'].map(description=>({shiftCode:'9',schedule:api.extractSeniorSchedule(description)}));
  const proposal=api.buildUnknownShiftProposals(rows,['9'])[0];
  assert.equal(proposal.canCreate,false);
  assert.match(proposal.reason,/horários diferentes/);
  assert.equal(proposal.sourceDescriptions.length,2);
});

test('última escala da página não incorpora a hora de emissão do rodapé FPRE011',()=>{
  const api=loadImportApi();
  const source=`Empregados por Escala\n000000001 TESTE PAGINA UM 0046 - 06:00-11:00-12:00-14:20sgAsb-E\nFPRE011.COL - 29/10/2026 - 23:01:25 EMPRESA TESTE Usuário: TESTE\n\f0001 EMPRESA TESTE Pág.: 2\nEmpregados por Escala\n000000002 TESTE PAGINA DOIS 0009 - 14:00-18:00 APRENDIZsgAsx-E\nFPRE011.COL - 29/10/2026 - 23:01:25 EMPRESA TESTE`;
  const rows=api.parseSeniorShiftRows(source,['46','9']);
  assert.equal(rows.length,2);
  assert.deepEqual(rows[0].schedule.times,['06:00','11:00','12:00','14:20']);
  assert.equal(rows[0].schedule.complete,true);
  assert.equal(rows[0].schedule.rawDescription,'06:00-11:00-12:00-14:20sgAsb-E');
  assert.deepEqual(rows[1].schedule.times,['14:00','18:00']);
  for(const row of rows){assert.doesNotMatch(row.rawLine,/FPRE011|23:01|Usuário/);assert.doesNotMatch(row.schedule.rawDescription,/FPRE011|23:01|Usuário/);}
});

test('isolamento do rodapé mantém um quinto horário verdadeiro para revisão',()=>{
  const api=loadImportApi();
  const source=`Empregados por Escala\n000000001 TESTE CINCO HORARIOS 0046 - 06:00-11:00-12:00-14:20-16:00sgAsb-E\nFPRE011.COL - 29/10/2026 - 23:01:25 EMPRESA TESTE`;
  const row=api.parseSeniorShiftRows(source,['46'])[0];
  assert.deepEqual(row.schedule.times,['06:00','11:00','12:00','14:20','16:00']);
  assert.equal(row.schedule.complete,false);
  assert.equal(api.buildUnknownShiftProposals([row],['46'])[0].canCreate,false);
});

test('confirmar turno de dois horários grava somente a jornada informada e mantém o escopo',async()=>{
  const api=loadImportApi();
  const result=await api.call({newShifts:[{code:'0009',name:'Aprendiz tarde',description:'14:00 - 18:00 APRENDIZsgAsx-E',rawDescription:'14:00 - 18:00 APRENDIZsgAsx-E',selected:true}]});
  assert.equal(result.status,200);
  assert.equal(result.body.createdShifts,1);
  assert.equal(result.body.updated,1);
  assert.equal(api.created[0].description,'14:00 - 18:00 APRENDIZsgAsx-E');
  assert.equal(api.created[0].companyId,'company-a');
  assert.equal(api.created[0].code,'9');
  assert.deepEqual(api.updates[0].slice(1,4),['employee-a','company-a','branch-a']);
  assert.equal(api.histories[0].approvedNewShifts[0].rawDescription,'14:00 - 18:00 APRENDIZsgAsx-E');
  assert.equal(api.histories[0].approvedNewShifts[0].type,'CONTINUOUS');
  assert.equal(api.histories[0].approvedNewShifts[0].normalizedDescription,'14:00 às 18:00');
});

test('cadastro preserva os códigos 0001, 0005 e 0009 como descritos no relatório sem completar horários PRE',async()=>{
  const api=loadImportApi();
  const source='08:00-12PRE-13:PRE-17:00sgAs';
  const result=await api.call({newShifts:[
    {code:'0001',name:'Turno 0001',description:source,rawDescription:source,preserveSource:true,selected:true},
    {code:'0005',name:'Aprendiz manhã',description:'08:00-12:00 - APRENDIZsgAsx',selected:true},
    {code:'0009',name:'Aprendiz tarde',description:'14:00 - 18:00 APRENDIZsgAsx-E',selected:true}
  ],rows:[{employeeId:'employee-a',registration:'1',shiftCode:'1',selected:true,result:'ATUALIZAR'},{employeeId:'employee-b',registration:'2',shiftCode:'5',selected:true,result:'ATUALIZAR'},{employeeId:'employee-c',registration:'3',shiftCode:'9',selected:true,result:'ATUALIZAR'}]});
  assert.equal(result.status,200);
  assert.equal(result.body.createdShifts,3);
  assert.equal(result.body.updated,3);
  assert.equal(api.created[0].description,source);
  assert.doesNotMatch(api.created[0].description,/12:00|13:00/);
  const sourceOnly=api.histories[0].approvedNewShifts[0];
  assert.equal(sourceOnly.type,'SOURCE_ONLY');
  assert.equal(sourceOnly.scheduleNeedsReview,true);
  assert.equal(sourceOnly.hasMealBreak,null);
  assert.equal(sourceOnly.normalizedDescription,null);
  assert.equal(sourceOnly.schedule,null);
});

test('preservação SOURCE_ONLY exige texto original igual e aprovação explícita',async()=>{
  const source='08:0012PRE13:30PRE18:00sgAsb-E';
  const api=loadImportApi();
  assert.equal((await api.call({newShifts:[{code:'7',name:'Comercial',description:source,rawDescription:source,preserveSource:true,selected:true}]})).status,200);
  assert.equal(api.created[0].description,source);
  for(const proposal of [
    {code:'7',name:'Comercial',description:source,rawDescription:source,selected:true},
    {code:'7',name:'Comercial',description:source,rawDescription:'outra descrição',preserveSource:true,selected:true},
    {code:'7',name:'Comercial',description:'08:00-12PRE-13:PRE-25:00',rawDescription:'08:00-12PRE-13:PRE-25:00',preserveSource:true,selected:true}
  ]){
    const blocked=loadImportApi();
    assert.equal((await blocked.call({newShifts:[proposal]})).status,400);
    assert.equal(blocked.created.length,0);
  }
});

test('proposta não selecionada ou sem aprovação explícita não é cadastrada nem bloqueia outras',async()=>{
  const api=loadImportApi();
  const result=await api.call({newShifts:[{code:'1',name:'Incompleto',description:'08:00-12PRE-13:PRE-17:00',selected:false},{code:'5',name:'Sem aprovação',description:'08:00-12:00'},{code:'9',name:'Aprendiz',description:'14:00-18:00',selected:true}]});
  assert.equal(result.status,200);
  assert.deepEqual(api.created.map(shift=>shift.code),['9']);
});

test('Admin pode cadastrar somente a identidade do turno sem criar nem atualizar colaborador',async()=>{
  const api=loadImportApi();
  const source='08:00-12PRE-13:PRE-17:00sgAs';
  const result=await api.call({rows:[],newShifts:[{code:'1',name:'Turno 0001',description:source,rawDescription:source,preserveSource:true,selected:true}]});
  assert.equal(result.status,200);
  assert.equal(result.body.createdShifts,1);
  assert.equal(result.body.updated,0);
  assert.equal(result.body.notFound,0);
  assert.equal(api.created[0].description,source);
  assert.equal(api.updates.length,0);
  assert.ok(!api.queries.some(({query})=>query.startsWith('INSERT INTO employees')));
  assert.equal(api.histories[0].approvedNewShifts[0].scheduleNeedsReview,true);
});

test('confirmação sem colaboradores não dispensa seleção explícita e permissão Admin',async()=>{
  for(const newShifts of [[],[{code:'9',name:'Aprendiz',description:'14:00-18:00',selected:false}],[{code:'9',name:'Aprendiz',description:'14:00-18:00'}]]){
    const api=loadImportApi();
    assert.equal((await api.call({rows:[],newShifts})).status,400);
    assert.equal(api.created.length,0);
  }
  const api=loadImportApi();
  const result=await api.call({rows:[],newShifts:[{code:'9',name:'Aprendiz',description:'14:00-18:00',selected:true}]},{isAdmin:false,companyId:'company-a',branchIds:['branch-a']});
  assert.equal(result.status,403);
  assert.equal(api.created.length,0);
});

test('confirmar horário inválido ou PRE incompleto bloqueia antes de qualquer criação',async()=>{
  for(const description of ['08:00-12PRE-13:PRE-17:00','08:0012PRE13:30PRE18:00','08:00-08:00','08:00-10:00-11:00-13:00-14:00-17:00']){
    const api=loadImportApi();
    const result=await api.call({newShifts:[{code:'9',name:'Turno teste',description,selected:true}]});
    assert.equal(result.status,400,description);
    assert.equal(api.created.length,0);
    assert.ok(!api.queries.some(({query})=>query==='BEGIN'));
  }
});

test('criação de turno continua exclusiva do Admin e os demais continuam limitados à filial',async()=>{
  const api=loadImportApi();
  const nonAdmin={isAdmin:false,companyId:'company-a',branchIds:['branch-a']};
  const result=await api.call({newShifts:[{code:'9',name:'Aprendiz',description:'14:00-18:00',selected:true}]},nonAdmin);
  assert.equal(result.status,403);
  assert.equal(api.created.length,0);
  const outOfScope=await api.call({branchId:'branch-other',newShifts:[]},nonAdmin);
  assert.equal(outOfScope.status,403);
  assert.equal(api.updates.length,0);
});

test('código existente e propostas duplicadas não criam novos turnos repetidos',async()=>{
  const existing=loadImportApi([{code:'9'}]);
  assert.equal((await existing.call({newShifts:[{code:'0009',name:'Aprendiz',description:'14:00-18:00',selected:true}]})).status,200);
  assert.equal(existing.created.length,0);
  const api=loadImportApi();
  const result=await api.call({newShifts:[{code:'9',name:'Aprendiz',description:'14:00-18:00',selected:true},{code:'0009',name:'Aprendiz',description:'14:00 às 18:00',selected:true}]});
  assert.equal(result.status,200);
  assert.equal(api.created.length,1);
});

test('propostas duplicadas conflitantes e código inválido não são aceitos por manipulação do payload',async()=>{
  for(const newShifts of [[{code:'9',name:'Aprendiz',description:'14:00-18:00',selected:true},{code:'0009',name:'Aprendiz',description:'08:00-12:00',selected:true}],[{code:'9abc',name:'Aprendiz',description:'14:00-18:00',selected:true}]]){
    const api=loadImportApi();
    const result=await api.call({newShifts});
    assert.equal(result.status,400);
    assert.equal(api.created.length,0);
  }
});

test('atualização conserva a condição de empresa e filial no colaborador',async()=>{
  const api=loadImportApi([{code:'9'}]);
  const result=await api.call({rows:[{employeeId:'employee-other-branch',registration:'2',shiftCode:'9',selected:true,result:'ATUALIZAR'}]});
  assert.equal(result.status,200);
  assert.equal(result.body.updated,0);
  assert.equal(result.body.notFound,1);
  assert.deepEqual(api.updates[0].slice(1,4),['employee-other-branch','company-a','branch-a']);
});

test('a confirmação valida filial e empresa e trava criação antes de verificar código existente',async()=>{
  const api=loadImportApi();
  assert.equal((await api.call({newShifts:[{code:'9',name:'Aprendiz',description:'14:00-18:00',selected:true}]})).status,200);
  const unitIndex=api.queries.findIndex(({query})=>query.startsWith('SELECT c.id FROM companies'));
  const shiftIndex=api.queries.findIndex(({query})=>query.startsWith('SELECT id,name'));
  assert.ok(unitIndex>0&&unitIndex<shiftIndex);
  assert.match(api.queries[unitIndex].query,/FOR UPDATE OF c/);
  assert.deepEqual(api.queries[unitIndex].values,['company-a','branch-a']);
  const wrongBranch=loadImportApi([],{branchMatches:false});
  const result=await wrongBranch.call({newShifts:[{code:'9',name:'Aprendiz',description:'14:00-18:00',selected:true}]});
  assert.equal(result.status,400);
  assert.match(result.error.message,/filial não pertence/);
  assert.equal(wrongBranch.created.length,0);
  assert.equal(wrongBranch.updates.length,0);
  assert.ok(wrongBranch.queries.some(({query})=>query==='ROLLBACK'));
});

test('falha ao obter conexão é encaminhada ao tratamento de erro sem promessa rejeitada solta',async()=>{
  const api=loadImportApi([],{connectError:true});
  const result=await api.call({newShifts:[]});
  assert.equal(result.status,500);
  assert.match(result.error.message,/Banco indisponível/);
  assert.equal(api.created.length,0);
  assert.equal(api.queries.length,0);
});
