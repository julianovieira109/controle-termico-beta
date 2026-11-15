"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {parseCsv,parseLegacyCsv,brDate,driveIds}=require("../src/lib/justification-csv");
const header=[
  "Carimbo de data/hora","Juliano","Fu","Setor/Departamento","Data de Ausência",
  "Declaro que o colaborador, esteve ausente na data acima mencionada, pelo motivo abaixo:",
  "Outros Motivos - Detalhe o motivo/justificativa",
  "Endereço de e-mail","Anexar atestado, advertência, suspensão e Outros",
  "Email do Gestor Responsável","Endereço de e-mail"
];
const encode=arr=>arr.map(c=>'"'+String(c??"").replaceAll('"','""')+'"').join(",");
const rows=[
  ["13/11/2026 08:00:01","Pessoa Fictícia","Auxiliar","Setor fictício","12/11/2026","Atestado","Justificativa de teste, com vírgula","", "https://drive.google.com/open?id=1pSPfFdmIQNbC4YJoWHBd4OJtppYOO8jX","", "teste@exemplo.invalid"],
  ["13/11/2026 09:00:00","","Auxiliar","Outro setor","13/11/2026","Outros","Detalhes com\nquebra de linha","","Observação sem link","",""],
  ["14/11/2026 10:30:00","Outra Pessoa Fictícia","","Área teste","31/02/2026","Falta","","","","",""]
];
const csv=[header,...rows].map(encode).join("\r\n")+"\r\n";
test("CSV identifica o texto entre aspas, a quebra interna, as aspas duplas e acentos",()=>{
 const out=parseCsv(csv);
 assert.equal(out.length,4);
 assert.equal(out[2][6],rows[1][6]);
 assert.equal(out[1][6],rows[0][6]);
 assert.deepEqual(parseCsv('a,"b ""c""",d\n'),[["a",'b "c"',"d"]]);
});
test("datas são validadas sem inventar dias inexistentes",()=>{
 assert.equal(brDate("13/11/2026"),"2026-11-13");
 assert.equal(brDate("31/02/2026"),null);
 assert.equal(brDate("25/13/2026"),null);
});
test("links Drive reconhecidos sem aceitar endereços externos",()=>{
 assert.deepEqual(driveIds("https://drive.google.com/open?id=1pSPfFdmIQNbC4YJoWHBd4OJtppYOO8jX"),["1pSPfFdmIQNbC4YJoWHBd4OJtppYOO8jX"]);
 assert.deepEqual(driveIds("https://exemplo.invalid/a?Id=1pSPfFdmIQNbC4YJoWHBd4OJtppYOO8jX"),[]);
});
test("respostas completas importam, registro sem nome é preservado para revisão e linha inválida é sinalizada",()=>{
 const p=parseLegacyCsv(csv);
 assert.equal(p.summary.sourceRows,3);
 assert.equal(p.summary.ready,2);
 assert.equal(p.summary.invalid,1);
 assert.equal(p.summary.missingNames,1);
 assert.equal(p.summary.linkCount,1);
 assert.equal(p.summary.notesOnly,1);
 assert.equal(p.cases[1].employeeName,"Não informado na origem");
 assert.equal(p.cases[1].reviewStatus,"EM_CONFERENCIA");
 assert.equal(p.cases[0].sourceSnapshot.originalValues[6],rows[0][6]);
 assert.equal(p.cases[0].sourceSnapshot.originalValues[8],rows[0][8]);
 assert.equal(p.issues[0].row,4);
 assert.match(p.issues[0].reason,/Data/);
});
test("mesma justificativa deduplica mesmo se a planilha for ordenada",()=>{
 const reverse=[header,rows[1],rows[0]].map(encode).join("\n");
 const a=parseLegacyCsv(csv),b=parseLegacyCsv(reverse);
 assert.equal(a.cases[0].sourceKey,b.cases[1].sourceKey);
 assert.equal(a.cases[1].sourceKey,b.cases[0].sourceKey);
});
test("CSV com cabeçalho de outra planilha não pode ser importado",()=>{
 assert.throws(()=>parseLegacyCsv("nome,email\nFulano,f@example.invalid"),/11 colunas/);
});
