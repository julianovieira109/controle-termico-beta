"use strict";
const express=require("express");
const multer=require("multer");
const crypto=require("node:crypto");
const pool=require("../db/pool");
const audit=require("../db/audit");
const {authenticate,requireMasterAdmin}=require("../middleware/auth");
const router=express.Router();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses=new Set(["PENDENTE","EM_CONFERENCIA","CONFERIDO","DIVERGENTE","DESCONSIDERADO"]);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const clean=(value,max=200)=>String(value??"").trim().slice(0,max);
const nullable=(value,max)=>clean(value,max)||null;
const validDate=value=>!value||(/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+"T12:00:00Z")));
const isUUID=value=>uuid.test(String(value||""));
const fileUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1},fileFilter:(_req,file,cb)=>{
  if(!["application/pdf","image/jpeg","image/png","image/webp"].includes(file.mimetype)){
    cb(fail("Somente PDF, JPG, PNG ou WebP.",415));return;
  }
  cb(null,true);
}}).single("file");

function detectMime(data){
  if(data.length>=5&&data.subarray(0,5).toString("latin1")==="%PDF-")return "application/pdf";
  if(data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return "image/jpeg";
  if(data.length>=8&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return "image/png";
  if(data.length>=12&&data.subarray(0,4).toString("ascii")==="RIFF"&&data.subarray(8,12).toString("ascii")==="WEBP")return "image/webp";
  return null;
}
async function assertUnit(companyId,branchId,db=pool){
  if(!isUUID(companyId)||!isUUID(branchId))throw fail("Selecione empresa e filial válidas.");
  const {rows}=await db.query("SELECT b.id FROM branches b WHERE b.id=$1 AND b.company_id=$2 AND b.active=TRUE",[branchId,companyId]);
  if(!rows.length)throw fail("Filial não encontrada para a empresa.",404);
}
function ensureUUID(input){if(!isUUID(input))throw fail("Identificador inválido.");return input;}
function handleUpload(req,res,next){
  fileUpload(req,res,error=>{
    if(error?.code==="LIMIT_FILE_SIZE")return res.status(413).json({error:"Arquivo maior que 8 MB."});
    if(error)return next(error);
    next();
  });
}
router.use(authenticate,requireMasterAdmin);
router.use((req,res,next)=>{
  res.set("Cache-Control","private, no-store");
  if(process.env.JUSTIFICATION_ARCHIVE_BETA!=="true")
    return res.status(503).json({error:"Acervo documental em homologação. O Administrador precisa habilitar JUSTIFICATION_ARCHIVE_BETA após validar backup/restauração."});
  next();
});
router.get("/units",async(_req,res,next)=>{
  try{
    const [companies,branches]=await Promise.all([
      pool.query("SELECT id,trade_name FROM companies WHERE active=TRUE ORDER BY trade_name"),
      pool.query("SELECT id,company_id,name FROM branches WHERE active=TRUE ORDER BY name")
    ]);
    res.json({companies:companies.rows,branches:branches.rows});
  }catch(error){next(error);}
});
router.get("/cases",async(req,res,next)=>{
  try{
    const {companyId,branchId}=req.query;
    await assertUnit(companyId,branchId);
    const limit=Math.min(100,Math.max(1,Number.parseInt(req.query.limit,10)||50));
    const offset=Math.min(100000,Math.max(0,Number.parseInt(req.query.offset,10)||0));
    const params=[companyId,branchId];
    const where=["c.company_id=$1","c.branch_id=$2"];
    const search=clean(req.query.q,100);
    if(search){params.push("%"+search.replace(/[\\%_]/g,"\\$&")+"%");where.push("(c.employee_name ILIKE $"+params.length+" ESCAPE '\\' OR c.employee_registration ILIKE $"+params.length+" ESCAPE '\\')");}
    if(req.query.status){if(!statuses.has(req.query.status))throw fail("Status inválido.");params.push(req.query.status);where.push("c.review_status=$"+params.length);}
    const clause=where.join(" AND ");
    const count=await pool.query("SELECT COUNT(*)::int total FROM justification_cases c WHERE "+clause,params);
    const records=await pool.query(
      "SELECT c.id,c.employee_name,c.employee_registration,c.department,c.absence_date,c.reason,c.review_status,c.submitted_at,c.created_at,c.source_system,COUNT(f.id)::int file_count,COUNT(f.id) FILTER (WHERE f.storage_state='ARMAZENADO')::int stored_count FROM justification_cases c LEFT JOIN justification_files f ON f.case_id=c.id WHERE "+clause+
      " GROUP BY c.id ORDER BY c.absence_date DESC NULLS LAST,c.created_at DESC LIMIT $"+(params.length+1)+" OFFSET $"+(params.length+2),
      [...params,limit,offset]
    );
    res.json({total:count.rows[0].total,records:records.rows});
  }catch(error){next(error);}
});
router.post("/cases",express.json({limit:"64kb"}),async(req,res,next)=>{
  try{
    const b=req.body||{};
    await assertUnit(b.companyId,b.branchId);
    const employeeName=clean(b.employeeName,200),reason=clean(b.reason,250),absenceDate=nullable(b.absenceDate,10);
    if(!employeeName||!reason)throw fail("Informe colaborador e motivo.");
    if(!validDate(absenceDate))throw fail("Data de ausência inválida.");
    const details=clean(b.details,3000);
    const r=await pool.query(
      "INSERT INTO justification_cases(company_id,branch_id,employee_name,employee_registration,job_title,department,absence_date,reason,details,manager_email,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,created_at",
      [b.companyId,b.branchId,employeeName,nullable(b.registration,40),nullable(b.jobTitle,180),nullable(b.department,160),absenceDate,reason,details||null,nullable(b.managerEmail,254),req.user.sub]
    );
    await audit(req,"CREATE","justification_cases",r.rows[0].id,{companyId:b.companyId,branchId:b.branchId});
    res.status(201).json(r.rows[0]);
  }catch(error){next(error);}
});
router.get("/cases/:id",async(req,res,next)=>{
  try{
    const id=ensureUUID(req.params.id);
    const [one,files]=await Promise.all([
      pool.query("SELECT id,company_id,branch_id,employee_name,employee_registration,job_title,department,absence_date,reason,details,manager_email,submitted_by_email,submitted_at,source_system,review_status,created_at FROM justification_cases WHERE id=$1",[id]),
      pool.query("SELECT id,original_name,mime_type,size_bytes,storage_state,created_at,stored_at FROM justification_files WHERE case_id=$1 ORDER BY created_at DESC",[id])
    ]);
    if(!one.rows[0])throw fail("Justificativa não encontrada.",404);
    res.json({record:one.rows[0],files:files.rows});
  }catch(error){next(error);}
});
router.patch("/cases/:id/status",express.json({limit:"4kb"}),async(req,res,next)=>{
  try{
    const id=ensureUUID(req.params.id),status=clean(req.body?.status,24);
    if(!statuses.has(status))throw fail("Status inválido.");
    const r=await pool.query("UPDATE justification_cases SET review_status=$2,updated_at=NOW() WHERE id=$1 RETURNING id,review_status",[id,status]);
    if(!r.rows[0])throw fail("Justificativa não encontrada.",404);
    await audit(req,"REVIEW","justification_cases",id,{status});
    res.json(r.rows[0]);
  }catch(error){next(error);}
});
router.post("/cases/:id/files",handleUpload,async(req,res,next)=>{
  let client;
  try{
    const caseId=ensureUUID(req.params.id);
    if(!req.file||!req.file.buffer?.length)throw fail("Selecione um documento.",400);
    const mime=detectMime(req.file.buffer);
    if(!mime||mime!==req.file.mimetype)throw fail("Conteúdo não corresponde ao tipo de arquivo informado.",415);
    const fileName=clean(req.file.originalname.replace(/[\\/\u0000-\u001f]/g,"_"),255)||"documento";
    const hash=crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    client=await pool.connect();await client.query("BEGIN");
    const exists=await client.query("SELECT id FROM justification_cases WHERE id=$1 FOR SHARE",[caseId]);
    if(!exists.rows.length)throw fail("Justificativa não encontrada.",404);
    const row=await client.query(
      "INSERT INTO justification_files(case_id,original_name,mime_type,size_bytes,sha256,storage_state,stored_at,uploaded_by) VALUES($1,$2,$3,$4,$5,'ARMAZENADO',NOW(),$6) ON CONFLICT DO NOTHING RETURNING id",
      [caseId,fileName,mime,req.file.buffer.length,hash,req.user.sub]
    );
    if(!row.rows[0])throw fail("Este documento já foi vinculado à justificativa.",409);
    await client.query("INSERT INTO justification_file_contents(file_id,bytes) VALUES($1,$2)",[row.rows[0].id,req.file.buffer]);
    await client.query("COMMIT");
    await audit(req,"UPLOAD","justification_files",row.rows[0].id,{caseId,size:req.file.buffer.length,mime});
    res.status(201).json({id:row.rows[0].id,originalName:fileName,sizeBytes:req.file.buffer.length,storageState:"ARMAZENADO"});
  }catch(error){if(client)await client.query("ROLLBACK").catch(()=>{});next(error);}
  finally{client?.release();}
});
router.get("/files/:id/download",async(req,res,next)=>{
  try{
    const id=ensureUUID(req.params.id);
    const r=await pool.query("SELECT f.id,f.original_name,f.mime_type,f.size_bytes,f.sha256,c.bytes FROM justification_files f JOIN justification_file_contents c ON c.file_id=f.id WHERE f.id=$1 AND f.storage_state='ARMAZENADO'",[id]);
    const f=r.rows[0];if(!f)throw fail("Arquivo não encontrado ou não armazenado.",404);
    if(!f.bytes||crypto.createHash("sha256").update(f.bytes).digest("hex")!==f.sha256)throw fail("Falha de integridade no arquivo.",409);
    const ascii=f.original_name.replace(/[^\x20-\x7e]/g,"_").replace(/[\"\\]/g,"_");
    res.set("Content-Type",f.mime_type||"application/octet-stream");
    res.set("Content-Disposition",'attachment; filename="'+ascii+'"; filename*=UTF-8'+"''"+encodeURIComponent(f.original_name));
    res.set("Content-Length",String(f.bytes.length));
    await audit(req,"DOWNLOAD","justification_files",id,{bytes:f.bytes.length});
    res.end(f.bytes);
  }catch(error){next(error);}
});
module.exports=router;
