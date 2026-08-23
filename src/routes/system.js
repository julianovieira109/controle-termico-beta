const express=require("express");
const multer=require("multer");
const crypto=require("crypto");
const pool=require("../db/pool");
const audit=require("../db/audit");
const {normalizeBackupData}=require("../services/backup-normalizer");
const {authenticate,requireAdmin,requireMasterAdmin}=require("../middleware/auth");

const router=express.Router();
const upload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:30*1024*1024}
});

router.use(authenticate,requireAdmin);

const BACKUP_TABLES=[
  "companies",
  "branches",
  "user_profiles",
  "profile_permissions",
  "shifts",
  "job_roles",
  "job_role_branch_report_policies",
  "departments",
  "employees",
  "employee_days_off",
  "holidays",
  "system_settings",
  "user_permissions",
  "user_branches",
  "user_recovery_codes",
  "employee_imports",
  "audit_logs",
  "users"
];

const RESTORE_ORDER=[
  "companies",
  "branches",
  "user_profiles",
  "profile_permissions",
  "shifts",
  "job_roles",
  "job_role_branch_report_policies",
  "departments",
  "users",
  "user_permissions",
  "user_branches",
  "user_recovery_codes",
  "employees",
  "employee_days_off",
  "holidays",
  "system_settings",
  "employee_imports",
  "audit_logs"
];

const CLEAR_ORDER=[
  "employee_days_off",
  "employee_imports",
  "audit_logs",
  "user_permissions",
  "user_branches",
  "user_recovery_codes",
  "profile_permissions",
  "job_role_branch_report_policies",
  "employees",
  "users",
  "user_profiles",
  "system_settings",
  "holidays",
  "departments",
  "job_roles",
  "shifts",
  "branches",
  "companies"
];

const backupTokens=new Map();

function cleanupTokens(){
  const now=Date.now();
  for(const [token,data] of backupTokens.entries()){
    if(data.expiresAt<=now)backupTokens.delete(token);
  }
}

async function existingTables(client){
  const {rows}=await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='public'
  `);
  return new Set(rows.map(row=>row.table_name));
}

async function tableColumns(client,table){
  const {rows}=await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name=$1
    ORDER BY ordinal_position
  `,[table]);
  return rows.map(row=>row.column_name);
}

function quoteIdentifier(value){
  return `"${String(value).replace(/"/g,'""')}"`;
}

async function collectBackup(client,req){
  const tables=await existingTables(client);
  const data={};

  for(const table of BACKUP_TABLES){
    if(!tables.has(table))continue;
    const {rows}=await client.query(`SELECT * FROM ${quoteIdentifier(table)}`);
    data[table]=rows;
  }

  return {
    format:"controle-termico-backup",
    version:"1.0.3-beta",
    generatedAt:new Date().toISOString(),
    generatedBy:{
      id:req.user.sub,
      name:req.user.name,
      role:req.user.role
    },
    warning:"Este arquivo contém dados pessoais e hashes de senha. Guarde-o em local seguro.",
    data
  };
}

