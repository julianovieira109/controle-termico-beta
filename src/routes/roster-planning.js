const express=require('express');
const rateLimit=require('express-rate-limit');
const pool=require('../db/pool');
const {authenticate,applyScope,requirePermission}=require('../middleware/auth');
const service=require('../services/roster-planning');
const router=express.Router();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.use(authenticate,applyScope,requirePermission('roster.view'));
router.use((req,_res,next)=>{if(req.method==='GET')return next();return requirePermission('roster.manage')(req,_res,next);});
router.use(['/import-preview','/pending-preview'],rateLimit({windowMs:60000,limit:10,keyGenerator:req=>req.user.sub,message:{error:'Aguarde um minuto antes de ler novos backups.'}}));
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
async function unit(req,db=pool,lock=false){
 const companyId=String(req.query.companyId||''),branchId=String(req.query.branchId||'');
 if(!uuid.test(companyId)||!uuid.test(branchId))throw service.fail('Selecione empresa e filial válidas.');
 if(!req.scope.isAdmin&&(companyId!==req.scope.companyId||!req.scope.branchIds.includes(branchId)))throw service.fail('Empresa ou filial fora do seu acesso.',403);
 const {rows}=await db.query(`SELECT b.id,b.company_id,b.name branch_name,c.trade_name company_name FROM branches b JOIN companies c ON c.id=b.company_id WHERE b.id=$1 AND b.company_id=$2${lock?' FOR UPDATE OF b':''}`,[branchId,companyId]);
 if(!rows[0])throw service.fail('A filial não pertence à empresa selecionada.',404);
 return {...rows[0],companyId,branchId};
}
async function official(db,scope,lock=false){return (await db.query(`SELECT e.id,e.registration,e.full_name,e.status,e.admission_date,e.termination_date,e.updated_at,e.job_title,j.name job_role_name,s.name shift_name,s.senior_code shift_senior_code,s.description shift_description
 FROM employees e LEFT JOIN job_roles j ON j.id=e.job_role_id LEFT JOIN shifts s ON s.id=e.shift_id WHERE e.company_id=$1 AND e.branch_id=$2 ORDER BY e.id${lock?' FOR SHARE OF e':''}`,[scope.companyId,scope.branchId])).rows;}
