"use strict";
const pool=require("../db/pool");
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(message,status=403)=>Object.assign(new Error(message),{status});

async function resolveScope(userId,db=pool){
 if(!UUID.test(String(userId||"")))throw fail("Sessão inválida.",401);
 const q=await db.query(
  "SELECT u.id,u.name,u.role,u.company_id,u.active,COALESCE(p.master_admin,FALSE) master,"+
  "COALESCE(p.name,CASE WHEN u.role='ADMIN' THEN 'Administrador' ELSE 'Operacional / DP' END) profile_name,"+
  "EXISTS(SELECT 1 FROM profile_permissions pp WHERE pp.profile_id=u.profile_id AND pp.permission_key='documents.view' AND pp.allowed=TRUE) view_perm,"+
  "EXISTS(SELECT 1 FROM profile_permissions pp WHERE pp.profile_id=u.profile_id AND pp.permission_key='documents.manage' AND pp.allowed=TRUE) manage_perm,"+
  "EXISTS(SELECT 1 FROM user_permissions up WHERE up.user_id=u.id AND up.permission_key='documents.view' AND up.allowed=TRUE) user_view,"+
  "EXISTS(SELECT 1 FROM user_permissions up WHERE up.user_id=u.id AND up.permission_key='documents.manage' AND up.allowed=TRUE) user_manage "+
  "FROM users u LEFT JOIN user_profiles p ON p.id=u.profile_id WHERE u.id=$1 LIMIT 1",[userId]);
 const u=q.rows[0];
 if(!u||u.active!==true)throw fail("Usuário inativo ou não encontrado.",401);
 const isMaster=u.role==="ADMIN"&&u.master===true;
 const canManage=isMaster||u.manage_perm===true||u.user_manage===true;
 const canView=canManage||u.view_perm===true||u.user_view===true;
 if(!canView)throw fail("Este perfil não tem acesso à Gestão de Documentos.");
 const units=isMaster?
  await db.query(
    "SELECT b.id branch_id,b.company_id,b.name branch_name,COALESCE(c.trade_name,c.legal_name) company_name "+
    "FROM branches b JOIN companies c ON c.id=b.company_id WHERE b.active=TRUE AND c.active=TRUE ORDER BY c.trade_name,b.name"):
  await db.query(
    "SELECT b.id branch_id,b.company_id,b.name branch_name,COALESCE(c.trade_name,c.legal_name) company_name "+
    "FROM user_branches ub JOIN users owner ON owner.id=ub.user_id "+
    "JOIN branches b ON b.id=ub.branch_id AND b.company_id=owner.company_id "+
    "JOIN companies c ON c.id=b.company_id "+
    "WHERE ub.user_id=$1 AND owner.active=TRUE AND b.active=TRUE AND c.active=TRUE ORDER BY c.trade_name,b.name",
    [userId]);
 if(!units.rows.length)throw fail("Nenhuma filial ativa vinculada ao usuário. Solicite a configuração ao Administrador Master.");
 const list=units.rows;
 return {userId:u.id,profileName:u.profile_name,isMaster,canView,canManage,units:list,
         branchIds:list.map(v=>v.branch_id),singleUnit:list.length===1?list[0]:null};
}
function allowedUnit(scope,companyId,branchId){
 return scope.units.some(v=>String(v.company_id)===String(companyId)&&String(v.branch_id)===String(branchId));
}
function requireScope(mode="view"){
 return async (req,res,next)=>{
  try{
   res.set("Cache-Control","private, no-store");
   if(process.env.JUSTIFICATION_ARCHIVE_BETA!=="true")return res.status(503).json({error:"Acervo documental em homologação."});
   const scope=await resolveScope(req.user?.sub);
   if(mode==="manage"&&!scope.canManage)return res.status(403).json({error:"O perfil não pode cadastrar, importar ou alterar documentos."});
   req.archiveScope=scope;
   next();
  }catch(e){next(e);}
 };
}
async function readCase(scope,id,db=pool){
 if(!UUID.test(String(id||"")))throw fail("Identificador inválido.",400);
 const {rows}=await db.query("SELECT * FROM justification_cases WHERE id=$1",[id]);
 const c=rows[0];
 if(!c||!allowedUnit(scope,c.company_id,c.branch_id))throw fail("Justificativa não encontrada no escopo do usuário.",404);
 return c;
}
function requireSingleUnit(scope){
 if(!scope.singleUnit)throw fail("Para cadastrar sem colaborador ou importar CSV, o usuário precisa de uma única filial autorizada. Configure o perfil com uma filial.",409);
 return scope.singleUnit;
}
module.exports={resolveScope,requireScope,allowedUnit,readCase,requireSingleUnit,fail};
