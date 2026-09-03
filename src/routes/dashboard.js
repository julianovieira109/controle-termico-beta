const express=require("express");
const pool=require("../db/pool");
const {authenticate,applyScope,requirePermission,requireOccurrencesAccess}=require("../middleware/auth");
const DashboardAlerts=require("../lib/dashboard-alerts");
const router=express.Router();
router.use(authenticate,applyScope,requirePermission("dashboard.view"));

router.get("/summary",async(req,res,next)=>{
  try{
    if(req.scope.isAdmin){
      const [employees,companies,branches,users,missingShift]=await Promise.all([
        pool.query("SELECT COUNT(*)::int total FROM employees WHERE status='ATIVO'"),
        pool.query("SELECT COUNT(*)::int total FROM companies WHERE active=TRUE"),
        pool.query("SELECT COUNT(*)::int total FROM branches WHERE active=TRUE"),
        pool.query("SELECT COUNT(*)::int total FROM users WHERE active=TRUE"),
        pool.query("SELECT COUNT(*)::int total FROM employees WHERE status='ATIVO' AND shift_id IS NULL")
      ]);
      return res.json({
        employees:employees.rows[0].total,
        companies:companies.rows[0].total,
        branches:branches.rows[0].total,
        users:users.rows[0].total,
        missingShift:missingShift.rows[0].total
      });
    }
    const params=[req.scope.companyId,req.scope.branchIds];
    const [employees,branches,missingShift]=await Promise.all([
      pool.query("SELECT COUNT(*)::int total FROM employees WHERE status='ATIVO' AND company_id=$1 AND branch_id=ANY($2::uuid[])",params),
      pool.query("SELECT COUNT(*)::int total FROM branches WHERE active=TRUE AND company_id=$1 AND id=ANY($2::uuid[])",params),
      pool.query("SELECT COUNT(*)::int total FROM employees WHERE status='ATIVO' AND shift_id IS NULL AND company_id=$1 AND branch_id=ANY($2::uuid[])",params)
    ]);
    res.json({
      employees:employees.rows[0].total,
      companies:req.scope.companyId?1:0,
      branches:branches.rows[0].total,
      users:1,
      missingShift:missingShift.rows[0].total
    });
  }catch(error){next(error);}
});

router.get("/alerts",async(req,res,next)=>{
  try{
    const month=String(req.query.month||"");
    if(!/^\d{4}-\d{2}$/.test(month)){
      return res.status(400).json({error:"Informe o mês no formato AAAA-MM."});
    }

    const employeeParams=[];
    let employeeScope="";
    if(!req.scope.isAdmin){
      employeeParams.push(req.scope.companyId,req.scope.branchIds);
      employeeScope=" AND e.company_id=$1 AND e.branch_id=ANY($2::uuid[])";
    }

    const {rows:employees}=await pool.query(`
      SELECT
        e.id,e.company_id,e.branch_id,e.full_name,e.registration,
        c.trade_name company_name,b.name branch_name,
        s.name shift_name,
        COALESCE(e.report_policy_override,jbp.report_policy,j.report_policy,'PENDING') report_policy
      FROM employees e
      JOIN companies c ON c.id=e.company_id
      JOIN branches b ON b.id=e.branch_id
      LEFT JOIN shifts s ON s.id=e.shift_id AND s.active=TRUE
      LEFT JOIN job_roles j ON j.id=e.job_role_id
      LEFT JOIN job_role_branch_report_policies jbp
        ON jbp.job_role_id=e.job_role_id AND jbp.branch_id=e.branch_id
      WHERE UPPER(TRIM(COALESCE(e.status,'')))='ATIVO'
        ${employeeScope}
      ORDER BY c.trade_name,b.name,e.full_name
    `,employeeParams);

    const importParams=[month];
    let importScope="";
    if(!req.scope.isAdmin){
      importParams.push(req.scope.companyId,req.scope.branchIds);
      importScope=" AND i.company_id=$2 AND i.branch_id=ANY($3::uuid[])";
    }
    const {rows:imports}=await pool.query(`
      SELECT DISTINCT i.company_id,i.branch_id
      FROM employee_imports i
      WHERE i.import_type='PONTO_SENIOR'
        AND COALESCE(i.details->'period'->>'start','') ~ '^\\d{4}-\\d{2}-\\d{2}$'
        AND COALESCE(i.details->'period'->>'end','') ~ '^\\d{4}-\\d{2}-\\d{2}$'
        AND LEFT(i.details->'period'->>'end',7)=$1
        ${importScope}
    `,importParams);

    const pointParams=[`${month}-01`];
    let pointScope="";
    if(!req.scope.isAdmin){
      pointParams.push(req.scope.companyId,req.scope.branchIds);
      pointScope=" AND p.company_id=$2 AND p.branch_id=ANY($3::uuid[])";
    }
    const {rows:pointRows}=await pool.query(`
      SELECT DISTINCT p.employee_id
      FROM employee_point_days p
      WHERE p.work_date>=($1::date - INTERVAL '1 day')
        AND p.work_date<($1::date + INTERVAL '1 month')
        ${pointScope}
    `,pointParams);

    const {rows:thermalRows}=await pool.query(`
      SELECT setting_value
      FROM system_settings
      WHERE setting_key='thermal-rest' AND company_id IS NULL AND branch_id IS NULL
      ORDER BY updated_at DESC,id DESC
      LIMIT 1
    `);
    const thermalConfig=thermalRows[0]?.setting_value||{};
    const alerts=DashboardAlerts.classify({
      employees,
      imports,
      pointRows,
      thermalConfig
    });
    res.json({month,...alerts});
  }catch(error){next(error);}
});

