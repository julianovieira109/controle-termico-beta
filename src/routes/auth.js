const express=require("express");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const crypto=require("crypto");
const rateLimit=require("express-rate-limit");
const pool=require("../db/pool");
const audit=require("../db/audit");
const {authenticate}=require("../middleware/auth");
const {
  CODE_TTL_MINUTES,
  MAX_CODE_ATTEMPTS,
  REQUEST_COOLDOWN_SECONDS,
  emailRecoveryConfigured,
  turnstileConfigured,
  generateEmailResetCode,
  emailResetCodeHash,
  safeEqualHash,
  validateTurnstile,
  sendPasswordResetEmail
}=require("../services/password-recovery");

const router=express.Router();
const limiter=rateLimit({
  windowMs:15*60*1000,
  limit:30,
  skipSuccessfulRequests:true,
  message:{error:"Muitas tentativas incorretas. Aguarde alguns minutos."}
});
const recoveryRequestLimiter=rateLimit({windowMs:15*60*1000,limit:5,message:{error:"Muitas solicitações. Aguarde 15 minutos antes de tentar novamente."}});
const recoveryCompleteLimiter=rateLimit({windowMs:15*60*1000,limit:10,message:{error:"Muitas tentativas de código. Aguarde 15 minutos."}});
const supportRecoveryMessage="Caso tenha esquecido a sua senha, entre em contato com o Suporte.";

function normalizeRecoveryCode(value){
  return String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
}

function recoveryCodeHash(value){
  return crypto.createHash("sha256").update(normalizeRecoveryCode(value)).digest("hex");
}

function generateRecoveryCodes(total=8){
  const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codes=[];
  for(let item=0;item<total;item++){
    let body="";
    for(let index=0;index<12;index++)body+=alphabet[crypto.randomInt(0,alphabet.length)];
    codes.push(`RTM-${body.slice(0,4)}-${body.slice(4,8)}-${body.slice(8)}`);
  }
  return codes;
}

async function replaceRecoveryCodes(client,userId){
  const codes=generateRecoveryCodes();
  await client.query("DELETE FROM user_recovery_codes WHERE user_id=$1",[userId]);
  for(const code of codes){
    await client.query(
      "INSERT INTO user_recovery_codes(user_id,code_hash) VALUES($1,$2)",
      [userId,recoveryCodeHash(code)]
    );
  }
  return codes;
}

router.post("/login",limiter,async(req,res,next)=>{
  try{
    const email=String(req.body.email||"").trim().toLowerCase();
    const password=String(req.body.password||"");
    const {rows}=await pool.query(
      `SELECT u.id,u.name,u.email,u.password_hash,u.role,u.profile_id,u.company_id,u.branch_id,u.active,u.must_change_password,
              COALESCE(p.name,CASE WHEN u.role='ADMIN' THEN 'Administrador' ELSE 'RH' END) profile_name,
              COALESCE(p.master_admin,FALSE) is_master_admin
       FROM users u
       LEFT JOIN user_profiles p ON p.id=u.profile_id
       WHERE u.email=$1 LIMIT 1`,[email]
    );
    const user=rows[0];
    const passwordMatches=Boolean(user&&user.active&&await bcrypt.compare(password,user.password_hash));
    if(!user||!user.active||!passwordMatches){
      const auditRequest={user:user?{sub:user.id}:null,ip:req.ip};
      const reason=!user?"EMAIL_NOT_FOUND":(!user.active?"INACTIVE":"INVALID_PASSWORD");
      setImmediate(()=>audit(auditRequest,"LOGIN_FAILED","users",user?.id||null,{reason}));
      return res.status(401).json({error:"Login ou senha inválidos."});
    }
    const branchRows=await pool.query("SELECT branch_id FROM user_branches WHERE user_id=$1",[user.id]);
    const branchIds=branchRows.rows.map(x=>x.branch_id);
    const profilePermissionRows=user.profile_id
      ? await pool.query(
          "SELECT permission_key,allowed FROM profile_permissions WHERE profile_id=$1",
          [user.profile_id]
        )
      : {rows:[]};

    const userPermissionRows=await pool.query(
      "SELECT permission_key,allowed FROM user_permissions WHERE user_id=$1",
      [user.id]
    );

    const permissions={
      ...Object.fromEntries(profilePermissionRows.rows.map(p=>[p.permission_key,p.allowed])),
      ...Object.fromEntries(userPermissionRows.rows.filter(p=>p.allowed===true).map(p=>[p.permission_key,true]))
    };
    const isMasterAdmin=user.role==="ADMIN"&&user.is_master_admin===true;
    const mustChangePassword=user.must_change_password===true;
    const payload={sub:user.id,name:user.name,role:user.role,profileId:user.profile_id,profileName:user.profile_name,isMasterAdmin,mustChangePassword,companyId:user.company_id,branchIds,permissions};
    const token=jwt.sign(payload,process.env.JWT_SECRET,{expiresIn:"8h"});
    setImmediate(()=>audit({user:{sub:user.id},ip:req.ip},"LOGIN_SUCCESS","users",user.id));
    res.json({token,user:{id:user.id,name:user.name,email:user.email,role:user.role,profileId:user.profile_id,profileName:user.profile_name,isMasterAdmin,mustChangePassword,companyId:user.company_id,branchIds,permissions}});
  }catch(error){next(error);}
});

