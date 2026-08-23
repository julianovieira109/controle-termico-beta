const express=require("express");
const bcrypt=require("bcryptjs");
const crypto=require("crypto");
const pool=require("../db/pool");
const audit=require("../db/audit");
const {authenticate,requireAdmin,requireMasterAdmin}=require("../middleware/auth");
const router=express.Router();
router.use(authenticate,requireAdmin);

function requesterIsMaster(req){
  return req.user?.role==="ADMIN"&&req.user?.isMasterAdmin===true;
}

async function userAccessRecord(client,userId){
  const {rows}=await client.query(`
    SELECT u.id,u.name,u.email,u.role,u.profile_id,
           COALESCE(p.master_admin,FALSE) is_master_admin
    FROM users u
    LEFT JOIN user_profiles p ON p.id=u.profile_id
    WHERE u.id=$1
    LIMIT 1
  `,[userId]);
  return rows[0]||null;
}

function masterProtectionError(req,target){
  if(!target?.is_master_admin)return null;
  if(requesterIsMaster(req)&&String(req.user.sub)===String(target.id))return null;
  return "O Administrador Master é protegido e não pode ser alterado por outro usuário. Para solicitar essa alteração, entre em contato com o Suporte.";
}

function randomTemporaryPassword(){
  const upper="ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower="abcdefghijkmnopqrstuvwxyz";
  const digits="23456789";
  const symbols="!@#$%";
  const all=upper+lower+digits+symbols;
  const pick=chars=>chars[crypto.randomInt(0,chars.length)];
  const characters=[pick(upper),pick(lower),pick(digits),pick(symbols)];
  while(characters.length<14)characters.push(pick(all));
  for(let index=characters.length-1;index>0;index--){
    const swap=crypto.randomInt(0,index+1);
    [characters[index],characters[swap]]=[characters[swap],characters[index]];
  }
  return characters.join("");
}

router.get("/security-access",requireMasterAdmin,async(_req,res,next)=>{
  try{
    const {rows}=await pool.query(`
      SELECT
        u.id,u.name,u.email,u.role,u.active,u.must_change_password,
        COALESCE(p.name,CASE WHEN u.role='ADMIN' THEN 'Administrador' ELSE 'Operacional / DP' END) profile_name,
        COALESCE(p.master_admin,FALSE) is_master_admin,
        COALESCE(activity.successful_logins,0)::int successful_logins,
        COALESCE(activity.failed_logins,0)::int failed_logins,
        COALESCE(activity.recovery_requests,0)::int recovery_requests,
        COALESCE(activity.temporary_passwords,0)::int temporary_passwords,
        activity.last_success_at,
        activity.last_failed_at,
        activity.last_attempt_at
      FROM users u
      LEFT JOIN user_profiles p ON p.id=u.profile_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE a.action='LOGIN_SUCCESS') successful_logins,
          COUNT(*) FILTER (WHERE a.action='LOGIN_FAILED') failed_logins,
          COUNT(*) FILTER (WHERE a.action='PASSWORD_RESET_EMAIL_SENT') recovery_requests,
          COUNT(*) FILTER (WHERE a.action='TEMPORARY_PASSWORD') temporary_passwords,
          MAX(a.created_at) FILTER (WHERE a.action='LOGIN_SUCCESS') last_success_at,
          MAX(a.created_at) FILTER (WHERE a.action='LOGIN_FAILED') last_failed_at,
          MAX(a.created_at) FILTER (WHERE a.action IN ('LOGIN_SUCCESS','LOGIN_FAILED')) last_attempt_at
        FROM audit_logs a
        WHERE a.entity='users' AND a.entity_id=u.id
      ) activity ON TRUE
      ORDER BY u.active DESC,u.name
    `);
    res.json(rows);
  }catch(error){next(error);}
});


router.get("/company-branches",async(_req,res,next)=>{
  try{
    const {rows}=await pool.query(`
      SELECT
        c.id company_id,
        c.trade_name company_name,
        c.legal_name,
        c.cnpj,
        c.city,
        c.state,
        c.active company_active,
        (SELECT COUNT(*)::int FROM employees e WHERE e.company_id=c.id AND e.status='ATIVO') employee_count,
        (SELECT COUNT(*)::int FROM users u WHERE u.company_id=c.id AND u.role='RH' AND u.active=TRUE) rh_count,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id',b.id,
                'name',b.name,
                'cnpj',b.cnpj,
                'city',b.city,
                'state',b.state,
                'active',b.active,
                'internal_code',b.internal_code,
                'employee_count',(SELECT COUNT(*)::int FROM employees e2 WHERE e2.branch_id=b.id AND e2.status='ATIVO')
              )
              ORDER BY b.name
            )
            FROM branches b
            WHERE b.company_id=c.id
          ),
          '[]'::json
        ) branches
      FROM companies c
      ORDER BY c.trade_name
    `);
    res.json(rows);
  }catch(e){next(e);}
});