router.get("/operations",async(req,res,next)=>{
  try{
    const month=String(req.query.month||"");
    if(!/^\d{4}-\d{2}$/.test(month)){
      return res.status(400).json({error:"Informe o mês no formato AAAA-MM."});
    }

    const params=[month];
    let scope="";
    if(!req.scope.isAdmin){
      params.push(req.scope.companyId,req.scope.branchIds);
      scope=" AND i.company_id=$2 AND i.branch_id=ANY($3::uuid[])";
    }

    const {rows:imports}=await pool.query(`
      SELECT i.id,i.file_name,i.total_found,i.total_updated,i.total_not_found,
             i.details,i.created_at,c.trade_name company_name,b.name branch_name
      FROM employee_imports i
      LEFT JOIN companies c ON c.id=i.company_id
      LEFT JOIN branches b ON b.id=i.branch_id
      WHERE i.import_type='PONTO_SENIOR'
        AND COALESCE(i.details->'period'->>'start','') ~ '^\\d{4}-\\d{2}-\\d{2}$'
        AND COALESCE(i.details->'period'->>'end','') ~ '^\\d{4}-\\d{2}-\\d{2}$'
        AND LEFT(i.details->'period'->>'end',7)=$1
        ${scope}
      ORDER BY i.created_at DESC
    `,params);

    const pointParams=[`${month}-01`];
    let pointScope="";
    if(!req.scope.isAdmin){
      pointParams.push(req.scope.companyId,req.scope.branchIds);
      pointScope=" AND p.company_id=$2 AND p.branch_id=ANY($3::uuid[])";
    }
    const {rows:pointSummary}=await pool.query(`
      SELECT
        COUNT(DISTINCT p.employee_id)::int employees_with_point,
        COUNT(*)::int point_days,
        COUNT(*) FILTER(WHERE p.eligible_for_automatic_rest=TRUE)::int eligible_days,
        COUNT(*) FILTER(WHERE p.point_state='REVIEW')::int review_days
      FROM employee_point_days p
      WHERE p.work_date>=($1::date - INTERVAL '1 day')
        AND p.work_date<($1::date + INTERVAL '1 month')
        ${pointScope}
    `,pointParams);

    const latest=imports[0]||null;
    res.json({
      month,
      point:{
        imports:imports.length,
        employees:pointSummary[0]?.employees_with_point||0,
        days:pointSummary[0]?.point_days||0,
        eligibleDays:pointSummary[0]?.eligible_days||0,
        reviewDays:pointSummary[0]?.review_days||0,
        lastImport:latest?{
          fileName:latest.file_name,
          createdAt:latest.created_at,
          companyName:latest.company_name||"-",
          branchName:latest.branch_name||"-",
          found:latest.total_found||0,
          located:latest.total_updated||0,
          notFound:latest.total_not_found||0
        }:null
      }
    });
  }catch(error){next(error);}
});

