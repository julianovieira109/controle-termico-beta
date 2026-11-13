const express=require("express");
const jwt=require("jsonwebtoken");
const rateLimit=require("express-rate-limit");
const pool=require("../db/pool");
const {authenticate,applyScope,requirePermission}=require("../middleware/auth");
const {normalizeProposal,employeeVersion,validateEmploymentDate}=require("../services/employee-status-rules");
const router=express.Router();
router.use(authenticate,applyScope,requirePermission("employees.view"),requirePermission("employees.manage"));
router.use(rateLimit({windowMs:60000,limit:30,message:{error:"Aguarde um minuto antes de enviar novos pedidos."}}));
function scope(req,params){
  if(req.scope.isAdmin)return "TRUE";
  params.push(req.scope.companyId,req.scope.branchIds);
  return `e.company_id=$${params.length-1} AND e.branch_id=ANY($${params.length}::uuid[])`;
}
function summary(e){
  return {id:e.id,name:e.full_name,registration:e.registration,company:e.company_name,branch:e.branch_name,
    status:e.status,terminationDate:e.termination_date?new Date(e.termination_date).toISOString().slice(0,10):null};
}
const selection=`SELECT e.*,c.trade_name company_name,b.name branch_name FROM employees e
  JOIN companies c ON c.id=e.company_id JOIN branches b ON b.id=e.branch_id`;

router.post("/prepare",async(req,res,next)=>{
  let proposal;
  try{proposal=normalizeProposal(req.body);}catch(error){return res.status(400).json({error:error.message});}
  try{
    const params=[];
    const allowed=scope(req,params);
    let filter;
    if(req.body.employeeId){
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.body.employeeId))return res.status(400).json({error:"Colaborador inválido."});
      params.push(req.body.employeeId);filter=`e.id=$${params.length}`;
    }else{
      params.push(proposal.search);const position=params.length;
      // strpos trata a pesquisa como texto literal, sem curingas de LIKE.
      filter=`(strpos(lower(e.full_name),lower($${position}))>0 OR e.registration=$${position}
        OR ($${position} ~ '^[0-9]+$' AND LTRIM(e.registration,'0')=LTRIM($${position},'0')))`;
    }
    const {rows}=await pool.query(`${selection} WHERE ${allowed} AND ${filter} ORDER BY e.full_name,e.registration LIMIT 21`,params);
    if(!rows.length)return res.status(404).json({error:"Nenhum colaborador encontrado nas empresas e filiais do seu acesso."});
    if(rows.length>1)return res.json({candidates:rows.slice(0,20).map(summary),more:rows.length>20});
    const employee=rows[0];
    try{validateEmploymentDate(employee,proposal);}catch(error){return res.status(400).json({error:error.message});}
    const before=summary(employee);
    if(before.status===proposal.status&&before.terminationDate===proposal.terminationDate)return res.json({unchanged:true,employee:before});
    const plan=jwt.sign({purpose:"employee-assistant",actor:req.user.sub,employeeId:employee.id,
      version:employeeVersion(employee),proposal},process.env.JWT_SECRET,{expiresIn:"5m",audience:"employee-assistant"});
    res.json({plan,employee:before,after:{status:proposal.status,terminationDate:proposal.terminationDate}});
  }catch(error){next(error);}
});

router.post("/confirm",async(req,res,next)=>{
  let plan;
  try{
    plan=jwt.verify(req.body.plan,process.env.JWT_SECRET,{audience:"employee-assistant",algorithms:["HS256"]});
    if(plan.purpose!=="employee-assistant"||plan.actor!==req.user.sub)throw new Error("Invalid plan");
    plan.proposal=normalizeProposal(plan.proposal);
  }catch{return res.status(409).json({error:"A conferência expirou ou é inválida. Confira o pedido novamente."});}
  let client;
  try{
    client=await pool.connect();await client.query("BEGIN");
    const params=[plan.employeeId];const allowed=scope(req,params);
    const {rows}=await client.query(`${selection} WHERE e.id=$1 AND ${allowed} FOR UPDATE OF e`,params);
    if(!rows[0]){
      await client.query("ROLLBACK");return res.status(404).json({error:"Colaborador indisponível no seu acesso."});
    }
    const before=rows[0];
    if(employeeVersion(before)!==plan.version){
      await client.query("ROLLBACK");return res.status(409).json({error:"O cadastro foi alterado desde a conferência. Confira novamente antes de salvar."});
    }
    validateEmploymentDate(before,plan.proposal);
    const updated=await client.query(`UPDATE employees SET status=$1,termination_date=$2,updated_at=NOW()
      WHERE id=$3 RETURNING *`,[plan.proposal.status,plan.proposal.terminationDate,before.id]);
    const changes={};
    const previous=summary(before);
    if(previous.status!==plan.proposal.status)changes.status={label:"Situação",from:previous.status,to:plan.proposal.status};
    if(previous.terminationDate!==plan.proposal.terminationDate)changes.termination_date={label:"Data de demissão",from:previous.terminationDate,to:plan.proposal.terminationDate};
    // A alteração e sua auditoria são confirmadas juntas.
    await client.query(`INSERT INTO audit_logs(user_id,action,entity,entity_id,details,ip_address)
      VALUES($1,'UPDATE','employees',$2,$3,$4)`,[req.user.sub,before.id,JSON.stringify({source:"ASSISTANT",changes,changedFields:Object.keys(changes)}),req.ip||null]);
    await client.query("COMMIT");
    res.json({employee:summary({...before,...updated.rows[0]})});
  }catch(error){if(client)await client.query("ROLLBACK");next(error);}
  finally{client?.release();}
});
module.exports=router;
