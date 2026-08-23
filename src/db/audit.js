const pool=require("./pool");
module.exports=async function audit(req,action,entity,entityId=null,details=null){
  try{
    await pool.query(
      `INSERT INTO audit_logs(user_id,action,entity,entity_id,details,ip_address)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [req.user?.sub||null,action,entity,entityId,details?JSON.stringify(details):null,req.ip||null]
    );
  }catch(error){
    console.error("Falha na auditoria:",error.message);
  }
};
