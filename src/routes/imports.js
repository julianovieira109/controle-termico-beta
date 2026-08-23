const express=require("express");
const multer=require("multer");
const pdfParse=require("pdf-parse");
const PDFParser=require("pdf2json");
const zlib=require("zlib");
const pool=require("../db/pool");
const audit=require("../db/audit");
const {authenticate,applyScope,requirePermission}=require("../middleware/auth");
const {normalizeDismissedCause,reconcileDismissedWithEmployee}=require("../importers/dismissed-reader");

const router=express.Router();


// A importação da Senior deve cadastrar todos os vínculos válidos. A decisão
// sobre gerar repouso, refeição, ambos ou nenhum pertence à política do cargo,
// da filial ou do colaborador e não pode impedir o cadastro automático.
const BLOCKED_EMPLOYEE_ROLES=new Set();

function normalizeBlockedRole(value){
  return String(value||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ")
    .trim()
    .toUpperCase();
}

function isBlockedEmployeeRole(value){
  return BLOCKED_EMPLOYEE_ROLES.has(normalizeBlockedRole(value));
}

const upload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:8*1024*1024},
  fileFilter:(_req,file,cb)=>{
    if(file.mimetype!=="application/pdf")return cb(new Error("Envie um arquivo PDF."));
    cb(null,true);
  }
});

router.use(authenticate,applyScope,requirePermission("imports.manage"));

function decodePdf2JsonText(value){
  try{
    return decodeURIComponent(value||"");
  }catch{
    return String(value||"");
  }
}

function pdf2JsonDataToText(data){
  const pages=data?.Pages||data?.pages||[];
  const output=[];

  for(const page of pages){
    const textItems=page.Texts||page.Texts||[];
    const rows=new Map();

    for(const item of textItems){
      const y=Number(item.y||0);
      const rowKey=y.toFixed(2);
      const text=(item.R||[])
        .map(run=>decodePdf2JsonText(run.T))
        .join("");

      if(!rows.has(rowKey))rows.set(rowKey,[]);
      rows.get(rowKey).push({
        x:Number(item.x||0),
        text
      });
    }

    const pageLines=[...rows.entries()]
      .sort((a,b)=>Number(a[0])-Number(b[0]))
      .map(([,items])=>
        items
          .sort((a,b)=>a.x-b.x)
          .map(item=>item.text)
          .join(" ")
          .replace(/\s+/g," ")
          .trim()
      )
      .filter(Boolean);

    output.push(pageLines.join("\n"));
  }

  return output.join("\n");
}

function extractWithPdf2Json(buffer){
  return new Promise((resolve,reject)=>{
    const parser=new PDFParser(null,1);

    const cleanup=()=>{
      parser.removeAllListeners("pdfParser_dataError");
      parser.removeAllListeners("pdfParser_dataReady");
    };

    parser.on("pdfParser_dataError",error=>{
      cleanup();
      const message=
        error?.parserError?.message ||
        error?.parserError ||
        error?.message ||
        "Falha no leitor alternativo.";
      reject(new Error(String(message).replace(/^Error:\s*/,"")));
    });

    parser.on("pdfParser_dataReady",data=>{
      cleanup();
      const text=pdf2JsonDataToText(data);
      if(!text.trim()){
        reject(new Error("O leitor alternativo abriu o PDF, mas não encontrou texto."));
        return;
      }
      resolve(text);
    });

    try{
      parser.parseBuffer(buffer);
    }catch(error){
      cleanup();
      reject(error);
    }
  });
}


function rebuildPdfXref(buffer){
  const source=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer);
  const sourceText=source.toString("latin1");
  const objectRegex=/(^|[\r\n])(\d+)\s+(\d+)\s+obj\b/g;

  const objects=new Map();
  let match;

  while((match=objectRegex.exec(sourceText))!==null){
    const objectNumber=Number(match[2]);
    const generation=Number(match[3]);
    const prefixLength=match[1]?.length||0;
    const offset=match.index+prefixLength;

    objects.set(objectNumber,{generation,offset});
  }

  if(!objects.size){
    throw new Error("Nenhum objeto PDF foi encontrado para reconstruir o XRef.");
  }

  const maxObject=Math.max(...objects.keys());
  const size=maxObject+1;

  let rootObject=1;
  for(const [objectNumber,{offset}] of objects.entries()){
    const segment=sourceText.slice(offset,Math.min(sourceText.length,offset+500));
    if(/\/Type\s*\/Catalog\b/.test(segment)){
      rootObject=objectNumber;
      break;
    }
  }

  const xrefOffset=source.length;
  const lines=[
    "\nxref\n",
    `0 ${size}\n`,
    "0000000000 65535 f \n"
  ];

  for(let objectNumber=1;objectNumber<size;objectNumber++){
    const object=objects.get(objectNumber);

    if(object){
      lines.push(
        `${String(object.offset).padStart(10,"0")} ${String(object.generation).padStart(5,"0")} n \n`
      );
    }else{
      lines.push("0000000000 00000 f \n");
    }
  }

  lines.push(
    "trailer\n",
    `<< /Size ${size} /Root ${rootObject} 0 R >>\n`,
    "startxref\n",
    `${xrefOffset}\n`,
    "%%EOF\n"
  );

  return Buffer.concat([
    source,
    Buffer.from(lines.join(""),"latin1")
  ]);
}

async function extractFromRepairedPdf(buffer){
  const repairedBuffer=rebuildPdfXref(buffer);
  const attempts=[];

  try{
    const parsed=await pdfParse(repairedBuffer);
    const text=parsed?.text||"";

    if(text.trim()){
      return {
        text,
        repairedBuffer,
        readerUsed:"xref-repair + pdf-parse",
        attempts:[{
          reader:"xref-repair + pdf-parse",
          success:true
        }]
      };
    }

    attempts.push({
      reader:"xref-repair + pdf-parse",
      success:false,
      error:"O PDF foi reparado, mas não foi encontrado texto."
    });
  }catch(error){
    attempts.push({
      reader:"xref-repair + pdf-parse",
      success:false,
      error:error.message||String(error)
    });
  }

  try{
    const text=await extractWithPdf2Json(repairedBuffer);
    return {
      text,
      repairedBuffer,
      readerUsed:"xref-repair + pdf2json",
      attempts:[
        ...attempts,
        {
          reader:"xref-repair + pdf2json",
          success:true
        }
      ]
    };
  }catch(error){
    attempts.push({
      reader:"xref-repair + pdf2json",
      success:false,
      error:error.message||String(error)
    });
  }

  const failure=new Error("O PDF foi reparado, mas os leitores ainda não encontraram texto.");
  failure.readerAttempts=attempts;
  throw failure;
}


function decodePdfLiteralString(value){
  return String(value||"")
    .replace(/\\([\\()])/g,"$1")
    .replace(/\\n/g,"\n")
    .replace(/\\r/g,"\r")
    .replace(/\\t/g,"\t")
    .replace(/\\b/g,"\b")
    .replace(/\\f/g,"\f")
    .replace(/\\([0-7]{1,3})/g,(_m,oct)=>String.fromCharCode(parseInt(oct,8)));
}

function extractRawPdfText(buffer){
  const source=(Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer)).toString("latin1");
  const tokens=[];

  // Fallback conservador: extrai strings literais de operadores de texto.
  const literalRegex=/\((?:\\.|[^\\()]){2,300}\)/g;
  let match;
  while((match=literalRegex.exec(source))!==null){
    const value=decodePdfLiteralString(match[0].slice(1,-1))
      .replace(/[^\x20-\x7EÀ-ÿ]/g," ")
      .replace(/\s+/g," ")
      .trim();

    if(value && /[A-Za-zÀ-ÿ0-9]/.test(value))tokens.push(value);
  }

  const text=tokens.join(" ").replace(/\s+/g," ").trim();
  if(text.length<40){
    throw new Error("A leitura bruta do PDF não encontrou texto suficiente.");
  }
  return text;
}