async function plan(db,scope,lock=false){return (await db.query(`SELECT * FROM roster_plans WHERE company_id=$1 AND branch_id=$2${lock?' FOR UPDATE':''}`,[scope.companyId,scope.branchId])).rows[0]||{version:0,payload:{}};}
async function audit(db,req,scope,id,before,after,action,summary){
 await db.query(`INSERT INTO audit_logs(user_id,action,entity,entity_id,details,ip_address) VALUES($1,$2,'roster_plans',$3,$4,$5)`,[req.user.sub,action,id,JSON.stringify({companyId:scope.companyId,branchId:scope.branchId,summary,changes:service.changes(before,after)}),req.ip||null]);
}
async function save(db,req,scope,current,payload,officialRows,summary,action='UPDATE_ROSTER'){
 const now=new Date().toISOString();payload.state.history=[{at:now,action:`${req.user.name||'Usuário'}: ${summary}`},...payload.state.history].slice(0,500);
 const {rows}=current.id?await db.query(`UPDATE roster_plans SET payload=$1,version=version+1,updated_at=NOW(),updated_by=$2 WHERE id=$3 AND version=$4 RETURNING *`,[JSON.stringify(payload),req.user.sub,current.id,current.version]):await db.query(`INSERT INTO roster_plans(company_id,branch_id,payload,version,updated_by) VALUES($1,$2,$3,1,$4) RETURNING *`,[scope.companyId,scope.branchId,JSON.stringify(payload),req.user.sub]);
 if(!rows[0])throw service.fail('Planejamento alterado por outro acesso. Recarregue antes de gravar.',409);
 await audit(db,req,scope,rows[0].id,service.project(officialRows,current.payload).state,payload.state,action,summary);
 return {state:payload.state,version:rows[0].version,updatedAt:rows[0].updated_at,officialVersion:service.officialVersion(officialRows)};
}
router.get('/options',async(req,res,next)=>{try{
 const companyParams=req.scope.isAdmin?[]:[req.scope.companyId],branchParams=req.scope.isAdmin?[]:[req.scope.companyId,req.scope.branchIds];
 const [companies,branches]=await Promise.all([pool.query(`SELECT id,trade_name FROM companies WHERE active=TRUE${req.scope.isAdmin?'':' AND id=$1'} ORDER BY trade_name`,companyParams),pool.query(`SELECT id,company_id,name FROM branches WHERE active=TRUE${req.scope.isAdmin?'':' AND company_id=$1 AND id=ANY($2::uuid[])'} ORDER BY name`,branchParams)]);
 res.json({companies:companies.rows,branches:branches.rows,canEdit:req.scope.isAdmin||req.user.permissions?.['roster.manage']===true});
}catch(error){next(error);}});
router.get('/state',async(req,res,next)=>{try{
 const scope=await unit(req);const [officialRows,current]=await Promise.all([official(pool,scope),plan(pool,scope)]);const projected=service.project(officialRows,current.payload);
 res.json({state:projected.state,pending:projected.pending,hasMigrationPending:(current.payload.pending||[]).some(row=>row.source),version:current.version,updatedAt:current.updated_at||null,officialVersion:service.officialVersion(officialRows)});
}catch(error){next(error);}});
router.put('/state',async(req,res,next)=>{
 let db;try{
  if(Buffer.byteLength(JSON.stringify(req.body))>3000000)throw service.fail('Planejamento maior que 3 MB.',413);
  if(!Number.isInteger(req.body.version)||req.body.version<0)throw service.fail('Versão do planejamento inválida.');
  db=await pool.connect();await db.query('BEGIN');const scope=await unit(req,db,true),officialRows=await official(db,scope,true),current=await plan(db,scope,true);
  if(current.version!==req.body.version||service.officialVersion(officialRows)!==req.body.officialVersion)throw service.fail('O planejamento ou o cadastro Beta foi alterado. Recarregue antes de salvar.',409);
  const projected=service.project(officialRows,current.payload);const next=service.protect(req.body.state,projected.state);const payload=service.serialize(next,current.payload,projected);
  const summary=String(req.body.action||'Planejamento atualizado').slice(0,5000);
  const result=await save(db,req,scope,current,payload,officialRows,summary);await db.query('COMMIT');res.json(result);
 }catch(error){if(db)await db.query('ROLLBACK');next(error);}finally{db?.release();}
});
async function createPreview(req,res,pendingOnly=false){
 if(Buffer.byteLength(JSON.stringify(req.body))>3000000)throw service.fail('Backup maior que 3 MB.',413);
 const scope=await unit(req);const [officialRows,current]=await Promise.all([official(pool,scope),plan(pool,scope)]);
 let backup=req.body.backup;
 if(pendingOnly){
  const entries=(current.payload.pending||[]).filter(row=>row.source);
  if(!entries.length)throw service.fail('Não há registros de migração pendentes para conferir.');
  backup={state:{employees:entries.map(row=>row.source),overrides:entries.flatMap(row=>row.overrides||[]),history:[],appliedImports:[]}};
 }
 const preview=service.previewImport(backup,officialRows,current.payload,scope);
 const payload={...preview,sourceBackup:backup,planVersion:current.version,officialVersion:service.officialVersion(officialRows)};
 await pool.query('DELETE FROM roster_import_previews WHERE expires_at<NOW()');
 const {rows}=await pool.query(`INSERT INTO roster_import_previews(user_id,company_id,branch_id,payload,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '30 minutes') RETURNING id`,[req.user.sub,scope.companyId,scope.branchId,JSON.stringify(payload)]);
 res.json({previewId:rows[0].id,summary:preview.summary,rows:preview.rows,companyName:scope.company_name,branchName:scope.branch_name});
}
router.post('/import-preview',async(req,res,next)=>{try{await createPreview(req,res);}catch(error){next(error);}});
router.post('/pending-preview',async(req,res,next)=>{try{await createPreview(req,res,true);}catch(error){next(error);}});
router.post('/import-confirm',async(req,res,next)=>{
 let db;try{
  if(!uuid.test(req.body.previewId||'')||req.body.unitConfirmed!==true)throw service.fail('Confira a unidade e a prévia antes de confirmar.');
  db=await pool.connect();await db.query('BEGIN');const scope=await unit(req,db,true),officialRows=await official(db,scope,true),current=await plan(db,scope,true);
  const {rows}=await db.query(`SELECT * FROM roster_import_previews WHERE id=$1 AND user_id=$2 AND company_id=$3 AND branch_id=$4 AND expires_at>NOW() FOR UPDATE`,[req.body.previewId,req.user.sub,scope.companyId,scope.branchId]);
  const preview=rows[0]?.payload;if(!preview)throw service.fail('Prévia expirada, já utilizada ou indisponível para este usuário/unidade.',409);
  if(current.version!==preview.planVersion||service.officialVersion(officialRows)!==preview.officialVersion)throw service.fail('O cadastro ou planejamento mudou após a prévia. Leia o backup novamente.',409);
  if((current.payload.importedDigests||[]).includes(preview.hash))throw service.fail('Backup já aplicado nesta unidade.',409);
  const payload=service.applyImport(preview,officialRows,current.payload,req.body.allowPartial===true);
  const result=await save(db,req,scope,current,payload,officialRows,`Migração conferida: ${preview.summary.matched} correspondências e ${preview.summary.pending} pendências preservadas.`,'IMPORT_ROSTER');
  await db.query(`INSERT INTO roster_import_archives(id,plan_id,company_id,branch_id,created_by,created_by_name,source_hash,payload)
   SELECT $1,id,$2,$3,$4,$5,$6,$7 FROM roster_plans WHERE company_id=$2 AND branch_id=$3`,[rows[0].id,scope.companyId,scope.branchId,req.user.sub,req.user.name||'Usuário',preview.hash,JSON.stringify({backup:preview.sourceBackup||{state:preview.input},rows:preview.rows,summary:preview.summary})]);
  await db.query('DELETE FROM roster_import_previews WHERE id=$1',[rows[0].id]);await db.query('COMMIT');res.json({...result,summary:preview.summary});
 }catch(error){if(db)await db.query('ROLLBACK');next(error);}finally{db?.release();}
});
module.exports=router;
