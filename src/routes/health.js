const {version:APP_VERSION}=require("../../package.json");
const express=require("express");
const pool=require("../db/pool");
const router=express.Router();
router.get("/",async(_req,res)=>{
  try{
    await pool.query("SELECT 1");
    res.json({status:"ok",database:"connected",version:APP_VERSION});
  }catch{
    res.status(503).json({status:"error",database:"disconnected"});
  }
});
module.exports=router;