router.get("/recovery-config",(_req,res)=>{
  res.json({
    emailRecoveryEnabled:emailRecoveryConfigured(),
    turnstileSiteKey:turnstileConfigured()?String(process.env.TURNSTILE_SITE_KEY||""):"",
    codeExpiresInMinutes:CODE_TTL_MINUTES
  });
});

router.post("/forgot-password",recoveryRequestLimiter,async(req,res,next)=>{
  try{
    const email=String(req.body.email||"").trim().toLowerCase();
    if(!/^\S+@\S+\.\S+$/.test(email)){
      return res.status(400).json({error:"Informe um e-mail válido."});
    }
    if(!emailRecoveryConfigured()){
      return res.status(503).json({
        error:`${supportRecoveryMessage} A recuperação automática por e-mail ainda não está configurada.`,
        code:"EMAIL_RECOVERY_NOT_CONFIGURED"
      });
    }
    if(!(await validateTurnstile(req.body.turnstileToken,req.ip))){
      return res.status(400).json({error:"Confirme a verificação de segurança e tente novamente."});
    }

    const genericMessage=`Se o e-mail estiver cadastrado e ativo, enviaremos um código válido por ${CODE_TTL_MINUTES} minutos.`;
    const {rows}=await pool.query(
      "SELECT id,name,email FROM users WHERE LOWER(email)=LOWER($1) AND active=TRUE LIMIT 1",
      [email]
    );
    const user=rows[0];
    if(!user)return res.json({message:genericMessage,nextStep:true,expiresInMinutes:CODE_TTL_MINUTES});

    const code=generateEmailResetCode();
    const codeHash=emailResetCodeHash(user.id,code);
    const expiresAt=new Date(Date.now()+CODE_TTL_MINUTES*60*1000);
    const saved=await pool.query(
      `UPDATE users
       SET password_reset_token_hash=$1,password_reset_expires_at=$2,
           password_reset_requested_at=NOW(),password_reset_attempts=0,updated_at=NOW()
       WHERE id=$3
         AND (password_reset_requested_at IS NULL
              OR password_reset_requested_at<NOW()-($4*INTERVAL '1 second'))
       RETURNING id`,
      [codeHash,expiresAt,user.id,REQUEST_COOLDOWN_SECONDS]
    );

    if(saved.rows[0]){
      const auditRequest={user:null,ip:req.ip};
      setImmediate(async()=>{
        try{
          await sendPasswordResetEmail({to:user.email,name:user.name,code});
          await audit(auditRequest,"PASSWORD_RESET_EMAIL_SENT","users",user.id);
        }catch(emailError){
          console.error("Falha ao enviar recuperação de senha:",emailError.message);
          await pool.query(
            `UPDATE users
             SET password_reset_token_hash=NULL,password_reset_expires_at=NULL,
                 password_reset_attempts=0,updated_at=NOW()
             WHERE id=$1 AND password_reset_token_hash=$2`,
            [user.id,codeHash]
          );
          await audit(auditRequest,"PASSWORD_RESET_EMAIL_FAILED","users",user.id);
        }
      });
    }

    res.json({
      message:genericMessage,
      nextStep:true,
      expiresInMinutes:CODE_TTL_MINUTES
    });
  }catch(error){next(error);}
});

