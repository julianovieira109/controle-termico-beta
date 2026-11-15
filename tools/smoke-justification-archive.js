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
  const mp=(await pool.query("INSERT INTO user_profiles(name,base_role,master_admin) VALUES('Master QA Acervo','ADMIN',TRUE) RETURNING id")).rows[0].id;
  const rp=(await pool.query("INSERT INTO user_profiles(name,base_role) VALUES('Gestor QA Acervo','RH') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO profile_permissions(profile_id,permission_key,allowed) VALUES($1,'documents.view',TRUE),($1,'documents.manage',TRUE)",[rp]);
  const user=(await pool.query("INSERT INTO users(name,email,password_hash,role,profile_id) VALUES('Usuário QA Master','qa-master-acervo@exemplo.invalid','hash-teste','ADMIN',$1) RETURNING id",[mp])).rows[0].id;
  const managerUser=(await pool.query("INSERT INTO users(name,email,password_hash,role,profile_id,company_id,branch_id) VALUES('Gestor QA','qa-gestor-acervo@exemplo.invalid','hash-teste','RH',$1,$2,$3) RETURNING id",[rp,com,branch])).rows[0].id;
  await pool.query("INSERT INTO user_branches(user_id,branch_id) VALUES($1,$2)",[managerUser,branch]);
  const regularUser=(await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES('Usuário QA sem acesso','qa-sem-acesso@exemplo.invalid','hash-teste','ADMIN') RETURNING id")).rows[0].id;
  const master=jwt.sign({sub:user,role:"ADMIN",isMasterAdmin:true},secret,{expiresIn:"5m"});
  const manager=jwt.sign({sub:managerUser,role:"RH",companyId:com,branchIds:[branch]},secret,{expiresIn:"5m"});
  const regular=jwt.sign({sub:regularUser,role:"ADMIN",isMasterAdmin:false},secret,{expiresIn:"5m"});
  server=spawn(process.execPath,["src/server.js"],{cwd:process.cwd(),env:{...process.env,PORT,JUSTIFICATION_ARCHIVE_BETA:"true",NODE_ENV:"test"},stdio:["ignore","pipe","pipe"]});
  let stderr="";server.stderr.on("data",chunk=>stderr+=String(chunk).slice(0,1000));
  await readiness();
  const notMaster=await request("/api/justification-archive/units",{token:regular});
  assert.equal(notMaster.status,403,"Administrador não-Master não deve ter acesso.");
  const units=await request("/api/justification-archive/units",{token:master});
  assert.equal(units.status,200,JSON.stringify(units.data));
  assert.ok(units.data.branches.some(b=>b.id===branch));
  const badDate=await request("/api/justification-archive/cases",{method:"POST",token:manager,payload:{companyId:com,branchId:branch,employeeName:"Pessoa Fictícia",reason:"Teste",absenceDate:"data-invalida"}});
  assert.equal(badDate.status,400);
  const created=await request("/api/justification-archive/cases",{method:"POST",token:manager,payload:{companyId:com,branchId:branch,employeeName:"Pessoa Fictícia",registration:"QA-0001",department:"QA",reason:"Atestado de teste",absenceDate:"2026-11-13",details:"Teste automatizado sem dados pessoais reais"}});
  assert.equal(created.status,201,JSON.stringify(created.data));
  const caseId=created.data.id;
  const pdf=Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
  const form=new FormData();form.append("file",new Blob([pdf],{type:"application/pdf"}),"teste-ficticio.pdf");
  const uploaded=await request("/api/justification-archive/cases/"+caseId+"/files",{method:"POST",token:manager,form});
  assert.equal(uploaded.status,201,JSON.stringify(uploaded.data));
  const fileId=uploaded.data.id;
  assert.equal(uploaded.data.storageState,"ARMAZENADO");
  const downloaded=await request("/api/justification-archive/files/"+fileId+"/download",{token:manager});
  assert.equal(downloaded.status,200,"Download deve funcionar com login Master.");
  assert.deepEqual(downloaded.data,pdf,"Bytes armazenados não correspondem aos originais.");
  assert.match(downloaded.headers.get("cache-control")||"",/no-store/);
  const deniedDownload=await request("/api/justification-archive/files/"+fileId+"/download",{token:regular});
  assert.equal(deniedDownload.status,403);
  const formDuplicated=new FormData();formDuplicated.append("file",new Blob([pdf],{type:"application/pdf"}),"teste-ficticio.pdf");
  const duplicate=await request("/api/justification-archive/cases/"+caseId+"/files",{method:"POST",token:manager,form:formDuplicated});
  assert.equal(duplicate.status,409,"Mesmo arquivo não pode ser salvo duas vezes na mesma justificativa.");
  const badForm=new FormData();badForm.append("file",new Blob([pdf],{type:"image/png"}),"arquivo-falso.png");
  const bad=await request("/api/justification-archive/cases/"+caseId+"/files",{method:"POST",token:manager,form:badForm});
  assert.equal(bad.status,415,"Arquivos falsamente identificados devem ser recusados.");
  const access=await request("/api/justification-archive/scope",{token:manager});
  assert.equal(access.status,200);
  assert.equal(access.data.units.length,1);
  assert.equal(access.data.importEnabled,true);
  const masterScope=await request("/api/justification-archive/scope",{token:master});
  assert.equal(masterScope.status,200);
  assert.equal(masterScope.data.isMaster,true);
  const cases=await request("/api/justification-archive/cases?companyId="+com+"&branchId="+branch,{token:manager});
  assert.equal(cases.status,200);assert.equal(cases.data.total,1);assert.equal(cases.data.records[0].stored_count,1);
  const searched=await request("/api/justification-archive/cases?companyId="+com+"&branchId="+branch+"&q=Fict%C3%ADcia",{token:manager});
  assert.equal(searched.status,200,"Pesquisa por nome deve funcionar.");
  assert.equal(searched.data.total,1);
  const impossible=await request("/api/justification-archive/cases?companyId="+com+"&branchId="+branch+"&q=__inexistente__",{token:manager});
  assert.equal(impossible.status,200);
  assert.equal(impossible.data.total,0,"Curingas de pesquisa não devem furar o filtro.");
  // Busca por nome/matrícula somente na filial selecionada, sem CPF.
  const employee=(await pool.query(
    "INSERT INTO employees(company_id,branch_id,full_name,registration,job_title,status) VALUES($1,$2,'Funcionário Fictício QA','QA98765','Conferente QA','ATIVO') RETURNING id",[com,branch]
  )).rows[0].id;
  const otherBranch=(await pool.query("INSERT INTO branches(company_id,name) VALUES($1,'Outra Filial QA Busca') RETURNING id",[com])).rows[0].id;
  const externalEmployee=(await pool.query(
    "INSERT INTO employees(company_id,branch_id,full_name,registration,job_title,status) VALUES($1,$2,'Funcionário Externo QA','QA98766','Cargo Externo','ATIVO') RETURNING id",[com,otherBranch]
  )).rows[0].id;
  await pool.query(
    "INSERT INTO employees(company_id,branch_id,full_name,registration,job_title,status) VALUES($1,$2,'Funcionário Anterior QA','QA98760','Cargo Anterior','DEMITIDO')",[com,branch]
  );
  const unauthorizedSearch=await request("/api/justification-archive/employees?companyId="+com+"&branchId="+branch+"&q=QA",{token:regular});
  assert.equal(unauthorizedSearch.status,403,"Busca de documentos não pode ser pública.");
  const searchedEmployee=await request("/api/justification-archive/employees?companyId="+com+"&branchId="+branch+"&q=QA",{token:manager});
  assert.equal(searchedEmployee.status,200,JSON.stringify(searchedEmployee.data));
  assert.equal(searchedEmployee.data.employees.length,2,"Não pode incluir colaborador de outra filial.");
  assert.ok(searchedEmployee.data.employees.every(e=>!Object.hasOwn(e,"cpf")),"Consulta não deve revelar CPF.");
  assert.equal(searchedEmployee.data.employees[0].registration,"QA98765","Ativos devem vir antes de desligados.");
  assert.equal(searchedEmployee.data.employees[0].job_title,"Conferente QA");
  const byRegistration=await request("/api/justification-archive/employees?companyId="+com+"&branchId="+branch+"&q=98765",{token:manager});
  assert.equal(byRegistration.status,200);
  assert.equal(byRegistration.data.employees.length,1);
  assert.equal(byRegistration.data.employees[0].id,employee);
  const shortQuery=await request("/api/justification-archive/employees?companyId="+com+"&branchId="+branch+"&q=Q",{token:manager});
  assert.equal(shortQuery.status,200);
  assert.equal(shortQuery.data.employees.length,2,"Pesquisa de um caractere deve mostrar os colaboradores encontrados.");
  const unfiltered=await request("/api/justification-archive/employees?companyId="+com+"&branchId="+branch,{token:manager});
  assert.equal(unfiltered.status,200);
  assert.equal(unfiltered.data.employees.length,2,"A lista deve aparecer mesmo antes da digitação.");
  assert.equal(unfiltered.data.employees[0].registration,"QA98765","Colaboradores ativos aparecem primeiro.");
  const crossedSearch=await request("/api/justification-archive/employees?companyId="+com+"&branchId="+otherBranch+"&q=98765",{token:manager});
  assert.equal(crossedSearch.status,200);
  assert.equal(crossedSearch.data.employees.length,1,"Filtro malicioso não pode alterar o escopo do usuário.");
  assert.ok(crossedSearch.data.employees.every(e=>e.branch_id===branch),"Só colaboradores da filial autorizada.");
  const selectedCreated=await request("/api/justification-archive/cases",{method:"POST",token:manager,payload:{
    companyId:com,branchId:branch,employeeId:employee,
    employeeName:"Nome adulterado",registration:"MATRICULA-ERRADA",jobTitle:"Cargo falso",
    department:"Setor informado manualmente",reason:"Ocorrência de teste vinculada",absenceDate:"2026-11-14"
  }});
  assert.equal(selectedCreated.status,201,JSON.stringify(selectedCreated.data));
  const canonical=(await pool.query(
    "SELECT employee_id,employee_name,employee_registration,job_title,department FROM justification_cases WHERE id=$1",
    [selectedCreated.data.id]
  )).rows[0];
  assert.equal(canonical.employee_id,employee);
  assert.equal(canonical.employee_name,"Funcionário Fictício QA");
  assert.equal(canonical.employee_registration,"QA98765");
  assert.equal(canonical.job_title,"Conferente QA");
  assert.equal(canonical.department,"Setor informado manualmente");
  const otherBranchAttempt=await request("/api/justification-archive/cases",{method:"POST",token:manager,payload:{
    companyId:com,branchId:otherBranch,employeeId:externalEmployee,
    employeeName:"Nome adulterado",reason:"Tentativa de vínculo incorreto"
  }});
  assert.equal(otherBranchAttempt.status,404,"Não pode vincular colaborador de outra filial.");
  // Perfil de consulta vinculado exclusivamente à outra filial.
  const viewProfile=(await pool.query(
    "INSERT INTO user_profiles(name,base_role) VALUES('Consulta outra filial QA','RH') RETURNING id"
  )).rows[0].id;
  await pool.query("INSERT INTO profile_permissions(profile_id,permission_key,allowed) VALUES($1,'documents.view',TRUE)",[viewProfile]);
  const viewUser=(await pool.query(
    "INSERT INTO users(name,email,password_hash,role,profile_id,company_id,branch_id) VALUES('Consulta QA','qa-consulta@exemplo.invalid','hash-teste','RH',$1,$2,$3) RETURNING id",
    [viewProfile,com,otherBranch]
  )).rows[0].id;
  await pool.query("INSERT INTO user_branches(user_id,branch_id) VALUES($1,$2)",[viewUser,otherBranch]);
  const reader=jwt.sign({sub:viewUser,role:"RH"},secret,{expiresIn:"5m"});
  const viewScope=await request("/api/justification-archive/scope",{token:reader});
  assert.equal(viewScope.status,200);
  assert.equal(viewScope.data.units.length,1);
  assert.equal(viewScope.data.canManage,false);
  assert.equal(viewScope.data.units[0].branch_id,otherBranch);
  const masterCreated=await request("/api/justification-archive/cases",{
    token:master,method:"POST",payload:{employeeId:externalEmployee,
       employeeName:"Nome falso",reason:"Teste outra filial"}
  });
  assert.equal(masterCreated.status,201);
  const readerList=await request("/api/justification-archive/cases",{token:reader});
  assert.equal(readerList.status,200);
  assert.equal(readerList.data.total,1,"Consulta somente da filial atribuída.");
  const readerWrongCase=await request("/api/justification-archive/cases/"+caseId,{token:reader});
  assert.equal(readerWrongCase.status,404,"Não revelar caso de outra filial.");
  const readerWrongFile=await request("/api/justification-archive/files/"+fileId+"/download",{token:reader});
  assert.equal(readerWrongFile.status,404,"Não revelar anexo de outra filial.");
  const readerPatch=await request("/api/justification-archive/cases/"+masterCreated.data.id+"/status",{
    token:reader,method:"PATCH",payload:{status:"CONFERIDO"}
  });
  assert.equal(readerPatch.status,403,"Perfil de consulta não pode editar.");
  const managerWrongCase=await request("/api/justification-archive/cases/"+masterCreated.data.id,{token:manager});
  assert.equal(managerWrongCase.status,404,"Perfil gestor não pode abrir documentos de outra filial.");

  const content=(await pool.query("SELECT f.sha256,c.bytes FROM justification_files f JOIN justification_file_contents c ON c.file_id=f.id WHERE f.id=$1",[fileId])).rows[0];
  assert.equal(content.sha256,crypto.createHash("sha256").update(pdf).digest("hex"));
  assert.deepEqual(content.bytes,pdf);
  // Importação CSV fictícia, sem acessar a planilha real ou anexos privados.
  const csvRows=[
    ["Carimbo de data/hora","Juliano","Fu","Setor/Departamento","Data de Ausência","Declaro que o colaborador, esteve ausente na data acima mencionada, pelo motivo abaixo:","Outros Motivos - Detalhe o motivo/justificativa","Endereço de e-mail","Anexar atestado, advertência, suspensão e Outros","Email do Gestor Responsável","Endereço de e-mail"],
    ["13/11/2026 10:15:00","Pessoa Fictícia CSV","Cargo teste","Setor QA","12/11/2026","Atestado","","","https://drive.google.com/open?id=1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","","teste@example.invalid"],
    ["13/11/2026 11:15:00","","Outro cargo","Setor QA","13/11/2026","Falta","Sem nome na origem","","Texto informativo sem URL","",""],
    ["13/11/2026 12:00:00","Pessoa com Data Inválida","","Setor QA","31/02/2026","Outros","","","","",""]
  ];
  const legacyCsv=csvRows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(",")).join("\r\n");
  const importForm=()=>{const f=new FormData();f.append("companyId",com);f.append("branchId",branch);f.append("file",new Blob([legacyCsv],{type:"text/csv"}),"historico-ficticio.csv");return f;};
  const deniedPreview=await request("/api/justification-archive/imports/preview",{token:regular,method:"POST",form:importForm()});
  assert.equal(deniedPreview.status,403,"Somente Master pode importar.");
  const preview=await request("/api/justification-archive/imports/preview",{token:manager,method:"POST",form:importForm()});
  assert.equal(preview.status,200,"Prévia do CSV deve funcionar: "+JSON.stringify(preview.data));
  assert.equal(preview.data.summary.ready,2);
  assert.equal(preview.data.summary.missingNames,1);
  assert.equal(preview.data.summary.linkCount,1);
  assert.equal(preview.data.summary.invalid,1);
  assert.equal(preview.data.summary.newCases,2);
  const invalidConfirm=await request("/api/justification-archive/imports/confirm",{token:manager,method:"POST",payload:{previewToken:preview.data.previewToken,companyId:com,branchId:branch,confirmation:"NÃO"}});
  assert.equal(invalidConfirm.status,400);
  const validConfirm=await request("/api/justification-archive/imports/confirm",{token:manager,method:"POST",payload:{previewToken:preview.data.previewToken,companyId:com,branchId:branch,confirmation:"IMPORTAR HISTORICO"}});
  assert.equal(validConfirm.status,201,"Importação deve ser concluída: "+JSON.stringify(validConfirm.data));
  assert.equal(validConfirm.data.created,2);
  assert.equal(validConfirm.data.linksPending,1);
  assert.equal(validConfirm.data.skipped,1);
  const importStatus=await request("/api/justification-archive/imports/status?companyId="+com+"&branchId="+branch,{token:manager});
  assert.equal(importStatus.status,200);
  assert.equal(importStatus.data.cases,2);
  assert.equal(importStatus.data.attachments,1);
  assert.equal(importStatus.data.pending,1);
  assert.equal(importStatus.data.stored,0);
  assert.equal(importStatus.data.no_name,1);
  const wrongBranch=(await pool.query("INSERT INTO branches(company_id,name) VALUES($1,'Outra filial QA') RETURNING id",[com])).rows[0].id;
  const crossForm=new FormData();
  crossForm.append("companyId",com);
  crossForm.append("branchId",wrongBranch);
  crossForm.append("file",new Blob([legacyCsv],{type:"text/csv"}),"historico-ficticio.csv");
  const crossPreview=await request("/api/justification-archive/imports/preview",{token:manager,method:"POST",form:crossForm});
  assert.equal(crossPreview.status,200,"O servidor deve ignorar a filial informada pelo navegador.");
  assert.equal(crossPreview.data.summary.alreadyImported,2);

  const previewAgain=await request("/api/justification-archive/imports/preview",{token:manager,method:"POST",form:importForm()});
  assert.equal(previewAgain.status,200);
  assert.equal(previewAgain.data.summary.alreadyImported,2);
  assert.equal(previewAgain.data.summary.newCases,0);
  const repeated=await request("/api/justification-archive/imports/confirm",{token:manager,method:"POST",payload:{previewToken:previewAgain.data.previewToken,companyId:com,branchId:branch,confirmation:"IMPORTAR HISTORICO"}});
  assert.equal(repeated.status,201);
  assert.equal(repeated.data.created,0,"Reimportação não pode duplicar casos.");
  assert.equal(repeated.data.linksPending,0,"Reimportação não pode duplicar anexos.");
  const noBinary=(await pool.query("SELECT COUNT(*)::int total FROM justification_files WHERE source_drive_id IS NOT NULL AND storage_state='ARMAZENADO'")).rows[0].total;
  assert.equal(noBinary,0,"Link não comprova que os bytes foram armazenados.");
  const backup=await request("/api/system/backup",{token:master});
  assert.equal(backup.status,200,"Backup deve funcionar para Master.");
  const item=backup.data.data.justification_file_contents.find(x=>x.file_id===fileId);
  assert.ok(item,"Backup não incluiu o arquivo privado.");
  assert.deepEqual(Buffer.from(item.bytes,"base64"),pdf);
  const blockedBackup=await request("/api/system/backup",{token:regular});
  assert.equal(blockedBackup.status,403,"Backup de documento médico não pode ser liberado a Admin comum.");
  // Restauração ocorre APENAS no PostgreSQL descartável criado pelo GitHub Actions.
  // Exercita a recuperação integral dos bytes, sem atingir Render ou usuários reais.
  const formRestore=new FormData();
  formRestore.append("file",new Blob([JSON.stringify(backup.data.data)],{type:"application/json"}),"invalido.json");
  formRestore.append("confirmation","RESTAURAR BACKUP");
  formRestore.append("restoreToken",backup.headers.get("x-reset-token")||"");
  const invalidRestore=await request("/api/system/restore",{token:master,method:"POST",form:formRestore});
  assert.equal(invalidRestore.status,400,"Backup sem envelope/assinatura deve ser rejeitado.");
  // Reconstrói um backup assinado válido para testar a restauração.
  const signed=backup.data;
  const restore=new FormData();
  restore.append("file",new Blob([JSON.stringify(signed)],{type:"application/json"}),"backup-valido.json");
  restore.append("confirmation","RESTAURAR BACKUP");
  restore.append("restoreToken",backup.headers.get("x-reset-token")||"");
  const restored=await request("/api/system/restore",{token:master,method:"POST",form:restore});
  assert.equal(restored.status,200,"Restauração em banco descartável deve funcionar: "+JSON.stringify(restored.data));
  const recovered=(await pool.query("SELECT bytes FROM justification_file_contents WHERE file_id=$1",[fileId])).rows[0];
  assert.ok(recovered,"Restauração removeu o arquivo.");
  assert.deepEqual(recovered.bytes,pdf,"Restauração alterou os bytes do documento.");
  const restoredLegacy=(await pool.query("SELECT COUNT(*)::int total FROM justification_cases WHERE source_system='GOOGLE_SHEETS'")).rows[0].total;
  assert.equal(restoredLegacy,2,"Backup/restauração deve incluir o histórico importado.");
  console.log("SMOKE_ACERVO_OK: esquema, CSV, reimportação, cadastro, links pendentes, upload e backup/restauração.");
}
main().catch(error=>{console.error("SMOKE_ACERVO_FALHOU:",error);process.exitCode=1;}).finally(async()=>{
  if(server){server.kill("SIGTERM");await Promise.race([new Promise(resolve=>server.once("exit",resolve)),sleep(1200)]);}
  await pool.end().catch(()=>{});
});
