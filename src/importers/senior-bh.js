const {readSeniorPdfPages}=require('./senior-pdf-text');

function isoDate(value){
  const m=String(value||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m)return null;
  const iso=`${m[3]}-${m[2]}-${m[1]}`;
  return Number.isFinite(Date.parse(iso))&&new Date(iso).toISOString().slice(0,10)===iso?iso:null;
}
function minutes(value){
  const m=String(value||'').match(/^(\d+):([0-5]\d)(-?)$/);
  if(!m)throw new Error('Duração de BH inválida.');
  const total=Number(m[1])*60+Number(m[2]);
  if(!Number.isSafeInteger(total))throw new Error('Duração de BH fora do limite numérico.');
  return total*(m[3]?-1:1);
}
function registration(value){return String(value||'').replace(/^0+/,'')||'0';}
function parseBhText(text){
  text=text.replace(/(\d+:[0-5]\d)[ \t]+-/g,'$1-');
  const analytic=/Banco de Horas Anal[ií]tico/i.test(text);
  const synthetic=/Banco de Horas Sint[eé]tico/i.test(text);
  if(analytic===synthetic)throw new Error('Envie Banco de Horas Analítico (HRBH008) ou Sintético (HRBH009) da Senior.');
  const period=text.match(/Per[ií]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i);
  const ref=text.match(/Refer[eê]ncia:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const start=isoDate(analytic?period?.[1]:ref?.[1]);
  const end=isoDate(analytic?period?.[2]:ref?.[1]);
  if(!start||!end||start>end)throw new Error('Período de BH ausente ou inválido.');
  const header=text.match(/^\s*\d{4}\s+(.+?)\s+P[áa]g\.:/m);
  const companyHeaders=[...text.matchAll(/^\s*\d{4}\s+(.+?)\s+P[áa]g\.:/gm)].map(m=>m[1].replace(/\s+/g,'').toUpperCase());
  if(new Set(companyHeaders).size>1)throw new Error('O PDF contém mais de uma empresa. Exporte uma empresa/filial por arquivo.');
  const dates=analytic?[...text.matchAll(/Per[ií]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/gi)].map(m=>`${m[1]}|${m[2]}`):[...text.matchAll(/Refer[eê]ncia:\s*(\d{2}\/\d{2}\/\d{4})/gi)].map(m=>m[1]);
  if(new Set(dates).size>1)throw new Error('O PDF mistura referências diferentes. Importe cada relatório separadamente.');
  const records=[];let person=null,record=null;let page=0;const errors=[];
  const known=new Set();
  for(const line of text.split(/\r?\n/)){
    if(/P[áa]g\.:/.test(line))page++;
    if(analytic){
      const emp=line.match(/^\s*\d+\s+(\d{9})\s+(.+?)\s*$/);
      if(emp){person={registration:registration(emp[1]),name:emp[2].trim()};record=null;continue;}
      const bank=line.match(/^\s*Banco\s+(\d+)\s+(.+?)\s+Saldo Inicial:\s*(\d+:[0-5]\d-?)\s*$/);
      if(bank&&person){
        const key=`${person.registration}|${bank[1]}`;
        if(known.has(key))throw new Error('Vínculo/banco repetido no PDF. Exporte uma empresa por arquivo.');
        known.add(key);record={...person,bank:bank[1],bankName:bank[2],initial:minutes(bank[3]),final:null,events:[],page};records.push(record);continue;
      }
      const event=line.match(/^\s*(\*\s*)?(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(\S+)\s+(\d+:[0-5]\d-?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+:[0-5]\d-?)\s+(\d+:[0-5]\d-?)\s*$/);
      if(event&&record){
        const date=isoDate(event[2]),deadline=isoDate(event[6]);
        if(!date||!deadline||date<start||date>end){errors.push(`Página ${page}: data fora do período ou inválida.`);continue;}
        record.events.push({date,code:event[3],origin:event[4],toCompensate:minutes(event[5]),deadline,minutes:minutes(event[7]),balance:minutes(event[8]),closing:Boolean(event[1]),page});continue;
      }
      const final=line.match(/^\s*Total do Banco\s+(\d+)\s+.+?\s+(\d+:[0-5]\d-?)\s*$/);
      if(final&&record&&final[1]===record.bank){record.final=minutes(final[2]);continue;}
      if(/^\s*\*?\s*\d{2}\/\d{2}\/\d{4}\s/.test(line))errors.push(`Página ${page}: lançamento não reconhecido.`);
    }else{
      const row=line.match(/^\s*\d+\s+(\d{9})\s+(.+?)\s+(\d{3})\s+(.+?)\s+(\d+:[0-5]\d-?)\s+(\d+:[0-5]\d-?)\s*$/);
      if(row){
        const key=`${registration(row[1])}|${row[3]}`;
        if(known.has(key))throw new Error('Vínculo/banco repetido no PDF.');
        known.add(key);records.push({registration:registration(row[1]),name:row[2],bank:row[3],bankName:row[4],expiring:minutes(row[5]),final:minutes(row[6]),initial:null,events:[],page});
      }else if(/^\s*\d+\s+\d{9}\s/.test(line))errors.push(`Página ${page}: saldo não reconhecido.`);
    }
  }
  if(!records.length)throw new Error('Nenhum vínculo de BH reconhecido.');
  if(records.some(r=>r.final===null))errors.push('Há bancos sem saldo final reconhecido.');
  const total=text.match(/Total Colaboradores\s+(\d+)/);
  if(total&&Number(total[1])!==new Set(records.map(r=>r.registration)).size)errors.push('Quantidade de colaboradores diferente do total impresso.');
  // Preserve every ledger movement, including closing entries; they do not all represent point hours.
  for(const r of records){
    r.ledgerDifference=analytic?r.final-(r.initial+r.events.reduce((sum,e)=>sum+e.minutes,0)):null;
  }
  return {type:analytic?'ANALYTIC':'SYNTHETIC',start,end,companyName:header?.[1]?.trim()||'',records,errors};
}
async function readBhPdf(buffer){
  const lines=[];
  await readSeniorPdfPages(buffer,page=>{
    const rows=[];
    for(const item of [...page.Texts].sort((a,b)=>a.y-b.y||a.x-b.x)){
      let row=rows.at(-1);
      if(!row||Math.abs(row.y-item.y)>0.12){row={y:item.y,items:[]};rows.push(row);}
      row.items.push(item);
    }
    for(const row of rows)lines.push(row.items.sort((a,b)=>a.x-b.x).map(t=>t.R.map(r=>decodeURIComponent(r.T)).join('')).join(' '));
  });
  return parseBhText(lines.join('\n'));
}
module.exports={isoDate,minutes,registration,parseBhText,readBhPdf};
