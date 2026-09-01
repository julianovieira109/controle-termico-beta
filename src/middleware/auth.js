const jwt=require("jsonwebtoken");

function authenticate(req,res,next){
  const [type,token]=(req.headers.authorization||"").split(" ");
  if(type!=="Bearer"||!token){
    return res.status(401).json({error:"Autenticação necessária."});
  }
  try{
    req.user=jwt.verify(token,process.env.JWT_SECRET);
    if(req.user?.mustChangePassword===true && req.originalUrl!=="/api/auth/change-password"){
      return res.status(428).json({error:"Troque a senha temporária antes de continuar.",mustChangePassword:true});
    }
    next();
  }catch{
    res.status(401).json({error:"Sessão inválida ou expirada."});
  }
}

function requireAdmin(req,res,next){
  if(req.user?.role!=="ADMIN"){
    return res.status(403).json({error:"Acesso permitido somente ao administrador."});
  }
  next();
}

function requireMasterAdmin(req,res,next){
  if(req.user?.role!=="ADMIN"||req.user?.isMasterAdmin!==true){
    return res.status(403).json({error:"Acesso exclusivo do Administrador Master."});
  }
  next();
}



function requirePermission(permissionKey){
  return function permissionMiddleware(req,res,next){
    if(req.user?.role==="ADMIN")return next();
    if(req.user?.permissions?.[permissionKey]===true)return next();
    return res.status(403).json({error:"Seu perfil não possui permissão para esta função."});
  };
}

function requireOccurrencesAccess(req,res,next){
  if(req.user?.role==="ADMIN"&&req.user?.isMasterAdmin===true)return next();
  if(req.user?.role==="ADMIN"&&req.user?.permissions?.["occurrences.view"]===true)return next();
  return res.status(403).json({error:"Seu usuário não possui autorização para acessar o Controle de Ocorrências."});
}

function applyScope(req,_res,next){
  req.scope={
    isAdmin:req.user?.role==="ADMIN",
    companyId:req.user?.companyId||null,
    branchIds:Array.isArray(req.user?.branchIds)?req.user.branchIds:[]
  };
  next();
}

function requireCalendarAccess(req,res,next){
  if(req.user?.role==="ADMIN" || req.user?.permissions?.["calendar.manage"]===true){
    return next();
  }
  return res.status(403).json({error:"Seu usuário não possui acesso às configurações de feriados e folgas."});
}

module.exports={authenticate,requireAdmin,requireMasterAdmin,requirePermission,applyScope,requireCalendarAccess,requireOccurrencesAccess};