router.post("/complete-password-reset",recoveryCompleteLimiter,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const email=String(req.body.email||"").trim().toLowerCase();
    const code=String(req.body.code||"").replace(/\D/g,"");
    const password=String(req.body.password||"");
    if(!/^\S+@\S+\.\S+$/.test(email)||code.length!==6||password.length<8){
      return res.status(400).json({error:"Informe o e-mail, o código de 6 números e uma senha com pelo menos 8 caracteres."});
    }

    await client.query("BEGIN");
    const {rows}=await client.query(
      `SELECT id,password_hash,password_reset_token_hash,password_reset_expires_at,password_reset_attempts
       FROM users
       WHERE LOWER(email)=LOWER($1) AND active=TRUE
       LIMIT 1 FOR UPDATE`,
      [email]
    );
    const user=rows[0];
    const invalidMessage="E-mail ou código inválido, expirado ou já utilizado.";
    if(!user||!user.password_reset_token_hash||!user.password_reset_expires_at){
      await client.query("ROLLBACK");
      return res.status(400).json({error:invalidMessage});
    }

    if(new Date(user.password_reset_expires_at).getTime()<=Date.now()||Number(user.password_reset_attempts||0)>=MAX_CODE_ATTEMPTS){
      await client.query(
        `UPDATE users SET password_reset_token_hash=NULL,password_reset_expires_at=NULL,
         password_reset_attempts=0,updated_at=NOW() WHERE id=$1`,[user.id]
      );
      await client.query("COMMIT");
      return res.status(400).json({error:invalidMessage});
    }

    const receivedHash=emailResetCodeHash(user.id,code);
    if(!safeEqualHash(receivedHash,user.password_reset_token_hash)){
      const nextAttempts=Number(user.password_reset_attempts||0)+1;
      await client.query(
        nextAttempts>=MAX_CODE_ATTEMPTS
          ? `UPDATE users SET password_reset_token_hash=NULL,password_reset_expires_at=NULL,
             password_reset_attempts=0,updated_at=NOW() WHERE id=$1`
          : "UPDATE users SET password_reset_attempts=$2,updated_at=NOW() WHERE id=$1",
        nextAttempts>=MAX_CODE_ATTEMPTS?[user.id]:[user.id,nextAttempts]
      );
      await client.query("COMMIT");
      return res.status(400).json({error:invalidMessage});
    }

    if(await bcrypt.compare(password,user.password_hash)){
      await client.query("ROLLBACK");
      return res.status(400).json({error:"A nova senha precisa ser diferente da senha anterior."});
    }

    const hash=await bcrypt.hash(password,12);
    await client.query(
      `UPDATE users
       SET password_hash=$1,must_change_password=FALSE,password_changed_at=NOW(),
           password_reset_token_hash=NULL,password_reset_expires_at=NULL,
           password_reset_requested_at=NULL,password_reset_attempts=0,updated_at=NOW()
       WHERE id=$2`,
      [hash,user.id]
    );
    await client.query("DELETE FROM user_recovery_codes WHERE user_id=$1",[user.id]);
    await client.query("COMMIT");
    await audit(req,"SELF_SERVICE_PASSWORD_RESET","users",user.id);
    res.json({message:"Senha alterada com sucesso. Você já pode entrar no sistema."});
  }catch(error){
    await client.query("ROLLBACK");
    next(error);
  }finally{client.release();}
});