router.get("/companies",async(_req,res,next)=>{
  try{
    const {rows}=await pool.query(`SELECT c.*,(SELECT COUNT(*)::int FROM branches b WHERE b.company_id=c.id) branch_count FROM companies c ORDER BY c.trade_name`);
    res.json(rows);
  }catch(e){next(e);}
});
router.post("/companies",async(req,res,next)=>{
  try{
    const {legalName,tradeName,cnpj,city,state,active=true}=req.body;
    if(!legalName||!tradeName)return res.status(400).json({error:"Razão social e nome fantasia são obrigatórios."});
    const {rows}=await pool.query(`INSERT INTO companies(legal_name,trade_name,cnpj,city,state,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [legalName,tradeName,cnpj||null,city||null,state||null,Boolean(active)]);
    await audit(req,"CREATE","companies",rows[0].id);
    res.status(201).json(rows[0]);
  }catch(e){next(e);}
});
router.put("/companies/:id",async(req,res,next)=>{
  try{
    const {legalName,tradeName,cnpj,city,state,active=true}=req.body;
    const {rows}=await pool.query(`UPDATE companies SET legal_name=$1,trade_name=$2,cnpj=$3,city=$4,state=$5,active=$6,updated_at=NOW() WHERE id=$7 RETURNING *`,
      [legalName,tradeName,cnpj||null,city||null,state||null,Boolean(active),req.params.id]);
    if(!rows[0])return res.status(404).json({error:"Empresa não encontrada."});
    await audit(req,"UPDATE","companies",req.params.id);
    res.json(rows[0]);
  }catch(e){next(e);}
});


router.delete("/companies/:id",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const company=await client.query(
      "SELECT id,trade_name,legal_name FROM companies WHERE id=$1 LIMIT 1",
      [req.params.id]
    );

    if(!company.rows[0]){
      return res.status(404).json({error:"Empresa não encontrada."});
    }

    const [branches,users,employees]=await Promise.all([
      client.query("SELECT COUNT(*)::int total FROM branches WHERE company_id=$1",[req.params.id]),
      client.query("SELECT COUNT(*)::int total FROM users WHERE company_id=$1",[req.params.id]),
      client.query("SELECT COUNT(*)::int total FROM employees WHERE company_id=$1",[req.params.id])
    ]);

    const branchCount=branches.rows[0].total;
    const userCount=users.rows[0].total;
    const employeeCount=employees.rows[0].total;

    if(branchCount>0||userCount>0||employeeCount>0){
      const links=[];
      if(branchCount>0)links.push(`${branchCount} filial(is)`);
      if(userCount>0)links.push(`${userCount} usuário(s)`);
      if(employeeCount>0)links.push(`${employeeCount} colaborador(es)`);

      return res.status(409).json({
        error:`Não é possível excluir esta empresa porque existem ${links.join(", ")} vinculados.`
      });
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM companies WHERE id=$1",[req.params.id]);
    await client.query("COMMIT");

    await audit(req,"DELETE","companies",req.params.id,{
      tradeName:company.rows[0].trade_name,
      legalName:company.rows[0].legal_name
    });

    res.status(204).end();
  }catch(e){
    await client.query("ROLLBACK");
    if(e.code==="23503"){
      return res.status(409).json({
        error:"Não foi possível excluir a empresa porque ainda existem registros vinculados."
      });
    }
    next(e);
  }finally{
    client.release();
  }
});

router.get("/branches",async(_req,res,next)=>{
  try{
    const {rows}=await pool.query(`
      SELECT
        b.*,
        c.trade_name company_name,
        (SELECT COUNT(*)::int FROM employees e WHERE e.branch_id=b.id AND e.status='ATIVO') employee_count,
        (
          SELECT COUNT(DISTINCT ub.user_id)::int
          FROM user_branches ub
          JOIN users u ON u.id=ub.user_id
          WHERE ub.branch_id=b.id
            AND u.role='RH'
            AND u.active=TRUE
        ) rh_count
      FROM branches b
      JOIN companies c ON c.id=b.company_id
      ORDER BY c.trade_name,b.name
    `);
    res.json(rows);
  }catch(e){next(e);}
});
router.post("/branches",async(req,res,next)=>{
  try{
    const {companyId,name,cnpj,internalCode,city,state,active=true}=req.body;
    if(!companyId||!name)return res.status(400).json({error:"Empresa e nome da filial são obrigatórios."});
    const company=await pool.query("SELECT id FROM companies WHERE id=$1 AND active=TRUE LIMIT 1",[companyId]);
    if(!company.rows[0])return res.status(400).json({error:"Selecione uma empresa ativa para vincular a filial."});
    const {rows}=await pool.query(`INSERT INTO branches(company_id,name,cnpj,internal_code,city,state,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [companyId,name,cnpj||null,internalCode||null,city||null,state||null,Boolean(active)]);
    await audit(req,"CREATE","branches",rows[0].id);
    res.status(201).json(rows[0]);
  }catch(e){next(e);}
});


router.put("/branches/:id",async(req,res,next)=>{
  try{
    const {companyId,name,cnpj,internalCode,city,state,active=true}=req.body;
    if(!companyId||!name){
      return res.status(400).json({error:"Empresa e nome da filial são obrigatórios."});
    }

    const company=await pool.query(
      "SELECT id FROM companies WHERE id=$1 AND active=TRUE LIMIT 1",
      [companyId]
    );
    if(!company.rows[0]){
      return res.status(400).json({error:"Selecione uma empresa ativa para vincular a filial."});
    }

    const {rows}=await pool.query(`
      UPDATE branches
      SET company_id=$1,name=$2,cnpj=$3,internal_code=$4,city=$5,state=$6,active=$7,updated_at=NOW()
      WHERE id=$8
      RETURNING *
    `,[companyId,name,cnpj||null,internalCode||null,city||null,state||null,Boolean(active),req.params.id]);

    if(!rows[0])return res.status(404).json({error:"Filial não encontrada."});
    await audit(req,"UPDATE","branches",req.params.id);
    res.json(rows[0]);
  }catch(e){next(e);}
});


router.delete("/branches/:id",async(req,res,next)=>{
  try{
    const [userBranches,legacyUsers,employees]=await Promise.all([
      pool.query("SELECT COUNT(*)::int total FROM user_branches WHERE branch_id=$1",[req.params.id]),
      pool.query("SELECT COUNT(*)::int total FROM users WHERE branch_id=$1",[req.params.id]),
      pool.query("SELECT COUNT(*)::int total FROM employees WHERE branch_id=$1",[req.params.id])
    ]);

    const userCount=Math.max(userBranches.rows[0].total,legacyUsers.rows[0].total);
    const employeeCount=employees.rows[0].total;

    if(userCount>0||employeeCount>0){
      const links=[];
      if(userCount>0)links.push(`${userCount} usuário(s)`);
      if(employeeCount>0)links.push(`${employeeCount} colaborador(es)`);

      return res.status(409).json({
        error:`Não é possível excluir esta filial porque existem ${links.join(" e ")} vinculados.`
      });
    }

    const deleted=await pool.query("DELETE FROM branches WHERE id=$1 RETURNING id",[req.params.id]);
    if(!deleted.rows[0])return res.status(404).json({error:"Filial não encontrada."});

    await audit(req,"DELETE","branches",req.params.id);
    res.status(204).end();
  }catch(e){next(e);}
});

router.get("/user-profiles",async(req,res,next)=>{
  try{
    const {rows}=await pool.query(`
      SELECT p.*,
        (SELECT COUNT(*)::int FROM users u
         WHERE u.profile_id=p.id
            OR (u.profile_id IS NULL AND p.name='Administrador' AND u.role='ADMIN')
            OR (u.profile_id IS NULL AND p.name='RH' AND u.role='RH')
        ) user_count,
        COALESCE(
          (SELECT json_object_agg(pp.permission_key,pp.allowed)
           FROM profile_permissions pp WHERE pp.profile_id=p.id),
          '{}'::json
        ) permissions
      FROM user_profiles p
      WHERE p.master_admin=FALSE OR $1::boolean=TRUE
      ORDER BY p.master_admin DESC,p.protected DESC,p.name`,[requesterIsMaster(req)]);
    res.json(rows);
  }catch(e){next(e);}
});

router.post("/user-profiles",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const name=String(req.body.name||"").trim().slice(0,80);
    const permissions=req.body.permissions&&typeof req.body.permissions==="object"?req.body.permissions:{};
    if(!name)return res.status(400).json({error:"Informe o nome do perfil."});

    await client.query("BEGIN");
    const {rows}=await client.query(
      `INSERT INTO user_profiles(name,base_role,protected,active)
       VALUES($1,'RH',FALSE,TRUE) RETURNING *`,[name]);

    for(const [key,allowed] of Object.entries(permissions)){
      await client.query(
        `INSERT INTO profile_permissions(profile_id,permission_key,allowed)
         VALUES($1,$2,$3)
         ON CONFLICT(profile_id,permission_key) DO UPDATE SET allowed=EXCLUDED.allowed`,
        [rows[0].id,key,Boolean(allowed)]
      );
    }

    await client.query("COMMIT");
    await audit(req,"CREATE","user_profiles",rows[0].id,{name,permissions});
    res.status(201).json(rows[0]);
  }catch(e){
    await client.query("ROLLBACK");
    if(e.code==="23505")return res.status(409).json({error:"Já existe um perfil com esse nome."});
    next(e);
  }finally{client.release();}
});

