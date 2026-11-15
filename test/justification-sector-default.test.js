"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../public/js/justification-archive.js"),"utf8");
const start=source.indexOf("function defaultDepartmentForBranch(){");
const end=source.indexOf("function setEmployeeFieldsReadonly",start);
assert.ok(start>=0&&end>start,"Função de setor padrão não encontrada");
function evaluate(label){
 const context={
  byId:id=>({selectedOptions:[{textContent:label}]})
 };
 vm.runInNewContext(source.slice(start,end)+"; result=defaultDepartmentForBranch();",context);
 return context.result;
}
test("setor padrão é Armazem para TRANZILOG",()=>assert.equal(evaluate("TRANZILOG"),"Armazem"));
test("variação TRANSZILOG também recebe Armazem",()=>assert.equal(evaluate("TRANSZILOG"),"Armazem"));
test("outras filiais não recebem Armazem indevidamente",()=>{
 assert.equal(evaluate("SODEXO"),"");
 assert.equal(evaluate("FRACIONADO"),"");
 assert.equal(evaluate("Selecione a filial"),"");
});
test("ao selecionar funcionário, setor cadastrado prevalece sobre padrão",()=>{
 assert.match(source,/employee\.department\|\|defaultDepartmentForBranch\(\)/);
 assert.match(source,/byId\("archive-department"\)\.value=defaultDepartmentForBranch\(\)/);
});
