const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../public/js/justification-archive.js"),"utf8");
const st=source.indexOf("function defaultDepartmentForBranch(){"),en=source.indexOf("function setEmployeeFieldsReadonly",st);
assert.ok(st>=0&&en>st);
function evaluate(branchName){
 const ctx={selectedEmployee:branchName?{branch_name:branchName}:null,archiveScope:{units:[]},currentBranch:""};
 vm.runInNewContext(source.slice(st,en)+";output=defaultDepartmentForBranch();",ctx);
 return ctx.output;
}
test("padrão Armazem segue a filial efetiva do colaborador",()=>{
 assert.equal(evaluate("TRANZILOG"),"Armazem");
 assert.equal(evaluate("TRANSZILOG"),"Armazem");
 assert.equal(evaluate("SODEXO"),"");
 assert.equal(evaluate(null),"");
});
test("setor cadastrado prevalece sobre o padrão",()=>{
 assert.match(source,/employee\.department\|\|defaultDepartmentForBranch\(\)/);
});
