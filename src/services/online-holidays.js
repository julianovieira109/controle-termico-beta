const https=require("https");

function addDays(date,days){
  const result=new Date(date);
  result.setUTCDate(result.getUTCDate()+days);
  return result;
}
function easterSunday(year){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4;
  const l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31);
  const day=((h+l-7*m+114)%31)+1;
  return new Date(Date.UTC(year,month-1,day));
}
function isoDate(date){return date.toISOString().slice(0,10);}

function localFallback(year){
  const easter=easterSunday(year);
  return [
    {date:`${year}-01-01`,name:"Confraternização Universal"},
    {date:isoDate(addDays(easter,-48)),name:"Carnaval - Segunda-feira"},
    {date:isoDate(addDays(easter,-47)),name:"Carnaval - Terça-feira"},
    {date:isoDate(addDays(easter,-2)),name:"Paixão de Cristo"},
    {date:`${year}-04-21`,name:"Tiradentes"},
    {date:`${year}-05-01`,name:"Dia Mundial do Trabalho"},
    {date:isoDate(addDays(easter,60)),name:"Corpus Christi"},
    {date:`${year}-09-07`,name:"Independência do Brasil"},
    {date:`${year}-10-12`,name:"Nossa Senhora Aparecida"},
    {date:`${year}-11-02`,name:"Finados"},
    {date:`${year}-11-15`,name:"Proclamação da República"},
    {date:`${year}-11-20`,name:"Dia Nacional de Zumbi e da Consciência Negra"},
    {date:`${year}-12-25`,name:"Natal"}
  ];
}

function getJson(url,timeoutMs=7000){
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{
      headers:{
        "Accept":"application/json",
        "User-Agent":"Controle-Termico/1.0"
      }
    },response=>{
      let body="";
      response.setEncoding("utf8");
      response.on("data",chunk=>{
        body+=chunk;
        if(body.length>1024*1024){
          request.destroy(new Error("Resposta de feriados excedeu o limite permitido."));
        }
      });
      response.on("end",()=>{
        if(response.statusCode<200||response.statusCode>=300){
          return reject(new Error(`Serviço de feriados respondeu HTTP ${response.statusCode}.`));
        }
        try{resolve(JSON.parse(body));}
        catch{reject(new Error("Resposta inválida do serviço de feriados."));}
      });
    });
    request.setTimeout(timeoutMs,()=>request.destroy(new Error("Tempo esgotado ao consultar feriados online.")));
    request.on("error",reject);
  });
}

function normalizeOnlineHoliday(item){
  const date=String(item?.date||item?.data||"").slice(0,10);
  const name=String(item?.name||item?.nome||item?.description||"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!name)return null;
  return {date,name};
}

async function fetchOnlineHolidays(year){
  const data=await getJson(`https://brasilapi.com.br/api/feriados/v1/${year}`);
  if(!Array.isArray(data))throw new Error("Lista de feriados online inválida.");
  const holidays=data.map(normalizeOnlineHoliday).filter(Boolean);
  if(!holidays.length)throw new Error("O serviço online não retornou feriados para o ano solicitado.");
  return holidays;
}

async function getHolidays(year){
  try{
    const holidays=await fetchOnlineHolidays(year);
    return {holidays,source:"ONLINE",provider:"BrasilAPI",warning:null};
  }catch(error){
    return {
      holidays:localFallback(year),
      source:"LOCAL_FALLBACK",
      provider:"Cálculo interno de segurança",
      warning:error.message
    };
  }
}

module.exports={getHolidays,fetchOnlineHolidays,localFallback,normalizeOnlineHoliday};
