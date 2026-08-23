const express=require("express");
const pool=require("../db/pool");
const {authenticate,applyScope,requirePermission}=require("../middleware/auth");
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

module.exports=router;
