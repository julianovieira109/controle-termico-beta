const path=require("path");
const express=require("express");
const jwt=require("jsonwebtoken");
const secret="assistant-local-test-secret";
const ids={company:"10000000-0000-4000-8000-000000000001",branch:"20000000-0000-4000-8000-000000000001",employee:"30000000-0000-4000-8000-000000000001",other:"30000000-0000-4000-8000-000000000002"};
const user={sub:"40000000-0000-4000-8000-000000000001",name:"Usuário de teste",role:"RH",companyId:ids.company,branchIds:[ids.branch],permissions:{"employees.view":true,"employees.manage":true}};
function fixture(){
  const state={employees:[],audits:[],companies:[],failAudit:false};
  function reset(){
    state.employees=[{id:ids.employee,company_id:ids.company,branch_id:ids.branch,full_name:"MARIA DE TESTE",registration:"000011447",status:"ATIVO",termination_date:null,admission_date:"2026-07-14",updated_at:"2026-11-01T12:00:00.000Z",company_name:"Empresa teste",branch_name:"Filial teste"}];
    state.audits=[];state.companies=[];state.failAudit=false;
  }
  reset();
  async function query(sql,values=[]){
    if(sql.includes("SELECT pg_advisory"))return {rows:[]};
    if(sql.includes("SELECT id FROM audit_logs"))return {rows:state.audits.filter(a=>a.entityId===values[0]).map(()=>({id:"test-audit"}))};
    if(sql.includes("INSERT INTO audit_logs")){
      if(state.failAudit)throw new Error("Test audit failure");
      state.audits.push({actor:values[0],entityId:values[1],details:JSON.parse(values[2])});return {rows:[]};
    }
    if(sql.includes("UPDATE employees SET status=")){
      const employee=state.employees.find(e=>e.id===values[2]);
      Object.assign(employee,{status:values[0],termination_date:values[1],updated_at:new Date(new Date(employee.updated_at).getTime()+1000).toISOString()});
      return {rows:[{...employee}]};
    }
    if(sql.includes("SELECT e.*")){
      let rows=state.employees;
      const branches=values.find(Array.isArray);
      if(branches)rows=rows.filter(e=>e.company_id===values[values.indexOf(branches)-1]&&branches.includes(e.branch_id));
      if(sql.includes("e.id=$")){
        const value=sql.includes("e.id=$1")?values[0]:values.at(-1);rows=rows.filter(e=>e.id===value);
      }else{
        const search=values.at(-1).toLowerCase();rows=rows.filter(e=>e.full_name.toLowerCase().includes(search)||e.registration===search||e.registration.replace(/^0+/,"")===search.replace(/^0+/,""));
      }
      return {rows:structuredClone(rows)};
    }
    throw new Error(`Unexpected fixture query: ${sql.slice(0,70)}`);
  }
  const pool={query,connect:async()=>{
    let snapshot;
    return {query:async(sql,values)=>{
      if(sql==="BEGIN"){snapshot=structuredClone(state);return {rows:[]};}
      if(sql==="COMMIT"){snapshot=null;return {rows:[]};}
      if(sql==="ROLLBACK"){if(snapshot)Object.assign(state,snapshot);snapshot=null;return {rows:[]};}
      return query(sql,values);
    },release(){}};
  }};
  const poolPath=path.resolve(__dirname,"../../src/db/pool.js");
  require.cache[poolPath]={id:poolPath,filename:poolPath,loaded:true,exports:pool};
  process.env.JWT_SECRET=secret;
  const {authenticate,requireAdmin}=require("../../src/middleware/auth");
  const app=express();app.set("trust proxy",1);app.use(express.json());
  app.post("/api/auth/login",(req,res)=>res.json({token:jwt.sign(user,secret,{expiresIn:"1h"}),user}));
  app.post("/api/auth/refresh-session",authenticate,(req,res)=>res.json({token:jwt.sign(user,secret,{expiresIn:"1h"}),user}));
  app.use("/api/workflow-assistant",require("../../src/routes/workflow-assistant"));
  app.get("/api/admin/companies",authenticate,requireAdmin,(_req,res)=>res.json(state.companies));
  app.post("/api/admin/companies",authenticate,requireAdmin,(req,res)=>{state.companies.push(req.body);res.status(201).json(req.body);});
  app.use(express.static(path.resolve(__dirname,"../../public")));
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message}));
  return {app,pool,state,reset,user,ids,secret,token:(claims=user)=>jwt.sign(claims,secret,{expiresIn:"1h"})};
}
module.exports={fixture,ids,user,secret};