router.get("/competence-compare",async(req,res,next)=>{
  try{
    const months=[String(req.query.monthA||""),String(req.query.monthB||"")];
    if(months.some(month=>!/^\d{4}-\d{2}$/.test(month))){
      return res.status(400).json({error:"Informe as duas competências no formato AAAA-MM."});
    }

    async function snapshot(month){
      const importParams=[month];
      let importScope="";
      if(!req.scope.isAdmin){
        importParams.push(req.scope.companyId,req.scope.branchIds);
        importScope=" AND i.company_id=$2 AND i.branch_id=ANY($3::uuid[])";
      }
      const {rows:imports}=await pool.query(`
        SELECT DISTINCT i.company_id,i.branch_id
        FROM employee_imports i
        WHERE i.import_type='PONTO_SENIOR'
          AND LEFT(COALESCE(i.details->'period'->>'end',''),7)=$1
          ${importScope}
      `,importParams);

      const pointParams=[`${month}-01`];
      let pointScope="";
      if(!req.scope.isAdmin){
        pointParams.push(req.scope.companyId,req.scope.branchIds);
        pointScope=" AND p.company_id=$2 AND p.branch_id=ANY($3::uuid[])";
      }
      const {rows:summary}=await pool.query(`
        SELECT
          COUNT(DISTINCT p.employee_id)::int employees,
          COUNT(*)::int days,
          COUNT(*) FILTER(WHERE p.eligible_for_automatic_rest=TRUE)::int eligible_days,
          COUNT(*) FILTER(WHERE p.point_state='REVIEW')::int review_days,
          COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('FALTA','ABSENT'))::int absence_days,
          COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('FERIAS','FÉRIAS','VACATION'))::int vacation_days,
          COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('ATESTADO','MEDICAL'))::int medical_days
        FROM employee_point_days p
        WHERE p.work_date>=($1::date - INTERVAL '1 day')
          AND p.work_date<($1::date + INTERVAL '1 month')
          ${pointScope}
      `,pointParams);

      const {rows:states}=await pool.query(`
        SELECT UPPER(COALESCE(p.point_state,'OUTRO')) state,COUNT(*)::int total
        FROM employee_point_days p
        WHERE p.work_date>=($1::date - INTERVAL '1 day')
          AND p.work_date<($1::date + INTERVAL '1 month')
          ${pointScope}
        GROUP BY UPPER(COALESCE(p.point_state,'OUTRO'))
        ORDER BY total DESC
      `,pointParams);

      return {
        month,
        imports:imports.length,
        employees:summary[0]?.employees||0,
        days:summary[0]?.days||0,
        eligibleDays:summary[0]?.eligible_days||0,
        reviewDays:summary[0]?.review_days||0,
        absenceDays:summary[0]?.absence_days||0,
        vacationDays:summary[0]?.vacation_days||0,
        medicalDays:summary[0]?.medical_days||0,
        states
      };
    }

    const [a,b]=await Promise.all(months.map(snapshot));
    res.json({a,b});
  }catch(error){next(error);}
});