function shouldSkipPdf2JsonGeneric(buffer,options={}){
  if(options.skipPdf2Json===true)return true;

  const source=(Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer))
    .toString("latin1",0,Math.min(buffer.length||0,250000));

  return /PDFium/i.test(source)
    || /\/Producer\s*\(\s*PDFium/i.test(source)
    || /\/Creator\s*\(\s*PDFium/i.test(source);
}

async function extractPdfText(buffer,options={}){
  const attempts=[];

  try{
    const parsed=await pdfParse(buffer);
    const text=parsed?.text||"";

    if(text.trim()){
      return {
        text,
        readerUsed:"pdf-parse",
        attempts:[{reader:"pdf-parse",success:true}]
      };
    }

    attempts.push({
      reader:"pdf-parse",
      success:false,
      error:"O leitor abriu o arquivo, mas não encontrou texto."
    });
  }catch(error){
    attempts.push({
      reader:"pdf-parse",
      success:false,
      error:error.message||String(error)
    });
  }

  if(shouldSkipPdf2JsonGeneric(buffer,options)){
    attempts.push({
      reader:"pdf2json",
      success:false,
      skipped:true,
      error:"Ignorado: PDFium/XRef problemático identificado."
    });
  }else{
    try{
      const text=await extractWithPdf2Json(buffer);
      return {
        text,
        readerUsed:"pdf2json",
        attempts:[
          ...attempts,
          {reader:"pdf2json",success:true}
        ]
      };
    }catch(error){
      attempts.push({
        reader:"pdf2json",
        success:false,
        error:error.message||String(error)
      });
    }
  }

  try{
    const text=extractRawPdfText(buffer);
    return {
      text,
      readerUsed:"raw-pdf-text",
      attempts:[
        ...attempts,
        {reader:"raw-pdf-text",success:true}
      ]
    };
  }catch(error){
    attempts.push({
      reader:"raw-pdf-text",
      success:false,
      error:error.message||String(error)
    });
  }

  try{
    const repaired=await extractFromRepairedPdf(buffer);
    return {
      text:repaired.text,
      readerUsed:repaired.readerUsed,
      attempts:[
        ...attempts,
        ...repaired.attempts
      ]
    };
  }catch(error){
    attempts.push(...(error.readerAttempts||[{
      reader:"reconstrução XRef",
      success:false,
      error:error.message||String(error)
    }]));
  }

  const failure=new Error(
    "Os leitores diretos falharam e a reconstrução automática do PDF também não conseguiu extrair o texto."
  );
  failure.readerAttempts=attempts;
  throw failure;
}



function isSeniorNoiseText(value){
  const text=normalizeText(value).toUpperCase();
  if(!text)return true;

  const blocked=[
    "TOTAL",
    "USUARIO:",
    "PAG.:",
    "FPRE",
    "TRANSPORTES E ARMAZENAGEM",
    "RELACAO DE COLABORADORES",
    "RELACAO DE ADMITIDOS",
    "RELACAO DE DEMITIDOS",
    "CADASTRO",
    "PERIODO:"
  ];

  return blocked.some(token=>text.includes(normalizeText(token).toUpperCase()));
}

function isPlausibleEmployeeName(value){
  const raw=String(value||"").trim();
  const text=normalizeText(raw);

  if(!text || text.length<5 || text.length>180)return false;
  if(isSeniorNoiseText(text))return false;

  // Nome precisa conter letras e pelo menos duas palavras.
  const words=text.split(/\s+/).filter(Boolean);
  if(words.length<2)return false;
  if(!/[A-Za-zÀ-Ü]/.test(text))return false;

  // Descarta campos formados quase só por números/códigos/pontuação.
  const letters=(text.match(/[A-Za-zÀ-Ü]/g)||[]).length;
  if(letters<4)return false;

  return true;
}

function isPlausibleRegistration(value){
  const registration=String(value||"").trim();
  return /^0\d{8}$/.test(registration);
}

function isPlausibleRole(value){
  const text=sanitizeImportedJobTitle(value);
  if(!text)return false;
  if(isSeniorNoiseText(text))return false;
  if(/\b\d{2}:\d{2}:\d{2}\b/.test(text))return false;
  if(!/[A-Za-zÀ-Ü]{3}/.test(text))return false;
  return true;
}

function sanitizeImportedJobTitle(value){
  let text=sanitizeImportedText(value,240);
  // Alguns modelos da Senior colam salário/código numérico antes do cargo.
  text=text.replace(/^\s*\d{1,3}(?:\.\d{3})*,\d{2}\s*/u,"");
  // Totais, cabeçalhos, rodapés e identificação do usuário não pertencem ao cargo.
  text=text.split(/(?:\b(?:Total|Grupo\s+Zilli|Cadastro|FPRE\d+\.COL|Rela[cç][aã]o\s+de|TRANSPORTES\s+E\s+ARMAZENAGEM)\b|\bUsu[aá]rio\s*:|\bPer[ií]odo\s*:|\bP[aá]g\.?\s*:)/i)[0];
  text=text.replace(/[\s,;.-]+$/g,"").replace(/\s+/g," ").trim();
  if(!text||isSeniorNoiseText(text)||/\b\d{2}:\d{2}:\d{2}\b/.test(text))return "";

  // O PDFium às vezes insere um espaço dentro de uma palavra (AUXILIA R,
  // ADMINISTRATIV O). Comparamos sem espaços e devolvemos o nome canônico.
  const compactRole=normalizeText(text).toUpperCase().replace(/[^A-Z0-9]/g,"");
  const canonical=knownJobTitles().find(title=>
    normalizeText(title).toUpperCase().replace(/[^A-Z0-9]/g,"")===compactRole
  );
  if(canonical)return canonical;

  return text.slice(0,120);
}

function normalizeText(value){
  return String(value||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ")
    .trim();
}

function toIsoDate(brDate){
  const [day,month,year]=brDate.split("/");
  return `${year}-${month}-${day}`;
}


function intelligenceLevel(score){
  if(score>=85)return "ALTA";
  if(score>=65)return "MÉDIA";
  return "BAIXA";
}

function buildImportIntelligence({
  type,
  detectedType,
  rows=[],
  readerUsed="",
  detectedOperationalBranch="",
  detectedCompany="",
  blockedByRole=0,
  possibleReadmissions=0
}={}){
  let score=20;
  const signals=[];

  if(detectedType){
    score+=15;
    signals.push(`Tipo de relatório reconhecido: ${detectedType}`);
  }

  if(type&&detectedType&&type===detectedType){
    score+=10;
    signals.push("Tipo selecionado confere com o tipo detectado");
  }

  if(rows.length){
    score+=20;
    signals.push(`${rows.length} registro(s) estruturado(s)`);
  }

  const plausible=rows.filter(row=>
    isPlausibleRegistration(row.registration) &&
    (
      type==="DEMITIDOS" ||
      isPlausibleEmployeeName(row.fullName||row.currentName||"")
    )
  ).length;

  if(rows.length){
    const ratio=plausible/rows.length;
    score+=Math.round(ratio*15);
    signals.push(`${Math.round(ratio*100)}% dos registros passaram na validação estrutural`);
  }

  if(readerUsed){
    score+=5;
    signals.push(`Leitor utilizado: ${readerUsed}`);
  }

  if(detectedOperationalBranch){
    score+=10;
    signals.push(`Operação identificada: ${detectedOperationalBranch}`);
  }

  if(detectedCompany){
    score+=5;
    signals.push("Empresa identificada no relatório");
  }

  if(blockedByRole){
    signals.push(`${blockedByRole} registro(s) protegido(s) por regra de cargo`);
  }

  if(possibleReadmissions){
    signals.push(`${possibleReadmissions} possível(is) readmissão(ões) sinalizada(s)`);
  }

  score=Math.max(0,Math.min(100,score));
  const level=intelligenceLevel(score);

  return {
    engine:"LEITOR_INTELIGENTE_SENIOR",
    score,
    level,
    requiresReview:score<65,
    signals,
    suggestedAction:score>=85
      ?"Conferência rápida e confirmação."
      : score>=65
        ?"Conferir os registros destacados antes de confirmar."
        :"Revisão manual obrigatória antes de qualquer alteração."
  };
}

function buildShiftIntelligence({
  rows=[],
  unknownCodes=[],
  parsingDiagnostics=null,
  detectedOperationalBranch="",
  inferredBranch=null,
  readerUsed="",
  readerScore=0
}={}){
  let score=15;
  const signals=[];

  if(rows.length){
    score+=20;
    signals.push(`${rows.length} colaborador(es) reconstruído(s) da escala`);
  }

  const configuredRows=rows.filter(row=>row.result!=="CODIGO_NAO_CONFIGURADO").length;
  if(rows.length){
    const ratio=configuredRows/rows.length;
    score+=Math.round(ratio*20);
    signals.push(`${Math.round(ratio*100)}% dos códigos possuem turno cadastrado`);
  }

  const locatedRows=rows.filter(row=>row.employeeId).length;
  if(rows.length){
    const ratio=locatedRows/rows.length;
    score+=Math.round(ratio*15);
    signals.push(`${Math.round(ratio*100)}% das matrículas foram localizadas na filial`);
  }

  const comparable=rows.filter(row=>row.employeeId&&row.nameMatches!==null);
  const nameMatches=comparable.filter(row=>row.nameMatches!==false).length;
  if(comparable.length){
    const ratio=nameMatches/comparable.length;
    score+=Math.round(ratio*10);
    signals.push(`${Math.round(ratio*100)}% dos nomes conferem com o cadastro`);
  }

  if(detectedOperationalBranch){
    score+=10;
    signals.push(`Operação identificada no arquivo: ${detectedOperationalBranch}`);
  }else if(inferredBranch){
    score+=8;
    signals.push(`Filial inferida pelas matrículas: ${inferredBranch.name}`);
  }

  if(readerUsed){
    score+=5;
    signals.push(`Leitor escolhido: ${readerUsed}`);
  }

  if(Number(readerScore)>0){
    score+=5;
  }

  if(unknownCodes.length){
    score-=Math.min(20,unknownCodes.length*5);
    signals.push(`Código(s) ainda não aprendido(s): ${unknownCodes.join(", ")}`);
  }

  const unresolvedCount=Number(parsingDiagnostics?.unresolvedCount||0);
  if(parsingDiagnostics?.uniqueRegistrationCount){
    const coverage=Math.round(
      (Number(parsingDiagnostics.parsedCount||0)/Number(parsingDiagnostics.uniqueRegistrationCount))*100
    );
    signals.push(`${coverage}% das matrículas do PDF foram montadas com turno`);
    if(unresolvedCount)score-=Math.min(30,unresolvedCount*3);
    else score+=5;
  }

  score=Math.max(0,Math.min(100,score));
  const level=intelligenceLevel(score);

  return {
    engine:"LEITOR_INTELIGENTE_SENIOR",
    score,
    level,
    requiresReview:score<65 || unknownCodes.length>0 || unresolvedCount>0,
    signals,
    suggestedAction:unresolvedCount
      ?"Não confirme: existem matrículas do PDF sem turno montado. Revise o arquivo e o diagnóstico."
      : unknownCodes.length
      ?"Vincule os códigos novos aos turnos cadastrados. O sistema memorizará essa associação."
      : score>=85
        ?"Escala reconhecida com alta confiança. Faça a conferência final."
        : score>=65
          ?"Confira divergências de nome e filial antes de atualizar."
          :"Revisão manual obrigatória antes de atualizar os turnos."
  };
}


function normalizeOperationalBranchName(value){
  return normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function canonicalOperationalBranch(value){
  const text=normalizeOperationalBranchName(value);
  if(!text)return "";
  if(/\bFRACIONADO\b/.test(text))return "FRACIONADO";
  if(/\bSODEXO\b/.test(text))return "SODEXO";
  if(/\bTRANZILOG\b/.test(text))return "TRANZILOG";
  return "";
}

function detectOperationalBranchFromText(text,fileName=""){
  const source=normalizeOperationalBranchName(`${fileName} ${text}`);
  // Detecta somente as três operações conhecidas, evitando inferência por cidade/código.
  const hits=["TRANZILOG","FRACIONADO","SODEXO"].filter(name=>
    new RegExp(`\\b${name}\\b`).test(source)
  );
  return hits.length===1?hits[0]:"";
}

async function getSelectedBranch(branchId,companyId){
  const result=await pool.query(`
    SELECT id,name,company_id
    FROM branches
    WHERE id=$1
      AND company_id=$2
      AND active=TRUE
    LIMIT 1
  `,[branchId,companyId]);
  return result.rows[0]||null;
}

async function validatePdfOperationalBranch({text,fileName="",companyId,branchId}){
  const selected=await getSelectedBranch(branchId,companyId);
  if(!selected){
    return {
      ok:false,
      status:400,
      error:"Filial selecionada não encontrada ou está inativa."
    };
  }

  const detected=detectOperationalBranchFromText(text,fileName);
  const selectedCanonical=canonicalOperationalBranch(selected.name);

  // Se o PDF não trouxer uma das três operações de forma inequívoca,
  // não bloqueamos: apenas seguimos com a conferência normal.
  if(!detected){
    return {
      ok:true,
      detectedOperationalBranch:"",
      selectedBranchName:selected.name,
      selectedOperationalBranch:selectedCanonical
    };
  }

  if(selectedCanonical!==detected){
    return {
      ok:false,
      status:409,
      code:"BRANCH_MISMATCH",
      error:"Filial divergente.",
      detail:`O PDF foi identificado como ${detected}, mas a filial selecionada é ${selected.name}. A importação foi bloqueada para evitar alteração de colaboradores de outra filial.`,
      detectedOperationalBranch:detected,
      selectedBranchName:selected.name,
      selectedOperationalBranch:selectedCanonical
    };
  }

  return {
    ok:true,
    detectedOperationalBranch:detected,
    selectedBranchName:selected.name,
    selectedOperationalBranch:selectedCanonical
  };
}

function detectHeader(text){
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const branchLine=lines.find(line=>/^\d{3}\.\d{2}\.\d{2}\.\d{3}\s*,/.test(line))
    || lines.find(line=>/FILIAL\s+\d+/i.test(line))
    || "";
  const companyLine=lines.find(line=>/TRANSPORTES E ARMAZENAGEM/i.test(line))||"";
  return {
    detectedCompany:companyLine.replace(/^\d+\s*-\s*/,"").trim(),
    detectedBranch:branchLine
  };
}

function cleanCaptured(value){
  return String(value||"")
    .replace(/\s+/g," ")
    .replace(/\s+Pág\.?:?\s*\d+/gi," ")
    .trim();
}

function compactText(text){
  return String(text||"")
    .replace(/\r/g," ")
    .replace(/\n/g," ")
    .replace(/\u00a0/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function normalizePdfLines(text){
  return String(text||"")
    .replace(/\r/g,"\n")
    .replace(/\u00a0/g," ")
    .split(/\n+/)
    .map(line=>line.replace(/[ \t]+/g," ").trim())
    .filter(Boolean);
}

function isNoiseLine(line){
  return (
    /^0001\s*-\s*Pág/i.test(line) ||
    /^Relação de /i.test(line) ||
    /^Cadastro Nome /i.test(line) ||
    /^TRANSPORTES E ARMAZENAGEM/i.test(line) ||
    /^Filial$/i.test(line) ||
    /^001\./.test(line) ||
    /^Total\b/i.test(line) ||
    /^FPRE\d+/i.test(line)
  );
}

function splitByRegistrations(text){
  const compact=compactText(text);
  const matches=[...compact.matchAll(/0\d{8}/g)];
  const blocks=[];

  for(let i=0;i<matches.length;i++){
    const blockStart=matches[i].index;
    const blockEnd=i+1<matches.length?matches[i+1].index:compact.length;
    const registration=matches[i][0];
    const body=compact.slice(blockStart+registration.length,blockEnd).trim();

    if(body)blocks.push({registration,body});
  }

  return blocks;
}

function parseAdmittedBlock(block){
  const dateMatch=block.body.match(/(\d{2}\/\d{2}\/\d{4})/);
  if(!dateMatch)return null;

  const beforeDate=cleanCaptured(block.body.slice(0,dateMatch.index));
  const afterDate=cleanCaptured(block.body.slice(dateMatch.index+dateMatch[0].length));

  // Extração real:
  // matrícula + código do cargo + cartão + nome + data + cargo
  // Ex.: 00001147719 0002 CARLOS... 04/07/2026 CARREGADOR
  const prefixMatch=beforeDate.match(/^(\d{1,3})\s*(\d{4})\s+(.+)$/);
  if(!prefixMatch)return null;

  const row={
    registration:block.registration,
    jobCode:prefixMatch[1],
    pointCard:prefixMatch[2],
    fullName:cleanCaptured(prefixMatch[3]),
    admissionDate:toIsoDate(dateMatch[1]),
    jobTitle:cleanCaptured(afterDate.replace(/^\s*-\s*/,"")),
    status:"NOVO"
  };

  return row.fullName&&row.jobTitle?row:null;
}

function parseDismissedBlock(block){
  const dateMatch=block.body.match(/(\d{2}\/\d{2}\/\d{4})/);
  if(!dateMatch)return null;

  const beforeDate=cleanCaptured(block.body.slice(0,dateMatch.index));
  const afterDate=cleanCaptured(block.body.slice(dateMatch.index+dateMatch[0].length));

  let causeCode="";
  let fullName=beforeDate;
  let jobTitle=afterDate;

  // Alguns modelos FPRE extraídos pelo pdf-parse retornam as colunas como:
  // matrícula + causa + data + cargo/nome unidos. O código de causa não é nome.
  if(/^\d{2}$/.test(beforeDate)){
    causeCode=beforeDate;
    fullName="";
  }

  const normalAfter=afterDate.match(/^(\d{2})\s+(.+)$/);
  if(normalAfter){
    causeCode=normalAfter[1];
    jobTitle=cleanCaptured(normalAfter[2]);
  }else{
    const compactPrefix=beforeDate.match(/^(\d{2})\s*(.+)$/);
    if(compactPrefix){
      causeCode=compactPrefix[1];
      fullName=cleanCaptured(compactPrefix[2]);
    }
  }

  if(!fullName&&!causeCode)return null;

  return {
    registration:block.registration,
    fullName,
    terminationDate:toIsoDate(dateMatch[1]),
    causeCode,
    jobTitle,
    status:"LOCALIZAR"
  };
}


function parseAdmittedColumnar(text){
  const source=String(text||"").replace(/\r/g,"\n");
  if(!/Rela[cç][aã]o de Admitidos/i.test(source))return [];

  // O FPRE004.COL pode ser extraído pelo pdf-parse em ordem de colunas:
  // todas as matrículas, depois Nome/Data alternados, depois códigos de cargo,
  // cargos e cartões. Este parser reconstrói as linhas pelo índice.
  const lines=source
    .split(/\n+/)
    .map(line=>line.replace(/[ \t]+/g," ").trim())
    .filter(Boolean);

  const firstReg=lines.findIndex(line=>/^0\d{8}$/.test(line));
  if(firstReg<0)return [];

  const registrations=[];
  let cursor=firstReg;
  while(cursor<lines.length && /^0\d{8}$/.test(lines[cursor])){
    registrations.push(lines[cursor]);
    cursor++;
  }

  if(registrations.length<2)return [];

  // Depois das matrículas, o PDF apresenta Nome / Data intercalados.
  const names=[];
  const dates=[];
  while(cursor<lines.length && names.length<registrations.length){
    const current=lines[cursor];

    if(/^Total\b/i.test(current) || /^FPRE\d+/i.test(current))break;

    if(/^\d{2}\/\d{2}\/\d{4}$/.test(current)){
      // Data sem nome anterior: estrutura inesperada.
      break;
    }

    const name=current;
    const next=lines[cursor+1]||"";
    if(!/^\d{2}\/\d{2}\/\d{4}$/.test(next))break;

    names.push(cleanCaptured(name));
    dates.push(next);
    cursor+=2;
  }

  if(names.length!==registrations.length || dates.length!==registrations.length){
    return [];
  }

  // Códigos de cargo: um número por colaborador.
  const jobCodes=[];
  while(cursor<lines.length && jobCodes.length<registrations.length){
    const current=lines[cursor];
    if(/^\d{1,4}$/.test(current)){
      jobCodes.push(current);
      cursor++;
      continue;
    }
    break;
  }

  if(jobCodes.length!==registrations.length)return [];

  // Cargos vêm como "- DESCRIÇÃO".
  const jobTitles=[];
  while(cursor<lines.length && jobTitles.length<registrations.length){
    const current=lines[cursor];
    if(/^-\s*.+/.test(current)){
      jobTitles.push(cleanCaptured(current.replace(/^-\s*/,"")));
      cursor++;
      continue;
    }
    break;
  }

  if(jobTitles.length!==registrations.length)return [];

  // Cartão ponto: normalmente 0002, um por colaborador.
  const pointCards=[];
  while(cursor<lines.length && pointCards.length<registrations.length){
    const current=lines[cursor];
    if(/^\d{4}$/.test(current)){
      pointCards.push(current);
      cursor++;
      continue;
    }
    break;
  }

  if(pointCards.length!==registrations.length)return [];

  return registrations.map((registration,index)=>({
    registration,
    fullName:names[index],
    admissionDate:toIsoDate(dates[index]),
    jobCode:jobCodes[index],
    jobTitle:jobTitles[index],
    pointCard:pointCards[index],
    status:"NOVO"
  }));
}

function isValidAdmittedRow(row){
  if(!row)return false;
  if(!isPlausibleRegistration(row.registration))return false;
  if(!isPlausibleEmployeeName(row.fullName))return false;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(row.admissionDate||"")))return false;
  if(!isPlausibleRole(row.jobTitle))return false;
  if(!String(row.jobTitle||"").trim())return false;
  if(!/^\d{4}$/.test(String(row.pointCard||"").trim()))return false;
  return true;
}

function parseAdmitted(text){
  let rows=[];
  const lines=normalizePdfLines(text);
  const lineRegex=/^(\d{9})\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s*-\s*(.+?)\s+(\d{4})$/;

  // 1) Layout preservado por linha.
  for(const line of lines){
    if(isNoiseLine(line))continue;
    const match=line.match(lineRegex);
    if(!match)continue;

    rows.push({
      registration:match[1],
      fullName:cleanCaptured(match[2]),
      admissionDate:toIsoDate(match[3]),
      jobCode:match[4],
      jobTitle:cleanCaptured(match[5]),
      pointCard:match[6],
      status:"NOVO"
    });
  }

  // 2) Layout FPRE004.COL extraído em ordem de colunas (caso real do Render).
  if(!rows.length){
    rows=parseAdmittedColumnar(text);
  }

  // 3) Compatibilidade com PDFs antigos concatenados.
  if(!rows.length){
    for(const block of splitByRegistrations(text)){
      const row=parseAdmittedBlock(block);
      if(row)rows.push(row);
    }
  }

  // Nunca permite que totalização, rodapé, horário ou usuário virem colaborador.
  rows=rows
    .map(normalizeImportItem)
    .filter(isValidAdmittedRow);

  const unique=new Map();
  for(const row of rows){
    if(!unique.has(row.registration))unique.set(row.registration,row);
  }

  return [...unique.values()];
}

function parseDismissed(text){
  const rows=[];
  const lines=normalizePdfLines(text);
  const lineRegex=/^(\d{9})\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2})\s+(.+)$/;

  for(const line of lines){
    if(isNoiseLine(line))continue;
    const match=line.match(lineRegex);
    if(!match)continue;

    rows.push({
      registration:match[1],
      fullName:cleanCaptured(match[2]),
      terminationDate:toIsoDate(match[3]),
      causeCode:match[4],
      jobTitle:cleanCaptured(match[5]),
      status:"LOCALIZAR"
    });
  }

  if(!rows.length){
    for(const block of splitByRegistrations(text)){
      const row=parseDismissedBlock(block);
      if(row)rows.push(row);
    }
  }

  return rows;
}



function removeCollaboratorReportNoise(text){
  return compactText(text)
    .replace(/-\s*Pág\.?:?\s*\d+/gi," ")
    .replace(/Relação de Colaboradores/gi," ")
    .replace(/Cadastro\s*Tipo\s*Nome\s*Admissão\s*Cargo/gi," ")
    .replace(/CadastroNomeAdmissãoCargoTipo/gi," ")
    .replace(/TRANSPORTES E ARMAZENAGEM ZILLI LTDA/gi," ")
    .replace(/001\.02\.03\.120[^0]*?/gi," ")
    .replace(/Total Geral.*$/gi," ")
    .replace(/Total\s+001[^0]*?/gi," ")
    // Remove somente o identificador/data/hora do rodapé. O texto já está
    // compactado em uma linha; usar .* até o fim apagaria as páginas seguintes.
    .replace(/FPRE\d+\.COL\s*-\s*\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}:\d{2}:\d{2}/gi," ")
    .replace(/\s+/g," ")
    .trim();
}

