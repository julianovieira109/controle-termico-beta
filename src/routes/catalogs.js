const express=require("express");
const pool=require("../db/pool");
const {authenticate,requireAdmin,applyScope}=require("../middleware/auth");
const audit=require("../db/audit");
const router=express.Router();
router.use(authenticate,applyScope);

const tables={shifts:"shifts",job_roles:"job_roles",departments:"departments"};

function normalizeSeniorShiftCodeLocal(value){
  const raw=String(value||"").trim();
  if(!raw)return "";
  if(/^\d+$/.test(raw))return String(Number(raw));
  return raw.toUpperCase();
}

const REPORT_POLICIES=new Set(["PENDING","BOTH","THERMAL_ONLY","MEAL_ONLY","NONE"]);

function normalizeRoleName(value){
  return String(value||"").replace(/\s+/g," ").trim().slice(0,120);
}

function normalizeWeeklyDaysOff(value,fallback=[]){
  if(!Array.isArray(value))return fallback;
  return [...new Set(value.map(Number).filter(day=>Number.isInteger(day)&&day>=0&&day<=6))];
}

function suggestedShiftDaysOff(name){
  const normalized=String(name||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/º/g,"")
    .replace(/\s+/g," ")
    .trim()
    .toUpperCase();

  if(/(^|\s)1\s*(TURNO)?\b|PRIMEIRO TURNO/.test(normalized))return [0];
  if(/(^|\s)2\s*(TURNO)?\b|SEGUNDO TURNO/.test(normalized))return [0];
  if(/(^|\s)3\s*(TURNO)?\b|TERCEIRO TURNO/.test(normalized))return [6];
  return [];
}

router.get("/job-report-policies",requireAdmin,async(req,res,next)=>{
  try{
    const {rows}=await pool.query(`
      SELECT jr.id,jr.company_id,jr.name,jr.active,jr.report_policy,
             COALESCE(c.trade_name,c.legal_name) company_name,
             (SELECT COUNT(*)::int FROM employees e WHERE e.job_role_id=jr.id AND UPPER(TRIM(e.status))='ATIVO') employee_count,
             COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'branch_id',p.branch_id,'branch_name',b.name,'report_policy',p.report_policy
             ) ORDER BY b.name)
             FROM job_role_branch_report_policies p JOIN branches b ON b.id=p.branch_id
             WHERE p.job_role_id=jr.id),'[]'::jsonb) branch_policies,
             COALESCE((SELECT jsonb_object_agg(x.branch_id,x.total) FROM (
               SELECT e.branch_id,COUNT(*)::int total FROM employees e
               WHERE e.job_role_id=jr.id AND UPPER(TRIM(e.status))='ATIVO' GROUP BY e.branch_id
             ) x),'{}'::jsonb) employee_counts_by_branch
      FROM job_roles jr
      JOIN companies c ON c.id=jr.company_id
      ORDER BY COALESCE(c.trade_name,c.legal_name),jr.name
    `);
    res.json(rows);
  }catch(error){next(error);}
});

router.put("/job-report-policies/:id/branches/:branchId",requireAdmin,async(req,res,next)=>{
  try{
    const policy=String(req.body?.reportPolicy||"").trim().toUpperCase();
    const role=await pool.query(`SELECT jr.id FROM job_roles jr JOIN branches b ON b.id=$2
      WHERE jr.id=$1 AND jr.company_id=b.company_id`,[req.params.id,req.params.branchId]);
    if(!role.rows[0])return res.status(400).json({error:"Cargo e filial precisam pertencer à mesma empresa."});
    if(!policy||policy==="INHERIT"){
      await pool.query("DELETE FROM job_role_branch_report_policies WHERE job_role_id=$1 AND branch_id=$2",[req.params.id,req.params.branchId]);
      await audit(req,"DELETE_BRANCH_REPORT_POLICY","job_roles",req.params.id,{branchId:req.params.branchId});
      return res.status(204).end();
    }
    if(!REPORT_POLICIES.has(policy))return res.status(400).json({error:"Regra de relatórios inválida."});
    const {rows}=await pool.query(`INSERT INTO job_role_branch_report_policies(job_role_id,branch_id,report_policy)
      VALUES($1,$2,$3) ON CONFLICT(job_role_id,branch_id) DO UPDATE SET report_policy=EXCLUDED.report_policy,updated_at=NOW()
      RETURNING *`,[req.params.id,req.params.branchId,policy]);
    await audit(req,"UPDATE_BRANCH_REPORT_POLICY","job_roles",req.params.id,{branchId:req.params.branchId,reportPolicy:policy});
    res.json(rows[0]);
  }catch(error){next(error);}
});

router.put("/job-report-policies/:id",requireAdmin,async(req,res,next)=>{
  try{
    const policy=String(req.body?.reportPolicy||"").trim().toUpperCase();
    if(!REPORT_POLICIES.has(policy)){
      return res.status(400).json({error:"Regra de relatórios inválida."});
    }
    const {rows}=await pool.query(
      "UPDATE job_roles SET report_policy=$1 WHERE id=$2 RETURNING *",
      [policy,req.params.id]
    );
    if(!rows[0])return res.status(404).json({error:"Cargo não encontrado."});
    await audit(req,"UPDATE_REPORT_POLICY","job_roles",req.params.id,{reportPolicy:policy});
    res.json(rows[0]);
  }catch(error){next(error);}
});

