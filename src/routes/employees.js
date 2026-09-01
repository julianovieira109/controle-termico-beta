const express=require("express");
const pool=require("../db/pool");
const audit=require("../db/audit");
const {authenticate,applyScope,requirePermission}=require("../middleware/auth");
const router=express.Router();
const REPORT_POLICIES=new Set(["PENDING","BOTH","THERMAL_ONLY","MEAL_ONLY","NONE"]);

function normalizeReportOverride(value){
  const policy=String(value||"").trim().toUpperCase();
  if(!policy)return null;
  if(!REPORT_POLICIES.has(policy))return undefined;
  return policy;
}

function historyValue(value){
  return value===undefined||value===null||value===""?null:value;
}

function employeeChangeDetails(before,after){
  const fields=[
    ["company_id","Empresa"],
    ["branch_id","Filial"],
    ["full_name","Nome"],
    ["registration","Matrícula"],
    ["admission_date","Admissão"],
    ["shift_id","Turno"],
    ["job_role_id","Cargo"],
    ["status","Situação"],
    ["report_policy_override","Exceção de relatórios"],
    ["use_shift_days_off","Regra da folga semanal"],
    ["weekly_days_off","Dias de folga"]
  ];
  const changes={};
  for(const [key,label] of fields){
    const oldValue=historyValue(before?.[key]);
    const newValue=historyValue(after?.[key]);
    if(JSON.stringify(oldValue)!==JSON.stringify(newValue)){
      changes[key]={label,from:oldValue,to:newValue};
    }
  }
  return changes;
}


const BLOCKED_EMPLOYEE_ROLES=new Set([
  "APRENDIZ DE AUXILIAR DE ADMINISTRACAO",
  "LIDER DE ESTOQUE",
  "AUXILIAR DE SERVICOS GERAIS",
  "CONTROLE DE QUALIDADE",
  "SERVICOS GERAIS",
  "ZELADOR"
]);