function splitConcatenatedCollaboratorBlocks(text){
  const cleaned=removeCollaboratorReportNoise(text);
  const matches=[...cleaned.matchAll(/0\d{8}/g)];
  const blocks=[];

  for(let i=0;i<matches.length;i++){
    const start=matches[i].index;
    const end=i+1<matches.length?matches[i+1].index:cleaned.length;
    const registration=matches[i][0];
    const raw=cleaned.slice(start+registration.length,end).trim();

    if(raw)blocks.push({registration,raw});
  }

  return blocks;
}

function knownJobTitles(){
  return [
    "AUXILIAR DE SERVICOS GERAIS",
    "CONFERENTE DE CARGA E DESCARGA",
    "LIDER DE EXPEDICAO",
    "OPERADOR DE EMPILHADEIRA II",
    "OPERADOR DE EMPILHADEIRA I",
    "OPERADOR DE EMPILHADEIRA LIDER",
    "OPERADOR DE EMPILHADEIRA",
    "CONFERENTE LIDER II",
    "CONFERENTE LIDER I",
    "CONFERENTE LIDER",
    "AUXILIAR DE EXPEDICAO",
    "ASSISTENTE ADMINISTRATIVO",
    "ENCARREGADO DE EXPEDICAO",
    "ENCARREGADO DE ARMAZEM",
    "COORDENADOR DE ARMAZEM",
    "COORDENADOR DE PREVENCAO DE PE",
    "CONTROLE DE QUALIDADE",
    "CONTROLE DE ESTOQUE",
    "ANALISTA DE ESTOQUE",
    "APRENDIZ DE AUXILIAR DE ADMINI",
    "OPERADOR DE EMPILHADEIRA LIDER",
    "LIDER DE ESTOQUE",
    "SERVICOS GERAIS",
    "BALANCEIRO",
    "SEPARADOR",
    "CARREGADOR",
    "ZELADOR"
  ].sort((a,b)=>b.length-a.length);
}

function parseConcatenatedCollaboratorBlock(block){
  const dateMatch=block.raw.match(/(\d{2}\/\d{2}\/\d{4})/);
  if(!dateMatch)return null;

  let beforeDate=cleanCaptured(block.raw.slice(0,dateMatch.index));
  let afterDate=cleanCaptured(block.raw.slice(dateMatch.index+dateMatch[0].length));

  // O campo Tipo pode aparecer antes do nome ou após o cargo.
  let employeeType="";
  const leadingType=beforeDate.match(/^(\d{1,2})\s*(.+)$/);
  if(leadingType){
    employeeType=leadingType[1];
    beforeDate=cleanCaptured(leadingType[2]);
  }

  const titles=knownJobTitles();
  let jobTitle="";
  let trailingType="";

  for(const title of titles){
    if(afterDate.startsWith(title)){
      jobTitle=title;
      trailingType=cleanCaptured(afterDate.slice(title.length));
      break;
    }
  }

  if(!jobTitle){
    const trailingMatch=afterDate.match(/^(.+?)(\d{1,2})$/);
    if(trailingMatch){
      jobTitle=cleanCaptured(trailingMatch[1]);
      trailingType=trailingMatch[2];
    }else{
      jobTitle=afterDate;
    }
  }

  if(!employeeType&&trailingType){
    const typeMatch=trailingType.match(/^(\d{1,2})$/);
    if(typeMatch)employeeType=typeMatch[1];
  }

  if(!beforeDate||!jobTitle)return null;

  return {
    registration:block.registration,
    employeeType:employeeType||"1",
    fullName:beforeDate,
    admissionDate:toIsoDate(dateMatch[1]),
    jobTitle,
    status:"ATIVO"
  };
}

function parseCollaboratorsColumnar(text){
  const lines=normalizePdfLines(text);
  const rows=[];
  const employeeLine=/^(0\d{8})\s+(\d{1,2})\s+(.+)$/;
  const dateRoleLine=/^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/;

  for(let cursor=0;cursor<lines.length;cursor++){
    const first=lines[cursor].match(employeeLine);
    if(!first||/\d{2}\/\d{2}\/\d{4}/.test(lines[cursor]))continue;

    const employees=[];
    let employeeCursor=cursor;
    while(employeeCursor<lines.length){
      const match=lines[employeeCursor].match(employeeLine);
      if(!match||/\d{2}\/\d{2}\/\d{4}/.test(lines[employeeCursor]))break;
      employees.push({
        registration:match[1],
        employeeType:match[2],
        fullName:cleanCaptured(match[3])
      });
      employeeCursor++;
    }

    // Entre as duas colunas podem aparecer rodapé, usuário, número da página
    // e outros textos da Senior. A próxima sequência de data + cargo pertence
    // à sequência de matrículas/nome localizada acima.
    const dateRoles=[];
    let dataCursor=employeeCursor;
    let nextEmployeeRun=false;
    while(dataCursor<lines.length&&dateRoles.length<employees.length){
      const dateMatch=lines[dataCursor].match(dateRoleLine);
      if(dateMatch){
        dateRoles.push({admissionDate:toIsoDate(dateMatch[1]),jobTitle:cleanCaptured(dateMatch[2])});
      }else if(lines[dataCursor].match(employeeLine)&&!/\d{2}\/\d{2}\/\d{4}/.test(lines[dataCursor])){
        nextEmployeeRun=true;
        break;
      }
      dataCursor++;
    }

    if(!nextEmployeeRun&&employees.length===dateRoles.length){
      employees.forEach((employee,index)=>rows.push({
        ...employee,
        ...dateRoles[index],
        status:"ATIVO"
      }));
      cursor=dataCursor-1;
    }
  }

  return rows;
}

function parseCollaborators(text){
  const rows=[];
  const lines=normalizePdfLines(text);

  // Layout com colunas preservadas.
  const lineRegex=/^(\d{9})\s+(\d+)\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(.+)$/;

  for(const line of lines){
    if(isNoiseLine(line))continue;
    const match=line.match(lineRegex);
    if(!match)continue;

    rows.push({
      registration:match[1],
      employeeType:match[2],
      fullName:cleanCaptured(match[3]),
      admissionDate:toIsoDate(match[4]),
      jobTitle:cleanCaptured(match[5]),
      status:"ATIVO"
    });
  }

  // O pdf-parse pode devolver cada página em duas colunas sequenciais:
  // primeiro matrícula/tipo/nome de todos e depois admissão/cargo de todos.
  // Reconstruímos cada grupo pelo índice para não perder páginas inteiras.
  rows.push(...parseCollaboratorsColumnar(text));

  // Também tenta o layout concatenado mesmo quando parte das linhas já foi
  // reconhecida. Antes, bastava uma linha válida para o fallback ser ignorado,
  // deixando colaboradores de páginas/trechos diferentes fora da importação.
  for(const block of splitConcatenatedCollaboratorBlocks(text)){
    const row=parseConcatenatedCollaboratorBlock(block);
    if(row)rows.push(row);
  }

  // Normaliza e remove ruídos antes de deduplicar. O primeiro registro íntegro
  // da matrícula prevalece, evitando duplicidade entre os dois formatos.
  const unique=new Map();
  for(const row of rows.map(normalizeImportItem)){
    if(!isPlausibleRegistration(row.registration))continue;
    if(!isPlausibleEmployeeName(row.fullName))continue;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(row.admissionDate||"")))continue;
    if(!isPlausibleRole(row.jobTitle))continue;
    if(!unique.has(row.registration)){
      unique.set(row.registration,row);
    }
  }

  return [...unique.values()];
}

function detectImportType(text){
  const normalized=normalizeText(text).toUpperCase();
  if(normalized.includes("RELACAO DE ADMITIDOS"))return "ADMITIDOS";
  if(normalized.includes("RELACAO DE DEMITIDOS"))return "DEMITIDOS";
  if(normalized.includes("RELACAO DE COLABORADORES"))return "COLABORADORES";
  return null;
}

function buildImportDiagnostics(text,type,rows){
  const compact=compactText(text);
  const registrations=[...compact.matchAll(/0\d{8}/g)].map(m=>m[0]);
  const uniqueRegistrations=[...new Set(registrations)];
  const parsedRegistrations=new Set(rows.map(row=>String(row.registration||"").trim()));
  const unresolvedRegistrations=uniqueRegistrations.filter(registration=>
    !parsedRegistrations.has(registration)
  );
  const dates=[...compact.matchAll(/\d{2}\/\d{2}\/\d{4}/g)].map(m=>m[0]);

  return {
    registrationCount:registrations.length,
    uniqueRegistrationCount:uniqueRegistrations.length,
    dateCount:dates.length,
    pointCardCount:type==="ADMITIDOS"
      ? rows.filter(row=>Boolean(row.pointCard)).length
      : 0,
    parsedCount:rows.length,
    unresolvedCount:unresolvedRegistrations.length,
    unresolvedRegistrations
  };
}

