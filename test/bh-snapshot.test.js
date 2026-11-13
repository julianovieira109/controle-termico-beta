const {test,before,after,beforeEach}=require("node:test");
const assert=require("node:assert/strict");
const express=require("express");
const {fixture,ids,user}=require("./helpers/assistant-fixture");
let context,server,base,points,reports,outside,queries;
const admin={...user,role:"ADMIN",isMasterAdmin:true};
before(async()=>{
  context=fixture();const original=context.pool.query;
  context.pool.query=async(sql,params=[])=>{
    queries.push({sql,params});
    if(sql.includes("SELECT e.id,e.registration"))return {rows:outside?[]:[{id:ids.employee,registration:"000011447",company_id:ids.company,branch_id:ids.branch,full_name:"MARIA DE TESTE"}]};
    if(sql.includes("FROM employee_point_days p"))return {rows:points};
    if(sql.includes("FROM senior_bh_imports i"))return {rows:reports};
    return original(sql,params);
  };
  const app=express();app.use("/api/reconciliation",require("../src/routes/reconciliation"));app.use((error,_req,res,_next)=>res.status(error.status||500).json({error:error.message}));
  server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
beforeEach(()=>{points=[];reports=[];outside=false;queries=[];});
async function get(query,claims=admin){const response=await fetch(base+"/api/reconciliation/snapshot?"+new URLSearchParams(query),{headers:claims?{Authorization:`Bearer ${context.token(claims)}`}:{}});return {status:response.status,data:await response.json()};}
test("snapshot exige os mesmos acessos do comparador e valida filtros",async()=>{
  assert.equal((await get({month:"2026-11"},null)).status,401);
  assert.equal((await get({month:"2026-11"},{...user,permissions:{"dashboard.view":true,"occurrences.view":true}})).status,403);
  assert.equal((await get({month:"2026-13"})).status,400);
  assert.equal((await get({month:"2026-11",employeeId:"invalid"})).status,400);
  assert.equal(queries.length,0);
});
test("snapshot mantém ausência de dados diferente de saldo zero",async()=>{
  const result=await get({month:"2026-11",employeeId:ids.employee,basis:"closing"});
  assert.equal(result.status,200);const s=result.data.snapshot;
  assert.deepEqual(s.range,{label:"2026-11",start:"2026-10-19",end:"2026-11-18"});
  assert.equal(s.hasPoint,false);assert.equal(s.pointPositive,null);assert.equal(s.hasBalance,false);assert.equal(s.balance,null);
});
test("colaborador fora dos filtros não é consultado nem tem BH exposto",async()=>{
  outside=true;assert.equal((await get({month:"2026-11",employeeId:ids.employee,companyId:ids.company,branchId:ids.branch})).status,403);
  assert.equal(queries.length,1);assert.ok(queries[0].params.includes(ids.company));assert.ok(queries[0].params.includes(ids.branch));
});
test("snapshot reutiliza o cálculo existente e separa matrículas iguais de unidades diferentes",async()=>{
  points=[{employee_id:ids.employee,company_id:ids.company,branch_id:ids.branch,registration:"000011447",full_name:"MARIA DE TESTE",work_date:"2026-11-03",point_state:"WORKED",work_minutes:480,bh_validated:true,bh_positive_minutes:120,bh_negative_minutes:30}];
  const common={company_id:ids.company,branch_id:ids.branch,period_start:"2026-10-19",period_end:"2026-11-18",confirmed_at:"2026-11-19T10:00:00Z"};
  const record={registration:"11447",name:"MARIA DE TESTE",bank:"BH1",initial:0,final:90,page:1,ledgerDifference:0,events:[{date:"2026-11-03",origin:"A",minutes:120},{date:"2026-11-03",origin:"A",minutes:-30}]};
  reports=[{...common,id:"bh-analytic",report_type:"ANALYTIC",file_name:"analitico.pdf",records:[record]},{...common,id:"bh-synthetic",report_type:"SYNTHETIC",file_name:"sintetico.pdf",records:[{...record,events:[]}]},{...common,id:"foreign",branch_id:"20000000-0000-4000-8000-000000000002",report_type:"SYNTHETIC",file_name:"outra-filial.pdf",records:[{...record,final:999}]}];
  const result=await get({month:"2026-11",employeeId:ids.employee});assert.equal(result.status,200);
  const s=result.data.snapshot;assert.equal(s.bhPositive,120);assert.equal(s.bhNegative,30);assert.equal(s.pointPositive,120);assert.equal(s.balance,90);assert.equal(s.balanceDate,"2026-11-18");
  assert.deepEqual(new Set(s.sources.map(source=>source.file)),new Set(["analitico.pdf","sintetico.pdf"]));
  assert.equal(s.mismatchCount,0);assert.ok(queries.some(item=>item.sql.includes("p.employee_id=")&&item.params.includes(ids.employee)));
});
test("mês calendário preserva seu próprio período e valores validados iguais a zero",async()=>{
  points=[{employee_id:ids.employee,company_id:ids.company,branch_id:ids.branch,registration:"000011447",work_date:"2026-11-03",point_state:"WORKED",work_minutes:480,bh_validated:true,bh_positive_minutes:0,bh_negative_minutes:0}];
  const response=await get({month:"2026-11",basis:"calendar",employeeId:ids.employee});const s=response.data.snapshot;
  assert.equal(s.range.start,"2026-11-01");assert.equal(s.range.end,"2026-11-30");assert.equal(s.pointPositive,0);assert.equal(s.pointNegative,0);assert.equal(s.balance,null);
});
