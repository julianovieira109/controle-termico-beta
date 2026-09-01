const https=require("https");

const TYPE_MAP={
  NATIONAL:"national",
  STATE:"state",
  MUNICIPAL:"municipal",
  OPTIONAL:"optional"
};

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

function nationalFallback(year){
  return [
    {date:`${year}-01-01`,name:"Confraternização Universal",type:"NATIONAL"},
    {date:`${year}-04-21`,name:"Tiradentes",type:"NATIONAL"},
    {date:`${year}-05-01`,name:"Dia Mundial do Trabalho",type:"NATIONAL"},
    {date:`${year}-09-07`,name:"Independência do Brasil",type:"NATIONAL"},
    {date:`${year}-10-12`,name:"Nossa Senhora Aparecida",type:"NATIONAL"},
    {date:`${year}-11-02`,name:"Finados",type:"NATIONAL"},
    {date:`${year}-11-15`,name:"Proclamação da República",type:"NATIONAL"},
    {date:`${year}-11-20`,name:"Dia Nacional de Zumbi e da Consciência Negra",type:"NATIONAL"},
    {date:`${year}-12-25`,name:"Natal",type:"NATIONAL"}
  ];
}

function optionalFallback(year){
  const easter=easterSunday(year);
  return [
    {date:isoDate(addDays(easter,-48)),name:"Carnaval - Segunda-feira",type:"OPTIONAL"},
    {date:isoDate(addDays(easter,-47)),name:"Carnaval - Terça-feira",type:"OPTIONAL"},
    {date:isoDate(addDays(easter,-2)),name:"Paixão de Cristo",type:"OPTIONAL"},
    {date:isoDate(addDays(easter,60)),name:"Corpus Christi",type:"OPTIONAL"}
  ];
}

function slugify(value){
  return String(value||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"");
}

function cityCode(state,city){
  const uf=String(state||"").trim().toUpperCase();
  const slug=slugify(city);
  return /^[A-Z]{2}$/.test(uf)&&slug?`${uf}-${slug}`:"";
}

function getJson(url,timeoutMs=7000){
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{
      headers:{
        Accept:"application/json",
        "User-Agent":"Controle-Termico/1.0"
      }
    },response=>{
      let body="";
      response.setEncoding("utf8");
      response.on("data",chunk=>{
        body+=chunk;
        if(body.length>2*1024*1024)request.destroy(new Error("Resposta de feriados excedeu o limite permitido."));
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

function unwrapList(data){
  if(Array.isArray(data))return data;
  if(Array.isArray(data?.data))return data.data;
  if(Array.isArray(data?.holidays))return data.holidays;
  return [];
}

function normalizeOnlineHoliday(item,fallbackType){
  const rawDate=String(item?.date||item?.data||"");
  const isoMatch=rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const brMatch=rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  const date=isoMatch?`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`:
    brMatch?`${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`:"";
  const name=String(item?.name||item?.nome||item?.description||"").trim();
  const rawType=String(item?.type||item?.tipo||fallbackType||"").trim().toLowerCase();
  const type=rawType==="national"||rawType==="nacional"?"NATIONAL":
    rawType==="state"||rawType==="estadual"?"STATE":
    rawType==="municipal"?"MUNICIPAL":
    rawType==="optional"||rawType==="facultativo"||rawType==="ponto facultativo"?"OPTIONAL":
    String(fallbackType||"").toUpperCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!name)return null;
  return {date,name,type};
}

async function fetchType(year,type,{state="",city=""}={}){
  const providerType=TYPE_MAP[type];
  if(!providerType)throw new Error("Tipo de feriado inválido.");

  const params=new URLSearchParams({year:String(year),type:providerType});
  if(type==="STATE"){
    const uf=String(state||"").trim().toUpperCase();
    if(!/^[A-Z]{2}$/.test(uf))throw new Error("UF da filial não informada.");
    params.set("state",uf);
  }
  if(type==="MUNICIPAL"){
    const code=cityCode(state,city);
    if(!code)throw new Error("Cidade/UF da filial não informada.");
    params.set("city",code);
  }

  const data=await getJson(`https://api.feriados.dev/api/v1/holidays?${params.toString()}`);
  const rows=unwrapList(data).map(item=>normalizeOnlineHoliday(item,type)).filter(Boolean);
  return rows.filter(row=>row.type===type||!row.type);
}

async function getNational(year){
  try{
    const holidays=await fetchType(year,"NATIONAL");
    if(!holidays.length)throw new Error("Fonte online não retornou feriados nacionais.");
    return {holidays,source:"ONLINE",provider:"feriados.dev",warning:null};
  }catch(error){
    return {holidays:nationalFallback(year),source:"LOCAL_FALLBACK",provider:"Lista nacional interna",warning:error.message};
  }
}

async function getOptional(year){
  try{
    const holidays=await fetchType(year,"OPTIONAL");
    if(!holidays.length)throw new Error("Fonte online não retornou pontos facultativos.");
    return {holidays,source:"ONLINE",provider:"feriados.dev",warning:null};
  }catch(error){
    return {holidays:optionalFallback(year),source:"LOCAL_FALLBACK",provider:"Cálculo interno",warning:error.message};
  }
}

async function getLocal(year,type,location){
  try{
    const holidays=await fetchType(year,type,location);
    return {holidays,source:"ONLINE",provider:"feriados.dev",warning:null};
  }catch(error){
    return {holidays:[],source:"UNAVAILABLE",provider:"feriados.dev",warning:error.message};
  }
}

module.exports={
  TYPE_MAP,cityCode,slugify,normalizeOnlineHoliday,nationalFallback,optionalFallback,
  fetchType,getNational,getOptional,getLocal
};
