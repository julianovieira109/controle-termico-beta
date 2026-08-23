const express=require("express");
const pool=require("../db/pool");
const audit=require("../db/audit");
const {authenticate,applyScope,requirePermission}=require("../middleware/auth");

const router=express.Router();

function addDays(date,days){
  const result=new Date(date);
  result.setUTCDate(result.getUTCDate()+days);
  return result;
}

function easterSunday(year){
  const a=year%19;
  const b=Math.floor(year/100);
  const c=year%100;
  const d=Math.floor(b/4);
  const e=b%4;
  const f=Math.floor((b+8)/25);
  const g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4);
  const k=c%4;
  const l=(32+2*e+2*i-h-k)%7;
  const m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31);
  const day=((h+l-7*m+114)%31)+1;
  return new Date(Date.UTC(year,month-1,day));
}

function isoDate(date){
  return date.toISOString().slice(0,10);
}

function automaticHolidays(year){
  const easter=easterSunday(year);
  return [
    [`${year}-01-01`,"Confraternização Universal"],
    [isoDate(addDays(easter,-48)),"Carnaval - Segunda-feira"],
    [isoDate(addDays(easter,-47)),"Carnaval - Terça-feira"],
    [isoDate(addDays(easter,-2)),"Paixão de Cristo"],
    [`${year}-04-21`,"Tiradentes"],
    [`${year}-05-01`,"Dia Mundial do Trabalho"],
    [isoDate(addDays(easter,60)),"Corpus Christi"],
    [`${year}-09-07`,"Independência do Brasil"],
    [`${year}-10-12`,"Nossa Senhora Aparecida"],
    [`${year}-11-02`,"Finados"],
    [`${year}-11-15`,"Proclamação da República"],
    [`${year}-11-20`,"Dia Nacional de Zumbi e da Consciência Negra"],
    [`${year}-12-25`,"Natal"]
  ];
}

async function ensureAutomaticHolidays(year){
  const start=`${year}-01-01`;
  const end=`${year}-12-31`;

  // Remove somente os feriados automáticos do ano selecionado.
  // Feriados manuais são preservados.
  await pool.query(
    `DELETE FROM holidays
     WHERE automatic=TRUE
       AND holiday_date BETWEEN $1::date AND $2::date`,
    [start,end]
  );

  for(const [date,description] of automaticHolidays(year)){
    await pool.query(
      `INSERT INTO holidays(company_id,branch_id,holiday_date,description,automatic)
       VALUES(NULL,NULL,$1::date,$2,TRUE)`,
      [date,description]
    );
  }
}

router.use(authenticate,applyScope,requirePermission("calendar.manage"));

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

    await ensureAutomaticHolidays(year);

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
      ${scopeWhere}
      ORDER BY h.holiday_date
    `,params);

    const automaticTotal=rows.filter(row=>row.automatic).length;
    await audit(req,"GENERATE","holidays",null,{
      year,
      total:rows.length,
      automaticTotal,
      regenerated:before.rows[0].total>0
    });

    res.json({
      year,
      total:rows.length,
      automaticTotal,
      regenerated:before.rows[0].total>0,
      holidays:rows
    });
  }catch(e){next(e);}
});

router.get("/holidays",async(req,res,next)=>{
  try{
    const year=Number(req.query.year||new Date().getFullYear());

    const params=[];
    let where="WHERE 1=1";

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