router.put("/user-profiles/:id",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const current=await client.query("SELECT * FROM user_profiles WHERE id=$1",[req.params.id]);
    if(!current.rows[0])return res.status(404).json({error:"Perfil não encontrado."});
    if(current.rows[0].protected)return res.status(400).json({error:"O perfil Administrador é protegido."});

    const name=String(req.body.name||"").trim().slice(0,80);
    const permissions=req.body.permissions&&typeof req.body.permissions==="object"?req.body.permissions:{};
    if(!name)return res.status(400).json({error:"Informe o nome do perfil."});

    await client.query("BEGIN");
    const {rows}=await client.query(
      "UPDATE user_profiles SET name=$1,updated_at=NOW() WHERE id=$2 RETURNING *",
      [name,req.params.id]
    );

    await client.query("DELETE FROM profile_permissions WHERE profile_id=$1",[req.params.id]);
    for(const [key,allowed] of Object.entries(permissions)){
      await client.query(
        "INSERT INTO profile_permissions(profile_id,permission_key,allowed) VALUES($1,$2,$3)",
        [req.params.id,key,Boolean(allowed)]
      );
    }

    await client.query("COMMIT");
    await audit(req,"UPDATE","user_profiles",req.params.id,{name,permissions});
    res.json(rows[0]);
  }catch(e){
    await client.query("ROLLBACK");
    if(e.code==="23505")return res.status(409).json({error:"Já existe um perfil com esse nome."});
    next(e);
  }finally{client.release();}
});

