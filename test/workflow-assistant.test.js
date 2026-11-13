const {test,before,after,beforeEach}=require("node:test");
const assert=require("node:assert/strict");
const {fixture,user,ids}=require("./helpers/assistant-fixture");
let context,server,base,requestNumber=0;
before(async()=>{context=fixture();server=context.app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));});beforeEach(()=>context.reset());
async function post(path,body,claims=user){
  const response=await fetch(base+"/api/workflow-assistant/"+path,{method:"POST",headers:{"Content-Type":"application/json","X-Forwarded-For":`192.0.2.${++requestNumber}`,...(claims?{Authorization:`Bearer ${context.token(claims)}`}:{})},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};
}
const proposal={search:"000011447",employeeId:ids.employee,status:"DEMITIDO",terminationDate:"2026-11-13"};
test("fluxo nativo prepara e confirma sem IA, com auditoria e sem alterar outros dados",async()=>{
  const before={...context.state.employees[0]};
  const prepared=await post("prepare",proposal);assert.equal(prepared.status,200);assert.equal(context.state.employees[0].status,"ATIVO");
  const result=await post("confirm",{plan:prepared.data.plan});assert.equal(result.status,200);
  assert.equal(result.data.employee.terminationDate,"2026-11-13");assert.equal(context.state.employees[0].registration,before.registration);assert.equal(context.state.audits.length,1);
  assert.equal((await post("confirm",{plan:prepared.data.plan})).status,409);assert.equal(context.state.audits.length,1);
});
test("fluxo nativo rejeita usuário sem permissão, outra filial e data inválida",async()=>{
  assert.equal((await post("prepare",proposal,null)).status,401);
  assert.equal((await post("prepare",proposal,{...user,permissions:{"employees.view":true}})).status,403);
  assert.equal((await post("prepare",proposal,{...user,branchIds:[]})).status,404);
  assert.equal((await post("prepare",{...proposal,terminationDate:"2026-02-31"})).status,400);
  assert.equal(context.state.audits.length,0);
});
test("atualização concorrente ou auditoria indisponível impede gravação silenciosa",async()=>{
  const prepared=await post("prepare",proposal);context.state.employees[0].updated_at="2026-11-02T12:00:00Z";
  assert.equal((await post("confirm",{plan:prepared.data.plan})).status,409);
  const fresh=await post("prepare",proposal);context.state.failAudit=true;
  assert.equal((await post("confirm",{plan:fresh.data.plan})).status,500);assert.equal(context.state.employees[0].status,"ATIVO");
});