function normalizeBlockedRole(value){
  return String(value||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ")
    .trim()
    .toUpperCase();
}

function isBlockedEmployeeRole(value){
  return BLOCKED_EMPLOYEE_ROLES.has(normalizeBlockedRole(value));
}

router.use(authenticate,applyScope,requirePermission("employees.view"));
router.use((req,res,next)=>{
  if(req.method==="GET")return next();
  return requirePermission("employees.manage")(req,res,next);
});

router.get("/scope-options",async(req,res,next)=>{
  try{
    if(req.scope.isAdmin){
      const [companyRows,branchRows]=await Promise.all([
        pool.query(`
          SELECT id,trade_name,legal_name,active
          FROM companies
          WHERE active=TRUE
          ORDER BY trade_name
        `),
        pool.query(`
          SELECT id,company_id,name,active
          FROM branches
          WHERE active=TRUE
          ORDER BY name
        `)
      ]);

      return res.json({
        companies:companyRows.rows,
        branches:branchRows.rows
      });
    }

    const [companyRows,branchRows]=await Promise.all([
      pool.query(`
        SELECT id,trade_name,legal_name,active
        FROM companies
        WHERE id=$1 AND active=TRUE
        ORDER BY trade_name
      `,[req.scope.companyId]),
      pool.query(`
        SELECT id,company_id,name,active
        FROM branches
        WHERE company_id=$1
          AND id=ANY($2::uuid[])
          AND active=TRUE
        ORDER BY name
      `,[req.scope.companyId,req.scope.branchIds])
    ]);

    res.json({
      companies:companyRows.rows,
      branches:branchRows.rows
    });
  }catch(e){next(e);}
});

function scopeWhere(req,params){
  if(req.scope.isAdmin)return "";
  params.push(req.scope.companyId,req.scope.branchIds);
  return ` AND e.company_id=$${params.length-1} AND e.branch_id=ANY($${params.length}::uuid[])`;
}

router.get("/status-summary",async(req,res,next)=>{
  try{
    const params=[];
    let where="WHERE 1=1"+scopeWhere(req,params);
    if(req.query.companyId){
      params.push(String(req.query.companyId));
      where+=` AND e.company_id=$${params.length}`;
    }
    if(req.query.branchId){
      params.push(String(req.query.branchId));
      where+=` AND e.branch_id=$${params.length}`;
    }
    const {rows}=await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE UPPER(TRIM(e.status))='ATIVO')::int active,
        COUNT(*) FILTER (WHERE UPPER(TRIM(e.status))='DEMITIDO')::int dismissed,
        COUNT(*) FILTER (WHERE UPPER(TRIM(e.status)) IN ('INATIVO','AFASTADO'))::int inactive,
        COUNT(*)::int total
      FROM employees e
      ${where}
    `,params);
    res.json(rows[0]||{active:0,dismissed:0,inactive:0,total:0});
  }catch(e){next(e);}
});

router.get("/",async(req,res,next)=>{
  try{
    const params=[];
    let where="WHERE 1=1"+scopeWhere(req,params);
    const statusView=String(req.query.status||"ATIVO").trim().toUpperCase();
    if(statusView==="ATIVO")where+=" AND UPPER(TRIM(e.status))='ATIVO'";
    else if(statusView==="DEMITIDO")where+=" AND UPPER(TRIM(e.status))='DEMITIDO'";
    else if(statusView==="INACTIVE_GROUP")where+=" AND UPPER(TRIM(e.status)) IN ('INATIVO','AFASTADO')";
    else if(statusView!=="ALL")return res.status(400).json({error:"Filtro de situação inválido."});

    const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||""));
    if(req.query.terminationFrom){
      if(!validDate(req.query.terminationFrom))return res.status(400).json({error:"Data inicial inválida."});
      params.push(req.query.terminationFrom);
      where+=` AND e.termination_date >= $${params.length}::date`;
    }
    if(req.query.terminationTo){
      if(!validDate(req.query.terminationTo))return res.status(400).json({error:"Data final inválida."});
      params.push(req.query.terminationTo);
      where+=` AND e.termination_date <= $${params.length}::date`;
    }
    if(req.query.search){
      params.push(`%${req.query.search}%`);
      where+=` AND (e.full_name ILIKE $${params.length} OR e.registration ILIKE $${params.length})`;
    }
    if(req.query.historyMode==="master"){
      where+=" AND NULLIF(TRIM(e.full_name),'') IS NOT NULL AND TRIM(e.full_name)<>'-'";
    }
    if(req.query.missingShift==="true"){
      where+=" AND e.shift_id IS NULL";
    }
    const {rows}=await pool.query(`
      SELECT e.*,c.trade_name company_name,b.name branch_name,s.name shift_name,j.name job_role_name,d.name department_name
      FROM employees e JOIN companies c ON c.id=e.company_id JOIN branches b ON b.id=e.branch_id
      LEFT JOIN shifts s ON s.id=e.shift_id LEFT JOIN job_roles j ON j.id=e.job_role_id LEFT JOIN departments d ON d.id=e.department_id
      ${where}
      ORDER BY
        CASE WHEN UPPER(TRIM(e.status))='DEMITIDO' THEN e.termination_date END DESC NULLS LAST,
        e.full_name
    `,params);
    res.json(rows);
  }catch(e){next(e);}
});

router.get("/:id/history",async(req,res,next)=>{
  try{
    if(req.user?.role!=="ADMIN"||req.user?.isMasterAdmin!==true){
      return res.status(403).json({error:"Histórico de colaboradores disponível somente para o Administrador Master."});
    }
    const employeeResult=await pool.query(`
      SELECT e.id,e.full_name,e.registration,e.company_id,e.branch_id,
             c.trade_name company_name,b.name branch_name
      FROM employees e
      JOIN companies c ON c.id=e.company_id
      JOIN branches b ON b.id=e.branch_id
      WHERE e.id=$1
      LIMIT 1
    `,[req.params.id]);
    const employee=employeeResult.rows[0];
    if(!employee)return res.status(404).json({error:"Colaborador não encontrado."});

    if(!req.scope.isAdmin){
      const allowedBranchIds=(req.scope.branchIds||[]).map(String);
      if(String(employee.company_id)!==String(req.scope.companyId)||!allowedBranchIds.includes(String(employee.branch_id))){
        return res.status(403).json({error:"Colaborador fora do seu acesso."});
      }
    }

    const {rows}=await pool.query(`
      SELECT a.id,a.action,a.details,a.created_at,
             COALESCE(u.name,u.email,'Sistema') actor_name
      FROM audit_logs a
      LEFT JOIN users u ON u.id=a.user_id
      WHERE a.entity='employees' AND a.entity_id=$1
      ORDER BY a.created_at DESC
      LIMIT 200
    `,[req.params.id]);

    res.json({
      employee:{
        id:employee.id,
        fullName:employee.full_name,
        registration:employee.registration,
        companyName:employee.company_name,
        branchName:employee.branch_name
      },
      history:rows
    });
  }catch(e){next(e);}
});

router.get("/:id",async(req,res,next)=>{
  try{
    const {rows}=await pool.query(`
      SELECT e.*,c.trade_name company_name,b.name branch_name,
             s.name shift_name,s.active shift_active,
             j.name job_role_name,j.active job_role_active
      FROM employees e
      JOIN companies c ON c.id=e.company_id
      JOIN branches b ON b.id=e.branch_id
      LEFT JOIN shifts s ON s.id=e.shift_id
      LEFT JOIN job_roles j ON j.id=e.job_role_id
      WHERE e.id=$1
      LIMIT 1
    `,[req.params.id]);

    const employee=rows[0];
    if(!employee)return res.status(404).json({error:"Colaborador não encontrado."});

    if(!req.scope.isAdmin){
      const allowedBranchIds=(req.scope.branchIds||[]).map(String);
      if(String(employee.company_id)!==String(req.scope.companyId)||!allowedBranchIds.includes(String(employee.branch_id))){
        return res.status(403).json({error:"Colaborador fora do seu acesso."});
      }
    }

    res.json(employee);
  }catch(e){next(e);}
});

router.post("/",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    let {
      companyId,branchId,fullName,registration,admissionDate,
      shiftId,jobRoleId,reportPolicyOverride,status="ATIVO",weeklyDaysOff=[],useShiftDaysOff=true
    }=req.body;

    fullName=String(fullName||"").trim();
    registration=String(registration||"").trim();
    reportPolicyOverride=normalizeReportOverride(reportPolicyOverride);
    if(reportPolicyOverride===undefined)return res.status(400).json({error:"Exceção de relatórios inválida."});

    if(!req.scope.isAdmin){
      companyId=req.scope.companyId;
      if(!req.scope.branchIds.includes(branchId)){
        return res.status(403).json({error:"Filial não autorizada."});
      }
    }

    if(!companyId||!branchId||!fullName){
      return res.status(400).json({error:"Empresa, filial e nome são obrigatórios."});
    }

    if(fullName.length>180){
      return res.status(400).json({error:"O nome do colaborador ultrapassa 180 caracteres."});
    }
    if(registration.length>50){
      return res.status(400).json({error:"A matrícula ultrapassa 50 caracteres."});
    }

    if(registration){
      const duplicate=await client.query(`
        SELECT e.id,e.full_name,c.trade_name company_name,b.name branch_name
        FROM employees e
        LEFT JOIN companies c ON c.id=e.company_id
        LEFT JOIN branches b ON b.id=e.branch_id
        WHERE e.registration=$1
        LIMIT 1
      `,[registration]);
      if(duplicate.rows[0]){
        return res.status(409).json({
          error:`A matrícula ${registration} já está cadastrada para ${duplicate.rows[0].full_name} em ${duplicate.rows[0].company_name||"empresa não identificada"} / ${duplicate.rows[0].branch_name||"filial não identificada"}.`
        });
      }
    }

    const branch=await client.query(
      "SELECT id FROM branches WHERE id=$1 AND company_id=$2 AND active=TRUE LIMIT 1",
      [branchId,companyId]
    );
    if(!branch.rows[0]){
      return res.status(400).json({error:"A filial selecionada não pertence à empresa escolhida."});
    }

    let jobTitle="";
    let selectedShiftDays=[];
    if(jobRoleId){
      const role=await client.query(
        "SELECT id,name FROM job_roles WHERE id=$1 AND company_id=$2 AND active=TRUE LIMIT 1",
        [jobRoleId,companyId]
      );
      if(!role.rows[0]){
        return res.status(400).json({error:"O cargo selecionado não pertence à empresa escolhida."});
      }
      jobTitle=String(role.rows[0].name||"").trim().slice(0,120);
      if(isBlockedEmployeeRole(jobTitle)){
        return res.status(400).json({
          error:`O cargo "${jobTitle}" está bloqueado para cadastro de colaboradores.`
        });
      }
    }

    if(shiftId){
      const shift=await client.query(
        "SELECT id,weekly_days_off,active FROM shifts WHERE id=$1 AND company_id=$2 AND active=TRUE LIMIT 1",
        [shiftId,companyId]
      );
      if(!shift.rows[0]){
        return res.status(400).json({error:"O turno selecionado não pertence à empresa escolhida."});
      }
      selectedShiftDays=Array.isArray(shift.rows[0].weekly_days_off)
        ? shift.rows[0].weekly_days_off.map(Number).filter(day=>Number.isInteger(day)&&day>=0&&day<=6)
        : [];
    }

    const normalizedDays=useShiftDaysOff!==false
      ? [...new Set(selectedShiftDays)]
      : Array.isArray(weeklyDaysOff)
        ? [...new Set(weeklyDaysOff.map(Number).filter(day=>Number.isInteger(day)&&day>=0&&day<=6))]
        : [];

    await client.query("BEGIN");

    const {rows}=await client.query(`
      INSERT INTO employees(
        company_id,branch_id,full_name,registration,admission_date,
        shift_id,job_role_id,job_title,report_policy_override,status,weekly_days_off,use_shift_days_off,
        source,last_imported_at
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'MANUAL',NULL)
      RETURNING *
    `,[
      companyId,branchId,fullName,registration||null,admissionDate||null,
      shiftId||null,jobRoleId||null,jobTitle,reportPolicyOverride,status,normalizedDays,useShiftDaysOff!==false
    ]);

    await client.query("COMMIT");
    await audit(req,"CREATE","employees",rows[0].id,{source:"MANUAL"});
    res.status(201).json(rows[0]);
  }catch(e){
    await client.query("ROLLBACK").catch(()=>{});

    if(e.code==="23505"){
      return res.status(409).json({error:"Já existe um colaborador com essa matrícula."});
    }
    if(e.code==="23503"){
      return res.status(409).json({error:"Empresa, filial, turno ou cargo possui um vínculo inválido."});
    }
    if(e.code==="23502"){
      return res.status(400).json({
        error:`Não foi possível cadastrar porque o campo ${e.column||"obrigatório"} está vazio no banco.`
      });
    }
    if(e.code==="22001"){
      return res.status(400).json({
        error:"Um dos campos ultrapassou o tamanho permitido.",
        detail:e.message
      });
    }

    console.error("[EMPLOYEE_CREATE]",{
      message:e.message,
      code:e.code,
      detail:e.detail,
      column:e.column,
      constraint:e.constraint
    });
    next(e);
  }finally{
    client.release();
  }
});



router.put("/:id",async(req,res,next)=>{
  try{
    let {
      companyId,branchId,fullName,registration,admissionDate,
      shiftId,jobRoleId,reportPolicyOverride,status="ATIVO",weeklyDaysOff=[],useShiftDaysOff=true
    }=req.body;
    reportPolicyOverride=normalizeReportOverride(reportPolicyOverride);
    if(reportPolicyOverride===undefined)return res.status(400).json({error:"Exceção de relatórios inválida."});

    if(!companyId||!branchId||!fullName){
      return res.status(400).json({error:"Empresa, filial e nome são obrigatórios."});
    }

    if(!req.scope.isAdmin){
      companyId=req.scope.companyId;
      if(!req.scope.branchIds.includes(branchId)){
        return res.status(403).json({error:"Filial fora do seu acesso."});
      }
    }

    fullName=String(fullName||"").trim();
    registration=String(registration||"").trim();

    if(fullName.length>180){
      return res.status(400).json({error:"O nome do colaborador ultrapassa 180 caracteres."});
    }
    if(registration.length>50){
      return res.status(400).json({error:"A matrícula ultrapassa 50 caracteres."});
    }

    const current=await pool.query(
      `SELECT id,company_id,branch_id,full_name,registration,admission_date,
              job_role_id,shift_id,report_policy_override,status,
              use_shift_days_off,weekly_days_off
       FROM employees WHERE id=$1 LIMIT 1`,
      [req.params.id]
    );
    if(!current.rows[0]){
      return res.status(404).json({error:"Colaborador não encontrado."});
    }

    if(!req.scope.isAdmin){
      const allowedBranchIds=(req.scope.branchIds||[]).map(String);
      if(String(current.rows[0].company_id)!==String(req.scope.companyId)||!allowedBranchIds.includes(String(current.rows[0].branch_id))){
        return res.status(403).json({error:"Colaborador fora do seu acesso."});
      }
    }

    let jobTitle="";
    let selectedShiftDays=[];
    if(jobRoleId){
      const role=await pool.query(
        "SELECT id,name,active FROM job_roles WHERE id=$1 AND company_id=$2 LIMIT 1",
        [jobRoleId,companyId]
      );
      if(!role.rows[0]){
        return res.status(400).json({error:"O cargo selecionado não pertence à empresa escolhida."});
      }
      const keepsCurrentRole=String(current.rows[0].job_role_id||"")===String(jobRoleId||"");
      if(role.rows[0].active===false&&!keepsCurrentRole){
        return res.status(400).json({error:"O cargo selecionado está inativo. Escolha um cargo ativo."});
      }
      jobTitle=String(role.rows[0].name||"").trim().slice(0,120);
      if(isBlockedEmployeeRole(jobTitle)&&!keepsCurrentRole){
        return res.status(400).json({
          error:`O cargo "${jobTitle}" está bloqueado para novos vínculos de colaboradores.`
        });
      }
    }

    if(shiftId){
      const shift=await pool.query(
        "SELECT id,active,weekly_days_off FROM shifts WHERE id=$1 AND company_id=$2 LIMIT 1",
        [shiftId,companyId]
      );
      if(!shift.rows[0]){
        return res.status(400).json({error:"O turno selecionado não pertence à empresa escolhida."});
      }
      const keepsCurrentShift=String(current.rows[0].shift_id||"")===String(shiftId||"");
      if(shift.rows[0].active===false&&!keepsCurrentShift){
        return res.status(400).json({error:"O turno selecionado está inativo. Escolha um turno ativo."});
      }
      // Turno inativo mantido apenas para compatibilidade de cadastro antigo:
      // ele não pode fornecer folga automática.
      selectedShiftDays=shift.rows[0].active===true && Array.isArray(shift.rows[0].weekly_days_off)
        ? shift.rows[0].weekly_days_off.map(Number).filter(day=>Number.isInteger(day)&&day>=0&&day<=6)
        : [];
    }

    if(registration){
      const duplicate=await pool.query(`
        SELECT e.id,e.full_name,c.trade_name company_name,b.name branch_name
        FROM employees e
        LEFT JOIN companies c ON c.id=e.company_id
        LEFT JOIN branches b ON b.id=e.branch_id
        WHERE e.registration=$1 AND e.id<>$2
        LIMIT 1
      `,[registration,req.params.id]);
      if(duplicate.rows[0]){
        return res.status(409).json({
          error:`A matrícula ${registration} já está cadastrada para ${duplicate.rows[0].full_name} em ${duplicate.rows[0].company_name||"empresa não identificada"} / ${duplicate.rows[0].branch_name||"filial não identificada"}.`
        });
      }
    }

    const branch=await pool.query(
      "SELECT id FROM branches WHERE id=$1 AND company_id=$2 AND active=TRUE LIMIT 1",
      [branchId,companyId]
    );
    if(!branch.rows[0]){
      return res.status(400).json({error:"A filial selecionada não pertence à empresa escolhida."});
    }

    const normalizedDays=useShiftDaysOff!==false
      ? [...new Set(selectedShiftDays)]
      : Array.isArray(weeklyDaysOff)
        ? [...new Set(weeklyDaysOff.map(Number).filter(day=>Number.isInteger(day)&&day>=0&&day<=6))]
        : [];

    const {rows}=await pool.query(`
      UPDATE employees
      SET company_id=$1,
          branch_id=$2,
          full_name=$3,
          registration=$4,
          admission_date=$5,
          shift_id=$6,
          job_role_id=$7,
          job_title=$8,
          report_policy_override=$9,
          status=$10,
          weekly_days_off=$11,
          use_shift_days_off=$12,
          source=COALESCE(source,'MANUAL'),
          updated_at=NOW()
      WHERE id=$13
      RETURNING *
    `,[
      companyId,branchId,fullName,registration||null,
      admissionDate||null,shiftId||null,jobRoleId||null,
      jobTitle,reportPolicyOverride,status,normalizedDays,useShiftDaysOff!==false,req.params.id
    ]);

    const changes=employeeChangeDetails(current.rows[0],rows[0]);
    await audit(req,"UPDATE","employees",req.params.id,{
      source:"MANUAL",
      changes,
      changedFields:Object.keys(changes)
    });
    res.json(rows[0]);
  }catch(e){
    if(e.code==="23505"){
      return res.status(409).json({error:"Já existe um colaborador com essa matrícula."});
    }
    next(e);
  }
});

router.delete("/:id",async(req,res,next)=>{
  try{
    const {rows}=await pool.query(`
      SELECT e.id,e.full_name,e.company_id,e.branch_id,
             EXISTS(SELECT 1 FROM employee_days_off d WHERE d.employee_id=e.id) has_days_off
      FROM employees e
      WHERE e.id=$1
    `,[req.params.id]);

    if(!rows[0]){
      return res.status(404).json({error:"Colaborador não encontrado."});
    }

    if(!req.scope.isAdmin){
      if(rows[0].company_id!==req.scope.companyId||!req.scope.branchIds.includes(rows[0].branch_id)){
        return res.status(403).json({error:"Colaborador fora do seu acesso."});
      }
    }

    await pool.query("DELETE FROM employees WHERE id=$1",[req.params.id]);
    await audit(req,"DELETE","employees",req.params.id,{name:rows[0].full_name});
    res.status(204).end();
  }catch(e){
    if(e.code==="23503"){
      return res.status(409).json({
        error:"Não foi possível excluir este colaborador porque existem registros vinculados. Altere a situação para inativo ou demitido."
      });
    }
    next(e);
  }
});


router.post("/bulk-delete",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const ids=Array.isArray(req.body?.ids)
      ? [...new Set(req.body.ids.map(String).filter(Boolean))]
      : [];

    if(!ids.length){
      return res.status(400).json({error:"Nenhum colaborador foi selecionado."});
    }

    if(ids.length>1000){
      return res.status(400).json({error:"Selecione no máximo 1000 colaboradores por operação."});
    }

    const {rows}=await client.query(`
      SELECT e.id,e.full_name,e.registration,e.company_id,e.branch_id,
             c.trade_name company_name,b.name branch_name,
             (
               SELECT COUNT(*)::int
               FROM employee_days_off edo
               WHERE edo.employee_id=e.id
             ) history_count
      FROM employees e
      LEFT JOIN companies c ON c.id=e.company_id
      LEFT JOIN branches b ON b.id=e.branch_id
      WHERE e.id = ANY($1::uuid[])
    `,[ids]);

    const allowedRows=req.scope.isAdmin
      ? rows
      : rows.filter(row=>
          String(row.company_id)===String(req.scope.companyId) &&
          req.scope.branchIds.includes(String(row.branch_id))
        );

    if(allowedRows.length!==rows.length){
      return res.status(403).json({error:"Há colaborador(es) fora das filiais autorizadas."});
    }

    const blocked=allowedRows
      .filter(row=>Number(row.history_count||0)>0)
      .map(row=>({
        id:row.id,
        name:row.full_name,
        registration:row.registration,
        company:row.company_name,
        branch:row.branch_name,
        historyCount:Number(row.history_count||0)
      }));

    if(blocked.length){
      return res.status(409).json({
        error:"A exclusão em lote foi bloqueada porque existem colaboradores com histórico vinculado.",
        blocked
      });
    }

    await client.query("BEGIN");

    const deleteIds=allowedRows.map(row=>row.id);
    await client.query(
      "DELETE FROM employees WHERE id = ANY($1::uuid[])",
      [deleteIds]
    );

    await client.query("COMMIT");

    await audit(req,"BULK_DELETE","employees",null,{
      count:deleteIds.length,
      ids:deleteIds
    });

    res.json({
      message:`${deleteIds.length} colaborador(es) excluído(s) com sucesso.`,
      deleted:deleteIds.length,
      ids:deleteIds
    });
  }catch(error){
    await client.query("ROLLBACK").catch(()=>{});
    next(error);
  }finally{
    client.release();
  }
});


module.exports=router;