router.delete("/user-profiles/:id",async(req,res,next)=>{
  try{
    const current=await pool.query("SELECT * FROM user_profiles WHERE id=$1",[req.params.id]);
    const p=current.rows[0];
    if(!p)return res.status(404).json({error:"Perfil não encontrado."});
    if(p.protected)return res.status(400).json({error:"O perfil Administrador é protegido e não pode ser excluído."});
    const count=await pool.query(
      `SELECT COUNT(*)::int total FROM users
       WHERE profile_id=$1
          OR (profile_id IS NULL AND $2='RH' AND role='RH')`,
      [req.params.id,p.name]
    );
    if(count.rows[0].total>0){
      return res.status(409).json({error:`Não é possível excluir: ${count.rows[0].total} usuário(s) utilizam este perfil.`});
    }
    await pool.query("DELETE FROM user_profiles WHERE id=$1",[req.params.id]);
    res.status(204).end();
  }catch(e){next(e);}
});

router.get("/users",async(_req,res,next)=>{
  try{
    const {rows}=await pool.query(`
      SELECT u.id,u.name,u.email,u.role,u.profile_id,u.company_id,u.active,u.must_change_password,c.trade_name company_name,
      COALESCE(p.name,CASE WHEN u.role='ADMIN' THEN 'Administrador' ELSE 'RH' END) profile_name,
      COALESCE(p.master_admin,FALSE) is_master_admin,
      COALESCE((SELECT json_agg(json_build_object('id',b.id,'name',b.name) ORDER BY b.name)
      FROM user_branches ub JOIN branches b ON b.id=ub.branch_id WHERE ub.user_id=u.id),'[]'::json) branches,
      COALESCE(
        (SELECT allowed FROM user_permissions up
         WHERE up.user_id=u.id AND up.permission_key='calendar.manage' AND up.allowed=TRUE LIMIT 1),
        (SELECT allowed FROM profile_permissions pp
         WHERE pp.profile_id=u.profile_id AND pp.permission_key='calendar.manage' LIMIT 1),
        FALSE
      ) calendar_access
      FROM users u
      LEFT JOIN companies c ON c.id=u.company_id
      LEFT JOIN user_profiles p ON p.id=u.profile_id
      ORDER BY u.name`);
    res.json(rows);
  }catch(e){next(e);}
});
router.post("/users",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const {name,email,password,profileId,companyId,branchIds=[],calendarAccess=false,active=true}=req.body;
    if(!name||!email||!password||!profileId)return res.status(400).json({error:"Preencha os campos obrigatórios."});
    if(password.length<8)return res.status(400).json({error:"A senha deve ter no mínimo 8 caracteres."});

    const profileQuery=await client.query(
      "SELECT id,name,base_role,protected,master_admin,active FROM user_profiles WHERE id=$1 LIMIT 1",
      [profileId]
    );
    const profile=profileQuery.rows[0];
    if(!profile||profile.active===false)return res.status(400).json({error:"Perfil inválido ou inativo."});
    if(profile.master_admin)return res.status(403).json({error:"Não é permitido cadastrar outro Administrador Master."});
    const role=profile.base_role;
    if(role==="RH"&&(!companyId||!branchIds.length))return res.status(400).json({error:"O acesso Operacional / DP precisa de empresa e pelo menos uma filial."});
    if(role==="RH"){
      const validBranches=await client.query(
        `SELECT id FROM branches
         WHERE company_id=$1
           AND active=TRUE
           AND id=ANY($2::uuid[])`,
        [companyId,branchIds]
      );
      if(validBranches.rows.length!==branchIds.length){
        return res.status(400).json({error:"Uma ou mais filiais não pertencem à empresa selecionada."});
      }
    }

    const hash=await bcrypt.hash(password,12);
    await client.query("BEGIN");
    const {rows}=await client.query(`INSERT INTO users(name,email,password_hash,role,profile_id,company_id,branch_id,active,must_change_password)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING id,name,email,role,profile_id,company_id,active,must_change_password`,
      [name,email.toLowerCase(),hash,role,profileId,role==="ADMIN"?null:companyId,role==="ADMIN"?null:branchIds[0],Boolean(active)]);
    if(role==="RH"){
      for(const branchId of branchIds){
        await client.query("INSERT INTO user_branches(user_id,branch_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[rows[0].id,branchId]);
      }
      if(Boolean(calendarAccess)){
        await client.query(
          `INSERT INTO user_permissions(user_id,permission_key,allowed)
           VALUES($1,'calendar.manage',TRUE)
           ON CONFLICT(user_id,permission_key) DO UPDATE SET allowed=TRUE`,
          [rows[0].id]
        );
      }
    }
    await client.query("COMMIT");
    await audit(req,"CREATE","users",rows[0].id);
    res.status(201).json(rows[0]);
  }catch(e){
    await client.query("ROLLBACK");
    if(e.code==="23505"){
      return res.status(409).json({error:"Já existe um usuário com esse e-mail."});
    }
    next(e);
  }finally{
    client.release();
  }
});


