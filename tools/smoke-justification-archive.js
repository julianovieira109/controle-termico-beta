/* Smoke test isolado: usa apenas banco efemero do GitHub Actions e dados ficticios. */
"use strict";
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const crypto=require("node:crypto");
const pg=require("pg");
const jwt=require("jsonwebtoken");
const PORT="31777";
const ORIGIN="http://127.0.0.1:"+PORT;
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const secret=process.env.JWT_SECRET;
let server=null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(path,{token,method="GET",payload,form}={}){
  const headers=token?{Authorization:"Bearer "+token}:{};
  let body;
  if(form){body=form;}
  else if(payload!==undefined){headers["Content-Type"]="application/json";body=JSON.stringify(payload);}
  const response=await fetch(ORIGIN+path,{method,headers,body});
  const contentType=response.headers.get("content-type")||"";
  const data=contentType.includes("application/json")?await response.json():Buffer.from(await response.arrayBuffer());
  return {status:response.status,data,headers:response.headers};
}
async function readiness(){
  for(let i=0;i<60;i++){
    try{const response=await fetch(ORIGIN+"/api/health");if(response.status<500)return;}catch{}
    await sleep(250);
  }
  throw new Error("Servidor beta não iniciou.");
}
async function main(){
  assert.ok(secret&&process.env.DATABASE_URL,"Configure banco descartavel e JWT_SECRET.");
  const tables=(await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('justification_cases','justification_files','justification_file_contents')")).rows.map(row=>row.table_name);
  assert.equal(tables.length,3,"Migração não criou todas as tabelas.");
  const com=(await pool.query("INSERT INTO companies(legal_name,trade_name) VALUES('Ficticia Testes S.A.','Teste Acervo') RETURNING id")).rows[0].id;
  const branch=(await pool.query("INSERT INTO branches(company_id,name) VALUES($1,'Filial de Teste') RETURNING id",[com])).rows[0].id;
  const user=(await pool.query("INSERT INTO users(name,email,password_hash,role,company_id,branch_id) VALUES('Usuário QA','qa-acervo@exemplo.invalid','hash-teste','ADMIN',$1,$2) RETURNING id",[com,branch])).rows[0].id;
  const master=jwt.sign({sub:user,role:"ADMIN",isMasterAdmin:true,companyId:com,branchIds:[branch]},secret,{expiresIn:"5m"});
  const regular=jwt.sign({sub:user,role:"ADMIN",isMasterAdmin:false,companyId:com,branchIds:[branch]},secret,{expiresIn:"5m"});
  server=spawn(process.execPath,["src/server.js"],{cwd:process.cwd(),env:{...process.env,PORT,JUSTIFICATION_ARCHIVE_BETA:"true",NODE_ENV:"test"},stdio:["ignore","pipe","pipe"]});
  let stderr="";server.stderr.on("data",chunk=>stderr+=String(chunk).slice(0,1000));
  await readiness();
  const notMaster=await request("/api/justification-archive/units",{token:regular});
  assert.equal(notMaster.status,403,"Administrador não-Master não deve ter acesso.");
  const units=await request("/api/justification-archive/units",{token:master});
  assert.equal(units.status,200,JSON.stringify(units.data));
  assert.ok(units.data.branches.some(b=>b.id===branch));
  const badDate=await request("/api/justification-archive/cases",{method:"POST",token:master,payload:{companyId:com,branchId:branch,employeeName:"Pessoa Fictícia",reason:"Teste",absenceDate:"data-invalida"}});
  assert.equal(badDate.status,400);
  const created=await request("/api/justification-archive/cases",{method:"POST",token:master,payload:{companyId:com,branchId:branch,employeeName:"Pessoa Fictícia",registration:"QA-0001",department:"QA",reason:"Atestado de teste",absenceDate:"2026-11-13",details:"Teste automatizado sem dados pessoais reais"}});
  assert.equal(created.status,201,JSON.stringify(created.data));
  const caseId=created.data.id;
  const pdf=Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
  const form=new FormData();form.append("file",new Blob([pdf],{type:"application/pdf"}),"teste-ficticio.pdf");
  const uploaded=await request("/api/justification-archive/cases/"+caseId+"/files",{method:"POST",token:master,form});
  assert.equal(uploaded.status,201,JSON.stringify(uploaded.data));
  const fileId=uploaded.data.id;
  assert.equal(uploaded.data.storageState,"ARMAZENADO");
  const downloaded=await request("/api/justification-archive/files/"+fileId+"/download",{token:master});
  assert.equal(downloaded.status,200,"Download deve funcionar com login Master.");
  assert.deepEqual(downloaded.data,pdf,"Bytes armazenados não correspondem aos originais.");
  assert.match(downloaded.headers.get("cache-control")||"",/no-store/);
  const deniedDownload=await request("/api/justification-archive/files/"+fileId+"/download",{token:regular});
  assert.equal(deniedDownload.status,403);
  const formDuplicated=new FormData();formDuplicated.append("file",new Blob([pdf],{type:"application/pdf"}),"teste-ficticio.pdf");
  const duplicate=await request("/api/justification-archive/cases/"+caseId+"/files",{method:"POST",token:master,form:formDuplicated});
  assert.equal(duplicate.status,409,"Mesmo arquivo não pode ser salvo duas vezes na mesma justificativa.");
  const badForm=new FormData();badForm.append("file",new Blob([pdf],{type:"image/png"}),"arquivo-falso.png");
  const bad=await request("/api/justification-archive/cases/"+caseId+"/files",{method:"POST",token:master,form:badForm});
  assert.equal(bad.status,415,"Arquivos falsamente identificados devem ser recusados.");
  const cases=await request("/api/justification-archive/cases?companyId="+com+"&branchId="+branch,{token:master});
  assert.equal(cases.status,200);assert.equal(cases.data.total,1);assert.equal(cases.data.records[0].stored_count,1);
  const content=(await pool.query("SELECT f.sha256,c.bytes FROM justification_files f JOIN justification_file_contents c ON c.file_id=f.id WHERE f.id=$1",[fileId])).rows[0];
  assert.equal(content.sha256,crypto.createHash("sha256").update(pdf).digest("hex"));
  assert.deepEqual(content.bytes,pdf);
  const backup=await request("/api/system/backup",{token:master});
  assert.equal(backup.status,200,"Backup deve funcionar para Master.");
  const item=backup.data.data.justification_file_contents.find(x=>x.file_id===fileId);
  assert.ok(item,"Backup não incluiu o arquivo privado.");
  assert.deepEqual(Buffer.from(item.bytes,"base64"),pdf);
  const blockedBackup=await request("/api/system/backup",{token:regular});
  assert.equal(blockedBackup.status,403,"Backup de documento médico não pode ser liberado a Admin comum.");
  console.log("SMOKE_ACERVO_OK: esquema, cadastro, upload, download, permissão, deduplicação, hash e backup.");
}
main().catch(error=>{console.error("SMOKE_ACERVO_FALHOU:",error);process.exitCode=1;}).finally(async()=>{
  if(server){server.kill("SIGTERM");await Promise.race([new Promise(resolve=>server.once("exit",resolve)),sleep(1200)]);}
  await pool.end().catch(()=>{});
});
