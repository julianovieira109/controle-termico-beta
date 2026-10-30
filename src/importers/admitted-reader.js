const {readSeniorPdfPages}=require('./senior-pdf-text');

const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const key=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const admittedSignature=text=>/RELACAO\s*DE\s*ADMITIDOS|FPRE004(?:\s*\.\s*(?:COL|IMP))?/.test(key(text));
function isoDate(value){
  const match=String(value||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!match)return null;
  const iso=`${match[3]}-${match[2]}-${match[1]}`;
  return Number.isFinite(Date.parse(iso))&&new Date(iso).toISOString().slice(0,10)===iso?iso:null;
}
function validIdentity(row){
  const name=clean(row?.fullName),role=clean(row?.jobTitle);
  return /^0\d{8}$/.test(String(row?.registration||''))
    &&/^[A-ZÀ-Ü][A-ZÀ-Ü .'-]+$/i.test(name)&&name.split(' ').length>=2
    &&/[A-ZÀ-Ü]{3}/i.test(role)&&!/TOTAL|FPRE\d|USU[AÁ]RIO:/i.test(role)
    &&/^\d{1,6}$/.test(String(row?.jobCode||''))
    &&/^\d{4}-\d{2}-\d{2}$/.test(String(row?.admissionDate||''))
    &&Number.isFinite(Date.parse(row.admissionDate))&&new Date(row.admissionDate).toISOString().slice(0,10)===row.admissionDate
    &&/^(?:\d{4})?$/.test(String(row?.pointCard||''))&&/^(?:\d{4})?$/.test(String(row?.branchCode||''));
}
function groupedRows(page){
  const items=(page?.Texts||[]).map(item=>({x:Number(item.x),y:Number(item.y),text:clean((item.R||[]).map(run=>decodeURIComponent(run.T||'')).join(''))})).filter(item=>item.text&&Number.isFinite(item.x)&&Number.isFinite(item.y)).sort((a,b)=>a.y-b.y||a.x-b.x);
  const rows=[];
  for(const item of items){let row=rows.at(-1);if(!row||Math.abs(row.y-item.y)>.14){row={y:item.y,items:[]};rows.push(row);}row.items.push(item);}
  for(const row of rows){row.items.sort((a,b)=>a.x-b.x);row.text=row.items.map(item=>item.text).join(' ');}
  return rows;
}
function printedTotal(text){
  let count=null;
  for(const line of String(text||'').split(/\n/)){
    if(!/Total/i.test(line))continue;
    const trailing=line.match(/\b(\d{1,6})\s*$/),leading=line.match(/^\s*(\d{1,6})\s*Total/i);
    if(trailing||leading)count=Number((trailing||leading)[1]);
  }
  return count;
}
function pageAdmissions(page,pageNumber){
  const lines=groupedRows(page),text=lines.map(row=>row.text).join('\n'),errors=[],rows=[];
  const header=lines.find(row=>row.items.some(item=>key(item.text)==='CADASTRO')&&row.items.some(item=>key(item.text)==='NOME')&&row.items.some(item=>key(item.text)==='ADMISSAO'));
  if(!header)return {text,rows,sourceRows:0,errors:admittedSignature(text)?[`Página ${pageNumber}: colunas de Admitidos não identificadas.`]:[]};
  const find=label=>header.items.find(item=>key(item.text)===label)?.x;
  const x={registration:find('CADASTRO'),name:find('NOME'),date:find('ADMISSAO'),job:find('CARGO'),card:header.items.find(item=>/^CARTAO(?:\s*PONTO)?$/.test(key(item.text)))?.x,branch:find('FILIAL')};
  if([x.registration,x.name,x.date,x.job].some(value=>value===undefined)||x.card===undefined){
    return {text,rows,sourceRows:0,errors:[`Página ${pageNumber}: cabeçalho incompleto; matrícula e nome não serão associados por posição na lista.`]};
  }
  const fields=line=>{
    const result={registration:'',name:'',date:'',job:'',card:'',branch:''};
    for(const item of line.items){
      const field=item.x<x.name-.18?'registration':item.x<x.date-.18?'name':item.x<x.job-.25?'date':item.x<x.card-.25?'job':x.branch===undefined||item.x<x.branch-.25?'card':'branch';
      result[field]=clean(`${result[field]} ${item.text}`);
    }
    return result;
  };
  let current=null,sourceRows=0;
  const flush=()=>{
    if(!current)return;
    const job=current.job.match(/^(\d{1,6})\s*-\s*(.+)$/);
    const row={registration:current.registration,fullName:current.name,admissionDate:isoDate(current.date),jobCode:job?.[1]||'',jobTitle:job?.[2]||'',pointCard:current.card,branchCode:current.branch,status:'NOVO',sourcePage:pageNumber,sourceLine:current.sourceLine,identitySource:'PDF_COORDINATES'};
    if(validIdentity(row))rows.push(row);else errors.push(`Página ${pageNumber}, linha ${current.sourceLine}: campos de matrícula, nome, admissão ou cargo incompletos; confira o PDF original.`);
    current=null;
  };
  for(const [index,line] of lines.entries()){
    if(line.y<=header.y)continue;
    if(/^Total\b|FPRE004|Usu[aá]rio:/i.test(line.text)){flush();break;}
    const data=fields(line);
    if(/^0\d{8}$/.test(data.registration)){flush();sourceRows++;current={...data,sourceLine:index+1};continue;}
    if(!current)continue;
    const populated=Object.entries(data).filter(([,value])=>value);
    if(populated.length===1&&['name','job'].includes(populated[0][0])){
      const [field,value]=populated[0];current[field]=clean(`${current[field]} ${value}`);
    }else if(populated.length){errors.push(`Página ${pageNumber}, linha ${index+1}: linha sem matrícula própria; a associação automática foi bloqueada.`);}
  }
  flush();
  return {text,rows,sourceRows,errors};
}
function finish(text,rows,sourceRows,errors){
  const expectedTotal=printedTotal(text),unique=new Map();
  for(const row of rows){
    if(unique.has(row.registration)){errors.push(`Matrícula ${row.registration} repetida no relatório; confira a origem.`);continue;}
    unique.set(row.registration,row);
  }
  if(expectedTotal!==null&&expectedTotal!==unique.size)errors.push(`Total impresso ${expectedTotal} diferente dos ${unique.size} registros estruturados.`);
  if(sourceRows!==rows.length)errors.push('Há linhas de origem sem uma identidade completa.');
  if(!unique.size)errors.push('Nenhum registro de Admitidos pôde ser associado com segurança.');
  return {recognized:admittedSignature(text),text,rows:[...unique.values()],diagnostics:{complete:errors.length===0,sourceRows,parsedRows:unique.size,expectedTotal,errors}};
}
async function readAdmittedPdf(buffer){
  const pages=[];let number=0;
  await readSeniorPdfPages(buffer,page=>pages.push(pageAdmissions(page,++number)));
  const text=pages.map(page=>page.text).join('\n\f\n');
  return finish(text,pages.flatMap(page=>page.rows),pages.reduce((sum,page)=>sum+page.sourceRows,0),pages.flatMap(page=>page.errors));
}
function parseAdmittedText(text){
  const source=String(text||''),hasBranch=/CARTAO\s*PONTO\s*FILIAL/.test(key(source))||source.split(/\r?\n/).some(line=>key(line)==='FILIAL'),rows=[];
  let unresolved=false;
  for(const rawLine of source.split(/\r?\n/)){
    const line=clean(rawLine);
    if(!/0\d{8}/.test(line)||/^FPRE004|Usu[aá]rio:/i.test(line))continue;
    let match=line.match(/^(0\d{8})\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{1,6})\s*-\s*(.+)$/);
    let registration,name,date,jobCode,roleAndCodes;
    if(match){[,registration,name,date,jobCode,roleAndCodes]=match;}
    else{
      match=line.match(/^([A-ZÀ-Ü][A-ZÀ-Ü .'-]+?)(\d{2}\/\d{2}\/\d{4})\s*-\s*(.+?)(0\d{8})(\d{1,6})\s+(\d{4})(?:\s+(\d{4}))?$/i);
      if(!match){unresolved=true;continue;}
      [,name,date,roleAndCodes,registration,jobCode]=match;roleAndCodes=`${roleAndCodes} ${match[6]}${match[7]?` ${match[7]}`:''}`;
    }
    let pointCard='',branchCode='',jobTitle=roleAndCodes;
    const codes=roleAndCodes.match(/\s+(\d{4})(?:\s+(\d{4}))?$/);
    if(codes){
      jobTitle=roleAndCodes.slice(0,codes.index).trim();
      if(hasBranch){branchCode=codes[2]||codes[1];pointCard=codes[2]?codes[1]:'';}
      else if(codes[2]){unresolved=true;continue;}else pointCard=codes[1];
    }
    const row={registration,fullName:clean(name),admissionDate:isoDate(date),jobCode,jobTitle:clean(jobTitle),pointCard,branchCode,status:'NOVO',identitySource:'SAME_SOURCE_LINE'};
    if(validIdentity(row))rows.push(row);else unresolved=true;
  }
  const result=finish(source,rows,rows.length,unresolved?['Uma linha não pôde ser associada sem cruzar identidades.']:[]);
  return result.diagnostics.complete?result.rows:[];
}

module.exports={readAdmittedPdf,pageAdmissions,parseAdmittedText,validIdentity,admittedSignature};