router.put("/users/:id",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const {name,email,password,profileId,companyId,branchIds=[],calendarAccess=false,active=true}=req.body;
    if(!name||!email||!profileId)return res.status(400).json({error:"Preencha os campos obrigatórios."});

    const target=await userAccessRecord(client,req.params.id);
    if(!target)return res.status(404).json({error:"Usuário não encontrado."});
    const protectionError=masterProtectionError(req,target);
    if(protectionError)return res.status(403).json({error:protectionError});

    const profileQuery=await client.query(
      "SELECT id,name,base_role,protected,master_admin,active FROM user_profiles WHERE id=$1 LIMIT 1",
      [profileId]
    );
    const profile=profileQuery.rows[0];
    if(!profile||profile.active===false)return res.status(400).json({error:"Perfil inválido ou inativo."});
    if(profile.master_admin&&(!target.is_master_admin||!requesterIsMaster(req)||String(req.user.sub)!==String(target.id))){
      return res.status(403).json({error:"Não é permitido atribuir o perfil Administrador Master a outro usuário."});
    }
    if(target.is_master_admin&&!profile.master_admin){
      return res.status(400).json({error:"O Administrador Master não pode ser rebaixado para outro perfil."});
    }
    const role=profile.base_role;

    if(role==="RH"&&(!companyId||!branchIds.length)){
      return res.status(400).json({error:"O acesso Operacional / DP precisa de empresa e pelo menos uma filial."});
    }
    if(password && password.length<8){
      return res.status(400).json({error:"A senha deve ter no mínimo 8 caracteres."});
    }

    if(role==="RH"){
      const validBranches=await client.query(
        `SELECT id FROM branches
         WHERE company_id=$1
           AND active=TRUE
           AND id=ANY($2::uuid[])`,
        [companyId,branchIds]
      );
      if(validBranches.rows.length!==branchIds.length){
        return res.status(400).json({error:"Uma ou mais filiais não pertencem à empresa selecionada."});
      }
    }

    await client.query("BEGIN");
    const primaryBranch=role==="ADMIN"?null:branchIds[0];
    const {rows}=await client.query(
      `UPDATE users
       SET name=$1,email=$2,role=$3,profile_id=$4,company_id=$5,branch_id=$6,active=$7,updated_at=NOW()
       WHERE id=$8
       RETURNING id,name,email,role,profile_id,company_id,active`,
      [name,email.toLowerCase(),role,profileId,role==="ADMIN"?null:companyId,primaryBranch,Boolean(active),req.params.id]
    );
    if(!rows[0]){
      await client.query("ROLLBACK");
      return res.status(404).json({error:"Usuário não encontrado."});
    }

    if(password){
      if(target.is_master_admin){
        await client.query("ROLLBACK");
        return res.status(400).json({error:"Use a opção Minha senha para alterar a senha do Administrador Master."});
      }
      if(!requesterIsMaster(req)){
        await client.query("ROLLBACK");
        return res.status(403).json({error:"Somente o Administrador Master pode redefinir a senha de outro usuário."});
      }
      const hash=await bcrypt.hash(password,12);
      await client.query(
        `UPDATE users SET password_hash=$1,must_change_password=TRUE,password_changed_at=NOW(),
         password_reset_token_hash=NULL,password_reset_expires_at=NULL,
         password_reset_requested_at=NULL,password_reset_attempts=0 WHERE id=$2`,
        [hash,req.params.id]
      );
    }

    await client.query("DELETE FROM user_branches WHERE user_id=$1",[req.params.id]);
    await client.query("DELETE FROM user_permissions WHERE user_id=$1",[req.params.id]);

    if(role==="RH"){
      for(const branchId of branchIds){
        await client.query(
          "INSERT INTO user_branches(user_id,branch_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [req.params.id,branchId]
        );
      }
      if(Boolean(calendarAccess)){
        await client.query(
          `INSERT INTO user_permissions(user_id,permission_key,allowed)
           VALUES($1,'calendar.manage',TRUE)`,
          [req.params.id]
        );
      }
    }

    await client.query("COMMIT");
    await audit(req,"UPDATE","users",req.params.id);
    res.json(rows[0]);
  }catch(e){
    await client.query("ROLLBACK");
    if(e.code==="23505")return res.status(409).json({error:"Já existe um usuário com esse e-mail."});
    next(e);
  }finally{
    client.release();
  }
});



