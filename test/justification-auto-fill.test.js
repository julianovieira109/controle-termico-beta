"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const filename=path.join(__dirname,"../public/js/justification-archive.js");
const source=fs.readFileSync(filename,"utf8");
const sentinel="bind();window.loadJustificationArchive=initialize;";
assert.ok(source.includes(sentinel),"O módulo precisa expor o ponto de inicialização esperado.");
const window={};
vm.runInNewContext(
 source.replace(sentinel,"window.__lookupTest={findAutomaticEmployee,normalizeEmployeeLookup};"),
 {window},
 {filename,timeout:2000}
);
const {findAutomaticEmployee,normalizeEmployeeLookup}=window.__lookupTest;
const employee=(id,name,registration)=>({id,full_name:name,registration,status:"ATIVO",job_title:"Auxiliar",department:null});

test("normalizeEmployeeLookup ignora acentos, espaços e maiúsculas",()=>{
 assert.equal(normalizeEmployeeLookup("  JOÃO   GONÇALVES "),"joao goncalves");
});
test("nome exato preenche automaticamente mesmo com resultados parciais adicionais",()=>{
 const joao=employee("1","João Gonçalves","00128");
 const other=employee("2","João Gonçalves Santos","00129");
 assert.equal(findAutomaticEmployee([joao,other],"joao goncalves").id,"1");
});
test("matrícula exata preenche automaticamente",()=>{
 const a=employee("1","Alice Souza","00128"),b=employee("2","Alice Nunes","001280");
 assert.equal(findAutomaticEmployee([a,b],"00128").id,"1");
});
test("trecho único do nome com 4 caracteres preenche automaticamente",()=>{
 const only=employee("1","Maria da Conceição","00321");
 assert.equal(findAutomaticEmployee([only],"mari").id,"1");
});
test("nome genérico com múltiplos resultados não seleciona funcionário errado",()=>{
 const list=[employee("1","Maria Souza","00001"),employee("2","Maria Costa","00002")];
 assert.equal(findAutomaticEmployee(list,"Maria"),null);
});
test("matrícula repetida obriga escolher pessoa na lista",()=>{
 const list=[employee("1","Pessoa A","00128"),employee("2","Pessoa B","00128")];
 assert.equal(findAutomaticEmployee(list,"00128"),null);
});
test("buscas com menos de 4 caracteres só preenchem quando exatas",()=>{
 const only=employee("1","Carlos","987");
 assert.equal(findAutomaticEmployee([only],"Car"),null);
 assert.equal(findAutomaticEmployee([only],"987").id,"1");
});
test("20 resultados possíveis indicam paginação e impedem preenchimento automático",()=>{
 const list=Array.from({length:20},(_,i)=>employee(String(i),"Ana "+i,String(i)));
 assert.equal(findAutomaticEmployee(list,"Ana 0"),null);
});
test("a tela possui busca e mantém diferenciação entre seleção e preenchimento automático",()=>{
 assert.match(source,/findAutomaticEmployee\(people,q\)/);
 assert.match(source,/chooseEmployee\(automatic,\{keepSearchText:true,automatic:true\}\)/);
 assert.match(source,/if\(sequence!==employeeSearchSequence/);
 assert.match(source,/const wasSelected=!!selectedEmployee/);
});