router.get("/tests",async(req,res)=>{
  const client=await pool.connect();
  try{
    const tables=await existingTables(client);
    const required=[
      "users","user_profiles","profile_permissions","companies","branches","shifts","job_roles","job_role_branch_report_policies","employees",
      "holidays","system_settings","user_branches","user_permissions",
      "user_recovery_codes","employee_days_off","employee_imports","audit_logs"
    ];
    const missing=required.filter(table=>!tables.has(table));

    const criticalColumns={
      users:["id","email","password_hash","role","company_id","branch_id","active","must_change_password"],
      employees:["id","company_id","branch_id","shift_id","job_role_id","full_name","registration","status","termination_date"],
      holidays:["holiday_date","description","automatic"],
      employee_imports:["import_type","file_name","total_found","created_at"]
    };

    const columnProblems=[];
    for(const [table,columns] of Object.entries(criticalColumns)){
      if(!tables.has(table))continue;
      const available=new Set(await tableColumns(client,table));
      const absent=columns.filter(column=>!available.has(column));
      if(absent.length)columnProblems.push(`${table}: ${absent.join(", ")}`);
    }

    const admin=await client.query(`
      SELECT id,name,email,active
      FROM users
      WHERE id=$1
        AND role='ADMIN'
      LIMIT 1
    `,[req.user.sub]);

    const checks=[
      {
        name:"Conexão com banco de dados",
        success:true,
        detail:"Consulta executada com sucesso."
      },
      {
        name:"Tabelas essenciais",
        success:missing.length===0,
        detail:missing.length?`Ausentes: ${missing.join(", ")}`:"Todas encontradas."
      },
      {
        name:"Colunas críticas do banco",
        success:columnProblems.length===0,
        detail:columnProblems.length?`Ausentes: ${columnProblems.join(" | ")}`:"Estrutura compatível com a V1.0.3 Beta."
      },
      {
        name:"Administrador atual",
        success:Boolean(admin.rows[0]?.active),
        detail:admin.rows[0]
          ? `${admin.rows[0].name} (${admin.rows[0].email})`
          : "Usuário administrador não localizado."
      },
      {
        name:"Rota de backup",
        success:true,
        detail:"Disponível somente para Administrador."
      },
      {
        name:"Rota de restauração",
        success:true,
        detail:"Exclusiva do Administrador Master; exige arquivo de backup e confirmação."
      },
      {
        name:"Rota de zeragem",
        success:true,
        detail:"Exclusiva do Administrador Master; exige backup recente, senha e frase de confirmação."
      }
    ];

    res.json({
      success:checks.every(check=>check.success),
      checkedAt:new Date().toISOString(),
      checks
    });
  }finally{
    client.release();
  }
});

router.get("/backup",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    cleanupTokens();
    const backup=await collectBackup(client,req);
    const token=crypto.randomBytes(24).toString("hex");

    backupTokens.set(token,{
      userId:req.user.sub,
      expiresAt:Date.now()+30*60*1000
    });

    const tokenExpiresAt=new Date(Date.now()+30*60*1000).toISOString();

    await audit(req,"BACKUP","system",null,{
      tables:Object.keys(backup.data),
      generatedAt:backup.generatedAt
    });

    const date=new Date().toISOString().replace(/[:.]/g,"-");
    res.setHeader("Content-Type","application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="controle-termico-backup-${date}.json"`
    );
    res.setHeader("X-Reset-Token",token);
    res.setHeader("X-Reset-Token-Expires",tokenExpiresAt);
    res.send(JSON.stringify(backup,null,2));
  }catch(error){
    next(error);
  }finally{
    client.release();
  }
});