router.patch("/users/:id/password",requireMasterAdmin,async(req,res,next)=>{
  try{
    const {password}=req.body;
    if(!password||password.length<8){
      return res.status(400).json({error:"A nova senha deve ter no mínimo 8 caracteres."});
    }

    const target=await userAccessRecord(pool,req.params.id);
    if(!target)return res.status(404).json({error:"Usuário não encontrado."});
    const protectionError=masterProtectionError(req,target);
    if(protectionError)return res.status(403).json({error:protectionError});

    if(target.is_master_admin){
      return res.status(400).json({error:"Use a opção Minha senha para alterar sua própria senha."});
    }
    const hash=await bcrypt.hash(password,12);
    const {rows}=await pool.query(
      `UPDATE users SET password_hash=$1,must_change_password=TRUE,password_changed_at=NOW(),
       password_reset_token_hash=NULL,password_reset_expires_at=NULL,
       password_reset_requested_at=NULL,password_reset_attempts=0,updated_at=NOW()
       WHERE id=$2 RETURNING id,name,email`,
      [hash,req.params.id]
    );

    if(!rows[0])return res.status(404).json({error:"Usuário não encontrado."});
    await audit(req,"RESET_PASSWORD","users",req.params.id,{email:rows[0].email});
    res.json({message:"Senha alterada com sucesso."});
  }catch(e){next(e);}
});

router.post("/users/:id/temporary-password",requireMasterAdmin,async(req,res,next)=>{
  try{
    const target=await userAccessRecord(pool,req.params.id);
    if(!target)return res.status(404).json({error:"Usuário não encontrado."});
    if(target.is_master_admin){
      return res.status(400).json({error:"A conta Master deve usar Minha senha ou um código de recuperação."});
    }

    const temporaryPassword=randomTemporaryPassword();
    const hash=await bcrypt.hash(temporaryPassword,12);
    await pool.query(
      `UPDATE users
       SET password_hash=$1,must_change_password=TRUE,password_changed_at=NOW(),
           password_reset_token_hash=NULL,password_reset_expires_at=NULL,
           password_reset_requested_at=NULL,password_reset_attempts=0,updated_at=NOW()
       WHERE id=$2`,
      [hash,req.params.id]
    );
    await audit(req,"TEMPORARY_PASSWORD","users",req.params.id,{email:target.email});
    res.json({
      message:"Senha temporária gerada. Ela será exibida somente agora.",
      temporaryPassword
    });
  }catch(e){next(e);}
});

router.patch("/users/:id/active",async(req,res,next)=>{
  try{
    if(req.params.id===req.user.sub){
      return res.status(400).json({error:"Você não pode bloquear o próprio usuário."});
    }

    const target=await userAccessRecord(pool,req.params.id);
    if(!target)return res.status(404).json({error:"Usuário não encontrado."});
    const protectionError=masterProtectionError(req,target);
    if(protectionError)return res.status(403).json({error:protectionError});

    const {active}=req.body;
    const {rows}=await pool.query(
      "UPDATE users SET active=$1,updated_at=NOW() WHERE id=$2 RETURNING id,name,email,active",
      [Boolean(active),req.params.id]
    );

    if(!rows[0])return res.status(404).json({error:"Usuário não encontrado."});
    await audit(req,Boolean(active)?"UNBLOCK":"BLOCK","users",req.params.id,{email:rows[0].email});
    res.json(rows[0]);
  }catch(e){next(e);}
});