router.post("/reset-password",limiter,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const email=String(req.body.email||"").trim().toLowerCase();
    const recoveryCode=String(req.body.recoveryCode||"");
    const password=String(req.body.password||"");
    if(!email||!recoveryCode||password.length<8){
      return res.status(400).json({error:"Código inválido ou senha com menos de 8 caracteres."});
    }

    await client.query("BEGIN");
    const {rows}=await client.query(
      `SELECT u.id,u.password_hash
       FROM users u
       JOIN user_profiles p ON p.id=u.profile_id
       WHERE LOWER(u.email)=LOWER($1) AND u.active=TRUE AND p.master_admin=TRUE
       LIMIT 1 FOR UPDATE`,
      [email]
    );
    if(!rows[0]){
      await client.query("ROLLBACK");
      return res.status(400).json({error:"E-mail ou código de recuperação inválido."});
    }
    const codeResult=await client.query(
      `SELECT id FROM user_recovery_codes
       WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [rows[0].id,recoveryCodeHash(recoveryCode)]
    );
    if(!codeResult.rows[0]){
      await client.query("ROLLBACK");
      return res.status(400).json({error:"E-mail ou código de recuperação inválido."});
    }
    if(await bcrypt.compare(password,rows[0].password_hash)){
      await client.query("ROLLBACK");
      return res.status(400).json({error:"A nova senha precisa ser diferente da senha anterior."});
    }

    const hash=await bcrypt.hash(password,12);
    await client.query(
      `UPDATE users
       SET password_hash=$1,must_change_password=FALSE,password_changed_at=NOW(),
           password_reset_token_hash=NULL,password_reset_expires_at=NULL,
           password_reset_requested_at=NULL,password_reset_attempts=0,updated_at=NOW()
       WHERE id=$2`,
      [hash,rows[0].id]
    );
    const newRecoveryCodes=await replaceRecoveryCodes(client,rows[0].id);
    await client.query("COMMIT");
    res.json({
      message:"Senha Master redefinida. Guarde os novos códigos; eles serão exibidos somente agora.",
      recoveryCodes:newRecoveryCodes
    });
  }catch(error){
    await client.query("ROLLBACK");
    next(error);
  }finally{client.release();}
});

router.post("/change-password",authenticate,async(req,res,next)=>{
  try{
    const currentPassword=String(req.body.currentPassword||"");
    const newPassword=String(req.body.newPassword||"");
    if(!currentPassword||newPassword.length<8){
      return res.status(400).json({error:"Informe a senha atual e uma nova senha com pelo menos 8 caracteres."});
    }
    const {rows}=await pool.query(
      "SELECT id,password_hash,active FROM users WHERE id=$1 LIMIT 1",
      [req.user.sub]
    );
    const user=rows[0];
    if(!user||!user.active)return res.status(401).json({error:"Usuário inválido ou inativo."});
    if(!(await bcrypt.compare(currentPassword,user.password_hash))){
      return res.status(400).json({error:"A senha atual está incorreta."});
    }
    if(await bcrypt.compare(newPassword,user.password_hash)){
      return res.status(400).json({error:"A nova senha precisa ser diferente da senha atual."});
    }
    const hash=await bcrypt.hash(newPassword,12);
    await pool.query(
      `UPDATE users
       SET password_hash=$1,must_change_password=FALSE,password_changed_at=NOW(),
           password_reset_token_hash=NULL,password_reset_expires_at=NULL,
           password_reset_requested_at=NULL,password_reset_attempts=0,updated_at=NOW()
       WHERE id=$2`,
      [hash,req.user.sub]
    );
    const payload={...req.user,mustChangePassword:false};
    delete payload.iat;
    delete payload.exp;
    const token=jwt.sign(payload,process.env.JWT_SECRET,{expiresIn:"8h"});
    res.json({message:"Senha alterada com sucesso.",token});
  }catch(error){next(error);}
});

router.get("/master-recovery-codes/status",authenticate,async(req,res,next)=>{
  try{
    if(req.user?.isMasterAdmin!==true){
      return res.status(403).json({error:"Acesso exclusivo do Administrador Master."});
    }
    const {rows}=await pool.query(
      `SELECT COUNT(*) FILTER (WHERE used_at IS NULL)::int available,
              MAX(created_at) created_at
       FROM user_recovery_codes WHERE user_id=$1`,
      [req.user.sub]
    );
    res.json({available:rows[0]?.available||0,createdAt:rows[0]?.created_at||null});
  }catch(error){next(error);}
});

router.post("/master-recovery-codes/regenerate",authenticate,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    if(req.user?.isMasterAdmin!==true){
      return res.status(403).json({error:"Acesso exclusivo do Administrador Master."});
    }
    const currentPassword=String(req.body.currentPassword||"");
    const {rows}=await client.query(
      "SELECT password_hash FROM users WHERE id=$1 AND active=TRUE LIMIT 1",
      [req.user.sub]
    );
    if(!rows[0]||!(await bcrypt.compare(currentPassword,rows[0].password_hash))){
      return res.status(400).json({error:"A senha atual está incorreta."});
    }
    await client.query("BEGIN");
    const recoveryCodes=await replaceRecoveryCodes(client,req.user.sub);
    await client.query("COMMIT");
    res.json({
      message:"Novos códigos gerados. Os anteriores foram cancelados.",
      recoveryCodes
    });
  }catch(error){
    await client.query("ROLLBACK");
    next(error);
  }finally{client.release();}
});

router.get("/me",authenticate,async(req,res,next)=>{
  try{
    const {rows}=await pool.query(`
      SELECT u.id,u.name,u.email,u.role,u.company_id,u.active,u.must_change_password,
             COALESCE(p.name,CASE WHEN u.role='ADMIN' THEN 'Administrador' ELSE 'RH' END) profile_name,
             COALESCE(p.master_admin,FALSE) is_master_admin,
             COALESCE(c.trade_name,c.legal_name) company_name,
             COALESCE((
               SELECT json_agg(b.name ORDER BY b.name)
               FROM user_branches ub
               JOIN branches b ON b.id=ub.branch_id
               WHERE ub.user_id=u.id
             ),'[]'::json) branch_names
      FROM users u
      LEFT JOIN companies c ON c.id=u.company_id
      LEFT JOIN user_profiles p ON p.id=u.profile_id
      WHERE u.id=$1
    `,[req.user.sub]);
    if(!rows[0])return res.status(404).json({error:"Usuário não encontrado."});
    res.json(rows[0]);
  }catch(error){next(error);}
});

module.exports=router;
