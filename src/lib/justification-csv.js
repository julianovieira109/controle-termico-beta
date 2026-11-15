"use strict";
const crypto=require("node:crypto");
const ORIGIN="TZL_FORM_JUSTIFICATIVAS_V1:";
const COLS=11;
const MAX_ROWS=3000;
function bad(message){const e=new Error(message);e.status=400;return e;}
function parseCsv(input){
  const text=String(input??"").replace(/^\uFEFF/,"");
  const rows=[];let row=[],cell="",quoted=false,closing=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"'&&text[i+1]==='"'){cell+='"';i++;continue;}
      if(c==='"'){quoted=false;closing=true;continue;}
      cell+=c;continue;
    }
    if(c==='"'&&!cell&&!closing){quoted=true;continue;}
    if(closing&&c!==" "&&c!=="\t"&&c!==","&&c!=="\n"&&c!=="\r")throw bad("CSV inválido: caractere após aspas.");
    if(c===","){row.push(cell);cell="";closing=false;continue;}
    if(c==="\n"||c==="\r"){
      if(c==="\r"&&text[i+1]==="\n")i++;
      row.push(cell);cell="";closing=false;
      if(row.some(v=>v!==""))rows.push(row);
      row=[];
      if(rows.length>MAX_ROWS+1)throw bad("Limite de 3.000 linhas por arquivo. Divida a importação.");
      continue;
    }
    if(!closing)cell+=c;
  }
  if(quoted)throw bad("CSV inválido: aspas não foram fechadas.");
  if(row.length||cell){row.push(cell);if(row.some(v=>v!==""))rows.push(row);}
  return rows;
}
function normalized(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase();}
function checkHeader(header){
  if(!header||header.length<COLS)throw bad("Arquivo incorreto: escolha o CSV da aba Respostas ao formulário 1 (11 colunas).");
  const h=header.map(normalized);
  if(!h[0].includes("carimbo")||!h[3].includes("setor")||!h[4].includes("data de ausencia")||!h[5].includes("declaro")||!h[8].includes("anexar"))
    throw bad("Cabeçalhos não correspondem ao formulário de justificativas da Transzilog. Não altere a ordem das colunas.");
}
function brDate(raw){
  const v=String(raw||"").trim(),m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if(!m)return null;
  const d=Number(m[1]),mo=Number(m[2]),y=Number(m[3]),t=new Date(Date.UTC(y,mo-1,d));
  if(y<2000||y>2100||t.getUTCDate()!==d||t.getUTCMonth()+1!==mo||t.getUTCFullYear()!==y)return null;
  return [y,String(mo).padStart(2,"0"),String(d).padStart(2,"0")].join("-");
}
function driveIds(raw){
  const value=String(raw||"");
  const urls=value.match(/https?:\/\/(?:drive|docs)\.google\.com\/[^\s,;]*/gi)||[];
  const found=new Set();
  for(const url of urls){
    const m=/(?:[?&]id=|\/d\/)([A-Za-z0-9_-]{20,})/.exec(url);
    if(m)found.add(m[1]);
  }
  return [...found];
}
function sanitize(value,max=3000){return String(value??"").trim().slice(0,max);}
function parseLegacyCsv(csv){
  const rows=parseCsv(csv);
  if(rows.length<2)throw bad("CSV vazio: exporte a aba que contém respostas.");
  checkHeader(rows[0]);
  const valid=[],issues=[];const seen=new Set();
  let notesOnly=0,linkCount=0,missingNames=0,sourceRows=0;
  for(let i=1;i<rows.length;i++){
    const row=Array.from({length:COLS},(_,c)=>String(rows[i][c]??""));
    if(row.every(x=>!x.trim()))continue;
    sourceRows++;
    const sourceRow=i+1;
    const timestamp=sanitize(row[0],120);
    const name=sanitize(row[1],200);
    const reason=sanitize(row[5],250);
    const date=brDate(row[4]);
    if(!timestamp||!date||!reason){
      issues.push({row:sourceRow,reason:!timestamp?"Sem carimbo de data/hora":!date?"Data de ausência inválida ou ausente":"Motivo ausente"});
      continue;
    }
    const digest=crypto.createHash("sha256").update(JSON.stringify(row),"utf8").digest("hex");
    const sourceKey=ORIGIN+digest;
    if(seen.has(sourceKey)){issues.push({row:sourceRow,reason:"Resposta repetida no próprio CSV"});continue;}
    seen.add(sourceKey);
    const documentIds=driveIds(row[8]);
    linkCount+=documentIds.length;
    if(row[8].trim()&&!documentIds.length)notesOnly++;
    if(!name)missingNames++;
    valid.push({
      sourceKey,digest,sourceRow,employeeName:name||"Não informado na origem",jobTitle:sanitize(row[2],180)||null,
      department:sanitize(row[3],160)||null,absenceDate:date,reason,
      details:sanitize(row[6],3000)||null,managerEmail:sanitize(row[9],254)||null,
      submittedByEmail:sanitize(row[10]||row[7],254)||null,
      reviewStatus:name?"PENDENTE":"EM_CONFERENCIA",
      sourceSnapshot:{row:sourceRow,submittedAtText:timestamp,originalValues:row.map(v=>v.slice(0,6000)),originalHeaders:rows[0].slice(0,COLS),digest},
      documentIds
    });
  }
  if(!valid.length)throw bad("Nenhuma justificativa válida no arquivo.");
  return {cases:valid,issues,summary:{sourceRows,ready:valid.length,invalid:issues.length,missingNames,linkCount,notesOnly}};
}
module.exports={ORIGIN,parseCsv,parseLegacyCsv,brDate,driveIds,checkHeader};