router.get("/occurrences",requireOccurrencesAccess,async(req,res,next)=>{
  try{
    const month=String(req.query.month||"");
    const companyId=String(req.query.companyId||"").trim();
    const branchId=String(req.query.branchId||"").trim();
    if(!/^\d{4}-\d{2}$/.test(month)){
      return res.status(400).json({error:"Informe a competência no formato AAAA-MM."});
    }

    const params=[`${month}-01`];
    const filters=[];
    if(!req.scope.isAdmin){
      params.push(req.scope.companyId);
      filters.push(`p.company_id=$${params.length}`);
      params.push(req.scope.branchIds);
      filters.push(`p.branch_id=ANY($${params.length}::uuid[])`);
    }
    if(companyId){
      params.push(companyId);
      filters.push(`p.company_id=$${params.length}::uuid`);
    }
    if(branchId){
      params.push(branchId);
      filters.push(`p.branch_id=$${params.length}::uuid`);
    }
    const pointFilter=filters.length?` AND ${filters.join(" AND ")}`:"";

    const {rows}=await pool.query(`
      SELECT
        e.id employee_id,
        e.full_name,
        e.registration,
        c.id company_id,
        c.trade_name company_name,
        b.id branch_id,
        b.name branch_name,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,''))='FOLGA')::int days_off,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('FALTA','ABSENT'))::int absences,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.occurrence,'')) ~ '(^|[^A-Z])BH([^A-Z]|$)')::int bank_hours,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('ATESTADO','MEDICAL'))::int medical,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('FERIAS','FÉRIAS','VACATION'))::int vacations,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,''))='DSR')::int dsr,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('LICENCA','LICENÇA','LICENSE'))::int licenses,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('AFASTAMENTO','LEAVE'))::int leaves,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,''))='COMPENSADO')::int compensated,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,''))='CURSO')::int courses,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('OBITO','ÓBITO'))::int bereavement,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('REVIEW','NO_MARKINGS'))::int review_days
      FROM employee_point_days p
      JOIN employees e ON e.id=p.employee_id
      JOIN companies c ON c.id=p.company_id
      JOIN branches b ON b.id=p.branch_id
      WHERE p.work_date>=($1::date - INTERVAL '1 day')
        AND p.work_date<($1::date + INTERVAL '1 month')
        ${pointFilter}
      GROUP BY e.id,e.full_name,e.registration,c.id,c.trade_name,b.id,b.name
      ORDER BY c.trade_name,b.name,e.full_name
    `,params);

    const summary=rows.reduce((acc,row)=>{
      for(const key of [
        "days_off","absences","bank_hours","medical","vacations","dsr",
        "licenses","leaves","compensated","courses","bereavement","review_days"
      ]) acc[key]=(acc[key]||0)+Number(row[key]||0);
      return acc;
    },{});

    const importParams=[month];
    const importFilters=[];
    if(!req.scope.isAdmin){
      importParams.push(req.scope.companyId);
      importFilters.push(`i.company_id=$${importParams.length}`);
      importParams.push(req.scope.branchIds);
      importFilters.push(`i.branch_id=ANY($${importParams.length}::uuid[])`);
    }
    if(companyId){
      importParams.push(companyId);
      importFilters.push(`i.company_id=$${importParams.length}::uuid`);
    }
    if(branchId){
      importParams.push(branchId);
      importFilters.push(`i.branch_id=$${importParams.length}::uuid`);
    }
    const importFilter=importFilters.length?` AND ${importFilters.join(" AND ")}`:"";

    const {rows:imports}=await pool.query(`
      SELECT DISTINCT i.company_id,i.branch_id,c.trade_name company_name,b.name branch_name,
             i.details->'period'->>'start' period_start,
             i.details->'period'->>'end' period_end,
             LEFT(i.details->'period'->>'end',7) competence
      FROM employee_imports i
      LEFT JOIN companies c ON c.id=i.company_id
      LEFT JOIN branches b ON b.id=i.branch_id
      WHERE i.import_type='PONTO_SENIOR'
        AND COALESCE(i.details->'period'->>'start','') ~ '^\\d{4}-\\d{2}-\\d{2}$'
        AND COALESCE(i.details->'period'->>'end','') ~ '^\\d{4}-\\d{2}-\\d{2}$'
        AND LEFT(i.details->'period'->>'end',7)=$1
        ${importFilter}
      ORDER BY company_name,branch_name
    `,importParams);

    res.json({month,companyId:companyId||null,branchId:branchId||null,summary,employees:rows,imports});
  }catch(error){next(error);}
});
module.exports=router;
