// Requires DATABASE_URL pointing to a local PostgreSQL instance with CREATEDB rights.
// All restore mutations run in a newly generated temporary database; the configured database is never restored/reset.
const {createRequire}=require('module'),{spawn,spawnSync}=require('child_process'),assert=require('node:assert/strict');const rr=createRequire(require('node:path').resolve(__dirname,'../package.json')),{Pool}=rr('pg');
const admin=new Pool({connectionString:process.env.DATABASE_URL});const name='beta_audit_restore_'+Date.now();let db,server,created=false;
(async()=>{try{
const target=new URL(process.env.DATABASE_URL);const host=target.searchParams.get('host')||target.hostname;
assert.ok(host.startsWith('/')||['localhost','127.0.0.1','[::1]','::1'].includes(host),'Esta auditoria só pode usar PostgreSQL local.');
await admin.query(`CREATE DATABASE "${name}"`);created=true;const url=new URL(process.env.DATABASE_URL);url.pathname='/'+name;const env={...process.env,DATABASE_URL:url.toString(),PORT:'3002',ALLOW_SEED:'true',DEMO_DATA:'false',NODE_ENV:'development'};
for(const file of ['src/db/migrate.js','src/db/seed.js']){const r=spawnSync(process.execPath,[file],{cwd:require('node:path').resolve(__dirname,'..'),env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
db=new Pool({connectionString:env.DATABASE_URL});
server=spawn(process.execPath,['src/server.js'],{cwd:require('node:path').resolve(__dirname,'..'),env,stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Servidor de auditoria não iniciou.')),10000);server.stdout.on('data',chunk=>{if(chunk.toString().includes('online na porta 3002')){clearTimeout(timer);resolve();}});server.once('exit',()=>{clearTimeout(timer);reject(Error('Servidor de auditoria encerrou antes de iniciar; confira a porta 3002.'));});server.once('error',error=>{clearTimeout(timer);reject(error);});});
for(let i=0;i<40;i++){try{const r=await fetch('http://127.0.0.1:3002/api/health');if(r.ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
const login=await(await fetch('http://127.0.0.1:3002/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD})})).json();assert.ok(login.token);
const headers={Authorization:'Bearer '+login.token};
const company=(await db.query("INSERT INTO companies(legal_name,trade_name) VALUES('Teste','Teste') RETURNING id")).rows[0].id;
const branch=(await db.query("INSERT INTO branches(company_id,name) VALUES($1,'Teste') RETURNING id",[company])).rows[0].id;
const employee=(await db.query("INSERT INTO employees(company_id,branch_id,full_name,registration) VALUES($1,$2,'Teste Restore','123') RETURNING id",[company,branch])).rows[0].id;
const importId=(await db.query("INSERT INTO employee_imports(company_id,branch_id,import_type,file_name,details) VALUES($1,$2,'PONTO_SENIOR','Teste.pdf',$3) RETURNING id",[company,branch,JSON.stringify({periods:[{start:'2026-10-01',end:'2026-10-01'}]})])).rows[0].id;
await db.query(`INSERT INTO employee_point_days(employee_id,company_id,branch_id,import_id,work_date,point_state,markings,work_minutes,bh_positive_minutes,bh_validated) VALUES($1,$2,$3,$4,'2026-10-01','WORKED','["08:00","12:00","13:00","17:00"]',480,15,TRUE)`,[employee,company,branch,importId]);
await db.query("INSERT INTO timecard_review_controls(employee_id,company_id,branch_id,work_date,status,note,last_seen_import_id) VALUES($1,$2,$3,'2026-10-01','REVIEWED','Conferência preservada',$4)",[employee,company,branch,importId]);
await db.query("INSERT INTO senior_bh_imports(company_id,branch_id,report_type,period_start,period_end,file_name,file_hash,records,confirmed_at) VALUES($1,$2,'SYNTHETIC','2026-10-18','2026-10-18','BH.pdf','hash',$3,NOW())",[company,branch,JSON.stringify([{registration:'123',final:15,events:[]}])]);
const response=await fetch('http://127.0.0.1:3002/api/system/backup',{headers});assert.equal(response.status,200);const restoreToken=response.headers.get('X-Reset-Token'),backup=await response.json();
for(const table of ['employee_point_days','timecard_review_controls','senior_bh_imports'])assert.equal(backup.data[table].length,1);
await db.query('DELETE FROM employee_point_days');await db.query('DELETE FROM timecard_review_controls');await db.query('DELETE FROM senior_bh_imports');
const form=new FormData();form.append('confirmation','RESTAURAR BACKUP');form.append('restoreToken',restoreToken);form.append('file',new Blob([JSON.stringify(backup)],{type:'application/json'}),'backup.json');
const restored=await fetch('http://127.0.0.1:3002/api/system/restore',{method:'POST',headers,body:form});assert.equal(restored.status,200,JSON.stringify(await restored.json()));
const days=(await db.query('SELECT * FROM employee_point_days')).rows;assert.equal(days.length,1);assert.deepEqual(days[0].markings,['08:00','12:00','13:00','17:00']);assert.equal(days[0].work_minutes,480);assert.equal(days[0].import_id,importId);
assert.equal((await db.query('SELECT note FROM timecard_review_controls')).rows[0].note,'Conferência preservada');assert.equal((await db.query('SELECT records FROM senior_bh_imports')).rows[0].records[0].final,15);
const tests=await(await fetch('http://127.0.0.1:3002/api/system/tests',{headers})).json();assert.equal(tests.success,true);
console.log('Restauração em banco isolado: ponto, marcações JSON, valores, revisões, BH e referências preservados. Diagnóstico do sistema aprovado.');
}finally{if(server&&server.exitCode===null&&server.signalCode===null){const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await stopped;}if(db)await db.end();if(created)await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();}})().catch(e=>{console.error(e);process.exitCode=1});
