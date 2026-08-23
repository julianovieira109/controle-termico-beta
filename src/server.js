const {version:APP_VERSION}=require("../package.json");
require("dotenv").config();
const path=require("path");
const express=require("express");
const helmet=require("helmet");

if(!process.env.JWT_SECRET)throw new Error("JWT_SECRET não configurado.");

const app=express();
app.set("trust proxy",1);
app.use(helmet({
  contentSecurityPolicy:{
    directives:{
      defaultSrc:["'self'"],
      scriptSrc:["'self'","'unsafe-inline'","https://challenges.cloudflare.com"],
      styleSrc:["'self'","'unsafe-inline'"],
      imgSrc:["'self'","data:","blob:"],
      connectSrc:["'self'","https://challenges.cloudflare.com"],
      frameSrc:["https://challenges.cloudflare.com"],
      fontSrc:["'self'","data:"],
      objectSrc:["'none'"],
      baseUri:["'self'"],
      formAction:["'self'"]
    }
  },
  crossOriginEmbedderPolicy:false
}));
app.use(express.json({limit:"10mb"}));

app.use("/api/health",require("./routes/health"));
app.use("/api/auth",require("./routes/auth"));
app.use("/api/dashboard",require("./routes/dashboard"));
app.use("/api/admin",require("./routes/admin"));
app.use("/api/employees",require("./routes/employees"));
app.use("/api/imports",require("./routes/imports"));
app.use("/api/catalogs",require("./routes/catalogs"));
app.use("/api/settings",require("./routes/settings"));
app.use("/api/reports",require("./routes/reports"));
app.use("/api/calendar",require("./routes/calendar"));
app.use("/api/system",require("./routes/system"));

app.use("/api",(req,res)=>{
  res.status(404).json({
    error:`Rota da API não encontrada: ${req.method} ${req.originalUrl}`
  });
});

const publicDir=path.join(__dirname,"..","public");
app.use(express.static(publicDir));
app.get("*",(_req,res)=>res.sendFile(path.join(publicDir,"index.html")));

app.use((error,_req,res,_next)=>{
  console.error("Erro da aplicação:",{
    message:error.message,
    code:error.code,
    detail:error.detail,
    constraint:error.constraint
  });

  if(res.headersSent)return;

  if(error.status){
    return res.status(error.status).json({error:error.message});
  }

  if(error.code==="23503"){
    return res.status(409).json({
      error:"A operação foi bloqueada porque existem registros vinculados."
    });
  }

  if(error.code==="23505"){
    return res.status(409).json({
      error:"Já existe um registro com essas informações."
    });
  }

  if(error.code==="42703"||error.code==="42P01"){
    return res.status(503).json({
      error:"O banco de dados precisa ser atualizado para esta versão. Execute um novo deploy com limpeza do cache."
    });
  }

  res.status(500).json({error:"Erro interno do servidor."});
});

const port=Number(process.env.PORT||3000);
const displayVersion=APP_VERSION==="1.0.0"?"1.0.0 Oficial":APP_VERSION.replace(/-beta(?:\.\d+)?$/," Beta");
app.listen(port,"0.0.0.0",()=>{
  console.log(`Controle Térmico v${displayVersion} online na porta ${port}`);
});
