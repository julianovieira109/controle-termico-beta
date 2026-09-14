const {version:APP_VERSION}=require("../../package.json");
const express=require("express");
const pool=require("../db/pool");
const router=express.Router();

function withTimeout(promise,ms){
  let timer;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Object.assign(new Error("database health timeout"),{code:"DB_HEALTH_TIMEOUT"})),ms);
  });
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

// Liveness: o Render precisa saber se o processo HTTP subiu. Uma oscilação
// temporária do PostgreSQL não deve manter o deploy preso indefinidamente.
router.get("/",async(_req,res)=>{
  const payload={status:"ok",application:"online",version:APP_VERSION,database:"checking"};
  try{
    await withTimeout(pool.query("SELECT 1"),Number(process.env.HEALTH_DB_TIMEOUT_MS||2500));
    payload.database="connected";
  }catch(error){
    payload.database="disconnected";
    payload.database_error=error.code||"unavailable";
  }
  // Sempre 200 para liveness. O estado do banco continua explícito no JSON.
  res.status(200).json(payload);
});

// Readiness detalhada para diagnóstico manual/monitoramento interno.
router.get("/db",async(_req,res)=>{
  try{
    await withTimeout(pool.query("SELECT 1"),Number(process.env.HEALTH_DB_TIMEOUT_MS||2500));
    res.json({status:"ok",database:"connected",version:APP_VERSION});
  }catch(error){
    res.status(503).json({status:"error",database:"disconnected",code:error.code||"unavailable",version:APP_VERSION});
  }
});

module.exports=router;