function normalizeChecklistText(value){
  return normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function checklistDate(value){
  if(!value)return "";
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
  return String(value).slice(0,10);
}

async function buildSeniorSystemChecklist({rows=[],companyId,branchId,type}){
  if(type!=="COLABORADORES")return null;

  const registrations=[...new Set(rows.map(row=>String(row.registration||"").trim()).filter(Boolean))];
  const [unitResult,globalResult]=await Promise.all([
    pool.query(`
      SELECT e.id,e.registration,e.full_name,e.admission_date,e.status,
             COALESCE(jr.name,e.job_title,'') job_title,
             s.name shift_name
      FROM employees e
      LEFT JOIN job_roles jr ON jr.id=e.job_role_id
      LEFT JOIN shifts s ON s.id=e.shift_id
      WHERE e.company_id=$1 AND e.branch_id=$2
      ORDER BY e.full_name
    `,[companyId,branchId]),
    registrations.length?pool.query(`
      SELECT e.id,e.registration,e.full_name,e.company_id,e.branch_id,
             c.trade_name company_name,b.name branch_name
      FROM employees e
      LEFT JOIN companies c ON c.id=e.company_id
      LEFT JOIN branches b ON b.id=e.branch_id
      WHERE e.registration=ANY($1::text[])
    `,[registrations]):Promise.resolve({rows:[]})
  ]);

  const unitByRegistration=new Map(
    unitResult.rows.map(employee=>[String(employee.registration||"").trim(),employee])
  );
  const globalByRegistration=new Map(
    globalResult.rows.map(employee=>[String(employee.registration||"").trim(),employee])
  );
  const pdfSet=new Set(registrations);
  const items=[];

  for(const row of rows){
    const registration=String(row.registration||"").trim();
    const existing=unitByRegistration.get(registration)||null;
    const globalExisting=globalByRegistration.get(registration)||null;

    if(!existing){
      if(globalExisting){
        items.push({
          origin:"SENIOR",
          registration,
          fullName:row.fullName,
          jobTitle:row.jobTitle||"",
          shiftName:"",
          status:"OUTRA_UNIDADE",
          details:`Cadastrado em ${globalExisting.company_name||"outra empresa"} / ${globalExisting.branch_name||"outra filial"}.`
        });
      }else{
        items.push({
          origin:"SENIOR",
          registration,
          fullName:row.fullName,
          jobTitle:row.jobTitle||"",
          shiftName:"",
          status:row.possibleReadmission?"POSSIVEL_READMISSAO":"CADASTRAR",
          details:row.possibleReadmission
            ?`Mesmo nome localizado anteriormente na matrícula ${row.previousRegistration||"não informada"}.`
            :"Está na lista da Senior e ainda não existe no sistema."
        });
      }
      continue;
    }

    const differences=[];
    if(normalizeChecklistText(existing.full_name)!==normalizeChecklistText(row.fullName))differences.push("nome");
    if(normalizeChecklistText(existing.job_title)!==normalizeChecklistText(row.jobTitle))differences.push("cargo");
    if(checklistDate(existing.admission_date)!==checklistDate(row.admissionDate))differences.push("admissão");
    if(String(existing.status||"").toUpperCase()!=="ATIVO")differences.push(`situação ${existing.status||"não informada"}`);

    const withoutShift=!existing.shift_name;
    items.push({
      origin:"SENIOR",
      registration,
      fullName:row.fullName,
      systemName:existing.full_name,
      jobTitle:row.jobTitle||"",
      systemJobTitle:existing.job_title||"",
      shiftName:existing.shift_name||"",
      withoutShift,
      status:differences.length?"ATUALIZAR":withoutShift?"SEM_TURNO":"CONFERIDO",
      details:differences.length
        ?`Divergência em: ${differences.join(", ")}.`
        : withoutShift
          ?"Cadastro localizado, mas o turno ainda não está definido."
          :"Matrícula e dados conferidos no sistema."
    });
  }

  for(const employee of unitResult.rows){
    const registration=String(employee.registration||"").trim();
    if(String(employee.status||"").toUpperCase()!=="ATIVO"||pdfSet.has(registration))continue;
    items.push({
      origin:"SISTEMA",
      registration,
      fullName:employee.full_name,
      jobTitle:employee.job_title||"",
      shiftName:employee.shift_name||"",
      withoutShift:!employee.shift_name,
      status:"NAO_APARECE_NA_SENIOR",
      details:"Está ativo no sistema, mas não aparece nesta lista da Senior. Revisar sem alteração automática."
    });
  }

  const count=status=>items.filter(item=>item.status===status).length;
  return {
    generatedAt:new Date().toISOString(),
    seniorTotal:rows.length,
    systemActiveTotal:unitResult.rows.filter(employee=>String(employee.status||"").toUpperCase()==="ATIVO").length,
    summary:{
      conferred:count("CONFERIDO"),
      toCreate:count("CADASTRAR"),
      toUpdate:count("ATUALIZAR"),
      withoutShift:items.filter(item=>item.withoutShift).length,
      possibleReadmissions:count("POSSIVEL_READMISSAO"),
      otherUnit:count("OUTRA_UNIDADE"),
      systemOnly:count("NAO_APARECE_NA_SENIOR")
    },
    items
  };
}


function sanitizeImportedText(value,maxLength){
  return cleanCaptured(value)
    .replace(/Rela[cç][aã]o de Admitidos/gi," ")
    .replace(/Cadastro\s*Nome\s*Admiss[aã]o\s*Cargo\s*Cart[aã]o\s*Ponto/gi," ")
    .replace(/TRANSPORTES E ARMAZENAGEM ZILLI LTDA/gi," ")
    .replace(/\bFilial\s+\d+\b.*?(?=\d{2}\/\d{2}\/\d{4}|$)/gi," ")
    .replace(/\s+/g," ")
    .trim()
    .slice(0,maxLength);
}

function normalizeImportItem(item){
  return {
    ...item,
    registration:String(item.registration||"").trim().slice(0,50),
    fullName:sanitizeImportedText(item.fullName,180),
    jobTitle:sanitizeImportedJobTitle(item.jobTitle),
    pointCard:String(item.pointCard||"").trim().slice(0,30),
    causeCode:String(item.causeCode||"").trim().slice(0,20)
  };
}

function comparableImportedText(value){
  return normalizeText(value).toUpperCase();
}

function comparableImportedDate(value){
  if(!value)return "";
  if(value instanceof Date&&!Number.isNaN(value.getTime())){
    return value.toISOString().slice(0,10);
  }
  return String(value).slice(0,10);
}

// A matrícula identifica o vínculo. Estes campos podem mudar na Senior e
// precisam ser corrigidos no cadastro sem criar um segundo colaborador.
function detectEmployeeCorrections(existing,item){
  const corrections=[];
  if(comparableImportedText(existing?.full_name)!==comparableImportedText(item?.fullName)){
    corrections.push("nome");
  }
  if(comparableImportedDate(existing?.admission_date)!==comparableImportedDate(item?.admissionDate)){
    corrections.push("admissão");
  }
  if(comparableImportedText(existing?.effective_job_title??existing?.job_title)!==comparableImportedText(item?.jobTitle)){
    corrections.push("cargo/função");
  }
  if(item?.pointCard&&String(existing?.point_card||"").trim()!==String(item.pointCard).trim()){
    corrections.push("cartão-ponto");
  }
  if(String(existing?.status||"").trim().toUpperCase()!=="ATIVO"){
    corrections.push("situação");
  }
  return corrections;
}

function assertScope(req,companyId,branchId){
  if(req.scope.isAdmin)return;
  if(companyId!==req.scope.companyId||!req.scope.branchIds.includes(branchId)){
    const error=new Error("Empresa ou filial fora do seu acesso.");
    error.status=403;
    throw error;
  }
}

router.post("/preview",upload.single("file"),async(req,res)=>{
  try{
    if(!req.file){
      return res.status(400).json({error:"Selecione o PDF."});
    }

    const requestedType=req.body.type;
    if(!["ADMITIDOS","DEMITIDOS","COLABORADORES","AUTO"].includes(requestedType)){
      return res.status(400).json({error:"Tipo de importação inválido."});
    }

    const companyId=String(req.body.companyId||"").trim();
    const branchId=String(req.body.branchId||"").trim();

    if(!companyId||!branchId){
      return res.status(400).json({error:"Selecione a empresa e a filial."});
    }

    assertScope(req,companyId,branchId);

    const movementReport=
      ["ADMITIDOS","DEMITIDOS"].includes(requestedType) ||
      /Admitidos|Demitidos|Demiss[aã]o/i.test(req.file.originalname||"");
    const extraction=movementReport
      ? await extractSeniorMovementPdfText(req.file.buffer)
      : await extractPdfText(req.file.buffer,{
          skipPdf2Json:/Senior|Escala|Turno|Colaboradores/i.test(req.file.originalname||"")
        });
    const text=extraction.text||"";

    const branchCheck=await validatePdfOperationalBranch({
      text,
      fileName:req.file.originalname,
      companyId,
      branchId
    });
    if(!branchCheck.ok){
      return res.status(branchCheck.status||409).json(branchCheck);
    }

    const detectedType=detectImportType(text);
    const type=requestedType==="AUTO"?detectedType:requestedType;

    if(!type){
      return res.status(400).json({
        error:"Não foi possível identificar o tipo do relatório da Senior."
      });
    }

    if(detectedType&&requestedType!=="AUTO"&&detectedType!==requestedType){
      return res.status(400).json({
        error:`O arquivo enviado é de ${detectedType.toLowerCase()}, mas o tipo selecionado foi ${requestedType.toLowerCase()}.`
      });
    }

    const header=detectHeader(text);
    let rows=(
      type==="ADMITIDOS" ? parseAdmitted(text) :
      type==="DEMITIDOS" ? parseDismissed(text) :
      parseCollaborators(text)
    ).map(normalizeImportItem);

    if(type==="DEMITIDOS"){
      rows=rows.map(normalizeDismissedCause);
      try{
        const registrations=[...new Set(rows.map(row=>row.registration).filter(Boolean))];
        const currentEmployees=registrations.length
          ? await pool.query(`
              SELECT e.registration,e.full_name,e.job_title,
                     COALESCE(jr.name,e.job_title,'') effective_job_title
              FROM employees e
              LEFT JOIN job_roles jr ON jr.id=e.job_role_id
              WHERE e.registration=ANY($1::text[])
              ORDER BY e.created_at
            `,[registrations])
          : {rows:[]};
        const employeesByRegistration=new Map(
          currentEmployees.rows.map(employee=>[String(employee.registration),employee])
        );
        rows=rows.map(row=>reconcileDismissedWithEmployee(
          row,employeesByRegistration.get(String(row.registration))||null
        ));
      }catch(error){
        console.warn("[IMPORT_DISMISSED_RECONCILIATION]",error.message);
      }
    }

    // Segurança adicional: Admitidos só chega à conferência se todos os campos
    // estruturais forem plausíveis. Ruídos de Total/Usuário/horário são descartados.
    if(type==="ADMITIDOS"){
      rows=rows.filter(isValidAdmittedRow);
    }

    if(!rows.length){
      const sample=text.replace(/\s+/g," ").trim().slice(0,1200);

      return res.status(422).json({
        error:"Nenhum colaborador foi reconhecido no PDF.",
        detail:`O arquivo foi lido como ${type.toLowerCase()}, mas nenhuma linha foi montada.`,
        extractedTextSample:sample
      });
    }

    let blockedByRole=0;
    let possibleReadmissions=0;

    // Nome nunca é usado para decidir se é o mesmo vínculo.
    // A matrícula continua sendo a chave operacional. O nome serve somente
    // para avisar sobre uma possível readmissão (mesmo nome, matrícula diferente).
    if(type==="ADMITIDOS"||type==="COLABORADORES"){
      try{
        const names=[...new Set(
          rows
            .map(row=>String(row.fullName||"").trim())
            .filter(Boolean)
        )];

        if(names.length){
          const sameNameRows=await pool.query(`
            SELECT id,registration,full_name,status,admission_date,termination_date
            FROM employees
            WHERE LOWER(REGEXP_REPLACE(TRIM(full_name),'\\s+',' ','g'))
              = ANY($1::text[])
            ORDER BY full_name,created_at
          `,[names.map(name=>name.toLowerCase().replace(/\s+/g," "))]);

          for(const row of rows){
            const normalizedName=String(row.fullName||"").trim().toLowerCase().replace(/\s+/g," ");
            const previous=sameNameRows.rows.find(existing=>
              String(existing.full_name||"").trim().toLowerCase().replace(/\s+/g," ")===normalizedName &&
              String(existing.registration||"")!==String(row.registration||"")
            );

            if(previous){
              row.possibleReadmission=true;
              row.previousRegistration=previous.registration||null;
              row.previousStatus=previous.status||null;
              row.previousTerminationDate=previous.termination_date||null;
              possibleReadmissions++;
            }
          }
        }
      }catch(error){
        // O aviso de readmissão é auxiliar e nunca deve impedir a leitura do PDF.
        console.warn("[IMPORT_READMISSION_PREVIEW]",error.message);
      }
    }

    for(const row of rows){
      const blocked=(type==="ADMITIDOS"||type==="COLABORADORES") &&
        isBlockedEmployeeRole(row.jobTitle);

      if(blocked){
        row.result="CARGO_BLOQUEADO";
        row.selected=false;
        row.blockReason=`Cargo bloqueado: ${row.jobTitle}`;
        blockedByRole++;
      }else if(row.possibleReadmission){
        row.result="POSSIVEL_READMISSAO";
      }else{
        row.result=type==="DEMITIDOS"
          ? (row.systemMatch===false?"NAO_LOCALIZADO":"LOCALIZAR")
          : "CONFERIR";
      }
      row.hasShift=false;
    }

    const diagnostics=buildImportDiagnostics(text,type,rows);
    const comparisonChecklist=await buildSeniorSystemChecklist({
      rows,companyId,branchId,type
    });
    const intelligence=buildImportIntelligence({
      type,
      detectedType,
      rows,
      readerUsed:extraction.readerUsed,
      detectedOperationalBranch:branchCheck.detectedOperationalBranch,
      detectedCompany:header.detectedCompany,
      blockedByRole,
      possibleReadmissions
    });

    return res.json({
      type,
      detectedType,
      readerUsed:extraction.readerUsed,
      readerAttempts:extraction.attempts,
      diagnostics,
      comparisonChecklist,
      intelligence,
      fileName:req.file.originalname,
      detectedCompany:header.detectedCompany,
      detectedBranch:header.detectedBranch,
      detectedOperationalBranch:branchCheck.detectedOperationalBranch,
      selectedBranchName:branchCheck.selectedBranchName,
      previewCompanyId:companyId,
      previewBranchId:branchId,
      total:rows.length,
      blockedByRole,
      possibleReadmissions,
      blockedRoles:[...BLOCKED_EMPLOYEE_ROLES],
      missingFromReport:[],
      rows
    });
  }catch(error){
    console.error("Falha ao ler PDF da Senior:",{
      message:error.message,
      code:error.code,
      detail:error.detail,
      stack:error.stack
    });

    const attempts=error.readerAttempts||[];
    const attemptDetail=attempts.length
      ? attempts.map(item=>
          `${item.reader}: ${item.success?"sucesso":item.error}`
        ).join(" | ")
      : "";

    return res.status(500).json({
      error:"Não foi possível ler o arquivo PDF.",
      detail:[
        error.message||"Falha desconhecida durante a leitura.",
        attemptDetail
      ].filter(Boolean).join(" "),
      readerAttempts:attempts
    });
  }
});









function seniorShiftTextScore(text,configuredCodes=[]){
  const source=String(text||"");
  if(!source.trim())return -1000;

  let score=0;
  const regs=(source.match(/0\d{8}/g)||[]).length;
  const dates=(source.match(/\d{2}\/\d{2}\/\d{4}/g)||[]).length;
  const seniorWords=(source.match(/(?:Empregados por Escala|Escala|Cadastro|Per[ií]odo|TRANSPORTES E ARMAZENAGEM)/gi)||[]).length;

  score+=regs*12;
  score+=Math.min(dates,30)*2;
  score+=seniorWords*4;

  for(const value of configuredCodes){
    const normalized=normalizeSeniorShiftCode(value);
    if(!normalized)continue;
    const variants=[normalized];
    if(/^\d+$/.test(normalized))variants.push(normalized.padStart(4,"0"));
    for(const code of variants){
      const escaped=String(code).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
      if(new RegExp(`(?:^|\\D)${escaped}(?:\\D|$)`).test(source))score+=5;
    }
  }

  const suspicious=(source.match(/(?:PDFium|endobj|stream|xref|obj\b|\/Type|\/Font|\/Length|FlateDecode)/gi)||[]).length;
  score-=suspicious*25;

  const printable=(source.match(/[A-Za-zÀ-ÿ0-9\s.,;:/()\-]/g)||[]).length;
  const ratio=source.length?printable/source.length:0;
  if(ratio<0.65)score-=80;

  return score;
}


function extractPdfiumFlateText(buffer,options={}){
  const source=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer);
  const latin=source.toString("latin1");
  const items=[];

  const streamRegex=/stream\r?\n/g;
  let streamMatch;

  while((streamMatch=streamRegex.exec(latin))!==null){
    const start=streamMatch.index+streamMatch[0].length;
    const end=latin.indexOf("endstream",start);
    if(end<0)break;

    let raw=source.slice(start,end);
    while(raw.length&&(raw[raw.length-1]===10||raw[raw.length-1]===13)){
      raw=raw.slice(0,-1);
    }

    let decoded;
    try{
      decoded=zlib.inflateSync(raw).toString("latin1");
    }catch{
      streamRegex.lastIndex=end+9;
      continue;
    }

    const textBlockRegex=/BT([\s\S]*?)ET/g;
    let blockMatch;

    while((blockMatch=textBlockRegex.exec(decoded))!==null){
      const block=blockMatch[1];
      const matrices=[...block.matchAll(
        /([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+Tm/g
      )];

      const tm=matrices[matrices.length-1];
      if(!tm)continue;

      const x=Number(tm[5]);
      const y=Number(tm[6]);
      let text="";

      const tjArray=block.match(/\[((?:\\.|[^\]])*)\]\s*TJ/);
      const tjSingle=block.match(/\(((?:\\.|[^\\)])*)\)\s*Tj/);

      if(tjArray){
        const literalRegex=/\((?:\\.|[^\\()])*\)/g;
        let literal;
        while((literal=literalRegex.exec(tjArray[1]))!==null){
          text+=decodePdfLiteralString(literal[0].slice(1,-1));
        }
      }else if(tjSingle){
        text=decodePdfLiteralString(tjSingle[1]);
      }

      text=text
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,"")
        .replace(/\s+/g," ")
        .trim();

      if(text)items.push({x,y,text});
    }

    streamRegex.lastIndex=end+9;
  }

  if(!items.length){
    throw new Error("O leitor PDFium/Flate não encontrou blocos de texto.");
  }

  items.sort((a,b)=>b.y-a.y||a.x-b.x);

  const rows=[];
  for(const item of items){
    let row=rows.find(existing=>Math.abs(existing.y-item.y)<=1.2);
    if(!row){
      row={y:item.y,items:[]};
      rows.push(row);
    }
    row.items.push(item);
  }

  rows.sort((a,b)=>b.y-a.y);

  const text=rows
    .map(row=>
      row.items
        .sort((a,b)=>a.x-b.x)
        .map(item=>item.text)
        .join(" ")
        .replace(/\s+/g," ")
        .trim()
    )
    .filter(Boolean)
    .join("\n");

  const registrations=(text.match(/0\d{8}/g)||[]).length;
  const shiftCodes=(text.match(/\b0\d{3}\b/g)||[]).length;
  const dates=(text.match(/\d{2}\/\d{2}\/\d{4}/g)||[]).length;

  if(registrations<1 || (options.movementReport ? dates<1 : shiftCodes<1)){
    throw new Error(
      options.movementReport
        ? "O texto PDFium foi extraído, mas não possui estrutura de admitidos/demitidos da Senior."
        : "O texto PDFium foi extraído, mas não possui estrutura de escala da Senior."
    );
  }

  return text;
}

async function extractSeniorMovementPdfText(buffer){
  const attempts=[];

  // Os relatórios FPRE004.COL e FPRE005.COL gerados pelo PDFium guardam
  // coordenadas confiáveis. O pdf-parse pode ler esses mesmos arquivos por
  // ordem interna dos objetos e deslocar Nome/Causa/Cargo entre colaboradores.
  if(isLikelyPdfiumPdf(buffer)){
    try{
      const text=extractPdfiumFlateText(buffer,{movementReport:true});
      return {
        text,
        readerUsed:"pdfium-flate",
        attempts:[{reader:"pdfium-flate",success:true}]
      };
    }catch(error){
      attempts.push({
        reader:"pdfium-flate",
        success:false,
        error:error.message||String(error)
      });
    }
  }

  const fallback=await extractPdfText(buffer,{skipPdf2Json:true});
  return {
    ...fallback,
    attempts:[...attempts,...(fallback.attempts||[])]
  };
}


