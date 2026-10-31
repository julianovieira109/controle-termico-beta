const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {reconcileAdmittedPreview}=require('../src/importers/admitted-reconciliation');

const admitted={registration:'000011687',fullName:'IZACO LOPES GERONIMO GUAJAJARA',
  admissionDate:'2026-10-09',jobCode:'000086',jobTitle:'CARREGADOR',pointCard:'',branchCode:'0002',selected:true};
const employee={id:'stable-employee',company_id:'company',branch_id:'branch',
  registration:admitted.registration,full_name:admitted.fullName,admission_date:admitted.admissionDate,
  effective_job_title:admitted.jobTitle,point_card:'1234',status:'DEMITIDO',termination_date:'2026-10-28',
  shift_id:'stable-shift',current_shift:'3º Turno'};

function api(existing=employee,{previous=null}={}){
  const queries=[],audits=[];
  const client={release(){},async query(sql,values=[]){
    const query=sql.replace(/\s+/g,' ').trim();queries.push({query,values});
    if(/^(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT |RELEASE SAVEPOINT |ROLLBACK TO SAVEPOINT )/.test(query))return {rows:[]};
    if(query.startsWith('SELECT e.*'))return {rows:existing?[existing]:[]};
    if(query.startsWith('SELECT id FROM job_roles'))return {rows:[{id:'stable-role'}]};
    if(query.startsWith('UPDATE job_roles')||query.startsWith('UPDATE employees'))return {rows:[]};
    if(query.startsWith('SELECT id,registration,full_name,status,admission_date,termination_date'))return {rows:previous?[previous]:[]};
    if(query.startsWith('INSERT INTO employees'))return {rows:[{id:'new-employee'}]};
    if(query.startsWith('INSERT INTO employee_imports'))return {rows:[{id:'import-id',created_at:'2026-10-30T00:00:00Z'}]};
    throw new Error('Consulta inesperada: '+query);
  }};
  const filename=path.resolve(__dirname,'../src/routes/imports.js');
  const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  mod.require=function(name){
    if(name==='../db/pool')return {connect:async()=>client};
    if(name==='../db/audit')return async(_req,_action,_table,_id,details)=>audits.push(details);
    return Module.prototype.require.call(this,name);
  };
  mod._compile(fs.readFileSync(filename,'utf8')+`
    module.exports={router,detectEmployeeCorrections,setSource(rows){
      extractSeniorMovementPdfText=async()=>({text:'Relação de Admitidos FPRE004.COL',admittedRows:rows,readerUsed:'senior-admitted-columns'});
      validatePdfOperationalBranch=async()=>({ok:true});
    }};`,filename);
  async function call(route,body,extra={}){
    const handler=mod.exports.router.stack.find(layer=>layer.route?.path===route).route.stack.at(-1).handle;
    const output={status:200};
    const res={status(code){output.status=code;return this;},json(value){output.body=value;return this;}};
    await handler({body:{companyId:'company',branchId:'branch',previewCompanyId:'company',previewBranchId:'branch',
      type:'ADMITIDOS',fileName:'admissão.pdf',rows:[admitted],...body},scope:{isAdmin:true},user:{sub:'user'},...extra},res,error=>{output.error=error;output.status=error.status||500;});
    assert.equal(output.error,undefined);
    return output;
  }
  return {...mod.exports,queries,audits,call};
}

for(const status of ['ATIVO','DEMITIDO','AFASTADO','INATIVO']){
  test(`correção de Admitidos preserva situação ${status} e demissão, mesmo com tentativa no payload`,async()=>{
    const current={...employee,full_name:'0002 NOME DESLOCADO DO PDF',status};
    const h=api(current);
    const response=await h.call('/confirm',{rows:[{...admitted,status:'ATIVO',terminationDate:null,currentStatus:'ATIVO'}]});
    assert.equal(response.status,200);
    assert.equal(response.body.updated,1);
    assert.equal(response.body.failed,0);
    assert.deepEqual(response.body.results[0].corrections,['nome']);
    const updates=h.queries.filter(({query})=>query.startsWith('UPDATE employees'));
    assert.equal(updates.length,1);
    assert.doesNotMatch(updates[0].query,/\b(?:status|termination_date|registration|shift_id|weekly_days_off)\s*=/);
    assert.equal(updates[0].values[2],admitted.fullName);
    assert.equal(updates[0].values[7],employee.id);
    assert.equal(h.audits[0].action,'CADASTRAR_OU_CORRIGIR_PRESERVANDO_SITUACAO');
  });
}