router.delete("/users/:id",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    if(req.params.id===req.user.sub){
      return res.status(400).json({error:"Você não pode excluir o próprio usuário."});
    }

    const target=await userAccessRecord(client,req.params.id);
    if(!target)return res.status(404).json({error:"Usuário não encontrado."});
    if(target.is_master_admin){
      if(!requesterIsMaster(req)){
        return res.status(403).json({error:"Somente outro Administrador Master pode excluir esta conta. Entre em contato com o Suporte."});
      }
      const remainingMasters=await client.query(`
        SELECT COUNT(*)::int total
        FROM users u
        JOIN user_profiles p ON p.id=u.profile_id
        WHERE p.master_admin=TRUE
          AND u.active=TRUE
          AND u.id<>$1
      `,[target.id]);
      if(Number(remainingMasters.rows[0]?.total||0)<1){
        return res.status(409).json({error:"Não é possível excluir o último Administrador Master ativo."});
      }
    }else{
      const protectionError=masterProtectionError(req,target);
      if(protectionError)return res.status(403).json({error:protectionError});
    }

    const current=await client.query(
      "SELECT id,name,email,role FROM users WHERE id=$1 LIMIT 1",
      [req.params.id]
    );

    if(!current.rows[0]){
      return res.status(404).json({error:"Usuário não encontrado."});
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM user_permissions WHERE user_id=$1",[req.params.id]);
    await client.query("DELETE FROM user_branches WHERE user_id=$1",[req.params.id]);
    await client.query("DELETE FROM users WHERE id=$1",[req.params.id]);
    await client.query("COMMIT");

    await audit(req,"DELETE","users",req.params.id,{
      name:current.rows[0].name,
      email:current.rows[0].email,
      role:current.rows[0].role
    });

    res.status(204).end();
  }catch(e){
    await client.query("ROLLBACK");
    next(e);
  }finally{
    client.release();
  }
});


router.get("/employees/duplicates",async(req,res,next)=>{
  try{
    const {rows}=await pool.query(`
      SELECT e.registration,
             COUNT(*)::int total,
             JSON_AGG(
               JSON_BUILD_OBJECT(
                 'id',e.id,
                 'fullName',e.full_name,
                 'companyName',c.trade_name,
                 'branchName',b.name,
                 'shiftName',s.name,
                 'jobTitle',COALESCE(jr.name,e.job_title),
                 'status',e.status,
                 'source',e.source,
                 'lastImportedAt',e.last_imported_at,
                 'createdAt',e.created_at,
                 'daysOffCount',(
                   SELECT COUNT(*)::int
                   FROM employee_days_off edo
                   WHERE edo.employee_id=e.id
                 )
               )
               ORDER BY e.created_at ASC
             ) records
      FROM employees e
      LEFT JOIN companies c ON c.id=e.company_id
      LEFT JOIN branches b ON b.id=e.branch_id
      LEFT JOIN shifts s ON s.id=e.shift_id
      LEFT JOIN job_roles jr ON jr.id=e.job_role_id
      WHERE e.registration IS NOT NULL
        AND TRIM(e.registration)<>''
      GROUP BY e.registration
      HAVING COUNT(*)>1
      ORDER BY e.registration
    `);

    const groups=rows.map(group=>{
      const records=group.records||[];
      const suggestedKeep=records
        .slice()
        .sort((a,b)=>{
          const aHistory=Number(a.daysOffCount||0)>0?1:0;
          const bHistory=Number(b.daysOffCount||0)>0?1:0;
          if(aHistory!==bHistory)return bHistory-aHistory;

          const aShift=a.shiftName?1:0;
          const bShift=b.shiftName?1:0;
          if(aShift!==bShift)return bShift-aShift;

          const aSource=a.source==="SENIOR"?1:0;
          const bSource=b.source==="SENIOR"?1:0;
          if(aSource!==bSource)return bSource-aSource;

          return new Date(a.createdAt||0)-new Date(b.createdAt||0);
        })[0]||null;

      return {
        ...group,
        suggestedKeepId:suggestedKeep?.id||null
      };
    });

    res.json({
      totalGroups:groups.length,
      totalRecords:groups.reduce((sum,g)=>sum+Number(g.total||0),0),
      groups
    });
  }catch(error){next(error);}
});