function isLikelyPdfiumPdf(buffer){
  const source=(Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer))
    .toString("latin1",0,Math.min(buffer.length||0,250000));

  return /PDFium/i.test(source)
    || /\/Producer\s*\(\s*PDFium/i.test(source)
    || /\/Creator\s*\(\s*PDFium/i.test(source);
}

function shouldSkipPdf2JsonForShift({buffer,pdfiumSucceeded=false,pdfParseError=""}={}){
  if(pdfiumSucceeded)return true;
  if(isLikelyPdfiumPdf(buffer))return true;
  return /Command token too long|Invalid XRef stream header|XRef/i.test(String(pdfParseError||""));
}


function evaluateSeniorShiftCandidate(text,configuredCodes=[]){
  const source=String(text||"").replace(/\u0000/g,"");
  const registrations=[...new Set(source.match(/0\d{8}/g)||[])];
  const detectedCodes=detectSeniorShiftCodes(source);
  const parseCodes=[...new Set([
    ...configuredCodes.map(normalizeSeniorShiftCode).filter(Boolean),
    ...detectedCodes.map(normalizeSeniorShiftCode).filter(Boolean)
  ])];

  let parsed=[];
  try{
    parsed=parseSeniorShiftRows(source,parseCodes);
  }catch{
    parsed=[];
  }

  const parsedRegistrations=new Set(
    parsed.map(row=>String(row.registration||"").trim()).filter(Boolean)
  );
  const completeRows=parsed.filter(row=>
    row.registration &&
    row.pdfName &&
    row.shiftCode &&
    row.schedule?.complete
  );

  const registrationCount=registrations.length;
  const parsedCount=parsedRegistrations.size;
  const completeCount=completeRows.length;
  const coverage=registrationCount
    ? Math.round((parsedCount/registrationCount)*100)
    : 0;
  const completeCoverage=registrationCount
    ? Math.round((completeCount/registrationCount)*100)
    : 0;

  return {
    registrationCount,
    parsedCount,
    completeCount,
    coverage,
    completeCoverage,
    detectedCodes
  };
}

async function extractSeniorShiftPdfText(buffer,configuredCodes=[]){
  const candidates=[];
  const attempts=[];
  const likelyPdfium=isLikelyPdfiumPdf(buffer);
  let pdfiumSucceeded=false;
  let pdfParseError="";

  const addCandidate=(reader,text)=>{
    const normalizedText=String(text||"");
    const score=seniorShiftTextScore(normalizedText,configuredCodes);
    const quality=evaluateSeniorShiftCandidate(normalizedText,configuredCodes);
    const candidate={reader,text:normalizedText,score,...quality};
    candidates.push(candidate);
    attempts.push({
      reader,
      success:true,
      score,
      registrations:quality.registrationCount,
      parsed:quality.parsedCount,
      complete:quality.completeCount,
      coverage:quality.coverage,
      completeCoverage:quality.completeCoverage
    });
    return candidate;
  };

  // 1) PDFium conhecido continua sendo testado primeiro, mas não vence
  // automaticamente. A decisão final depende da cobertura real.
  if(likelyPdfium){
    try{
      const text=extractPdfiumFlateText(buffer);
      const candidate=addCandidate("pdfium-flate",text);
      pdfiumSucceeded=candidate.score>0;
    }catch(error){
      attempts.push({reader:"pdfium-flate",success:false,error:error.message||String(error)});
    }
  }

  // 2) pdf-parse é sempre testado. Para FPRE011 ele pode reconstruir melhor
  // as três colunas (matrícula, nome e escala) do que o PDFium interno.
  try{
    const parsed=await pdfParse(buffer);
    const text=parsed?.text||"";
    if(text.trim()){
      addCandidate("pdf-parse",text);
    }else{
      attempts.push({reader:"pdf-parse",success:false,error:"Sem texto."});
    }
  }catch(error){
    pdfParseError=error.message||String(error);
    attempts.push({reader:"pdf-parse",success:false,error:pdfParseError});
  }

  // 3) Em arquivos que não foram identificados previamente como PDFium,
  // tenta também o leitor interno.
  if(!likelyPdfium){
    try{
      const text=extractPdfiumFlateText(buffer);
      const candidate=addCandidate("pdfium-flate",text);
      pdfiumSucceeded=candidate.score>0;
    }catch(error){
      attempts.push({reader:"pdfium-flate",success:false,error:error.message||String(error)});
    }
  }

  // 4) Só evita pdf2json quando o PDF é conhecido por causar erro de XRef
  // E já existe candidato com cobertura praticamente completa.
  const hasNearCompleteCandidate=candidates.some(item=>
    item.registrationCount>0 &&
    item.coverage>=98 &&
    item.completeCoverage>=95
  );
  const skipPdf2Json=
    hasNearCompleteCandidate ||
    (
      /Command token too long|Invalid XRef stream header|XRef/i.test(String(pdfParseError||"")) &&
      candidates.some(item=>item.coverage>=90)
    );

  if(skipPdf2Json){
    attempts.push({
      reader:"pdf2json",
      success:false,
      skipped:true,
      error:"Ignorado: já existe leitor com cobertura suficiente para este PDF."
    });
  }else{
    try{
      const text=await extractWithPdf2Json(buffer);
      if(String(text||"").trim())addCandidate("pdf2json",text);
      else attempts.push({reader:"pdf2json",success:false,error:"Sem texto."});
    }catch(error){
      attempts.push({reader:"pdf2json",success:false,error:error.message||String(error)});
    }
  }

  // 5) Reconstrução XRef quando nenhum candidato passou de 90% de cobertura.
  if(!candidates.some(item=>item.coverage>=90) && !likelyPdfium){
    try{
      const repaired=await extractFromRepairedPdf(buffer);
      if(String(repaired.text||"").trim())addCandidate(repaired.readerUsed,repaired.text);
      attempts.push(...(repaired.attempts||[]).filter(item=>!item.success));
    }catch(error){
      attempts.push(...(error.readerAttempts||[{
        reader:"reconstrução XRef",
        success:false,
        error:error.message||String(error)
      }]));
    }
  }

  // 6) Texto bruto apenas quando ainda não existe candidato útil.
  if(!candidates.some(item=>item.coverage>=50)){
    try{
      const text=extractRawPdfText(buffer);
      const registrations=(String(text||"").match(/0\d{8}/g)||[]).length;
      const hasUsefulStructure=
        registrations>=2 ||
        /Empregados por Escala/i.test(text) ||
        /\d{2}\/\d{2}\/\d{4}.*0\d{3}/.test(text);

      if(hasUsefulStructure){
        addCandidate("raw-pdf-text",text);
      }else{
        attempts.push({
          reader:"raw-pdf-text",
          success:false,
          error:"Texto bruto descartado por não possuir estrutura válida de escala da Senior."
        });
      }
    }catch(error){
      attempts.push({reader:"raw-pdf-text",success:false,error:error.message||String(error)});
    }
  }

  // O melhor leitor é escolhido nesta ordem:
  // 1. mais matrículas realmente montadas;
  // 2. mais linhas com horários completos;
  // 3. maior cobertura percentual;
  // 4. pontuação textual antiga apenas como desempate.
  candidates.sort((a,b)=>
    b.parsedCount-a.parsedCount ||
    b.completeCount-a.completeCount ||
    b.coverage-a.coverage ||
    b.completeCoverage-a.completeCoverage ||
    b.score-a.score
  );

  const best=candidates[0];

  if(!best || best.parsedCount<=0){
    const failure=new Error("Nenhum leitor conseguiu reconstruir uma escala válida da Senior.");
    failure.readerAttempts=attempts;
    throw failure;
  }

  return {
    text:best.text,
    readerUsed:best.reader,
    readerScore:best.score,
    readerCoverage:best.coverage,
    readerCompleteCoverage:best.completeCoverage,
    attempts,
    candidates:candidates.map(item=>({
      reader:item.reader,
      score:item.score,
      registrations:item.registrationCount,
      parsed:item.parsedCount,
      complete:item.completeCount,
      coverage:item.coverage,
      completeCoverage:item.completeCoverage
    })),
    optimizedPath:"COVERAGE_BASED_READER_SELECTION"
  };
}

function normalizeSeniorShiftCode(value){
  const raw=String(value||"").trim();
  if(!raw)return "";
  if(/^\d+$/.test(raw))return raw.replace(/^0+(?=\d)/,"");
  return raw.toUpperCase();
}

function defaultSeniorCodeForShiftName(name){
  const normalized=String(name||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/º/g,"")
    .replace(/\s+/g," ")
    .trim()
    .toUpperCase();

  if(/(^|\s)1(?:O)?\s*[-º]?\s*TURNO|PRIMEIRO TURNO/.test(normalized))return "46";
  if(/(^|\s)2(?:O)?\s*[-º]?\s*TURNO|SEGUNDO TURNO/.test(normalized))return "96";
  if(/(^|\s)3(?:O)?\s*[-º]?\s*TURNO|TERCEIRO TURNO/.test(normalized))return "56";
  return "";
}

function configuredSeniorCodeFromName(name){
  const raw=String(name||"").trim();
  const explicit=raw.match(/(?:ESCALA|TURNO|SENIOR)?\s*0*(\d{1,4})\b/i);
  if(explicit){
    const code=normalizeSeniorShiftCode(explicit[1]);
    if(!["1","2","3"].includes(code))return code;
  }
  return "";
}

function effectiveSeniorCode(shift){
  return normalizeSeniorShiftCode(shift?.senior_code)
    || configuredSeniorCodeFromName(shift?.name)
    || defaultSeniorCodeForShiftName(shift?.name);
}

function normalizeSeniorShiftName(value){
  return String(value||"")
    .replace(/\s+/g," ")
    .replace(/[,\-]+$/,"")
    .trim()
    .slice(0,180);
}

function suggestedWeeklyDaysOffForShift(name,code){
  const normalizedCode=normalizeSeniorShiftCode(code);
  const normalizedName=String(name||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/º/g,"")
    .replace(/\s+/g," ")
    .trim()
    .toUpperCase();

  // Regras oficiais de folga.
  // 0046 = 1º Turno => Domingo
  // 0096 = 2º Turno => Domingo
  // 0056 = 3º Turno => Sábado
  if(normalizedCode==="46")return [0];
  if(normalizedCode==="96")return [0];
  if(normalizedCode==="56")return [6];

  if(/(^|\s)1\s*(TURNO)?\b|PRIMEIRO TURNO/.test(normalizedName))return [0];
  if(/(^|\s)2\s*(TURNO)?\b|SEGUNDO TURNO/.test(normalizedName))return [0];
  if(/(^|\s)3\s*(TURNO)?\b|TERCEIRO TURNO/.test(normalizedName))return [6];

  return [];
}

function seniorDateToTime(value){
  const m=String(value||"").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m)return 0;
  return Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1]));
}