test('prévia mantém situação e demissão reais, sem tratar inatividade como dado a corrigir',()=>{
  const h=api();
  const [row]=reconcileAdmittedPreview([admitted],[employee],(current,item)=>
    h.detectEmployeeCorrections(current,item,{preserveEmploymentState:true})
  );
  assert.equal(row.currentStatus,'DEMITIDO');
  assert.equal(row.currentTerminationDate,'2026-10-28');
  assert.equal(row.employeeId,employee.id);
  assert.equal(row.currentShiftId,employee.shift_id);
  assert.equal(row.result,'CONFERIDO');
  assert.deepEqual(row.corrections,[]);
});

test('reconferir demitido sem diferenças não relata reativação nem falsa atualização',async()=>{
  const h=api();
  const response=await h.call('/confirm',{});
  assert.equal(response.status,200);
  assert.equal(response.body.updated,0);
  assert.equal(response.body.unchanged,1);
  assert.equal(response.body.results[0].result,'CONFERIDO');
  assert.deepEqual(response.body.results[0].corrections,[]);
});

test('nova matrícula com mesmo nome cria vínculo ativo sem tocar no demitido anterior',async()=>{
  const h=api(null,{previous:employee});
  const response=await h.call('/confirm',{rows:[{...admitted,registration:'000011734'}]});
  assert.equal(response.status,200);
  assert.equal(response.body.created,1);
  assert.equal(response.body.readmissions,1);
  assert.equal(response.body.results[0].previousEmployeeId,employee.id);
  assert.equal(response.body.results[0].id,'new-employee');
  assert.equal(h.queries.filter(({query})=>query.startsWith('UPDATE employees')).length,0);
  const insertion=h.queries.find(({query})=>query.startsWith('INSERT INTO employees'));
  assert.match(insertion.query,/'ATIVO'/);
  assert.equal(insertion.values[3],'000011734');
});

test('Relação de Colaboradores conserva sua atualização explícita da situação',async()=>{
  const h=api();
  const response=await h.call('/confirm',{type:'COLABORADORES'});
  assert.equal(response.status,200);
  assert.equal(response.body.updated,1);
  const update=h.queries.find(({query})=>query.startsWith('UPDATE employees'));
  assert.match(update.query,/status='ATIVO',termination_date=NULL/);
  assert.deepEqual(response.body.results[0].corrections,['situação']);
});

test('regularizar cadastro pelo ponto também preserva situação e demissão existentes',async()=>{
  const h=api({...employee,full_name:'0002 NOME DESLOCADO DO PDF'});
  h.setSource([admitted]);
  const response=await h.call('/timecard-resolve-new-hires',{registrations:[admitted.registration]},
    {file:{buffer:Buffer.from('teste'),originalname:'admissão.pdf'}});
  assert.equal(response.status,200);
  assert.equal(response.body.updated,1);
  const update=h.queries.find(({query})=>query.startsWith('UPDATE employees'));
  assert.doesNotMatch(update.query,/\b(?:status|termination_date|registration|shift_id)\s*=/);
  assert.deepEqual(response.body.results[0].corrections,['nome']);
});

test('regularização de cadastro já conferido não escreve para reativá-lo',async()=>{
  const h=api();
  h.setSource([admitted]);
  const response=await h.call('/timecard-resolve-new-hires',{registrations:[admitted.registration]},
    {file:{buffer:Buffer.from('teste'),originalname:'admissão.pdf'}});
  assert.equal(response.status,200);
  assert.equal(response.body.updated,0);
  assert.equal(response.body.alreadyLinked,1);
  assert.equal(h.queries.filter(({query})=>query.startsWith('UPDATE employees')).length,0);
});
