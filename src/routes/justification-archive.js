"use strict";
const express=require("express");
const multer=require("multer");
const crypto=require("node:crypto");
const pool=require("../db/pool");
const audit=require("../db/audit");
const {authenticate}=require("../middleware/auth");
const {requireScope,readCase,allowedUnit,requireSingleUnit,fail}=require("../middleware/archive-scope");
const router=express.Router();
const statuses=new Set(["PENDENTE","EM_CONFERENCIA","CONFERIDO","DIVERGENTE","DESCONSIDERADO"]);
const clean=(value,max=200)=>String(value??"").trim().slice(0,max);
const nullable=(value,max)=>clean(value,max)||null;
const validDate=value=>!value||(/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+"T12:00:00Z")));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ensureUUID=id=>{if(!uuid.test(String(id||"")))throw fail("Identificador inválido.",400);return id;};
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1},fileFilter:(_req,file,cb)=>{
 if(!["application/pdf","image/jpeg","image/png","image/webp"].includes(file.mimetype))return cb(fail("Somente PDF, JPG, PNG e WebP.",415));
 cb(null,true);
}}).single("file");
function uploadSingle(req,res,next){
 upload(req,res,e=>{
  if(e?.code==="LIMIT_FILE_SIZE")return res.status(413).json({error:"Arquivo maior que 8 MB."});
  if(e)return next(e);
  next();
 });
}
function mimeOf(bytes){
 if(bytes.length>=5&&bytes.subarray(0,5).toString("latin1")==="%PDF-")return "application/pdf";
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return "image/jpeg";
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return "image/png";
 if(bytes.length>=12&&bytes.subarray(0,4).toString("ascii")==="RIFF"&&bytes.subarray(8,12).toString("ascii")==="WEBP")return "image/webp";
 return null;
}
router.use(authenticate);