function detectSeniorShiftCodes(text){
  const source=String(text||"").replace(/\u0000/g,"");
  const found=new Set();

  // No FPRE011.COL, o título da coluna "Escala" vem imediatamente antes da
  // primeira matrícula. A busca genérica confundia o final dessa matrícula
  // com um código de turno. Aqui aceitamos somente o código de quatro dígitos
  // ligado a uma matrícula/nome e seguido por um horário válido.
  if(/Empregados por Escala/i.test(source)){
    const compact=source.replace(/\r/g," ").replace(/\n/g," ").replace(/\s+/g," ");
    const rowCode=/0\d{8}\s*[-–—:]?\s*[A-ZÀ-Ü][A-ZÀ-Ü\s.'-]{2,180}?\s+(0\d{3})\s*(?:[-–—:]\s*)?(?=\d{2}:\d{2})/gi;
    let rowMatch;
    while((rowMatch=rowCode.exec(compact))!==null){
      const code=normalizeSeniorShiftCode(rowMatch[1]);
      if(code)found.add(code);
    }
    if(found.size)return [...found];
  }

  const patterns=[
    /(?:Escala|escala)\s*[:\-]?\s*0*(\d{1,4})\b/g,
    /\d{2}\/\d{2}\/\d{4}\s+(?:\d{2}\/\d{2}\/\d{4}\s+)?0*(\d{1,4})\b/g
  ];

  for(const pattern of patterns){
    let match;
    while((match=pattern.exec(source))!==null){
      const code=normalizeSeniorShiftCode(match[1]);
      if(code)found.add(code);
    }
  }

  return [...found];
}

function formatSeniorShiftCode(value){
  const normalized=normalizeSeniorShiftCode(value);
  if(!normalized)return "";
  return /^\d+$/.test(normalized)?normalized.padStart(4,"0"):normalized;
}

function buildSeniorShiftDisplayName(code,schedule=null){
  const normalized=normalizeSeniorShiftCode(code);
  const calibrated=calibratedSeniorShiftName(normalized);
  // Nomes operacionais conhecidos permanecem curtos.
  if(calibrated&&!/^Escala\s/i.test(calibrated)&&!/\d{2}:\d{2}/.test(calibrated)){
    return calibrated;
  }
  const displayCode=formatSeniorShiftCode(normalized);
  return displayCode?`Turno ${displayCode}`:"Turno Senior";
}

function calibratedSeniorShiftName(code){
  return ({
    "7":"Comercial",
    "26":"Comercial",
    "46":"1º Turno",
    "56":"3º Turno",
    "64":"1º Turno Comercial",
    "96":"2º Turno",
    "106":"Turno 0106",
    "116":"Turno 0116"
  })[normalizeSeniorShiftCode(code)]||`Escala ${String(code||"").padStart(4,"0")}`;
}

function buildSeniorCodeVariants(validCodes=[]){
  const variants=[];
  for(const value of validCodes){
    const normalized=normalizeSeniorShiftCode(value);
    if(!normalized)continue;
    variants.push(normalized);
    if(/^\d+$/.test(normalized))variants.push(normalized.padStart(4,"0"));
  }
  return [...new Set(variants)].sort((a,b)=>b.length-a.length);
}

function extractSeniorSchedule(value,rawCode=""){
  const source=String(value||"").replace(/\s+/g," ");
  const normalizedCode=normalizeSeniorShiftCode(rawCode);
  let scheduleSource=source;

  if(normalizedCode&&/^\d+$/.test(normalizedCode)){
    const codePattern=new RegExp(`0*${normalizedCode}\\b`);
    const match=codePattern.exec(source);
    if(match)scheduleSource=source.slice(match.index+match[0].length);
  }

  // Algumas escalas comerciais da Senior compactam o fim do primeiro período
  // e usam PRE como separador: 08:0012PRE13:30PRE18:00.
  // Reconstrução calibrada: 08:00 12:00 13:30 18:00.
  scheduleSource=scheduleSource
    .replace(/(\d{2}:\d{2})(\d{2})(?=PRE)/gi,"$1 $2:00")
    .replace(/PRE(?=\d{2}:\d{2})/gi," ")
    .replace(/PRE/gi," ");

  const times=(scheduleSource.match(/\b(?:[01]\d|2[0-3]):[0-5]\d(?=$|[^0-9:])/g)||[]).slice(0,4);
  if(times.length<2)return null;

  const raw=times.join("-");
  const description=times.length>=4
    ? `${times[0]} às ${times[1]} / ${times[2]} às ${times[3]}`
    : `${times[0]} às ${times[1]}`;

  return {
    times,
    raw,
    description,
    complete:times.length===4
  };
}

function buildUnknownShiftProposals(rows=[],unknownCodes=[]){
  return unknownCodes.map(code=>{
    const schedules=new Map();

    for(const row of rows){
      if(normalizeSeniorShiftCode(row.shiftCode)!==normalizeSeniorShiftCode(code))continue;
      const schedule=row.schedule||extractSeniorSchedule(row.rawLine,row.rawShiftCode||row.shiftCode);
      if(!schedule?.complete)continue;
      const current=schedules.get(schedule.raw)||{...schedule,count:0};
      current.count++;
      schedules.set(schedule.raw,current);
    }

    const ranked=[...schedules.values()].sort((a,b)=>b.count-a.count);
    const best=ranked[0]||null;
    const conflicting=ranked.length>1&&ranked[1].count===best?.count;

    return {
      code:normalizeSeniorShiftCode(code),
      displayCode:formatSeniorShiftCode(code),
      suggestedName:buildSeniorShiftDisplayName(code,best),
      schedule:best?.raw||null,
      description:best?.description||null,
      occurrences:best?.count||0,
      canCreate:Boolean(best&&!conflicting),
      requiresReview:!best||conflicting,
      reason:!best
        ?"Horários completos não foram encontrados no PDF."
        : conflicting
          ?"O PDF apresenta horários diferentes com a mesma frequência para este código."
          :"Código e horários identificados. Confira antes de cadastrar."
    };
  });
}


function parseEmployeesByScaleColumnarBlocks(source){
  const output=[];
  const pages=String(source||"").split(/\f|\u000c/g);

  for(const page of pages){
    const pageLines=String(page||"")
      .replace(/\r/g,"\n")
      .split(/\n+/)
      .map(line=>line.replace(/[ \t]+/g," ").trim())
      .filter(Boolean);

    if(!pageLines.length)continue;

    const registrations=[];
    const registrationIndexes=[];
    for(let idx=0;idx<pageLines.length;idx++){
      if(/^0\d{8}$/.test(pageLines[idx])){
        registrations.push(pageLines[idx]);
        registrationIndexes.push(idx);
      }
    }
    if(!registrations.length)continue;

    const scaleStart=pageLines.findIndex(line=>/^Escala$/i.test(line));
    const footerStart=pageLines.findIndex(line=>/^FPRE011\.COL\b/i.test(line));
    const lastRegIndex=registrationIndexes[registrationIndexes.length-1];

    let nameEnd=pageLines.length;
    const positiveStops=[scaleStart,footerStart].filter(index=>index>lastRegIndex);
    if(positiveStops.length)nameEnd=Math.min(...positiveStops);

    const ignoredNameLine=line=>
      /^Pág\.?:?/i.test(line) ||
      /^Empregados por Escala$/i.test(line) ||
      /^Cadastro$/i.test(line) ||
      /^Nome$/i.test(line) ||
      /^Escala$/i.test(line) ||
      /^TRANSPORTES E ARMAZENAGEM/i.test(line) ||
      /^Usuário:/i.test(line) ||
      /^Total\s+Em/i.test(line) ||
      /^\d+$/.test(line) ||
      /^FPRE011\.COL\b/i.test(line);

    const names=pageLines
      .slice(lastRegIndex+1,nameEnd)
      .filter(line=>/^[A-ZÀ-Ü]/i.test(line))
      .filter(line=>!ignoredNameLine(line));

    const scales=(scaleStart>=0?pageLines.slice(scaleStart+1):pageLines)
      .map(line=>line.match(/^(0\d{3})\s*(?:[-–—:]\s*)?(.+)$/i))
      .filter(Boolean)
      .filter(match=>/\d{2}:\d{2}/.test(match[2]||""))
      .map(match=>({
        rawCode:match[1],
        schedule:String(match[2]||"").trim()
      }));

    const pairCount=Math.min(registrations.length,names.length,scales.length);
    if(!pairCount || pairCount/registrations.length<0.80)continue;

    for(let idx=0;idx<pairCount;idx++){
      output.push({
        registration:registrations[idx],
        pdfName:names[idx],
        rawCode:scales[idx].rawCode,
        schedule:scales[idx].schedule
      });
    }
  }

  return output;
}

function parseSeniorShiftRows(text,validCodes=[]){
  const normalizedCodes=[...new Set(validCodes.map(normalizeSeniorShiftCode).filter(Boolean))];
  if(!normalizedCodes.length)return [];

  const codeVariants=buildSeniorCodeVariants(validCodes);
  const source=String(text||"").replace(/\u0000/g,"");
  const rows=[];
  const byRegistration=new Map();

  const isEmployeesByScale=/Empregados por Escala/i.test(source);

  function pushCandidate(registration,pdfName,date,rawCode,rawLine){
    const shiftCode=normalizeSeniorShiftCode(rawCode);
    if(!isEmployeesByScale && !normalizedCodes.includes(shiftCode))return;

    const candidate={
      registration,
      pdfName:normalizeSeniorShiftName(pdfName),
      shiftCode,
      rawShiftCode:rawCode,
      effectiveDate:date,
      historyCount:1,
      rawLine:String(rawLine||"").slice(0,320),
      schedule:extractSeniorSchedule(rawLine,rawCode)
    };

    if(!candidate.pdfName)return;

    const previous=byRegistration.get(registration);
    if(!previous || seniorDateToTime(candidate.effectiveDate)>seniorDateToTime(previous.effectiveDate)){
      byRegistration.set(registration,candidate);
    }
  }

  /*
   * Estratégia FPRE011-COLUNAR: recompõe matrícula, nome e escala
   * quando o extrator entrega as três colunas em blocos separados.
   */
  if(isEmployeesByScale){
    for(const item of parseEmployeesByScaleColumnarBlocks(source)){
      pushCandidate(
        item.registration,
        item.pdfName,
        null,
        item.rawCode,
        `${item.registration} ${item.pdfName} ${item.rawCode} ${item.schedule}`
      );
    }
  }

  /*
   * Estratégia 0: FPRE011.COL — Empregados por Escala.
   * Este relatório não possui datas. O Senior pode extrair os campos como:
   * 000010139 ARLEN PINHO BORGES 0096 - 14:00...
   * 000010139-ARLEN PINHO BORGES 0096 14:00...
   * Por isso aceitamos separadores opcionais antes do nome e do horário.
   */
  if(isEmployeesByScale){
    const compactScale=source
      .replace(/\r/g," ")
      .replace(/\n/g," ")
      .replace(/\s+/g," ")
      .trim();

    const registrations=[...compactScale.matchAll(/0\d{8}/g)];

    for(let i=0;i<registrations.length;i++){
      const registration=registrations[i][0];
      const start=registrations[i].index+registration.length;
      const end=i+1<registrations.length?registrations[i+1].index:compactScale.length;

      let body=compactScale
        .slice(start,end)
        .replace(/^[\s\-–—:|]+/,"")
        .trim();

      /*
       * Captura o último bloco de 4 dígitos antes do horário como código da escala.
       * O nome pode conter espaços, hífen e apóstrofo.
       * Exemplos válidos:
       *   NOME COMPLETO 0096 - 14:00...
       *   NOME COMPLETO 0092 07:00...
       */
      const match=body.match(
        /^([A-ZÀ-Ü][A-ZÀ-Ü\s.'-]{2,180}?)\s+(0\d{3})\s*(?:[-–—:]\s*)?([0-9]{2}:[0-9]{2}.*)$/i
      );

      if(!match)continue;

      let pdfName=normalizeSeniorShiftName(match[1])
        .replace(/^Cadastro\s+Nome\s+Escala\s*/i,"")
        .replace(/.*FRACIONADO\s*/i,"")
        .replace(/.*SODEXO\s*/i,"")
        .replace(/^[\s\-–—:|]+/,"")
        .trim();

      const rawCode=match[2];
      const schedule=String(match[3]||"").trim();

      if(!pdfName || !/^[A-ZÀ-Ü]/i.test(pdfName))continue;

      pushCandidate(
        registration,
        pdfName,
        null,
        rawCode,
        `${registration} ${pdfName} ${rawCode} ${schedule}`
      );
    }
  }

  /*
   * Estratégia 1: texto com linhas preservadas.
   * Formato real do PDF 96:
   * 000007687 ADISSON PEREIRA DE ALCANTARA 01/08/2023 19/05/2025 0096 ...
   */
  const lines=source
    .replace(/\r/g,"\n")
    .split("\n")
    .map(line=>line.replace(/\s+/g," ").trim())
    .filter(Boolean);

  let currentRegistration=null;
  let currentName=null;

  for(const line of lines){
    const main=line.match(
      /^(0\d{8})\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(0*\d{1,4})\b/
    );

    if(main){
      currentRegistration=main[1];
      currentName=main[2];
      pushCandidate(main[1],main[2],main[4],main[5],line);
      continue;
    }

    // Linha histórica sem matrícula: 21/06/2025 0046 ...
    if(currentRegistration && currentName){
      const hist=line.match(/^(\d{2}\/\d{2}\/\d{4})\s+(0*\d{1,4})\b/);
      if(hist){
        pushCandidate(currentRegistration,currentName,hist[1],hist[2],line);
      }
    }
  }

  /*
   * Estratégia 2: fallback para texto concatenado pelo Render.
   * Exemplos observados:
   * ADRIAN...00000834802/01/202607/03/2024 0046
   * ou
   * 000007687ADISSON...01/08/202319/05/20250096
   */
  const compact=source
    .replace(/\r/g," ")
    .replace(/\n/g," ")
    .replace(/\s+/g," ")
    .trim();

  const regRegex=/0\d{8}/g;
  const regs=[];
  let rm;

  while((rm=regRegex.exec(compact))!==null){
    regs.push({registration:rm[0],index:rm.index,end:rm.index+rm[0].length});
  }

  for(let i=0;i<regs.length;i++){
    const current=regs[i];
    const prevEnd=i>0?regs[i-1].end:0;
    const nextIndex=i+1<regs.length?regs[i+1].index:compact.length;
    const before=compact.slice(prevEnd,current.index);
    const after=compact.slice(current.end,nextIndex);

    // Prefer name after matrícula (normal PDF extraction)
    let pdfName="";
    const firstDateAfter=after.match(/\d{2}\/\d{2}\/\d{4}/);
    if(firstDateAfter && firstDateAfter.index>0){
      const possible=after.slice(0,firstDateAfter.index)
        .replace(/^[^A-ZÀ-Ü]+/i,"")
        .trim();
      const nameMatch=possible.match(/([A-ZÀ-Ü][A-ZÀ-Ü\s.'-]{2,180})$/i);
      if(nameMatch)pdfName=normalizeSeniorShiftName(nameMatch[1]);
    }

    // Otherwise name before matrícula (xref-repair extraction)
    if(!pdfName){
      const nameMatch=before.match(/([A-ZÀ-Ü][A-ZÀ-Ü\s.'-]{2,180})$/i);
      if(nameMatch)pdfName=normalizeSeniorShiftName(nameMatch[1]);
    }

    if(!pdfName)continue;

    // Clean common residues
    pdfName=pdfName
      .replace(/.*TRANSPORTES E ARMAZENAGEM ZILLI LTDA/i,"")
      .replace(/.*Cadastro/i,"")
      .replace(/.*Per[ií]odo:/i,"")
      .replace(/.*Nova Turma/i,"")
      .replace(/.*sgAsb-[A-Z]\d*/i,"")
      .replace(/.*\d{2}:\d{2}(?:-\d{2}:\d{2})+/i,"")
      .trim();

    if(!pdfName)continue;

    const localBlock=after.slice(0,420);

    // Find all date + code pairs, allowing an extra date in between.
    const dateRegex=/\d{2}\/\d{2}\/\d{4}/g;
    let dm;
    while((dm=dateRegex.exec(localBlock))!==null){
      const firstDate=dm[0];
      let tail=localBlock.slice(dm.index+firstDate.length,dm.index+firstDate.length+40).replace(/^\s+/,"");

      let effectiveDate=firstDate;
      let variant=codeVariants.find(v=>tail.startsWith(v));

      if(!variant){
        const second=tail.match(/^(\d{2}\/\d{2}\/\d{4})\s*/);
        if(second){
          effectiveDate=second[1];
          tail=tail.slice(second[0].length);
          variant=codeVariants.find(v=>tail.startsWith(v));
        }
      }

      if(variant){
        pushCandidate(current.registration,pdfName,effectiveDate,variant,localBlock);
      }
    }
  }

  return [...byRegistration.values()];
}

function buildShiftParsingDiagnostics(text,rows=[]){
  const registrations=[...new Set(
    (String(text||"").match(/0\d{8}/g)||[]).map(value=>String(value).trim())
  )];
  const parsedRegistrations=new Set(
    rows.map(row=>String(row.registration||"").trim()).filter(Boolean)
  );
  const unresolvedRegistrations=registrations.filter(registration=>
    !parsedRegistrations.has(registration)
  );

  return {
    uniqueRegistrationCount:registrations.length,
    parsedCount:parsedRegistrations.size,
    unresolvedCount:unresolvedRegistrations.length,
    unresolvedRegistrations,
    complete:registrations.length>0&&unresolvedRegistrations.length===0
  };
}


router.post("/shift-preview",upload.single("file"),async(req,res,next)=>{
  try{
    if(!req.file)return res.status(400).json({error:"Selecione um arquivo PDF."});

    const companyId=String(req.body.companyId||"").trim();
    const branchId=String(req.body.branchId||"").trim();

    if(!companyId||!branchId){
      return res.status(400).json({error:"Selecione a empresa e a filial."});
    }

    assertScope(req,companyId,branchId);

    const companyShifts=await pool.query(`
      SELECT id,name,senior_code,active
      FROM shifts
      WHERE company_id=$1
        AND active=TRUE
      ORDER BY name
    `,[companyId]);

    const shiftsWithCode=companyShifts.rows
      .map(shift=>({...shift,effective_senior_code:effectiveSeniorCode(shift)}))
      .filter(shift=>shift.effective_senior_code);

    const configuredCodesForReader=shiftsWithCode.map(shift=>shift.effective_senior_code);
    const extracted=await extractSeniorShiftPdfText(req.file.buffer,configuredCodesForReader);

    const branchCheck=await validatePdfOperationalBranch({
      text:extracted.text,
      fileName:req.file.originalname,
      companyId,
      branchId
    });
    if(!branchCheck.ok){
      return res.status(branchCheck.status||409).json(branchCheck);
    }

    const configuredCodeSet=new Set(
      shiftsWithCode.map(shift=>shift.effective_senior_code)
    );

    const detectedCodes=detectSeniorShiftCodes(extracted.text);
    const unknownCodes=detectedCodes
      .filter(code=>!configuredCodeSet.has(code))
      .slice(0,30);

    const parseCodes=[...new Set([
      ...shiftsWithCode.map(shift=>shift.effective_senior_code),
      ...detectedCodes
    ])];

    const parsed=parseSeniorShiftRows(
      extracted.text,
      parseCodes
    );
    const parsingDiagnostics=buildShiftParsingDiagnostics(extracted.text,parsed);
    const newShiftProposals=buildUnknownShiftProposals(parsed,unknownCodes);

    // Segurança extra para ESCALAS:
    // se o cabeçalho/filename não identificar a operação, usamos as matrículas
    // do próprio PDF para verificar em qual filial elas estão cadastradas.
    // Isso evita que uma escala de FRACIONADO/SODEXO/TRANZILOG seja aplicada
    // na filial errada mesmo quando o texto do cabeçalho vier incompleto.
    let inferredBranch=null;
    let inferredBranchConfidence=0;

    if(parsed.length){
      const registrations=[...new Set(parsed.map(row=>String(row.registration||"").trim()).filter(Boolean))];

      if(registrations.length){
        const branchHits=await pool.query(`
          SELECT
            b.id branch_id,
            b.name branch_name,
            COUNT(*)::int hit_count
          FROM employees e
          JOIN branches b ON b.id=e.branch_id
          WHERE e.company_id=$1
            AND e.registration = ANY($2::text[])
          GROUP BY b.id,b.name
          ORDER BY hit_count DESC,b.name
        `,[companyId,registrations]);

        const totalHits=branchHits.rows.reduce((sum,row)=>sum+Number(row.hit_count||0),0);
        const top=branchHits.rows[0]||null;

        if(top&&totalHits){
          inferredBranch={
            id:String(top.branch_id),
            name:top.branch_name,
            hits:Number(top.hit_count||0),
            totalHits,
            distribution:branchHits.rows.map(row=>({
              id:String(row.branch_id),
              name:row.branch_name,
              hits:Number(row.hit_count||0)
            }))
          };
          inferredBranchConfidence=inferredBranch.hits/totalHits;

          // Bloqueia quando a maioria clara das matrículas pertence a outra filial.
          if(
            String(inferredBranch.id)!==String(branchId) &&
            inferredBranch.hits>=2 &&
            inferredBranchConfidence>=0.60
          ){
            return res.status(409).json({
              code:"BRANCH_MISMATCH",
              error:"Filial divergente na escala.",
              detail:`A escala possui ${inferredBranch.hits} matrícula(s) vinculada(s) principalmente à filial ${inferredBranch.name}, mas foi selecionada ${branchCheck.selectedBranchName}. A atualização foi bloqueada.`,
              detectedOperationalBranch:branchCheck.detectedOperationalBranch||canonicalOperationalBranch(inferredBranch.name),
              inferredBranch,
              selectedBranchName:branchCheck.selectedBranchName
            });
          }
        }
      }
    }

    const shiftsByCode=new Map(
      shiftsWithCode.map(shift=>[shift.effective_senior_code,shift])
    );

    const rows=[];
    for(const row of parsed){
      const shift=shiftsByCode.get(normalizeSeniorShiftCode(row.shiftCode));
      const employee=await pool.query(`
        SELECT e.id,e.full_name,e.registration,e.shift_id,s.name current_shift
        FROM employees e
        LEFT JOIN shifts s ON s.id=e.shift_id
        WHERE e.registration=$1
          AND e.company_id=$2
          AND e.branch_id=$3
        LIMIT 1
      `,[row.registration,companyId,branchId]);

      const found=employee.rows[0]||null;

      let registrationElsewhere=null;
      if(!found){
        const elsewhere=await pool.query(`
          SELECT e.id,e.full_name,e.registration,e.branch_id,e.status,
                 s.name current_shift,b.name branch_name
          FROM employees e
          LEFT JOIN shifts s ON s.id=e.shift_id
          LEFT JOIN branches b ON b.id=e.branch_id
          WHERE e.registration=$1
            AND e.company_id=$2
          LIMIT 1
        `,[row.registration,companyId]);
        if(elsewhere.rows[0]){
          registrationElsewhere={
            fullName:elsewhere.rows[0].full_name,
            registration:elsewhere.rows[0].registration,
            currentShift:elsewhere.rows[0].current_shift||null,
            branchName:elsewhere.rows[0].branch_name||null,
            status:elsewhere.rows[0].status||null
          };
        }
      }

      // V1.0.5: quando a matrícula do PDF não existe, procuramos apenas
      // um possível cadastro pelo nome na mesma empresa/filial.
      // Esse resultado é SOMENTE diagnóstico e nunca vira employeeId.
      let possibleMatch=null;
      if(!found&&row.pdfName){
        const candidates=await pool.query(`
          SELECT e.id,e.full_name,e.registration,e.shift_id,e.branch_id,
                 e.status,s.name current_shift,b.name branch_name
          FROM employees e
          LEFT JOIN shifts s ON s.id=e.shift_id
          LEFT JOIN branches b ON b.id=e.branch_id
          WHERE e.company_id=$1
          ORDER BY e.full_name
        `,[companyId]);

        const normalizeCandidateName=value=>String(value||"")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g,"")
          .replace(/[^A-Z0-9 ]/gi," ")
          .replace(/\s+/g," ")
          .trim()
          .toUpperCase();

        const wanted=normalizeCandidateName(row.pdfName);
        const matches=candidates.rows.filter(item=>{
          const candidate=normalizeCandidateName(item.full_name);
          return candidate===wanted ||
            candidate.startsWith(wanted) ||
            wanted.startsWith(candidate);
        });

        if(matches.length===1){
          possibleMatch={
            id:matches[0].id,
            fullName:matches[0].full_name,
            registration:matches[0].registration,
            currentShift:matches[0].current_shift||null,
            branchName:matches[0].branch_name||null,
            status:matches[0].status||null,
            sameBranch:String(matches[0].branch_id||"")===String(branchId||"")
          };
        }
      }

      const registeredName=found?.full_name||null;
      const normalizeName=value=>String(value||"")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g,"")
        .replace(/[^A-Z0-9 ]/gi," ")
        .replace(/\s+/g," ")
        .trim()
        .toUpperCase();

      const pdfNameNormalized=normalizeName(row.pdfName);
      const registeredNameNormalized=normalizeName(registeredName);
      const nameMatches=Boolean(
        pdfNameNormalized &&
        registeredNameNormalized &&
        (
          pdfNameNormalized===registeredNameNormalized ||
          registeredNameNormalized.startsWith(pdfNameNormalized) ||
          pdfNameNormalized.startsWith(registeredNameNormalized)
        )
      );

      rows.push({
        ...row,
        employeeId:found?.id||null,
        fullName:registeredName,
        nameMatches:found?nameMatches:null,
        currentShift:found?.current_shift||null,
        currentShiftId:found?.shift_id||null,
        possibleMatch,
        registrationElsewhere,
        targetShiftId:shift?.id||null,
        targetShiftName:shift?.name||null,
        result:!shift
          ?"CODIGO_NAO_CONFIGURADO"
          : !found
            ?"NAO_LOCALIZADO"
            : String(found.shift_id||"")===String(shift.id||"")
              ?"JA_CONFIGURADO"
              :"ATUALIZAR"
      });
    }

    const intelligence=buildShiftIntelligence({
      rows,
      unknownCodes,
      parsingDiagnostics,
      detectedOperationalBranch:branchCheck.detectedOperationalBranch,
      inferredBranch,
      readerUsed:extracted.readerUsed,
      readerScore:extracted.readerScore
    });

    const readerCandidates=Array.isArray(extracted.candidates)?extracted.candidates:[];
    if(readerCandidates.length){
      const chosen=readerCandidates.find(item=>item.reader===extracted.readerUsed)||readerCandidates[0];
      intelligence.signals.push(
        `Leitor escolhido por cobertura: ${extracted.readerUsed} — ${chosen?.parsed||0}/${chosen?.registrations||0} matrícula(s) montada(s) (${chosen?.coverage||0}%)`
      );
      for(const candidate of readerCandidates){
        if(candidate.reader===extracted.readerUsed)continue;
        intelligence.signals.push(
          `${candidate.reader}: ${candidate.parsed||0}/${candidate.registrations||0} matrícula(s) montada(s) (${candidate.coverage||0}%)`
        );
      }
    }

    res.json({
      fileName:req.file.originalname,
      readerUsed:extracted.readerUsed,
      companyId,
      branchId,
      detectedOperationalBranch:branchCheck.detectedOperationalBranch,
      selectedBranchName:branchCheck.selectedBranchName,
      inferredBranch,
      inferredBranchConfidence,
      intelligence,
      configuredCodes:shiftsWithCode.map(shift=>({
        code:shift.effective_senior_code,
        configuredCode:shift.senior_code||null,
        shiftId:shift.id,
        shiftName:shift.name,
        source:shift.senior_code?"CODIGO_SENIOR":"NOME_DO_TURNO"
      })),
      detectedCodes,
      unknownCodes,
      newShiftProposals,
      total:rows.length,
      ready:rows.filter(row=>row.result==="ATUALIZAR").length,
      alreadyConfigured:rows.filter(row=>row.result==="JA_CONFIGURADO").length,
      notFound:rows.filter(row=>row.result==="NAO_LOCALIZADO").length,
      unconfigured:rows.filter(row=>row.result==="CODIGO_NAO_CONFIGURADO").length,
      diagnostics:{
        extractedCharacters:String(extracted.text||"").length,
        registrationCandidates:(String(extracted.text||"").match(/0\d{8}/g)||[]).length,
        uniqueRegistrationCount:parsingDiagnostics.uniqueRegistrationCount,
        unresolvedCount:parsingDiagnostics.unresolvedCount,
        unresolvedRegistrations:parsingDiagnostics.unresolvedRegistrations,
        parsingComplete:parsingDiagnostics.complete,
        configuredCodes:shiftsWithCode.map(shift=>shift.effective_senior_code),
        readerUsed:extracted.readerUsed,
        readerScore:extracted.readerScore??null,
        readerCandidates:extracted.candidates||[],
        optimizedPath:extracted.optimizedPath||null,
        configuredShiftCatalog:shiftsWithCode.map(shift=>({
          code:shift.effective_senior_code,
          name:shift.name
        })),
        reportFormat:/Empregados por Escala/i.test(String(extracted.text||""))?"FPRE011_EMPREGADOS_POR_ESCALA":"ESCALA_HISTORICA",
        detectedCodes,
        parsedRows:parsed.length,
        sample:String(extracted.text||"").replace(/\s+/g," ").slice(0,500)
      },
      rows
    });
  }catch(error){
    console.error("[SHIFT_PREVIEW]",{
      message:error?.message,
      stack:error?.stack,
      code:error?.code
    });

    res.status(500).json({
      error:"Não foi possível analisar o PDF de turnos.",
      detail:error?.message||String(error)
    });
  }
});

router.post("/shift-confirm",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const {
      companyId,branchId,fileName,rows=[],
      readerUsed=null,
      optimizedPath=null,
      intelligence=null,
      detectedOperationalBranch=null,
      parsingDiagnostics=null,
      newShifts=[]
    }=req.body||{};

    if(!companyId||!branchId){
      return res.status(400).json({error:"Selecione a empresa e a filial."});
    }

    if(!Array.isArray(rows)||!rows.length){
      return res.status(400).json({error:"Nenhum registro de turno para atualizar."});
    }


    if(Number(parsingDiagnostics?.unresolvedCount||0)>0){
      return res.status(409).json({
        error:"A atualização foi bloqueada porque existem matrículas não reconhecidas no PDF de turnos.",
        detail:`Leia novamente o arquivo e confira: ${parsingDiagnostics.unresolvedCount} matrícula(s) não foram montadas.`
      });
    }

    assertScope(req,companyId,branchId);

    if(Array.isArray(newShifts)&&newShifts.length&&!req.scope.isAdmin){
      return res.status(403).json({
        error:"Somente o Administrador pode confirmar o cadastro automático de novos turnos."
      });
    }

    await client.query("BEGIN");

    let updated=0,alreadyConfigured=0,notFound=0,failed=0,createdShifts=0;
    const results=[];

    for(const proposal of Array.isArray(newShifts)?newShifts:[]){
      if(proposal?.selected===false)continue;

      const code=normalizeSeniorShiftCode(proposal?.code);
      const name=String(proposal?.name||"").trim().slice(0,100);
      const description=String(proposal?.description||"").trim().slice(0,180);
      const schedule=extractSeniorSchedule(description);

      if(!code||!name||!description||!schedule?.complete){
        const error=new Error(`A proposta do turno ${code||"sem código"} não possui nome e quatro horários válidos.`);
        error.status=400;
        throw error;
      }

      const existing=await client.query(`
        SELECT id,name
        FROM shifts
        WHERE company_id=$1
          AND (CASE WHEN BTRIM(senior_code) ~ '^[0-9]+$' THEN (BTRIM(senior_code)::numeric)::text ELSE UPPER(BTRIM(senior_code)) END)=$2
        LIMIT 1
      `,[companyId,code]);

      if(existing.rows[0])continue;

      const created=await client.query(`
        INSERT INTO shifts(company_id,name,description,senior_code,weekly_days_off,active)
        VALUES($1,$2,$3,$4,$5,TRUE)
        RETURNING id,name
      `,[companyId,name,description,code,suggestedWeeklyDaysOffForShift(name,code)]);

      createdShifts++;
      results.push({result:"TURNO_CADASTRADO",shiftCode:code,shiftName:created.rows[0].name});
    }

    for(const row of rows){
      if(row.selected===false)continue;

      if(row.result==="NAO_LOCALIZADO"||!row.employeeId){
        notFound++;
        results.push({registration:row.registration,result:"NAO_LOCALIZADO"});
        continue;
      }

      if(row.result==="JA_CONFIGURADO"){
        alreadyConfigured++;
        results.push({registration:row.registration,result:"JA_CONFIGURADO"});
        continue;
      }

      const shift=await client.query(`
        SELECT id,name,weekly_days_off
        FROM shifts
        WHERE company_id=$1
          AND (CASE WHEN BTRIM(senior_code) ~ '^[0-9]+$' THEN (BTRIM(senior_code)::numeric)::text ELSE UPPER(BTRIM(senior_code)) END)=$2
          AND active=TRUE
        LIMIT 1
      `,[companyId,normalizeSeniorShiftCode(row.shiftCode)]);

      if(!shift.rows[0]){
        failed++;
        results.push({registration:row.registration,result:"CODIGO_NAO_CONFIGURADO"});
        continue;
      }

      const changed=await client.query(`
        UPDATE employees
        SET shift_id=$1,
            weekly_days_off=CASE
              WHEN use_shift_days_off=TRUE THEN COALESCE($5::SMALLINT[],ARRAY[]::SMALLINT[])
              ELSE weekly_days_off
            END,
            updated_at=NOW()
        WHERE id=$2
          AND company_id=$3
          AND branch_id=$4
        RETURNING id
      `,[shift.rows[0].id,row.employeeId,companyId,branchId,shift.rows[0].weekly_days_off||[]]);

      if(!changed.rows[0]){
        notFound++;
        results.push({registration:row.registration,result:"NAO_LOCALIZADO"});
        continue;
      }

      updated++;
      results.push({
        registration:row.registration,
        result:"ATUALIZADO",
        shiftCode:row.shiftCode,
        shiftName:shift.rows[0].name
      });
    }

    await client.query(`
      INSERT INTO employee_imports(
        user_id,company_id,branch_id,import_type,file_name,
        total_found,total_created,total_updated,total_not_found,details
      )
      VALUES($1,$2,$3,'TURNOS',$4,$5,0,$6,$7,$8)
    `,[
      req.user.sub,companyId,branchId,fileName||"turnos.pdf",
      rows.length,updated,notFound,
      JSON.stringify({
        results,
        alreadyConfigured,
        failed,
        createdShifts,
        readerUsed,
        optimizedPath,
        intelligence,
        detectedOperationalBranch
      })
    ]);

    await client.query("COMMIT");

    await audit(req,"IMPORT_SHIFTS","employees",null,{
      fileName,total:rows.length,updated,alreadyConfigured,notFound,failed,createdShifts
    });

    res.json({
      message:`Novos turnos cadastrados: ${createdShifts}. Cadastros atualizados com turno: ${updated}. Já estavam no turno correto: ${alreadyConfigured}. Colaboradores não localizados: ${notFound}. Nenhum colaborador novo foi criado.`,
      createdShifts,updated,alreadyConfigured,notFound,failed,results
    });
  }catch(error){
    await client.query("ROLLBACK").catch(()=>{});
    next(error);
  }finally{
    client.release();
  }
});


router.post("/confirm",async(req,res,next)=>{
  const client=await pool.connect();
  let transactionCommitted=false;

  try{
    const {
      type,fileName,companyId,branchId,
      detectedCompany,detectedBranch,detectedOperationalBranch,
      previewCompanyId,previewBranchId,
      readerUsed=null,
      intelligence=null,
      rows=[]
    }=req.body;
    if(!["ADMITIDOS","DEMITIDOS","COLABORADORES"].includes(type)){
      return res.status(400).json({error:"Tipo de importação inválido."});
    }
    if(!companyId||!branchId){
      return res.status(400).json({error:"Selecione a empresa e a filial."});
    }
    if(!Array.isArray(rows)||!rows.length){
      return res.status(400).json({error:"Nenhum registro para importar."});
    }
    assertScope(req,companyId,branchId);

    if(String(previewCompanyId||"")!==String(companyId)||String(previewBranchId||"")!==String(branchId)){
      return res.status(409).json({
        error:"Empresa ou filial alterada após a conferência.",
        detail:"Leia o PDF novamente antes de confirmar a importação."
      });
    }

    if(detectedOperationalBranch){
      const selected=await getSelectedBranch(branchId,companyId);
      const selectedCanonical=canonicalOperationalBranch(selected?.name);
      if(!selected||selectedCanonical!==canonicalOperationalBranch(detectedOperationalBranch)){
        return res.status(409).json({
          code:"BRANCH_MISMATCH",
          error:"Filial divergente.",
          detail:`O PDF foi conferido como ${detectedOperationalBranch}, mas a filial atual é ${selected?.name||"não identificada"}. Leia o PDF novamente na filial correta.`
        });
      }
    }

    // A confirmação recebe a prévia já montada, mas normalizamos novamente
    // antes de gravar para impedir que ruídos do PDF cheguem ao banco.
    const sanitizedRows=rows
      .filter(item=>item&&item.selected!==false)
      .map(normalizeImportItem)
      .filter(item=>isPlausibleRegistration(item.registration))
      .filter(item=>type==="DEMITIDOS"||isPlausibleEmployeeName(item.fullName))
      .filter(item=>type==="DEMITIDOS"||isPlausibleRole(item.jobTitle))
      .filter(item=>type!=="ADMITIDOS"||isValidAdmittedRow(item));

    if(!sanitizedRows.length){
      return res.status(400).json({
        error:"Nenhum registro válido foi selecionado para importar."
      });
    }

    await client.query("BEGIN");
    let created=0,updated=0,unchanged=0,demitted=0,notFound=0,failed=0,blockedByRole=0,readmissions=0;
    const results=[];
    const errors=[];

    for(let rowIndex=0;rowIndex<sanitizedRows.length;rowIndex++){
      const item=sanitizedRows[rowIndex];
      const registration=item.registration;

      const savepoint=`import_row_${rowIndex}`;
      await client.query(`SAVEPOINT ${savepoint}`);

      try{
      const current=await client.query(
        `SELECT e.*,c.trade_name company_name,b.name branch_name,
                COALESCE(jr.name,e.job_title,'') effective_job_title
         FROM employees e
         LEFT JOIN companies c ON c.id=e.company_id
         LEFT JOIN branches b ON b.id=e.branch_id
         LEFT JOIN job_roles jr ON jr.id=e.job_role_id
         WHERE e.registration=$1
         ORDER BY e.created_at
         LIMIT 1`,
        [registration]
      );

      const existing=current.rows[0]||null;
      const sameUnit=Boolean(existing) &&
        String(existing.company_id)===String(companyId) &&
        String(existing.branch_id)===String(branchId);

      if(existing&&!sameUnit){
        notFound++;
        results.push({
          registration,
          result:"OUTRA_UNIDADE",
          id:existing.id,
          fullName:existing.full_name,
          companyName:existing.company_name||null,
          branchName:existing.branch_name||null
        });
        errors.push({
          registration,
          name:item.fullName||existing.full_name||null,
          code:"DUPLICATE_OTHER_UNIT",
          message:`Matrícula já cadastrada em ${existing.company_name||"outra empresa"} / ${existing.branch_name||"outra filial"}.`
        });
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        continue;
      }

      if(type==="ADMITIDOS"||type==="COLABORADORES"){
        let roleId=null;
        const roleName=String(item.jobTitle||"").trim();
        if(roleName){
          const existingRole=await client.query(
            `SELECT id
             FROM job_roles
             WHERE company_id=$1 AND LOWER(TRIM(name))=LOWER(TRIM($2))
             LIMIT 1`,
            [companyId,roleName]
          );

          if(existingRole.rows[0]){
            roleId=existingRole.rows[0].id;
            await client.query(
              `UPDATE job_roles SET active=TRUE WHERE id=$1`,
              [roleId]
            );
          }else{
            const role=await client.query(
              `INSERT INTO job_roles(company_id,name,active)
               VALUES($1,$2,TRUE)
               RETURNING id`,
              [companyId,roleName]
            );
            roleId=role.rows[0].id;
          }
        }

        if(current.rows[0]){
          const corrections=detectEmployeeCorrections(current.rows[0],item);
          await client.query(`
            UPDATE employees
            SET company_id=$1,
                branch_id=$2,
                full_name=$3,
                admission_date=$4,
                job_role_id=$5,
                job_title=$6,
                point_card=COALESCE($7,point_card),
                status='ATIVO',
                termination_date=NULL,
                source=$9,
                last_imported_at=NOW(),
                updated_at=NOW()
            WHERE id=$8
          `,[
            companyId,branchId,item.fullName,item.admissionDate,roleId,roleName,
            item.pointCard||null,
            current.rows[0].id,
            type==="COLABORADORES"?"SENIOR_PDF_COLABORADORES":"SENIOR_PDF_ADMITIDOS"
          ]);
          if(corrections.length){
            updated++;
            results.push({
              registration,
              result:"ATUALIZADO",
              id:current.rows[0].id,
              corrections
            });
          }else{
            unchanged++;
            results.push({
              registration,
              result:"CONFERIDO",
              id:current.rows[0].id,
              corrections:[]
            });
          }
        }else{
          const priorSameName=await client.query(`
            SELECT id,registration,full_name,status,admission_date,termination_date
            FROM employees
            WHERE LOWER(REGEXP_REPLACE(TRIM(full_name),'\\s+',' ','g'))
                  = LOWER(REGEXP_REPLACE(TRIM($1),'\\s+',' ','g'))
              AND COALESCE(registration,'')<>$2
            ORDER BY
              CASE WHEN status='DEMITIDO' THEN 0 ELSE 1 END,
              created_at DESC
            LIMIT 1
          `,[item.fullName,registration]);

          const previous=priorSameName.rows[0]||null;

          const inserted=await client.query(`
            INSERT INTO employees(
              company_id,branch_id,full_name,registration,admission_date,
              job_role_id,job_title,point_card,status,weekly_days_off,
              source,last_imported_at
            )
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ATIVO',ARRAY[0]::SMALLINT[],$9,NOW())
            RETURNING id
          `,[
            companyId,branchId,item.fullName,registration,item.admissionDate,
            roleId,roleName,item.pointCard||null,
            type==="COLABORADORES"?"SENIOR_PDF_COLABORADORES":"SENIOR_PDF_ADMITIDOS"
          ]);

          created++;

          if(previous){
            readmissions++;
            results.push({
              registration,
              result:"CADASTRADO_POSSIVEL_READMISSAO",
              id:inserted.rows[0].id,
              previousEmployeeId:previous.id,
              previousRegistration:previous.registration||null,
              previousStatus:previous.status||null,
              previousTerminationDate:previous.termination_date||null
            });
          }else{
            results.push({registration,result:"CADASTRADO",id:inserted.rows[0].id});
          }
        }
      }else{
        if(!current.rows[0]){
          notFound++;
          results.push({registration,result:"NAO_LOCALIZADO"});
          continue;
        }
        await client.query(`
          UPDATE employees
          SET status='DEMITIDO',
              termination_date=$1,
              source='SENIOR_PDF_DEMITIDOS',
              last_imported_at=NOW(),
              updated_at=NOW()
          WHERE id=$2
        `,[item.terminationDate,current.rows[0].id]);
        updated++;
        demitted++;
        results.push({
          registration,
          result:"DEMITIDO",
          id:current.rows[0].id,
          terminationDate:item.terminationDate||null
        });
      }

      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      }catch(rowError){
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);

        failed++;
        errors.push({
          registration,
          name:item.fullName||null,
          code:rowError.code||null,
          message:rowError.message||"Falha ao processar registro."
        });
        results.push({registration,result:"ERRO"});
        console.error("[IMPORT_PDF_ROW]",{
          registration,
          name:item.fullName,
          code:rowError.code,
          message:rowError.message
        });
      }
    }

    const importRow=await client.query(`
      INSERT INTO employee_imports(
        user_id,company_id,branch_id,import_type,file_name,
        detected_company,detected_branch,total_found,total_created,
        total_updated,total_not_found,details
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id,created_at
    `,[
      req.user.sub,companyId,branchId,type,fileName||"arquivo.pdf",
      detectedCompany||null,detectedBranch||null,sanitizedRows.length,
      created,updated,notFound,JSON.stringify({
        results,
        errors,
        failed,
        blockedByRole,
        unchanged,
        readmissions,
        submittedRows:rows.length,
        sanitizedRows:sanitizedRows.length,
        readerUsed,
        intelligence,
        detectedOperationalBranch
      })
    ]);

    await client.query("COMMIT");
    transactionCommitted=true;

    await audit(req,"IMPORT_PDF","employees",null,{
      type,
      fileName,
      total:sanitizedRows.length,
      created,
      updated,
      demitted,
      notFound,
      failed,
      blockedByRole,
      unchanged,
      readmissions,
      action:type==="DEMITIDOS"
        ?"INATIVAR_COMO_DEMITIDO"
        : (type==="ADMITIDOS"?"CADASTRAR_OU_REATIVAR":"ATUALIZAR")
    });

    res.json({
      success:true,
      importId:importRow.rows[0].id,
      importedAt:importRow.rows[0].created_at,
      processed:sanitizedRows.length,
      created,
      updated,
      demitted,
      notFound,
      failed,
      blockedByRole,
      unchanged,
      readmissions,
      errors,
      results
    });
  }catch(e){
    if(!transactionCommitted){
      try{await client.query("ROLLBACK");}catch{}
    }
    console.error("[IMPORT_PDF_CONFIRM]",{
      message:e.message,
      code:e.code,
      detail:e.detail,
      constraint:e.constraint
    });
    return res.status(400).json({
      error:"Não foi possível concluir a importação no banco de dados.",
      detail:e.detail||e.message||"Erro sem detalhe retornado pelo PostgreSQL.",
      code:e.code||null,
      step:"CONFIRMAR_IMPORTACAO"
    });
  }finally{
    client.release();
  }
});


router.get("/intelligence-models",async(req,res,next)=>{
  try{
    const companyParams=[];
    let companyWhere="WHERE c.active=TRUE";
    let branchWhere="WHERE b.active=TRUE";
    let shiftWhere="WHERE s.active=TRUE";
    let importWhere="WHERE 1=1";

    if(!req.scope.isAdmin){
      companyParams.push(req.scope.companyId,req.scope.branchIds);
      companyWhere+=" AND c.id=$1";
      branchWhere+=" AND b.company_id=$1 AND b.id=ANY($2::uuid[])";
      shiftWhere+=" AND s.company_id=$1";
      importWhere+=" AND i.company_id=$1 AND i.branch_id=ANY($2::uuid[])";
    }

    const [companiesResult,branchesResult,shiftsResult,importsResult]=await Promise.all([
      pool.query(`
        SELECT c.id,c.trade_name,c.legal_name,c.active
        FROM companies c
        ${companyWhere}
        ORDER BY c.trade_name
      `,companyParams),

      pool.query(`
        SELECT b.id,b.company_id,b.name,b.internal_code,b.active,
               c.trade_name company_name
        FROM branches b
        LEFT JOIN companies c ON c.id=b.company_id
        ${branchWhere}
        ORDER BY c.trade_name,b.name
      `,companyParams),

      pool.query(`
        SELECT s.id,s.company_id,s.name,s.description,s.senior_code,s.active,
               c.trade_name company_name
        FROM shifts s
        LEFT JOIN companies c ON c.id=s.company_id
        ${shiftWhere}
        ORDER BY c.trade_name,s.name
      `,companyParams),

      pool.query(`
        SELECT i.id,i.import_type,i.file_name,i.created_at,i.details,
               c.trade_name company_name,b.name branch_name
        FROM employee_imports i
        LEFT JOIN companies c ON c.id=i.company_id
        LEFT JOIN branches b ON b.id=i.branch_id
        ${importWhere}
        ORDER BY i.created_at DESC
        LIMIT 100
      `,companyParams)
    ]);

    const importsHistory=importsResult.rows.map(row=>{
      const details=row.details&&typeof row.details==="object"?row.details:{};
      return {
        id:row.id,
        importType:row.import_type,
        fileName:row.file_name,
        createdAt:row.created_at,
        companyName:row.company_name,
        branchName:row.branch_name,
        readerUsed:details.readerUsed||null,
        optimizedPath:details.optimizedPath||null,
        intelligence:details.intelligence||null,
        detectedOperationalBranch:details.detectedOperationalBranch||null
      };
    });

    const readerSuccess=new Map();
    for(const item of importsHistory){
      if(!item.readerUsed)continue;
      const key=item.readerUsed;
      if(!readerSuccess.has(key)){
        readerSuccess.set(key,{
          reader:key,
          successfulUses:0,
          lastUsedAt:null,
          lastFile:null
        });
      }
      const current=readerSuccess.get(key);
      current.successfulUses++;
      if(!current.lastUsedAt){
        current.lastUsedAt=item.createdAt;
        current.lastFile=item.fileName;
      }
    }

    const recognizedReports=[
      {
        key:"ADMITIDOS",
        name:"Relação de Admitidos",
        status:"ATIVO",
        learned:false,
        fields:["Matrícula","Nome","Admissão","Cargo","Cartão Ponto"]
      },
      {
        key:"DEMITIDOS",
        name:"Relação de Demitidos",
        status:"ATIVO",
        learned:false,
        fields:["Matrícula","Nome","Demissão","Causa","Cargo"]
      },
      {
        key:"COLABORADORES",
        name:"Relação de Colaboradores",
        status:"ATIVO",
        learned:false,
        fields:["Matrícula","Nome","Admissão","Cargo","Situação"]
      },
      {
        key:"TURNOS",
        name:"Escalas / Empregados por Escala",
        status:"ATIVO",
        learned:true,
        fields:["Matrícula","Nome","Código Senior","Horário","Turno"]
      }
    ];

    const readers=[
      {
        key:"pdfium-flate",
        name:"PDFium / Flate",
        priority:"Alta para PDFs PDFium",
        purpose:"Reconstrói streams compactados da Senior sem depender do XRef."
      },
      {
        key:"pdf-parse",
        name:"PDF Parse",
        priority:"Principal",
        purpose:"Leitura padrão de PDFs estruturados."
      },
      {
        key:"pdf2json",
        name:"PDF2JSON",
        priority:"Contingência",
        purpose:"Leitor alternativo; evitado quando o XRef já foi identificado como problemático."
      },
      {
        key:"xref-repair + pdf-parse",
        name:"Reparo XRef + PDF Parse",
        priority:"Contingência",
        purpose:"Reconstrói o índice interno do PDF antes da leitura."
      },
      {
        key:"xref-repair + pdf2json",
        name:"Reparo XRef + PDF2JSON",
        priority:"Último recurso",
        purpose:"Leitura alternativa após reconstrução do XRef."
      },
      {
        key:"raw-pdf-text",
        name:"Texto bruto PDF",
        priority:"Último recurso",
        purpose:"Só é aceito quando há estrutura válida de relatório Senior."
      }
    ].map(reader=>{
      const usage=readerSuccess.get(reader.key);
      return {
        ...reader,
        successfulUses:usage?.successfulUses||0,
        lastUsedAt:usage?.lastUsedAt||null,
        lastFile:usage?.lastFile||null
      };
    });

    const learnedCodes=shiftsResult.rows
      .filter(shift=>String(shift.senior_code||"").trim())
      .map(shift=>({
        code:String(shift.senior_code).trim(),
        shiftId:shift.id,
        shiftName:shift.name,
        description:shift.description||null,
        companyId:shift.company_id,
        companyName:shift.company_name
      }))
      .sort((a,b)=>String(a.code).localeCompare(String(b.code),"pt-BR",{numeric:true}));

    const confidenceHistory=importsHistory
      .filter(item=>item.intelligence&&Number.isFinite(Number(item.intelligence.score)))
      .slice(0,20)
      .map(item=>({
        fileName:item.fileName,
        importType:item.importType,
        score:Number(item.intelligence.score),
        level:item.intelligence.level||null,
        companyName:item.companyName,
        branchName:item.branchName,
        readerUsed:item.readerUsed,
        createdAt:item.createdAt
      }));

    return res.json({
      engine:{
        name:"Leitor Inteligente Senior",
        version:"1.25",
        mode:"LOCAL",
        externalAi:false,
        learningMode:"CÓDIGOS_SENIOR_E_HISTÓRICO"
      },
      recognizedReports,
      readers,
      companies:companiesResult.rows,
      branches:branchesResult.rows,
      learnedCodes,
      confidenceHistory,
      summary:{
        reportModels:recognizedReports.length,
        companies:companiesResult.rows.length,
        branches:branchesResult.rows.length,
        learnedCodes:learnedCodes.length,
        historicalImports:importsHistory.length,
        readersWithSuccessfulHistory:[...readerSuccess.keys()].length
      }
    });
  }catch(error){
    next(error);
  }
});


router.get("/history",async(req,res,next)=>{
  try{
    const params=[];
    let where="WHERE 1=1";
    if(!req.scope.isAdmin){
      params.push(req.scope.companyId,req.scope.branchIds);
      where+=" AND i.company_id=$1 AND i.branch_id=ANY($2::uuid[])";
    }
    const {rows}=await pool.query(`
      SELECT i.id,i.import_type,i.file_name,i.total_found,i.total_created,
             i.total_updated,i.total_not_found,i.created_at,
             c.trade_name company_name,b.name branch_name,u.name user_name
      FROM employee_imports i
      LEFT JOIN companies c ON c.id=i.company_id
      LEFT JOIN branches b ON b.id=i.branch_id
      LEFT JOIN users u ON u.id=i.user_id
      ${where}
      ORDER BY i.created_at DESC
      LIMIT 30
    `,params);
    res.json(rows);
  }catch(e){next(e);}
});

module.exports=router;