router.post("/reset",requireMasterAdmin,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    cleanupTokens();

    const {
      password,
      confirmation,
      resetToken,
      preserveVisualSettings=true
    }=req.body||{};

    if(confirmation!=="ZERAR SISTEMA"){
      return res.status(400).json({
        error:'Digite exatamente "ZERAR SISTEMA" para confirmar.'
      });
    }

    const tokenData=backupTokens.get(resetToken);
    if(!tokenData||tokenData.userId!==req.user.sub||tokenData.expiresAt<=Date.now()){
      return res.status(400).json({
        error:"Gere e baixe um backup novo antes de zerar o sistema."
      });
    }

    const userResult=await client.query(`
      SELECT id,password_hash,role,active
      FROM users
      WHERE id=$1
      LIMIT 1
    `,[req.user.sub]);

    const currentAdmin=userResult.rows[0];
    if(!currentAdmin||currentAdmin.role!=="ADMIN"||!currentAdmin.active){
      return res.status(403).json({error:"Administrador atual inválido."});
    }

    const bcrypt=require("bcryptjs");
    const validPassword=await bcrypt.compare(String(password||""),currentAdmin.password_hash);
    if(!validPassword){
      return res.status(401).json({error:"Senha do Administrador incorreta."});
    }

    const tables=await existingTables(client);

    await client.query("BEGIN");

    // O Administrador preservado não pode continuar apontando para empresa/filial
    // que serão apagadas.
    if(tables.has("users")){
      await client.query(`
        UPDATE users
        SET company_id=NULL,
            branch_id=NULL,
            role='ADMIN',
            active=TRUE,
            password_reset_token_hash=NULL,
            password_reset_expires_at=NULL,
            updated_at=NOW()
        WHERE id=$1
      `,[req.user.sub]);
    }

    // Remove primeiro tabelas-filhas.
    for(const table of [
      "employee_days_off",
      "employee_imports",
      "audit_logs",
      "user_permissions",
      "user_branches",
      "employees"
    ]){
      if(tables.has(table)){
        await client.query(`DELETE FROM ${quoteIdentifier(table)}`);
      }
    }

    // Usuários RH / outros administradores precisam sair antes de empresas e filiais.
    if(tables.has("users")){
      await client.query("DELETE FROM users WHERE id<>$1",[req.user.sub]);
    }

    // Configurações: preserva somente a identidade global quando solicitado.
    if(tables.has("system_settings")){
      if(preserveVisualSettings){
        await client.query(`
          DELETE FROM system_settings
          WHERE company_id IS NOT NULL
             OR branch_id IS NOT NULL
             OR setting_key<>'visual'
        `);
      }else{
        await client.query("DELETE FROM system_settings");
      }
    }

    for(const table of [
      "holidays",
      "departments",
      "job_roles",
      "shifts",
      "branches",
      "companies"
    ]){
      if(tables.has(table)){
        await client.query(`DELETE FROM ${quoteIdentifier(table)}`);
      }
    }

    await client.query("COMMIT");
    backupTokens.delete(resetToken);

    await audit(req,"RESET","system",null,{
      keptAdmin:req.user.sub,
      preserveVisualSettings:Boolean(preserveVisualSettings)
    });

    res.json({
      message:"Sistema zerado com sucesso.",
      keptAdminId:req.user.sub,
      preservedVisualSettings:Boolean(preserveVisualSettings)
    });
  }catch(error){
    await client.query("ROLLBACK").catch(()=>{});
    next(error);
  }finally{
    client.release();
  }
});

router.post("/restore",requireMasterAdmin,upload.single("file"),async(req,res,next)=>{
  const client=await pool.connect();

  try{
    if(!req.file){
      return res.status(400).json({error:"Selecione o arquivo de backup JSON."});
    }

    if(req.body.confirmation!=="RESTAURAR BACKUP"){
      return res.status(400).json({
        error:'Digite exatamente "RESTAURAR BACKUP" para confirmar.'
      });
    }

    let backup;
    try{
      backup=JSON.parse(req.file.buffer.toString("utf8"));
    }catch{
      return res.status(400).json({error:"O arquivo não contém um JSON válido."});
    }

    if(backup?.format!=="controle-termico-backup"||!backup?.data){
      return res.status(400).json({error:"Arquivo de backup incompatível."});
    }

    const normalizedBackup=normalizeBackupData(backup.data);

    const tables=await existingTables(client);

    await client.query("BEGIN");

    for(const table of CLEAR_ORDER){
      if(tables.has(table)){
        await client.query(`DELETE FROM ${quoteIdentifier(table)}`);
      }
    }

    for(const table of RESTORE_ORDER){
      if(!tables.has(table))continue;
      const rows=Array.isArray(normalizedBackup.data[table])?normalizedBackup.data[table]:[];
      if(!rows.length)continue;

      const validColumns=new Set(await tableColumns(client,table));

      for(const row of rows){
        const columns=Object.keys(row).filter(column=>validColumns.has(column));
        if(!columns.length)continue;

        const values=columns.map(column=>row[column]);
        const placeholders=columns.map((_,index)=>`$${index+1}`).join(",");
        const sql=`
          INSERT INTO ${quoteIdentifier(table)}
          (${columns.map(quoteIdentifier).join(",")})
          VALUES(${placeholders})
        `;
        await client.query(sql,values);
      }
    }

    await client.query("COMMIT");

    res.json({
      message:"Backup restaurado com sucesso. Entre novamente no sistema.",
      generatedAt:backup.generatedAt||null,
      tablesRestored:Object.keys(backup.data),
      duplicatesResolved:normalizedBackup.stats,
      requiresRelogin:true
    });
  }catch(error){
    await client.query("ROLLBACK").catch(()=>{});
    next(error);
  }finally{
    client.release();
  }
});

module.exports=router;
