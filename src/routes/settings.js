const express=require("express");
const pool=require("../db/pool");
const audit=require("../db/audit");
const {authenticate}=require("../middleware/auth");
const router=express.Router();

function normalizeSettingValue(value){
  if(!value || typeof value!=="object" || Array.isArray(value))return {};
  return value;
}

const thermalRestDefaults={mode:"AUTOMATIC",workMinutes:100,restMinutes:20,maxRestMinutes:25,variationMinutes:15,cycleDays:31,restCount:3,fontSizePt:7.2};
function normalizeThermalRest(value={}){
  const integer=(key,min,max)=>Math.max(min,Math.min(max,Number.parseInt(value[key],10)||thermalRestDefaults[key]));
  const restMinutes=integer("restMinutes",5,60);
  return {
    mode:String(value.mode||"").toUpperCase()==="MANUAL"?"MANUAL":"AUTOMATIC",
    workMinutes:integer("workMinutes",30,240),
    restMinutes,
    maxRestMinutes:Math.max(restMinutes,integer("maxRestMinutes",5,60)),
    variationMinutes:integer("variationMinutes",0,30),
    cycleDays:integer("cycleDays",1,31),
    restCount:integer("restCount",1,3),
    fontSizePt:Math.max(6,Math.min(10,Math.round((Number(value.fontSizePt)||thermalRestDefaults.fontSizePt)*10)/10))
  };
}

router.get("/thermal-rest",authenticate,async(_req,res,next)=>{
  try{
    const {rows}=await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key='thermal-rest' AND company_id IS NULL AND branch_id IS NULL ORDER BY updated_at DESC,id DESC LIMIT 1`);
    res.json(normalizeThermalRest({...thermalRestDefaults,...(rows[0]?.setting_value||{})}));
  }catch(e){next(e);}
});

router.get("/public",async(_req,res,next)=>{
  try{
    const {rows}=await pool.query(`
      SELECT setting_value
      FROM system_settings
      WHERE setting_key='visual'
        AND company_id IS NULL
        AND branch_id IS NULL
      ORDER BY updated_at DESC,id DESC
      LIMIT 1
    `);
    const visual={...(rows[0]?.setting_value||{})};
    delete visual.supportName;
    delete visual.supportWhatsapp;
    delete visual.supportEmail;
    delete visual.supportHours;
    delete visual.supportPasswordHelp;
    res.json(visual);
  }catch(e){next(e);}
});

router.get("/public-support",async(_req,res,next)=>{
  try{
    const supportResult=await pool.query(`
      SELECT setting_value
      FROM system_settings
      WHERE setting_key='support'
        AND company_id IS NULL
        AND branch_id IS NULL
      ORDER BY updated_at DESC,id DESC
      LIMIT 1
    `);
    let support=supportResult.rows[0]?.setting_value||null;
    if(!support){
      const visualResult=await pool.query(`
        SELECT setting_value
        FROM system_settings
        WHERE setting_key='visual'
          AND company_id IS NULL
          AND branch_id IS NULL
        ORDER BY updated_at DESC,id DESC
        LIMIT 1
      `);
      support=visualResult.rows[0]?.setting_value||{};
    }
    res.json({
      supportName:String(support.supportName||"").trim().slice(0,80),
      supportWhatsapp:String(support.supportWhatsapp||"").replace(/\D/g,"").slice(0,15),
      supportPasswordHelp:String(
        support.supportPasswordHelp||"Caso tenha esquecido a sua senha, entre em contato com o Suporte."
      ).replace(/\s+/g," ").trim().slice(0,300)
    });
  }catch(e){next(e);}
});

router.get("/support",authenticate,async(_req,res,next)=>{
  try{
    const supportResult=await pool.query(`
      SELECT setting_value
      FROM system_settings
      WHERE setting_key='support'
        AND company_id IS NULL
        AND branch_id IS NULL
      ORDER BY updated_at DESC,id DESC
      LIMIT 1
    `);
    if(supportResult.rows[0]?.setting_value){
      return res.json(supportResult.rows[0].setting_value);
    }

    // Compatibilidade: reaproveita os contatos que versões anteriores
    // armazenavam junto da identidade visual.
    const visualResult=await pool.query(`
      SELECT setting_value
      FROM system_settings
      WHERE setting_key='visual'
        AND company_id IS NULL
        AND branch_id IS NULL
      ORDER BY updated_at DESC,id DESC
      LIMIT 1
    `);
    const visual=visualResult.rows[0]?.setting_value||{};
    res.json({
      supportName:visual.supportName||"",
      supportWhatsapp:visual.supportWhatsapp||"",
      supportEmail:visual.supportEmail||"",
      supportHours:visual.supportHours||"",
      supportPasswordHelp:visual.supportPasswordHelp||"Caso tenha esquecido a sua senha, entre em contato com o Suporte."
    });
  }catch(e){next(e);}
});

router.get("/",authenticate,async(_req,res,next)=>{
  try{
    const {rows}=await pool.query(`SELECT * FROM system_settings ORDER BY setting_key,updated_at DESC`);
    res.json(rows);
  }catch(e){next(e);}
});

router.put("/:key",authenticate,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    if(req.user.role!=="ADMIN"){
      return res.status(403).json({error:"Somente o administrador pode alterar a identidade visual."});
    }

    const key=String(req.params.key||"").trim();
    if(!key)return res.status(400).json({error:"Configuração inválida."});
    const protectedMasterSettings=new Set(["support","visual"]);
    if(protectedMasterSettings.has(key.toLowerCase())&&req.user.isMasterAdmin!==true){
      return res.status(403).json({
        error:key.toLowerCase()==="visual"
          ? "Somente o Administrador Master pode alterar a identidade visual."
          : "Somente o Administrador Master pode alterar o suporte."
      });
    }

    const companyId=req.body?.companyId||null;
    const branchId=req.body?.branchId||null;
    let value=normalizeSettingValue(req.body?.value);
    if(key.toLowerCase()==="thermal-rest")value=normalizeThermalRest(value);

    await client.query("BEGIN");

    // Configuração global: mantemos apenas um registro por chave.
    // O UNIQUE com campos NULL do PostgreSQL permite duplicidade; por isso
    // a exclusão explícita é necessária antes de gravar.
    if(!companyId && !branchId){
      await client.query(
        `DELETE FROM system_settings
         WHERE company_id IS NULL
           AND branch_id IS NULL
           AND setting_key=$1`,
        [key]
      );
    }

    const {rows}=await client.query(`
      INSERT INTO system_settings(
        company_id,branch_id,setting_key,setting_value,updated_at
      )
      VALUES($1,$2,$3,$4::jsonb,NOW())
      RETURNING id,company_id,branch_id,setting_key,setting_value,updated_at
    `,[companyId,branchId,key,JSON.stringify(value)]);

    await client.query("COMMIT");

    await audit(req,"UPDATE","system_settings",rows[0].id,{
      key,
      global:!companyId&&!branchId
    });

    // Retorna exatamente o conteúdo persistido no PostgreSQL.
    res.json({
      saved:true,
      setting:rows[0],
      value:rows[0].setting_value
    });
  }catch(e){
    try{await client.query("ROLLBACK");}catch{}
    next(e);
  }finally{
    client.release();
  }
});

module.exports=router;