router.get("/scope",requireScope(),async(req,res)=>{
 const scope=req.archiveScope;
 res.json({profileName:scope.profileName,isMaster:scope.isMaster,canManage:scope.canManage,
           units:scope.units,importEnabled:scope.canManage&&!!scope.singleUnit,
           importMessage:scope.singleUnit?"":"Para importar histórico CSV ou cadastrar sem colaborador, o perfil precisa ter uma única filial vinculada."});
});
// Compatibilidade para outros componentes, mas nunca devolve unidades não autorizadas.
router.get("/units",requireScope(),async(req,res)=>{
 const units=req.archiveScope.units;
 res.json({
  companies:[...new Map(units.map(u=>[u.company_id,{id:u.company_id,trade_name:u.company_name}])).values()],
  branches:units.map(u=>({id:u.branch_id,company_id:u.company_id,name:u.branch_name}))
 });
});
router.get("/employees",requireScope(),async(req,res,next)=>{
 try{
  const q=clean(req.query.q,100),args=[req.archiveScope.branchIds];
  const parts=["e.branch_id=ANY($1::uuid[])"];
  if(q){args.push("%"+q.replace(/[\\%_]/g,"\\$&")+"%");parts.push("(e.full_name ILIKE $2 ESCAPE '\\' OR e.registration ILIKE $2 ESCAPE '\\')");}
  const {rows}=await pool.query(
    "SELECT e.id,e.company_id,e.branch_id,e.full_name,e.registration,e.status,"+
    "COALESCE(NULLIF(TRIM(j.name),''),NULLIF(TRIM(e.job_title),'')) job_title,"+
    "NULLIF(TRIM(d.name),'') department,b.name branch_name,COALESCE(c.trade_name,c.legal_name) company_name "+
    "FROM employees e JOIN branches b ON b.id=e.branch_id AND b.company_id=e.company_id JOIN companies c ON c.id=e.company_id "+
    "LEFT JOIN job_roles j ON j.id=e.job_role_id AND j.company_id=e.company_id "+
    "LEFT JOIN departments d ON d.id=e.department_id AND d.company_id=e.company_id "+
    "WHERE "+parts.join(" AND ")+" ORDER BY CASE WHEN UPPER(TRIM(e.status))='ATIVO' THEN 0 ELSE 1 END,e.full_name,e.registration LIMIT 500",args
  );
  res.json({employees:rows,limit:500});
 }catch(e){next(e);}
});
router.get("/cases",requireScope(),async(req,res,next)=>{
 try{
  const scope=req.archiveScope,limit=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||50)),offset=Math.min(100000,Math.max(0,parseInt(req.query.offset,10)||0));
  const args=[scope.branchIds],where=["c.branch_id=ANY($1::uuid[])","EXISTS(SELECT 1 FROM branches bcheck WHERE bcheck.id=c.branch_id AND bcheck.company_id=c.company_id)"];
  const q=clean(req.query.q,100);
  if(q){args.push("%"+q.replace(/[\\%_]/g,"\\$&")+"%");where.push("(c.employee_name ILIKE $"+args.length+" ESCAPE '\\' OR c.employee_registration ILIKE $"+args.length+" ESCAPE '\\')");}
  if(req.query.status){if(!statuses.has(req.query.status))throw fail("Situação inválida.",400);args.push(req.query.status);where.push("c.review_status=$"+args.length);}
  const clause=where.join(" AND ");
  const count=await pool.query("SELECT COUNT(*)::int total FROM justification_cases c WHERE "+clause,args);
  const records=await pool.query(
    "SELECT c.id,c.company_id,c.branch_id,c.employee_name,c.employee_registration,c.department,c.absence_date,c.reason,c.review_status,c.submitted_at,c.created_at,c.source_system,"+
    "b.name branch_name,COALESCE(co.trade_name,co.legal_name) company_name,"+
    "COUNT(f.id)::int file_count,COUNT(f.id) FILTER (WHERE f.storage_state='ARMAZENADO')::int stored_count "+
    "FROM justification_cases c JOIN branches b ON b.id=c.branch_id AND b.company_id=c.company_id JOIN companies co ON co.id=c.company_id "+
    "LEFT JOIN justification_files f ON f.case_id=c.id WHERE "+clause+
    " GROUP BY c.id,b.name,co.trade_name,co.legal_name ORDER BY c.absence_date DESC NULLS LAST,c.created_at DESC LIMIT $"+(args.length+1)+" OFFSET $"+(args.length+2),
    [...args,limit,offset]);
  res.json({total:count.rows[0].total,records:records.rows});
 }catch(e){next(e);}
});
router.post("/cases",requireScope("manage"),express.json({limit:"64kb"}),async(req,res,next)=>{
 try{
  const scope=req.archiveScope,b=req.body||{},reason=clean(b.reason,250),date=nullable(b.absenceDate,10);
  if(!reason)throw fail("Informe o motivo.",400);
  if(!validDate(date))throw fail("Data de ausência inválida.",400);
  const employeeId=nullable(b.employeeId,80);
  let companyId,branchId,employeeName=clean(b.employeeName,200),registration=nullable(b.registration,40),jobTitle=nullable(b.jobTitle,180),department=nullable(b.department,160);
  if(employeeId){
   ensureUUID(employeeId);
   const {rows}=await pool.query(
    "SELECT e.company_id,e.branch_id,e.full_name,e.registration,"+
    "COALESCE(NULLIF(TRIM(j.name),''),NULLIF(TRIM(e.job_title),'')) job_title,NULLIF(TRIM(d.name),'') department "+
    "FROM employees e LEFT JOIN job_roles j ON j.id=e.job_role_id AND j.company_id=e.company_id "+
    "LEFT JOIN departments d ON d.id=e.department_id AND d.company_id=e.company_id WHERE e.id=$1",[employeeId]);
   const e=rows[0];
   if(!e||!allowedUnit(scope,e.company_id,e.branch_id))throw fail("Colaborador fora das filiais autorizadas.",404);
   companyId=e.company_id;branchId=e.branch_id;employeeName=e.full_name;
   registration=nullable(e.registration,40)||registration;
   jobTitle=nullable(e.job_title,180)||jobTitle;
   department=nullable(e.department,160)||department;
  }else{
   const unit=requireSingleUnit(scope);
   companyId=unit.company_id;branchId=unit.branch_id;
  }
  if(!employeeName)throw fail("Informe ou escolha um colaborador.",400);
  const row=await pool.query(
   "INSERT INTO justification_cases(company_id,branch_id,employee_id,employee_name,employee_registration,job_title,department,absence_date,reason,details,manager_email,created_by) "+
   "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,created_at",
   [companyId,branchId,employeeId,employeeName,registration,jobTitle,department,date,reason,nullable(b.details,3000),nullable(b.managerEmail,254),scope.userId]);
  await audit(req,"CREATE","justification_cases",row.rows[0].id,{companyId,branchId});
  res.status(201).json(row.rows[0]);
 }catch(e){next(e);}
});
router.get("/cases/:id",requireScope(),async(req,res,next)=>{
 try{
  const record=await readCase(req.archiveScope,req.params.id);
  const {rows:files}=await pool.query(
   "SELECT id,original_name,mime_type,size_bytes,storage_state,created_at,stored_at FROM justification_files WHERE case_id=$1 ORDER BY created_at DESC",[record.id]);
  res.json({record,files});
 }catch(e){next(e);}
});
router.patch("/cases/:id/status",requireScope("manage"),express.json({limit:"4kb"}),async(req,res,next)=>{
 try{
  const c=await readCase(req.archiveScope,req.params.id),status=clean(req.body?.status,24);
  if(!statuses.has(status))throw fail("Situação inválida.",400);
  const row=await pool.query("UPDATE justification_cases SET review_status=$2,updated_at=NOW() WHERE id=$1 RETURNING id,review_status",[c.id,status]);
  await audit(req,"REVIEW","justification_cases",c.id,{status});
  res.json(row.rows[0]);
 }catch(e){next(e);}
});
router.post("/cases/:id/files",requireScope("manage"),uploadSingle,async(req,res,next)=>{
 let client;
 try{
  if(!req.file?.buffer?.length)throw fail("Selecione um documento.",400);
  const mime=mimeOf(req.file.buffer);
  if(!mime||mime!==req.file.mimetype)throw fail("Conteúdo não corresponde ao tipo de arquivo informado.",415);
  const name=clean(req.file.originalname.replace(/[\\/\u0000-\u001f]/g,"_"),255)||"documento";
  const hash=crypto.createHash("sha256").update(req.file.buffer).digest("hex");
  client=await pool.connect();await client.query("BEGIN");
  const c=await readCase(req.archiveScope,req.params.id,client);
  const row=await client.query(
   "INSERT INTO justification_files(case_id,original_name,mime_type,size_bytes,sha256,storage_state,stored_at,uploaded_by) "+
   "VALUES($1,$2,$3,$4,$5,'ARMAZENADO',NOW(),$6) ON CONFLICT DO NOTHING RETURNING id",
   [c.id,name,mime,req.file.buffer.length,hash,req.archiveScope.userId]);
  if(!row.rows.length)throw fail("Documento já vinculado a esta justificativa.",409);
  await client.query("INSERT INTO justification_file_contents(file_id,bytes) VALUES($1,$2)",[row.rows[0].id,req.file.buffer]);
  await client.query("COMMIT");
  await audit(req,"UPLOAD","justification_files",row.rows[0].id,{caseId:c.id,bytes:req.file.buffer.length});
  res.status(201).json({id:row.rows[0].id,originalName:name,sizeBytes:req.file.buffer.length,storageState:"ARMAZENADO"});
 }catch(e){if(client)await client.query("ROLLBACK").catch(()=>{});next(e);}
 finally{client?.release();}
});
router.get("/files/:id/download",requireScope(),async(req,res,next)=>{
 try{
  const id=ensureUUID(req.params.id);
  const {rows}=await pool.query(
   "SELECT f.id,f.case_id,f.original_name,f.mime_type,f.sha256 FROM justification_files f WHERE f.id=$1 AND f.storage_state='ARMAZENADO'",[id]);
  const f=rows[0];
  if(!f)throw fail("Documento não encontrado.",404);
  await readCase(req.archiveScope,f.case_id);
  const file=await pool.query("SELECT bytes FROM justification_file_contents WHERE file_id=$1",[f.id]);
  const bytes=file.rows[0]?.bytes;
  if(!bytes||crypto.createHash("sha256").update(bytes).digest("hex")!==f.sha256)throw fail("Falha de integridade.",409);
  const ascii=f.original_name.replace(/[^\x20-\x7e]/g,"_").replace(/["\\]/g,"_");
  res.set("Content-Type",f.mime_type||"application/octet-stream");
  res.set("Content-Disposition",'attachment; filename="'+ascii+'"; filename*=UTF-8'+ "''"+encodeURIComponent(f.original_name));
  res.set("Content-Length",String(bytes.length));
  await audit(req,"DOWNLOAD","justification_files",f.id,{bytes:bytes.length});
  res.end(bytes);
 }catch(e){next(e);}
});
module.exports=router;