router.post("/job-roles",requireAdmin,async(req,res,next)=>{
  try{
    const companyId=String(req.body?.companyId||"").trim();
    const name=normalizeRoleName(req.body?.name);
    const policy=String(req.body?.reportPolicy||"PENDING").trim().toUpperCase();
    if(!companyId||!name)return res.status(400).json({error:"Empresa e nome do cargo são obrigatórios."});
    if(!REPORT_POLICIES.has(policy))return res.status(400).json({error:"Regra de relatórios inválida."});
    const {rows}=await pool.query(
      `INSERT INTO job_roles(company_id,name,report_policy,active)
       VALUES($1,$2,$3,TRUE) RETURNING *`,[companyId,name,policy]
    );
    await audit(req,"CREATE","job_roles",rows[0].id,{name,reportPolicy:policy});
    res.status(201).json(rows[0]);
  }catch(error){
    if(error.code==="23505")return res.status(409).json({error:"Já existe um cargo com esse nome para a empresa."});
    next(error);
  }
});

router.put("/job-roles/:id",requireAdmin,async(req,res,next)=>{
  try{
    const name=normalizeRoleName(req.body?.name);
    const policy=String(req.body?.reportPolicy||"PENDING").trim().toUpperCase();
    const active=req.body?.active!==false;
    if(!name)return res.status(400).json({error:"Informe o nome do cargo."});
    if(!REPORT_POLICIES.has(policy))return res.status(400).json({error:"Regra de relatórios inválida."});
    const {rows}=await pool.query(
      `UPDATE job_roles SET name=$1,report_policy=$2,active=$3 WHERE id=$4 RETURNING *`,
      [name,policy,active,req.params.id]
    );
    if(!rows[0])return res.status(404).json({error:"Cargo não encontrado."});
    await audit(req,"UPDATE","job_roles",req.params.id,{name,reportPolicy:policy,active});
    res.json(rows[0]);
  }catch(error){
    if(error.code==="23505")return res.status(409).json({error:"Já existe um cargo com esse nome para a empresa."});
    next(error);
  }
});

router.delete("/job-roles/:id",requireAdmin,async(req,res,next)=>{
  try{
    const linked=await pool.query("SELECT COUNT(*)::int total FROM employees WHERE job_role_id=$1",[req.params.id]);
    if(linked.rows[0].total>0){
      return res.status(409).json({error:`Este cargo possui ${linked.rows[0].total} colaborador(es) vinculado(s). Edite ou inative o cargo em vez de excluí-lo.`});
    }
    const {rows}=await pool.query("DELETE FROM job_roles WHERE id=$1 RETURNING id,name",[req.params.id]);
    if(!rows[0])return res.status(404).json({error:"Cargo não encontrado."});
    await audit(req,"DELETE","job_roles",req.params.id,{name:rows[0].name});
    res.status(204).end();
  }catch(error){next(error);}
});


router.get("/:type",async(req,res,next)=>{
  try{
    const table=tables[req.params.type];
    if(!table)return res.status(404).json({error:"Cadastro não encontrado."});
    const {rows}=req.scope.isAdmin
      ? await pool.query(`SELECT * FROM ${table} ORDER BY name`)
      : await pool.query(`SELECT * FROM ${table} WHERE company_id=$1 ORDER BY name`,[req.scope.companyId]);
    res.json(rows);
  }catch(e){next(e);}
});


router.post("/shifts",requireAdmin,async(req,res,next)=>{
  try{
    const {companyId,name,description,seniorCode,weeklyDaysOff,active=true}=req.body||{};
    if(!companyId||!String(name||"").trim()){
      return res.status(400).json({error:"Empresa e nome do turno são obrigatórios."});
    }

    const company=await pool.query(
      "SELECT id FROM companies WHERE id=$1 AND active=TRUE LIMIT 1",
      [companyId]
    );
    if(!company.rows[0]){
      return res.status(400).json({error:"Empresa inválida ou inativa."});
    }

    const normalizedSeniorCode=String(seniorCode||"").trim()||null;
    const normalizedDays=normalizeWeeklyDaysOff(weeklyDaysOff,suggestedShiftDaysOff(name));
    if(normalizedSeniorCode){
      const duplicateCode=await pool.query(
        "SELECT id,name FROM shifts WHERE company_id=$1 AND senior_code=$2 LIMIT 1",
        [companyId,normalizedSeniorCode]
      );
      if(duplicateCode.rows[0]){
        return res.status(409).json({
          error:`O código Senior ${normalizedSeniorCode} já está vinculado ao turno ${duplicateCode.rows[0].name}.`
        });
      }
    }

    const {rows}=await pool.query(`
      INSERT INTO shifts(company_id,name,description,senior_code,weekly_days_off,active)
      VALUES($1,$2,$3,$4,$5,$6)
      RETURNING *
    `,[companyId,String(name).trim(),description||null,normalizedSeniorCode,normalizedDays,Boolean(active)]);

    await audit(req,"CREATE","shifts",rows[0].id,{name:rows[0].name,weeklyDaysOff:normalizedDays});
    res.status(201).json(rows[0]);
  }catch(error){
    if(error.code==="23505"){
      return res.status(409).json({error:"Já existe um turno com esse nome para a empresa."});
    }
    next(error);
  }
});