router.post("/employees/duplicates/resolve",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const {registration,keepId,deleteIds=[]}=req.body||{};

    if(!registration||!keepId||!Array.isArray(deleteIds)||!deleteIds.length){
      return res.status(400).json({
        error:"Informe a matrícula, o cadastro que será mantido e pelo menos um duplicado para remover."
      });
    }

    const group=await client.query(`
      SELECT e.id,e.registration,e.full_name,e.company_id,e.branch_id,e.shift_id,
             e.job_role_id,e.job_title,e.status,e.source,e.created_at,
             c.trade_name company_name,b.name branch_name,s.name shift_name
      FROM employees e
      LEFT JOIN companies c ON c.id=e.company_id
      LEFT JOIN branches b ON b.id=e.branch_id
      LEFT JOIN shifts s ON s.id=e.shift_id
      WHERE e.registration=$1
      ORDER BY e.created_at ASC
    `,[registration]);

    if(group.rows.length<2){
      return res.status(409).json({
        error:"Essa matrícula não possui mais duplicidade."
      });
    }

    const byId=new Map(group.rows.map(row=>[String(row.id),row]));
    const keep=byId.get(String(keepId));
    if(!keep){
      return res.status(400).json({
        error:"O cadastro escolhido para permanecer não pertence a esta matrícula."
      });
    }

    const uniqueDeleteIds=[...new Set(deleteIds.map(String))]
      .filter(id=>id!==String(keepId));

    if(!uniqueDeleteIds.length){
      return res.status(400).json({
        error:"Nenhum cadastro duplicado foi selecionado para remoção."
      });
    }

    for(const id of uniqueDeleteIds){
      if(!byId.has(id)){
        return res.status(400).json({
          error:"Um dos cadastros selecionados não pertence ao grupo de duplicidade."
        });
      }
    }

    const history=await client.query(`
      SELECT employee_id,COUNT(*)::int total
      FROM employee_days_off
      WHERE employee_id = ANY($1::uuid[])
      GROUP BY employee_id
    `,[uniqueDeleteIds]);

    if(history.rows.length){
      const blocked=history.rows
        .filter(row=>row.total>0)
        .map(row=>String(row.employee_id));

      if(blocked.length){
        return res.status(409).json({
          error:"Há cadastro(s) duplicado(s) com histórico de folgas vinculado. A remoção automática foi bloqueada.",
          blockedIds:blocked
        });
      }
    }

    await client.query("BEGIN");

    // Preserva informações úteis no cadastro mantido quando estiverem vazias.
    const deleteRows=uniqueDeleteIds.map(id=>byId.get(id));
    const fallbackShift=deleteRows.find(row=>row.shift_id)?.shift_id||null;
    const fallbackRole=deleteRows.find(row=>row.job_role_id)?.job_role_id||null;
    const fallbackJobTitle=deleteRows.find(row=>row.job_title)?.job_title||"";

    await client.query(`
      UPDATE employees
      SET shift_id=COALESCE(shift_id,$1),
          job_role_id=COALESCE(job_role_id,$2),
          job_title=CASE
            WHEN COALESCE(TRIM(job_title),'')='' THEN $3
            ELSE job_title
          END,
          updated_at=NOW()
      WHERE id=$4
    `,[fallbackShift,fallbackRole,fallbackJobTitle,keepId]);

    await client.query(
      "DELETE FROM employees WHERE id = ANY($1::uuid[])",
      [uniqueDeleteIds]
    );

    await client.query("COMMIT");

    await audit(req,"RESOLVE_DUPLICATES","employees",keepId,{
      registration,
      keptId:keepId,
      deletedIds:uniqueDeleteIds
    });

    res.json({
      message:`Duplicidade da matrícula ${registration} resolvida com sucesso.`,
      keptId:keepId,
      deletedIds:uniqueDeleteIds
    });
  }catch(error){
    await client.query("ROLLBACK").catch(()=>{});
    next(error);
  }finally{
    client.release();
  }
});

router.delete("/employees/duplicates/:id",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const target=await client.query(`
      SELECT e.id,e.registration,e.full_name,e.source,c.trade_name company_name,b.name branch_name
      FROM employees e
      LEFT JOIN companies c ON c.id=e.company_id
      LEFT JOIN branches b ON b.id=e.branch_id
      WHERE e.id=$1 LIMIT 1
    `,[req.params.id]);

    if(!target.rows[0])return res.status(404).json({error:"Colaborador duplicado não encontrado."});
    const employee=target.rows[0];

    const siblings=await client.query(
      "SELECT id FROM employees WHERE registration=$1 AND id<>$2",
      [employee.registration,employee.id]
    );
    if(!siblings.rows.length)return res.status(409).json({error:"Esta matrícula não está mais duplicada."});

    const history=await client.query(
      "SELECT COUNT(*)::int total FROM employee_days_off WHERE employee_id=$1",
      [employee.id]
    );
    if(history.rows[0].total>0){
      return res.status(409).json({
        error:"Este cadastro possui histórico vinculado e não pode ser removido automaticamente."
      });
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM employees WHERE id=$1",[employee.id]);
    await client.query("COMMIT");

    await audit(req,"DELETE_DUPLICATE","employees",employee.id,{
      registration:employee.registration,
      company:employee.company_name,
      branch:employee.branch_name,
      source:employee.source
    });

    res.json({
      message:"Cadastro duplicado removido com segurança.",
      registration:employee.registration
    });
  }catch(error){
    await client.query("ROLLBACK").catch(()=>{});
    next(error);
  }finally{
    client.release();
  }
});

module.exports=router;
