const express=require("express");
const pool=require("../db/pool");
const {authenticate,applyScope,requirePermission}=require("../middleware/auth");
const router=express.Router();
router.use(authenticate,applyScope,requirePermission("reports.view"));

router.get("/employees",async(req,res,next)=>{
  try{
    const params=[];
    let where="WHERE e.full_name IS NOT NULL AND TRIM(e.full_name)<>'' AND UPPER(TRIM(e.status))='ATIVO'";
    if(!req.scope.isAdmin){
      params.push(req.scope.companyId,req.scope.branchIds);
      where+=" AND e.company_id=$1 AND e.branch_id=ANY($2::uuid[])";
    }
    const {rows}=await pool.query(`
      SELECT e.id,e.full_name,e.registration,e.use_shift_days_off,
      CASE
        WHEN e.use_shift_days_off AND s.id IS NOT NULL AND s.active=TRUE
          THEN COALESCE(s.weekly_days_off,ARRAY[]::SMALLINT[])
        WHEN e.use_shift_days_off
          THEN ARRAY[]::SMALLINT[]
        ELSE COALESCE(e.weekly_days_off,ARRAY[]::SMALLINT[])
      END weekly_days_off,
      s.weekly_days_off shift_weekly_days_off,s.active shift_active,e.admission_date,e.termination_date,e.status,c.trade_name company_name,b.name branch_name,
      s.name shift_name,j.name job_role_name,
      COALESCE(e.report_policy_override,jbp.report_policy,j.report_policy,'PENDING') report_policy,
      e.report_policy_override,jbp.report_policy branch_report_policy,j.report_policy job_role_report_policy,
      COALESCE(
        (SELECT json_agg(json_build_object('date',edo.off_date,'description',edo.description) ORDER BY edo.off_date)
         FROM employee_days_off edo WHERE edo.employee_id=e.id),
        '[]'::json
      ) specific_days_off
      FROM employees e JOIN companies c ON c.id=e.company_id JOIN branches b ON b.id=e.branch_id
      LEFT JOIN shifts s ON s.id=e.shift_id LEFT JOIN job_roles j ON j.id=e.job_role_id
      LEFT JOIN job_role_branch_report_policies jbp ON jbp.job_role_id=e.job_role_id AND jbp.branch_id=e.branch_id
      ${where} ORDER BY e.full_name`,params);
    res.json(rows);
  }catch(e){next(e);}
});
module.exports=router;