router.patch("/shifts/:id/weekly-days-off",requireAdmin,async(req,res,next)=>{
  try{
    if(!Array.isArray(req.body?.weeklyDaysOff)){
      return res.status(400).json({error:"Informe os dias de folga do turno."});
    }
    const normalizedDays=normalizeWeeklyDaysOff(req.body.weeklyDaysOff,[]);
    const {rows}=await pool.query(
      "UPDATE shifts SET weekly_days_off=$1 WHERE id=$2 RETURNING *",
      [normalizedDays,req.params.id]
    );
    if(!rows[0])return res.status(404).json({error:"Turno não encontrado."});
    await audit(req,"UPDATE_WEEKLY_DAYS_OFF","shifts",req.params.id,{weeklyDaysOff:normalizedDays});
    res.json(rows[0]);
  }catch(error){next(error);}
});

router.put("/shifts/:id",requireAdmin,async(req,res,next)=>{
  try{
    const {companyId,name,description,seniorCode,weeklyDaysOff,active=true}=req.body||{};
    if(!companyId||!String(name||"").trim()){
      return res.status(400).json({error:"Empresa e nome do turno são obrigatórios."});
    }

    const normalizedSeniorCode=String(seniorCode||"").trim()||null;
    const normalizedDays=Array.isArray(weeklyDaysOff)?normalizeWeeklyDaysOff(weeklyDaysOff):null;
    if(normalizedSeniorCode){
      const duplicateCode=await pool.query(
        "SELECT id,name FROM shifts WHERE company_id=$1 AND senior_code=$2 AND id<>$3 LIMIT 1",
        [companyId,normalizedSeniorCode,req.params.id]
      );
      if(duplicateCode.rows[0]){
        return res.status(409).json({
          error:`O código Senior ${normalizedSeniorCode} já está vinculado ao turno ${duplicateCode.rows[0].name}.`
        });
      }
    }

    const {rows}=await pool.query(`
      UPDATE shifts
      SET company_id=$1,name=$2,description=$3,senior_code=$4,
          weekly_days_off=COALESCE($5,weekly_days_off),active=$6
      WHERE id=$7
      RETURNING *
    `,[companyId,String(name).trim(),description||null,normalizedSeniorCode,normalizedDays,Boolean(active),req.params.id]);

    if(!rows[0])return res.status(404).json({error:"Turno não encontrado."});

    await audit(req,"UPDATE","shifts",req.params.id,{name:rows[0].name,weeklyDaysOff:rows[0].weekly_days_off});
    res.json(rows[0]);
  }catch(error){
    if(error.code==="23505"){
      return res.status(409).json({error:"Já existe um turno com esse nome para a empresa."});
    }
    next(error);
  }
});


router.post("/shifts/map-code",requireAdmin,async(req,res,next)=>{
  try{
    const {companyId,shiftId,seniorCode}=req.body||{};
    const code=normalizeSeniorShiftCodeLocal(seniorCode);

    if(!companyId||!shiftId||!code){
      return res.status(400).json({error:"Empresa, turno e código Senior são obrigatórios."});
    }

    const duplicate=await pool.query(
      "SELECT id,name FROM shifts WHERE company_id=$1 AND senior_code=$2 AND id<>$3 LIMIT 1",
      [companyId,code,shiftId]
    );
    if(duplicate.rows[0]){
      return res.status(409).json({
        error:`O código Senior ${code} já está vinculado ao turno ${duplicate.rows[0].name}.`
      });
    }

    const {rows}=await pool.query(
      `UPDATE shifts SET senior_code=$1 WHERE id=$2 AND company_id=$3 RETURNING *`,
      [code,shiftId,companyId]
    );
    if(!rows[0])return res.status(404).json({error:"Turno não encontrado."});

    await audit(req,"MAP_SENIOR_CODE","shifts",shiftId,{seniorCode:code});
    res.json(rows[0]);
  }catch(error){next(error);}
});

router.delete("/shifts/:id",requireAdmin,async(req,res,next)=>{
  try{
    const linked=await pool.query(
      "SELECT COUNT(*)::int total FROM employees WHERE shift_id=$1",
      [req.params.id]
    );

    if(linked.rows[0].total>0){
      return res.status(409).json({
        error:`Não é possível excluir este turno porque ${linked.rows[0].total} colaborador(es) estão vinculados.`
      });
    }

    const {rows}=await pool.query(
      "DELETE FROM shifts WHERE id=$1 RETURNING id,name",
      [req.params.id]
    );

    if(!rows[0])return res.status(404).json({error:"Turno não encontrado."});

    await audit(req,"DELETE","shifts",req.params.id,{name:rows[0].name});
    res.status(204).end();
  }catch(error){next(error);}
});


module.exports=router;
