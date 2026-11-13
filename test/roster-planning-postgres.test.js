const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const express=require('express');
const jwt=require('jsonwebtoken');
const {Pool}=require('pg');
const connectionString=process.env.ROSTER_TEST_DATABASE_URL;
if(!connectionString){test('PostgreSQL de planejamento: habilite ROSTER_TEST_DATABASE_URL em banco local descartável',{skip:true},()=>{});}else{
 const url=new URL(connectionString);
 if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw Error('Os testes de integração exigem banco local terminado em _test.');
 const schema='test_roster_'+randomUUID().replaceAll('-','');let db,adminDb,server,base,fixture,sequence=0;
 const secret='roster-postgres-test-only';
 before(async()=>{
  adminDb=new Pool({connectionString});await adminDb.query(`CREATE SCHEMA ${schema}`);
  execFileSync(process.execPath,['src/db/migrate.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,DATABASE_URL:connectionString,PGOPTIONS:`-c search_path=${schema},public`},stdio:'pipe'});
  db=new Pool({connectionString,options:`-c search_path=${schema},public`,max:8});
  const poolPath=require.resolve('../src/db/pool');require.cache[poolPath]={id:poolPath,filename:poolPath,loaded:true,exports:db};process.env.JWT_SECRET=secret;
  const app=express();app.set('trust proxy',1);app.use(express.json({limit:'10mb'}));app.use('/api/escalas-5x2',require('../src/routes/roster-planning'));app.use('/api/reports',require('../src/routes/reports'));app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message}));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
 });
 after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.end();if(adminDb){await adminDb.query(`DROP SCHEMA ${schema} CASCADE`);await adminDb.end();}});
 beforeEach(async()=>{
  await db.query('TRUNCATE roster_import_previews,roster_plans,audit_logs,employee_point_days,employees,branches,companies,users CASCADE');
  const c=randomUUID(),otherC=randomUUID(),a=randomUUID(),b=randomUUID(),foreign=randomUUID(),actor=randomUUID(),otherActor=randomUUID(),employee=randomUUID(),otherEmployee=randomUUID(),shift=randomUUID();
  await db.query("INSERT INTO companies(id,legal_name,trade_name) VALUES($1,'EMPRESA A','EMPRESA A'),($2,'EMPRESA B','EMPRESA B')",[c,otherC]);
  await db.query("INSERT INTO branches(id,company_id,name) VALUES($1,$2,'FILIAL A'),($3,$2,'FILIAL B'),($4,$5,'FILIAL C')",[a,c,b,foreign,otherC]);
  await db.query("INSERT INTO users(id,name,email,password_hash,role,company_id) VALUES($1,'Operador teste','a@test.local','test-only','RH',$2),($3,'Outro teste','b@test.local','test-only','RH',$2)",[actor,c,otherActor]);
  await db.query("INSERT INTO shifts(id,company_id,name,description,senior_code) VALUES($1,$2,'1º Turno','08:00-12:00-13:00-17:00','0046')",[shift,c]);
  await db.query("INSERT INTO employees(id,company_id,branch_id,registration,full_name,job_title,shift_id,admission_date) VALUES($1,$2,$3,'000011447','ALICE DE TESTE','OPERADOR',$4,'2026-01-01'),($5,$2,$6,'11447','PESSOA DA FILIAL B','OPERADOR',$4,'2026-01-01')",[employee,c,a,shift,otherEmployee,b]);
  await db.query("INSERT INTO employee_point_days(employee_id,company_id,branch_id,work_date,point_state,markings,bh_positive_minutes,bh_negative_minutes,bh_validated) VALUES($1,$2,$3,'2026-11-13','WORKED','[\"08:00\",\"12:00\",\"13:00\",\"17:00\"]',120,30,TRUE)",[employee,c,a]);
  await db.query("INSERT INTO employee_days_off(employee_id,off_date,description) VALUES($1,'2026-11-16','Folga oficial preservada')",[employee]);
  const user={sub:actor,name:'Operador teste',role:'RH',companyId:c,branchIds:[a],permissions:{'roster.view':true,'roster.manage':true,'reports.view':true}};
  fixture={c,a,b,foreign,otherC,actor,otherActor,employee,user};
 });
 async function request(method,route,body,user=fixture.user,scope={companyId:fixture.c,branchId:fixture.a}){
  const response=await fetch(base+'/api/escalas-5x2'+route+'?'+new URLSearchParams(scope),{method,headers:{'Content-Type':'application/json','X-Forwarded-For':`192.0.2.${++sequence%254+1}`,...(user?{Authorization:'Bearer '+jwt.sign(user,secret,{expiresIn:'1h'})}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};
 }
 async function snapshot(){let result='';for(const table of ['employees','employee_point_days','shifts','employee_days_off','holidays','employee_imports','senior_bh_imports'])result+=JSON.stringify((await db.query('SELECT * FROM '+table+' ORDER BY id')).rows);return result;}
 function backup(extra=[]){return {state:{employees:[{id:'11447',name:'ALICE DE TESTE',code:'0046',schedule:'06:00-10:00-11:00-15:00',shift:'1º',included:true,off1:'Dom',off2:'Seg',note:'Planejado',active:true,role:'CARGO ANTIGO',journeys:[{hours:40,option:1,start:'06:00',breakAfter:240,breakMinutes:60,effectiveDate:'2026-11-01'}]},...extra],overrides:[],history:[{at:'2026-11-01T12:00:00Z',action:'Histórico de origem'}],appliedImports:['origin']}};}
 test('GET não cria planos, não insere referências e respeita filial/permissão',async()=>{
  assert.equal((await request('GET','/state',null,null)).status,401);
  assert.equal((await request('GET','/state',null,{...fixture.user,permissions:{}})).status,403);
  assert.equal((await request('GET','/state',null,fixture.user,{companyId:fixture.c,branchId:fixture.b})).status,403);
  const result=await request('GET','/state');assert.equal(result.status,200);assert.equal(result.data.state.employees.length,1);assert.equal(result.data.state.employees[0].included,false);assert.equal(result.data.version,0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM roster_plans')).rows[0].n,0);assert.equal((await db.query('SELECT COUNT(*)::int n FROM audit_logs')).rows[0].n,0);
 });
 test('PUT grava somente planejamento e auditoria, mantendo cadastro/ponto/BH byte a byte',async()=>{
  const before=await snapshot(),current=(await request('GET','/state')).data;current.state.employees[0].included=true;current.state.employees[0].off1='Dom';current.state.employees[0].off2='Seg';
  const result=await request('PUT','/state',{...current,action:'Planejamento teste'});assert.equal(result.status,200);assert.equal(result.data.version,1);assert.equal(await snapshot(),before);
  const audit=(await db.query("SELECT * FROM audit_logs WHERE entity='roster_plans'")).rows;assert.equal(audit.length,1);assert.equal(audit[0].user_id,fixture.actor);assert.equal(audit[0].details.branchId,fixture.a);assert.equal(audit[0].details.changes.employees[0].before.included,false);assert.equal(audit[0].details.changes.employees[0].after.included,true);
 });
 test('versões concorrentes não sobrescrevem o primeiro salvamento',async()=>{
  const current=(await request('GET','/state')).data;
  const results=await Promise.all([request('PUT','/state',{...current,action:'Pedido 1'}),request('PUT','/state',{...current,action:'Pedido 2'})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await db.query('SELECT COUNT(*)::int n FROM roster_plans')).rows[0].n,1);
 });
 test('mudança oficial ou adulteração de cargo/situação bloqueia escrita',async()=>{
  const current=(await request('GET','/state')).data;const changed=structuredClone(current);changed.state.employees[0].role='CARGO INVENTADO';assert.equal((await request('PUT','/state',changed)).status,409);
  await db.query("UPDATE employees SET full_name='ALICE ATUALIZADA',updated_at=NOW() WHERE id=$1",[fixture.employee]);assert.equal((await request('PUT','/state',current)).status,409);assert.equal((await db.query('SELECT COUNT(*)::int n FROM roster_plans')).rows[0].n,0);
 });
 test('perfil somente leitura não pode salvar nem preparar importação',async()=>{
  const user={...fixture.user,permissions:{'roster.view':true}};const current=await request('GET','/state',null,user);assert.equal(current.status,200);assert.equal((await request('PUT','/state',current.data,user)).status,403);assert.equal((await request('POST','/import-preview',{backup:backup()},user)).status,403);
 });
 test('prévia é vinculada ao ator; migração confirmada preserva vínculos oficiais',async()=>{
  const before=await snapshot();const preview=await request('POST','/import-preview',{backup:backup()});assert.equal(preview.status,200);assert.equal(preview.data.summary.matched,1);assert.equal((await db.query('SELECT COUNT(*)::int n FROM roster_plans')).rows[0].n,0);
  const payload={previewId:preview.data.previewId,unitConfirmed:true};assert.equal((await request('POST','/import-confirm',payload,{...fixture.user,sub:fixture.otherActor})).status,409);
  const result=await request('POST','/import-confirm',payload);assert.equal(result.status,200);assert.equal(result.data.state.employees[0].role,'OPERADOR');assert.equal(result.data.state.employees[0].schedule,'08:00-12:00-13:00-17:00');assert.equal(result.data.state.employees[0].journeys[0].start,'06:00');assert.equal(await snapshot(),before);
  const archive=(await db.query('SELECT payload FROM roster_import_archives')).rows[0].payload;assert.equal(archive.backup.state.employees[0].schedule,'06:00-10:00-11:00-15:00');assert.equal(archive.backup.state.employees[0].role,'CARGO ANTIGO');
  assert.equal((await request('POST','/import-confirm',payload)).status,409);assert.equal((await request('POST','/import-preview',{backup:backup()})).status,409);
 });
 test('pendências exigem aceite parcial e permanecem preservadas sem criar pessoas',async()=>{
  const missing={...backup().state.employees[0],id:'999',name:'SEM VINCULO'};const preview=(await request('POST','/import-preview',{backup:backup([missing])})).data;assert.equal(preview.summary.pending,1);
  assert.equal((await request('POST','/import-confirm',{previewId:preview.previewId,unitConfirmed:true})).status,400);
  const result=await request('POST','/import-confirm',{previewId:preview.previewId,unitConfirmed:true,allowPartial:true});assert.equal(result.status,200);
  const saved=(await db.query('SELECT payload FROM roster_plans')).rows[0].payload;assert.equal(saved.pending[0].source.id,'999');assert.equal((await db.query('SELECT COUNT(*)::int n FROM employees')).rows[0].n,2);
 });
 test('falha de auditoria reverte plano e mantém a prévia disponível',async()=>{
  const preview=(await request('POST','/import-preview',{backup:backup()})).data;
  await db.query("CREATE FUNCTION reject_roster_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Teste de auditoria indisponivel'; END $$; CREATE TRIGGER reject_roster_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_roster_audit()");
  try{assert.equal((await request('POST','/import-confirm',{previewId:preview.previewId,unitConfirmed:true})).status,500);assert.equal((await db.query('SELECT COUNT(*)::int n FROM roster_plans')).rows[0].n,0);assert.equal((await db.query('SELECT COUNT(*)::int n FROM roster_import_previews')).rows[0].n,1);}
  finally{await db.query('DROP TRIGGER reject_roster_audit ON audit_logs; DROP FUNCTION reject_roster_audit()');}
 });
 test('escalas e consultas oficiais dos relatórios Senior permanecem idênticas após migração e alterações da 5x2',async()=>{
  const officialBefore=await snapshot();
  async function report(path){const response=await fetch(base+'/api/reports/'+path,{headers:{Authorization:'Bearer '+jwt.sign(fixture.user,secret,{expiresIn:'1h'})}});assert.equal(response.status,200);return response.json();}
  const employeesBefore=await report('employees'),pointBefore=await report('point-days?month=2026-11');
  const preview=(await request('POST','/import-preview',{backup:backup()})).data;
  assert.equal((await request('POST','/import-confirm',{previewId:preview.previewId,unitConfirmed:true})).status,200);
  const current=(await request('GET','/state')).data;
  current.state.employees[0].shift='3º';current.state.employees[0].journeys=[{hours:44,option:3,start:'22:00',breakAfter:120,breakMinutes:60,effectiveDate:'2026-11-14'}];
  current.state.overrides=[{id:'11447',date:'2026-11-14',status:'A',reason:'Ausência apenas planejada'}];
  assert.equal((await request('PUT','/state',{...current,action:'Mudança somente de planejamento'})).status,200);
  assert.equal(await snapshot(),officialBefore);assert.deepEqual(await report('employees'),employeesBefore);assert.deepEqual(await report('point-days?month=2026-11'),pointBefore);
 });
 test('pendências podem ser reconferidas após regularizar o cadastro Beta, sem reaplicar o backup inteiro',async()=>{
  const missing={...backup().state.employees[0],id:'999',name:'NOVO VINCULO'};
  const first=(await request('POST','/import-preview',{backup:backup([missing])})).data;
  assert.equal((await request('POST','/import-confirm',{previewId:first.previewId,unitConfirmed:true,allowPartial:true})).status,200);
  await db.query("INSERT INTO employees(company_id,branch_id,registration,full_name,job_title) VALUES($1,$2,'0000999','NOVO VINCULO','OPERADOR')",[fixture.c,fixture.a]);
  const second=await request('POST','/pending-preview',{});assert.equal(second.status,200);assert.equal(second.data.summary.matched,1);
  const result=await request('POST','/import-confirm',{previewId:second.data.previewId,unitConfirmed:true});assert.equal(result.status,200);assert.equal(result.data.state.employees.find(e=>e.id==='999').included,true);
  const saved=(await db.query('SELECT payload FROM roster_plans')).rows[0].payload;assert.equal(saved.pending.length,0);assert.equal((await db.query('SELECT COUNT(*)::int n FROM roster_import_archives')).rows[0].n,2);
 });
}
