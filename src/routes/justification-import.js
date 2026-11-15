"use strict";
const express=require("express");
const multer=require("multer");
const crypto=require("node:crypto");
const pool=require("../db/pool");
const audit=require("../db/audit");
const {authenticate,requireMasterAdmin}=require("../middleware/auth");
const {parseLegacyCsv,ORIGIN}=require("../lib/justification-csv");

const router=express.Router();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const previews=new Map(),PREVIEW_TTL=15*60*1000;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function validUnit(companyId,branchId){
  if(!uuid.test(String(companyId||""))||!uuid.test(String(branchId||"")))throw fail("Empresa ou filial inválida.");
}
async function assertUnit(db,companyId,branchId){
  validUnit(companyId,branchId);
  const x=await db.query("SELECT id FROM branches WHERE company_id=$1 AND id=$2 AND active=TRUE",[companyId,branchId]);
  if(!x.rows.length)throw fail("Filial não pertence à empresa informada.",404);
}
const upload=multer({storage:multer.memoryStorage(),limits:{files:1,fileSize:5*1024*1024},fileFilter:(_req,file,cb)=>{
  if(!/\.(csv)$/i.test(file.originalname))return cb(fail("Escolha o CSV exportado da aba Respostas ao formulário 1."));
  cb(null,true);
}}).single("file");
function csvUpload(req,res,next){
  upload(req,res,error=>{
    if(error?.code==="LIMIT_FILE_SIZE")return res.status(413).json({error:"CSV excede o limite de 5 MB."});
    if(error)return next(error);
    next();
  });
}
router.use(authenticate,requireMasterAdmin);
router.use((req,res,next)=>{
  res.set("Cache-Control","private, no-store");
  if(process.env.JUSTIFICATION_ARCHIVE_BETA!=="true")return res.status(503).json({error:"O acervo está desativado no ambiente."});
  next();
});
router.post("/preview",csvUpload,async(req,res,next)=>{
  try{
    const companyId=String(req.body?.companyId||""),branchId=String(req.body?.branchId||"");
    await assertUnit(pool,companyId,branchId);
    if(!req.file?.buffer?.length)throw fail("Selecione o CSV de respostas.");
    const csv=req.file.buffer.toString("utf8");
    if(csv.includes("\uFFFD"))throw fail("O CSV não está codificado em UTF-8. Exporte diretamente do Google Sheets.");
    const parsed=parseLegacyCsv(csv);
    const {rows}=await pool.query(
      "SELECT source_key FROM justification_cases WHERE company_id=$1 AND branch_id=$2 AND source_system='GOOGLE_SHEETS' AND source_key LIKE $3",
      [companyId,branchId,ORIGIN+"%"]
    );
    const existing=new Set(rows.map(x=>x.source_key));
    const duplicates=parsed.cases.filter(x=>existing.has(x.sourceKey)).length;
    const userId=req.user.sub;
    for(const [key,value] of previews)if(value.expiresAt<=Date.now())previews.delete(key);
    const token=crypto.randomBytes(24).toString("hex");
    previews.set(userId,{token,expiresAt:Date.now()+PREVIEW_TTL,companyId,branchId,data:parsed});
    res.json({
      previewToken:token,expiresInMinutes:15,
      summary:{...parsed.summary,alreadyImported:duplicates,newCases:parsed.cases.length-duplicates},
      issues:parsed.issues.slice(0,35),
      warning:"A leitura é uma prévia. Os documentos serão cadastrados como links pendentes; os arquivos ainda não serão armazenados."
    });
  }catch(error){next(error);}
});
router.post("/confirm",express.json({limit:"8kb"}),async(req,res,next)=>{
  let client;let finished=false;
  try{
    const {previewToken,companyId,branchId,confirmation}=req.body||{};
    if(confirmation!=="IMPORTAR HISTORICO")throw fail("Confirme a importação antes de continuar.");
    const userId=req.user.sub,entry=previews.get(userId);
    if(!entry||entry.expiresAt<=Date.now()||entry.token!==previewToken)
      throw fail("Prévia expirada ou inválida. Leia o CSV novamente.",409);
    if(companyId!==entry.companyId||branchId!==entry.branchId)throw fail("A empresa ou filial foi alterada. Leia o CSV novamente.",409);
    client=await pool.connect();await client.query("BEGIN");
    await assertUnit(client,companyId,branchId);
    // Evita importações concorrentes para a mesma filial.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",[companyId,branchId]);
    let created=0,duplicates=0,linked=0;
    for(let i=0;i<entry.data.cases.length;i+=100){
      const chunk=entry.data.cases.slice(i,i+100);
      const params=[];
      const values=chunk.map((c,j)=>{
        const offset=j*12;
        params.push(companyId,branchId,c.employeeName,c.jobTitle,c.department,c.absenceDate,c.reason,c.details,c.managerEmail,c.submittedByEmail,c.sourceKey,JSON.stringify(c.sourceSnapshot));
        return "("+Array.from({length:12},(_,k)=>"$"+(offset+k+1)).join(",")+")";
      });
      const inserted=await client.query(
        "INSERT INTO justification_cases(company_id,branch_id,employee_name,job_title,department,absence_date,reason,details,manager_email,submitted_by_email,source_key,source_snapshot,source_system,review_status,created_by) "+
        "SELECT input.company_id,input.branch_id,input.employee_name,input.job_title,input.department,input.absence_date::date,input.reason,input.details,input.manager_email,input.submitted_by_email,input.source_key,input.source_snapshot::jsonb,'GOOGLE_SHEETS',CASE WHEN input.employee_name='Não informado na origem' THEN 'EM_CONFERENCIA' ELSE 'PENDENTE' END,$"+(params.length+1)+"::uuid "+
        "FROM (VALUES "+values.join(",")+") AS input(company_id,branch_id,employee_name,job_title,department,absence_date,reason,details,manager_email,submitted_by_email,source_key,source_snapshot) "+
        "ON CONFLICT DO NOTHING RETURNING id,source_key",
        [...params,userId]
      );
      created+=inserted.rowCount;
      duplicates+=chunk.length-inserted.rowCount;
      const mapped=new Map(inserted.rows.map(x=>[x.source_key,x.id]));
      const files=[];
      for(const c of chunk){
        const caseId=mapped.get(c.sourceKey);
        if(!caseId)continue;
        for(const driveId of c.documentIds)files.push([caseId,driveId,"https://drive.google.com/file/d/"+driveId+"/view"]);
      }
      for(let j=0;j<files.length;j+=100){
        const group=files.slice(j,j+100),fp=[];
        const blocks=group.map((r,k)=>{
          fp.push(...r);
          const ix=k*3;
          return "($"+(ix+1)+",$"+(ix+2)+",$"+(ix+3)+")";
        });
        const write=await client.query(
          "INSERT INTO justification_files(case_id,source_drive_id,source_url,original_name,storage_state) "+
          "SELECT src.case_id::uuid,src.drive_id,src.url,'Anexo original do formulário','PENDENTE' "+
          "FROM (VALUES "+blocks.join(",")+") AS src(case_id,drive_id,url) ON CONFLICT DO NOTHING RETURNING id",
          fp
        );
        linked+=write.rowCount;
      }
    }
    await client.query("COMMIT");finished=true;
    previews.delete(userId);
    await audit(req,"IMPORT","justification_cases",null,{companyId,branchId,created,duplicates,linked,skipped:entry.data.issues.length,source:"CSV legado Transzilog"});
    res.status(201).json({
      message:"Importação do histórico concluída.",
      created,duplicates,linksPending:linked,skipped:entry.data.issues.length,
      warning:"Nenhum arquivo binário foi importado. Os links aguardam transferência e validação."
    });
  }catch(error){
    if(client&&!finished)await client.query("ROLLBACK").catch(()=>{});
    next(error);
  }finally{client?.release();}
});
router.get("/status",async(req,res,next)=>{
  try{
    const {companyId,branchId}=req.query;
    await assertUnit(pool,companyId,branchId);
    const {rows}=await pool.query(
      "SELECT COUNT(DISTINCT c.id)::int AS cases,COUNT(f.id)::int AS attachments,COUNT(f.id) FILTER(WHERE f.storage_state='ARMAZENADO')::int AS stored,COUNT(f.id) FILTER(WHERE f.storage_state='PENDENTE')::int AS pending,COUNT(DISTINCT c.id) FILTER(WHERE c.employee_name='Não informado na origem')::int AS no_name "+
      "FROM justification_cases c LEFT JOIN justification_files f ON f.case_id=c.id "+
      "WHERE c.company_id=$1 AND c.branch_id=$2 AND c.source_system='GOOGLE_SHEETS' AND c.source_key LIKE $3",
      [companyId,branchId,ORIGIN+"%"]
    );
    res.json(rows[0]||{cases:0,attachments:0,stored:0,pending:0,no_name:0});
  }catch(error){next(error);}
});
module.exports=router;
