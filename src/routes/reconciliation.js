const express=require('express');
const crypto=require('node:crypto');
const pool=require('../db/pool');
const audit=require('../db/audit');
const {authenticate,applyScope,requirePermission,requireOccurrencesAccess}=require('../middleware/auth');
const {createPdfUpload}=require('../middleware/pdf-upload');
const {readBhPdf,registration}=require('../importers/senior-bh');
const {periodRange,compareSnapshot,guidance}=require('../lib/period-comparison');
const router=express.Router();router.use(authenticate,applyScope);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function filters(req,alias,params){
  const clauses=[];
  for(const key of ['companyId','branchId','employeeId'])if(req.query[key]&&!uuid.test(req.query[key]))throw fail('Filtro inválido.');
  if(!req.scope.isAdmin){
    params.push(req.scope.companyId);clauses.push(`${alias}.company_id=$${params.length}::uuid`);
    params.push(req.scope.branchIds);clauses.push(`${alias}.branch_id=ANY($${params.length}::uuid[])`);
  }
  for(const [key,column] of [['companyId','company_id'],['branchId','branch_id']])if(req.query[key]){params.push(req.query[key]);clauses.push(`${alias}.${column}=$${params.length}::uuid`);}
  return clauses.length?' AND '+clauses.join(' AND '):'';
}
async function assertUnit(req,companyId,branchId,db=pool){
  if(!uuid.test(companyId||'')||!uuid.test(branchId||''))throw fail('Selecione empresa e filial válidas.');
  if(!req.scope.isAdmin&&(companyId!==req.scope.companyId||!req.scope.branchIds.includes(branchId)))throw fail('Empresa/filial fora do seu acesso.',403);
  const {rows}=await db.query(`SELECT c.legal_name,c.trade_name,b.name FROM companies c JOIN branches b ON b.company_id=c.id WHERE c.id=$1 AND b.id=$2`,[companyId,branchId]);
  if(!rows.length)throw fail('A filial não pertence à empresa selecionada.');return rows[0];
}
const canonical=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toUpperCase();
function summary(row){return {id:row.id,type:row.report_type,start:row.period_start,end:row.period_end,fileName:row.file_name,companyId:row.company_id,branchId:row.branch_id,companyName:row.company_name,confirmedAt:row.confirmed_at,errors:row.errors,
  records:row.records.map(r=>({registration:r.registration,name:r.name,bank:r.bank,initial:r.initial,final:r.final,expiring:r.expiring,page:r.page,events:r.events.length,ledgerDifference:r.ledgerDifference}))};}
