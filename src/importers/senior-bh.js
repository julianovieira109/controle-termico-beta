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
  text=text.replace(/(\d+:[0-5]\d)[ \t]+-/g,'$1-')
    .replace(/Per[ií]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/gi,(_,start,end)=>`Período: ${start} a ${end}`)
    .replace(/Refer[eê]ncia:\s*(\d{2}\/\d{2}\/\d{4})/gi,(_,date)=>`Referência: ${date}`);
  const analytic=/Banco de Horas Anal[ií]tico/i.test(text);
  const synthetic=/Banco de Horas Sint[eé]tico/i.test(text);
  if(analytic===synthetic)throw new Error('Envie Banco de Horas Analítico (HRBH008) ou Sintético (HRBH009) da Senior.');
  const header=text.match(/^\s*\d{4}\s+(.+?)\s+P[áa]g\.:/m);
  const companyHeaders=[...text.matchAll(/^\s*\d{4}\s+(.+?)\s+P[áa]g\.:/gm)].map(m=>m[1].replace(/\s+/g,'').toUpperCase());
  if(new Set(companyHeaders).size>1)throw new Error('O PDF contém mais de uma empresa. Exporte uma empresa/filial por arquivo.');
  const records=[];let person=null,record=null,currentPeriod=null;let page=0;const errors=[];
  const periods=new Map();
  const known=new Set();
  for(const line of text.split(/\r?\n/)){
    if(/P[áa]g\.:/.test(line))page++;
    const printed=analytic?line.match(/Per[ií]odo:\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i):line.match(/Refer[eê]ncia:\s*(\d{2}\/\d{2}\/\d{4})/i);
    if(!printed&&(analytic?/Per[ií]odo:/i:/Refer[eê]ncia:/i).test(line))throw new Error('Datas de BH ausentes ou inválidas no relatório.');
    if(printed){
      const next={start:isoDate(printed[1]),end:isoDate(analytic?printed[2]:printed[1])};
      if(!next.start||!next.end||next.start>next.end)throw new Error('Datas de BH ausentes ou inválidas no relatório.');
      if(currentPeriod&&(next.start!==currentPeriod.start||next.end!==currentPeriod.end)){person=null;record=null;}
      currentPeriod=next;periods.set(`${next.start}|${next.end}`,next);
    }
    const printedTotal=line.match(/Total Colaboradores\s+(\d+)/);
    if(printedTotal&&currentPeriod){
      const count=new Set(records.filter(r=>r.periodStart===currentPeriod.start&&r.periodEnd===currentPeriod.end).map(r=>r.registration)).size;
      if(count!==Number(printedTotal[1]))errors.push(`Página ${page}: quantidade de colaboradores diferente do total impresso neste intervalo.`);
    }
    if(analytic){
      const emp=line.match(/^\s*\d+\s+(\d{9})\s+(.+?)\s*$/);
      if(emp){person={registration:registration(emp[1]),name:emp[2].trim()};record=null;continue;}
      const bank=line.match(/^\s*Banco\s+(\d+)\s+(.+?)\s+Saldo Inicial:\s*(\d+:[0-5]\d-?)\s*$/);
      if(bank&&person){
        if(!currentPeriod)throw new Error('Não foi possível identificar as datas deste bloco de BH.');
        const key=`${person.registration}|${bank[1]}|${currentPeriod.start}|${currentPeriod.end}`;
        if(known.has(key))throw new Error('Vínculo/banco repetido no mesmo intervalo do PDF. Confira a duplicidade.');
        if(records.some(r=>r.registration===person.registration&&r.bank===bank[1]&&r.periodStart<=currentPeriod.end&&r.periodEnd>=currentPeriod.start)){
          errors.push(`Página ${page}: blocos sobrepostos para matrícula ${person.registration}, banco ${bank[1]}. Confira as versões em arquivos separados antes de confirmar.`);
        }
        known.add(key);record={...person,bank:bank[1],bankName:bank[2],initial:minutes(bank[3]),final:null,events:[],page,periodStart:currentPeriod.start,periodEnd:currentPeriod.end};records.push(record);continue;
      }
      const event=line.match(/^\s*(\*\s*)?(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(\S+)\s+(\d+:[0-5]\d-?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+:[0-5]\d-?)\s+(\d+:[0-5]\d-?)\s*$/);
      if(event&&record){
        const date=isoDate(event[2]),deadline=isoDate(event[6]);
        if(!date||!deadline||date<record.periodStart||date>record.periodEnd){errors.push(`Página ${page}: data fora do período ou inválida.`);continue;}
        record.events.push({date,code:event[3],origin:event[4],toCompensate:minutes(event[5]),deadline,minutes:minutes(event[7]),balance:minutes(event[8]),closing:Boolean(event[1]),page});continue;
      }
      const final=line.match(/^\s*Total do Banco\s+(\d+)\s+.+?\s+(\d+:[0-5]\d-?)\s*$/);
      if(final&&record&&final[1]===record.bank){record.final=minutes(final[2]);continue;}
      if(/^\s*\*?\s*\d{2}\/\d{2}\/\d{4}\s/.test(line))errors.push(`Página ${page}: lançamento não reconhecido.`);
    }else{
      const row=line.match(/^\s*\d+\s+(\d{9})\s+(.+?)\s+(\d{3})\s+(.+?)\s+(\d+:[0-5]\d-?)\s+(\d+:[0-5]\d-?)\s*$/);
      if(row){
        if(!currentPeriod)throw new Error('Não foi possível identificar a referência deste saldo de BH.');
        const key=`${registration(row[1])}|${row[3]}|${currentPeriod.end}`;
        if(known.has(key))throw new Error('Vínculo/banco repetido na mesma referência do PDF.');
        known.add(key);records.push({registration:registration(row[1]),name:row[2],bank:row[3],bankName:row[4],expiring:minutes(row[5]),final:minutes(row[6]),initial:null,events:[],page,periodStart:currentPeriod.start,periodEnd:currentPeriod.end});
      }else if(/^\s*\d+\s+\d{9}\s/.test(line))errors.push(`Página ${page}: saldo não reconhecido.`);
    }
  }
  if(!records.length)throw new Error('Nenhum vínculo de BH reconhecido.');
  if(records.some(r=>r.final===null))errors.push('Há bancos sem saldo final reconhecido.');
  // Preserve every ledger movement, including closing entries; they do not all represent point hours.
  for(const r of records){
    r.ledgerDifference=analytic?r.final-(r.initial+r.events.reduce((sum,e)=>sum+e.minutes,0)):null;
  }
  const intervals=[...periods.values()].sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
  const start=records.map(r=>r.periodStart).sort()[0],end=records.map(r=>r.periodEnd).sort().at(-1);
  return {type:analytic?'ANALYTIC':'SYNTHETIC',start,end,periods:intervals,companyName:header?.[1]?.trim()||'',records,errors};
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
