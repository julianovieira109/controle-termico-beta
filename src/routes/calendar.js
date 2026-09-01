const express=require("express");
const pool=require("../db/pool");
const audit=require("../db/audit");
const {authenticate,applyScope,requirePermission}=require("../middleware/auth");
const {getNational,getOptional,getLocal}=require("../services/online-holidays");

const router=express.Router();

const holidayTypeDefaults={
  NATIONAL:true,
  STATE:false,
  MUNICIPAL:false,
  OPTIONAL:false
};

function normalizeHolidayTypes(value={}){
  return {
    NATIONAL:value.NATIONAL!==false,
    STATE:value.STATE===true,
    MUNICIPAL:value.MUNICIPAL===true,
    OPTIONAL:value.OPTIONAL===true
  };
}

async function loadHolidayTypeSettings(){
  const {rows}=await pool.query(`
    SELECT setting_value
    FROM system_settings
    WHERE setting_key='holiday-types'
      AND company_id IS NULL
      AND branch_id IS NULL
    ORDER BY updated_at DESC,id DESC
    LIMIT 1
  `);
  return normalizeHolidayTypes({...holidayTypeDefaults,...(rows[0]?.setting_value||{})});
}

async function ensureAutomaticHolidays(year,settings){
  const start=`${year}-01-01`;
  const end=`${year}-12-31`;
  const branchesResult=await pool.query(`
    SELECT id,company_id,name,city,state
    FROM branches
    WHERE active=TRUE
    ORDER BY name
  `);
  const activeBranches=branchesResult.rows;
  const warnings=[];
  const sources=new Set();
  const prepared=[];

  if(settings.NATIONAL){
    const result=await getNational(year);
    result.holidays.forEach(h=>prepared.push({...h,companyId:null,branchId:null}));
    sources.add(result.source);
    if(result.warning)warnings.push(`Nacionais: ${result.warning}`);
  }

  if(settings.OPTIONAL){
    const result=await getOptional(year);
    result.holidays.forEach(h=>prepared.push({...h,companyId:null,branchId:null}));
    sources.add(result.source);
    if(result.warning)warnings.push(`Pontos facultativos: ${result.warning}`);
  }

  for(const branch of activeBranches){
    if(settings.STATE){
      const result=await getLocal(year,"STATE",{state:branch.state,city:branch.city});
      result.holidays.forEach(h=>prepared.push({...h,companyId:branch.company_id,branchId:branch.id}));
      sources.add(result.source);
      if(result.warning)warnings.push(`${branch.name} / estadual: ${result.warning}`);
    }
    if(settings.MUNICIPAL){
      const result=await getLocal(year,"MUNICIPAL",{state:branch.state,city:branch.city});
      result.holidays.forEach(h=>prepared.push({...h,companyId:branch.company_id,branchId:branch.id}));
      sources.add(result.source);
      if(result.warning)warnings.push(`${branch.name} / municipal: ${result.warning}`);
    }
  }

  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM holidays
       WHERE automatic=TRUE
         AND holiday_date BETWEEN $1::date AND $2::date`,
      [start,end]
    );

    for(const holiday of prepared){
      await client.query(
        `INSERT INTO holidays(company_id,branch_id,holiday_date,description,automatic)
         VALUES($1,$2,$3::date,$4,TRUE)
         ON CONFLICT(company_id,branch_id,holiday_date)
         DO UPDATE SET description=EXCLUDED.description,automatic=TRUE`,
        [holiday.companyId,holiday.branchId,holiday.date,holiday.name]
      );
    }

    await client.query("COMMIT");
  }catch(error){
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  }finally{
    client.release();
  }

  return {
    settings,
    sources:[...sources],
    source:sources.has("ONLINE")?"ONLINE":sources.has("LOCAL_FALLBACK")?"LOCAL_FALLBACK":"UNAVAILABLE",
    provider:"feriados.dev",
    warnings:[...new Set(warnings)].slice(0,20),
    preparedTotal:prepared.length
  };
}

router.use(authenticate,applyScope,requirePermission("calendar.manage"));

router.get("/holiday-types",async(_req,res,next)=>{
  try{
    res.json(await loadHolidayTypeSettings());
  }catch(error){next(error);}
});

router.put("/holiday-types",async(req,res,next)=>{
  try{
    if(req.user.role!=="ADMIN"){
      return res.status(403).json({error:"Somente o administrador pode alterar os tipos de feriados."});
    }
    const settings=normalizeHolidayTypes(req.body||{});
    const {rows}=await pool.query(`
      INSERT INTO system_settings(setting_key,setting_value,company_id,branch_id)
      VALUES('holiday-types',$1::jsonb,NULL,NULL)
      RETURNING *
    `,[JSON.stringify(settings)]);
    await audit(req,"UPDATE","system_settings",rows[0].id,{settingKey:"holiday-types",settings});
    res.json(settings);
  }catch(error){next(error);}
});

function checkBranchScope(req, branchId){
  return req.scope.isAdmin || req.scope.branchIds.includes(branchId);
}


router.post("/holidays/generate",async(req,res,next)=>{
  try{
    const year=Number(req.body.year);
    if(!Number.isInteger(year)||year<2000||year>2100){
      return res.status(400).json({error:"Informe um ano válido."});
    }

    const before=await pool.query(
      `SELECT COUNT(*)::int total
       FROM holidays
       WHERE automatic=TRUE
         AND EXTRACT(YEAR FROM holiday_date)=$1`,
      [year]
    );

    const holidayTypes=await loadHolidayTypeSettings();
    const onlineResult=await ensureAutomaticHolidays(year,holidayTypes);

    const params=[year];
    let scopeWhere="";
    if(!req.scope.isAdmin){
      params.push(req.scope.companyId,req.scope.branchIds);
      scopeWhere=" AND (h.company_id IS NULL OR h.company_id=$2) AND (h.branch_id IS NULL OR h.branch_id=ANY($3::uuid[]))";
    }

    const {rows}=await pool.query(`
      SELECT h.*,c.trade_name company_name,b.name branch_name
      FROM holidays h
      LEFT JOIN companies c ON c.id=h.company_id
      LEFT JOIN branches b ON b.id=h.branch_id
      WHERE EXTRACT(YEAR FROM h.holiday_date)=$1
        AND h.automatic=TRUE
      ${scopeWhere}
      ORDER BY h.holiday_date
    `,params);

    const automaticTotal=rows.filter(row=>row.automatic).length;
    await audit(req,"GENERATE","holidays",null,{
      year,
      total:rows.length,
      automaticTotal,
      regenerated:before.rows[0].total>0,
      source:onlineResult.source,
      provider:onlineResult.provider,
      warnings:onlineResult.warnings,
      holidayTypes:onlineResult.settings
    });

    res.json({
      year,
      total:rows.length,
      automaticTotal,
      regenerated:before.rows[0].total>0,
      source:onlineResult.source,
      provider:onlineResult.provider,
      warnings:onlineResult.warnings,
      holidayTypes:onlineResult.settings,
      holidays:rows
    });
  }catch(e){next(e);}
});

router.get("/holidays",async(req,res,next)=>{
  try{
    const year=Number(req.query.year||new Date().getFullYear());

    const params=[];
    let where="WHERE h.automatic=TRUE";

    if(!req.scope.isAdmin){
      params.push(req.scope.companyId,req.scope.branchIds);
      where+=" AND (h.company_id IS NULL OR h.company_id=$1) AND (h.branch_id IS NULL OR h.branch_id=ANY($2::uuid[]))";
    }else{
      if(req.query.companyId){
        params.push(req.query.companyId);
        where+=` AND (h.company_id IS NULL OR h.company_id=$${params.length})`;
      }
      if(req.query.branchId){
        params.push(req.query.branchId);
        where+=` AND (h.branch_id IS NULL OR h.branch_id=$${params.length})`;
      }
    }

    if(req.query.year){
      params.push(Number(req.query.year));
      where+=` AND EXTRACT(YEAR FROM h.holiday_date)=$${params.length}`;
    }

    const {rows}=await pool.query(`
      SELECT h.*,c.trade_name company_name,b.name branch_name
      FROM holidays h
      LEFT JOIN companies c ON c.id=h.company_id
      LEFT JOIN branches b ON b.id=h.branch_id
      ${where}
      ORDER BY h.holiday_date
    `,params);

    res.json(rows);
  }catch(e){next(e);}
});

router.post("/holidays",async(req,res,next)=>{
  try{
    let {companyId,branchId,holidayDate,description,automatic=false}=req.body;

    if(!req.scope.isAdmin){
      companyId=req.scope.companyId;
      if(branchId && !checkBranchScope(req,branchId)){
        return res.status(403).json({error:"Filial não autorizada."});
      }
    }

    if(!holidayDate||!description){
      return res.status(400).json({error:"Data e descrição são obrigatórias."});
    }

    const {rows}=await pool.query(`
      INSERT INTO holidays(company_id,branch_id,holiday_date,description,automatic)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(company_id,branch_id,holiday_date)
      DO UPDATE SET description=EXCLUDED.description,automatic=EXCLUDED.automatic
      RETURNING *
    `,[companyId||null,branchId||null,holidayDate,description.trim(),Boolean(automatic)]);

    await audit(req,"CREATE","holidays",rows[0].id);
    res.status(201).json(rows[0]);
  }catch(e){next(e);}
});

router.put("/holidays/:id",async(req,res,next)=>{
  try{
    const current=await pool.query("SELECT * FROM holidays WHERE id=$1",[req.params.id]);
    if(!current.rows[0])return res.status(404).json({error:"Feriado não encontrado."});
    if(current.rows[0].automatic){
      return res.status(403).json({error:"Feriados automáticos não podem ser excluídos."});
    }

    if(!req.scope.isAdmin){
      const row=current.rows[0];
      if(row.company_id && row.company_id!==req.scope.companyId){
        return res.status(403).json({error:"Feriado não autorizado."});
      }
      if(row.branch_id && !checkBranchScope(req,row.branch_id)){
        return res.status(403).json({error:"Filial não autorizada."});
      }
    }

    let {companyId,branchId,holidayDate,description,automatic=false}=req.body;
    if(!req.scope.isAdmin){
      companyId=req.scope.companyId;
      if(branchId && !checkBranchScope(req,branchId)){
        return res.status(403).json({error:"Filial não autorizada."});
      }
    }

    const {rows}=await pool.query(`
      UPDATE holidays
      SET company_id=$1,branch_id=$2,holiday_date=$3,description=$4,automatic=$5
      WHERE id=$6
      RETURNING *
    `,[companyId||null,branchId||null,holidayDate,description.trim(),Boolean(automatic),req.params.id]);

    await audit(req,"UPDATE","holidays",req.params.id);
    res.json(rows[0]);
  }catch(e){next(e);}
});

router.delete("/holidays/:id",async(req,res,next)=>{
  try{
    const current=await pool.query("SELECT * FROM holidays WHERE id=$1",[req.params.id]);
    if(!current.rows[0])return res.status(404).json({error:"Feriado não encontrado."});
    if(current.rows[0].automatic){
      return res.status(403).json({error:"Feriados automáticos não podem ser excluídos."});
    }

    if(!req.scope.isAdmin){
      const row=current.rows[0];
      if(row.company_id && row.company_id!==req.scope.companyId){
        return res.status(403).json({error:"Feriado não autorizado."});
      }
      if(row.branch_id && !checkBranchScope(req,row.branch_id)){
        return res.status(403).json({error:"Filial não autorizada."});
      }
    }

    await pool.query("DELETE FROM holidays WHERE id=$1",[req.params.id]);
    await audit(req,"DELETE","holidays",req.params.id);
    res.status(204).end();
  }catch(e){next(e);}
});

router.get("/days-off",async(req,res,next)=>{
  try{
    const params=[];
    let where="WHERE 1=1";

    if(!req.scope.isAdmin){
      params.push(req.scope.companyId,req.scope.branchIds);
      where+=" AND e.company_id=$1 AND e.branch_id=ANY($2::uuid[])";
    }

    if(req.query.employeeId){
      params.push(req.query.employeeId);
      where+=` AND e.id=$${params.length}`;
    }

    if(req.query.year){
      params.push(Number(req.query.year));
      where+=` AND EXTRACT(YEAR FROM d.off_date)=$${params.length}`;
    }

    const {rows}=await pool.query(`
      SELECT d.*,e.full_name,e.registration,c.trade_name company_name,b.name branch_name
      FROM employee_days_off d
      JOIN employees e ON e.id=d.employee_id
      JOIN companies c ON c.id=e.company_id
      JOIN branches b ON b.id=e.branch_id
      ${where}
      ORDER BY d.off_date,e.full_name
    `,params);

    res.json(rows);
  }catch(e){next(e);}
});

router.post("/days-off",async(req,res,next)=>{
  try{
    const {employeeId,offDate,description="Folga"}=req.body;
    if(!employeeId||!offDate){
      return res.status(400).json({error:"Colaborador e data são obrigatórios."});
    }

    const employee=await pool.query(
      "SELECT id,company_id,branch_id FROM employees WHERE id=$1 LIMIT 1",
      [employeeId]
    );
    if(!employee.rows[0])return res.status(404).json({error:"Colaborador não encontrado."});

    if(!req.scope.isAdmin){
      const row=employee.rows[0];
      if(row.company_id!==req.scope.companyId||!checkBranchScope(req,row.branch_id)){
        return res.status(403).json({error:"Colaborador fora do seu escopo."});
      }
    }

    const {rows}=await pool.query(`
      INSERT INTO employee_days_off(employee_id,off_date,description)
      VALUES($1,$2,$3)
      ON CONFLICT(employee_id,off_date)
      DO UPDATE SET description=EXCLUDED.description
      RETURNING *
    `,[employeeId,offDate,description.trim()||"Folga"]);

    await audit(req,"CREATE","employee_days_off",rows[0].id);
    res.status(201).json(rows[0]);
  }catch(e){next(e);}
});

router.delete("/days-off/:id",async(req,res,next)=>{
  try{
    const {rows}=await pool.query(`
      SELECT d.id,e.company_id,e.branch_id
      FROM employee_days_off d
      JOIN employees e ON e.id=d.employee_id
      WHERE d.id=$1
    `,[req.params.id]);

    if(!rows[0])return res.status(404).json({error:"Folga não encontrada."});

    if(!req.scope.isAdmin){
      if(rows[0].company_id!==req.scope.companyId||!checkBranchScope(req,rows[0].branch_id)){
        return res.status(403).json({error:"Folga fora do seu escopo."});
      }
    }

    await pool.query("DELETE FROM employee_days_off WHERE id=$1",[req.params.id]);
    await audit(req,"DELETE","employee_days_off",req.params.id);
    res.status(204).end();
  }catch(e){next(e);}
});

module.exports=router;