router.post('/bh/preview',requirePermission('imports.manage'),createPdfUpload(32).single('file'),async(req,res,next)=>{
  try{
    const {companyId,branchId}=req.body;const unit=await assertUnit(req,companyId,branchId);
    if(!req.file)throw fail('Selecione o PDF de BH.');
    let parsed;
    try{parsed=await readBhPdf(req.file.buffer);}catch(error){throw fail(`Não foi possível ler o BH: ${error.message}`,422);}
    if(![unit.legal_name,unit.trade_name].some(name=>canonical(name)===canonical(parsed.companyName)))throw fail('A empresa identificada no PDF difere da selecionada. Confira o arquivo e a empresa.');
    const hash=crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const {rows}=await pool.query(`INSERT INTO senior_bh_imports(user_id,company_id,branch_id,report_type,period_start,period_end,file_name,file_hash,company_name,records,errors)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(company_id,branch_id,file_hash) DO UPDATE SET created_at=CASE WHEN senior_bh_imports.confirmed_at IS NULL THEN NOW() ELSE senior_bh_imports.created_at END
      RETURNING *,to_char(period_start,'YYYY-MM-DD') period_start,to_char(period_end,'YYYY-MM-DD') period_end`,
      [req.user.sub,companyId,branchId,parsed.type,parsed.start,parsed.end,req.file.originalname.slice(0,255),hash,parsed.companyName,JSON.stringify(parsed.records),JSON.stringify(parsed.errors)]);
    res.json(summary(rows[0]));
  }catch(error){next(error);}
});
router.post('/bh/confirm',requirePermission('imports.manage'),async(req,res,next)=>{
  const client=await pool.connect();let committed=false;
  try{
    const {id,companyId,branchId,scopeConfirmed}=req.body;
    if(!uuid.test(id||''))throw fail('Leia o PDF antes de confirmar.');
    await assertUnit(req,companyId,branchId,client);
    if(scopeConfirmed!==true)throw fail('Confirme que os colaboradores deste arquivo pertencem à filial selecionada.');
    await client.query('BEGIN');
    const {rows}=await client.query('SELECT * FROM senior_bh_imports WHERE id=$1 AND company_id=$2 AND branch_id=$3 FOR UPDATE',[id,companyId,branchId]);
    const row=rows[0];if(!row)throw fail('Prévia não encontrada nesta empresa/filial.',404);
    if(row.errors.length)throw fail('Há linhas não reconhecidas no BH. Confira o PDF antes de confirmar.');
    if(!row.confirmed_at&&new Date(row.created_at).getTime()<Date.now()-86400000)throw fail('Prévia expirada. Reenvie o PDF para uma nova conferência.',409);
    const alreadyConfirmed=Boolean(row.confirmed_at);
    if(!alreadyConfirmed)await client.query('UPDATE senior_bh_imports SET confirmed_at=NOW() WHERE id=$1',[id]);
    await client.query('COMMIT');committed=true;
    if(!alreadyConfirmed)await audit(req,'IMPORT_BH','senior_bh_imports',id,{type:row.report_type,fileName:row.file_name,companyId,branchId,records:row.records.length});
    res.json({success:true,alreadyConfirmed,records:row.records.length});
  }catch(error){if(!committed)await client.query('ROLLBACK');next(error);}finally{client.release();}
});
router.get('/bh/history',requirePermission('imports.manage'),async(req,res,next)=>{
  try{
    const params=[];const scope=filters(req,'i',params);
    const {rows}=await pool.query(`SELECT i.id,i.report_type,i.file_name,to_char(i.period_start,'YYYY-MM-DD') start,to_char(i.period_end,'YYYY-MM-DD') "end",i.confirmed_at,jsonb_array_length(i.records) records,c.trade_name company,b.name branch
      FROM senior_bh_imports i JOIN companies c ON c.id=i.company_id JOIN branches b ON b.id=i.branch_id
      WHERE i.confirmed_at IS NOT NULL ${scope} ORDER BY i.confirmed_at DESC LIMIT 100`,params);res.json({rows});
  }catch(error){next(error);}
});
router.get('/options',requirePermission('dashboard.view'),requireOccurrencesAccess,async(req,res,next)=>{
  try{
    const params=[];const scope=filters(req,'e',params);
    const {rows:employees}=await pool.query(`SELECT e.id,e.full_name,e.registration,e.company_id,e.branch_id FROM employees e WHERE TRUE ${scope} ORDER BY e.full_name`,params);
    const companyParams=req.scope.isAdmin?[]:[req.scope.companyId];const branchParams=req.scope.isAdmin?[]:[req.scope.companyId,req.scope.branchIds];
    const [companies,branches]=await Promise.all([
      pool.query(`SELECT id,trade_name FROM companies WHERE TRUE ${req.scope.isAdmin?'':'AND id=$1'} ORDER BY trade_name`,companyParams),
      pool.query(`SELECT id,company_id,name FROM branches WHERE TRUE ${req.scope.isAdmin?'':'AND company_id=$1 AND id=ANY($2::uuid[])'} ORDER BY name`,branchParams)]);
    res.json({employees,companies:companies.rows,branches:branches.rows});
  }catch(error){next(error);}
});
router.get('/compare',requirePermission('dashboard.view'),requireOccurrencesAccess,async(req,res,next)=>{
  try{
    const mode=req.query.mode||'month',basis=req.query.basis||'closing';let a,b;
    try{a=periodRange(String(req.query.a||''),mode,basis);b=periodRange(String(req.query.b||''),mode,basis);}catch(e){throw fail(e.message);}
    if(a.label===b.label)throw fail('Selecione dois períodos diferentes.');
    const params=[a.start,a.end,b.start,b.end];let scope=filters(req,'p',params);
    if(req.query.employeeId){params.push(req.query.employeeId);scope+=` AND p.employee_id=$${params.length}::uuid`;}
    const bhParams=[a.start,a.end,b.start,b.end];const bhScope=filters(req,'i',bhParams);
    const [points,reports]=await Promise.all([
      pool.query(`SELECT p.*,to_char(p.work_date,'YYYY-MM-DD') work_date,e.full_name,e.registration
        FROM employee_point_days p JOIN employees e ON e.id=p.employee_id
        WHERE ((p.work_date BETWEEN $1::date AND $2::date) OR (p.work_date BETWEEN $3::date AND $4::date)) ${scope} ORDER BY p.work_date,e.full_name`,params),
      pool.query(`SELECT i.*,to_char(i.period_start,'YYYY-MM-DD') period_start,to_char(i.period_end,'YYYY-MM-DD') period_end
        FROM senior_bh_imports i WHERE i.confirmed_at IS NOT NULL AND ((i.period_start<=$2::date AND i.period_end>=$1::date) OR (i.period_start<=$4::date AND i.period_end>=$3::date)) ${bhScope}
        ORDER BY i.confirmed_at DESC,i.id DESC`,bhParams)]);
    if(req.query.employeeId){
      const ep=[];const es=filters(req,'e',ep);ep.push(req.query.employeeId);
      const {rows}=await pool.query(`SELECT e.registration,e.company_id,e.branch_id FROM employees e WHERE TRUE ${es} AND e.id=$${ep.length}::uuid`,ep);
      if(!rows.length)throw fail('Colaborador fora do escopo selecionado.',403);
      const employee=rows[0];
      for(const r of reports.rows)r.records=r.company_id===employee.company_id&&r.branch_id===employee.branch_id?r.records.filter(x=>registration(x.registration)===registration(employee.registration)):[];
    }
    // Drop empty records after an employee filter: no report coverage must not look like a zero balance.
    const available=reports.rows.filter(r=>r.records.length);
    const sa=compareSnapshot(a,points.rows,available),sb=compareSnapshot(b,points.rows,available);
    res.json({mode,basis,a:sa,b:sb,guidance:guidance(sa,sb),assistantMode:'RULES',note:'Orientações baseadas em regras verificáveis. Não há alteração de dados da Senior nem envio para IA externa.'});
  }catch(error){next(error);}
});
module.exports=router;
