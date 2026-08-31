const express=require("express");
const pool=require("../db/pool");
const {authenticate,applyScope,requirePermission}=require("../middleware/auth");
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
        AND LEFT(COALESCE(i.details->'period'->>'end',''),7)=$1
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
        AND LEFT(COALESCE(i.details->'period'->>'end',''),7)=$1
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

module.exports=router;
