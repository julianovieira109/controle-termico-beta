"use strict";

const MONITOR_ALARM="ct-senior-monitor-2h";

function nextEvenHourTimestamp(now=new Date()){
  const next=new Date(now);
  next.setMinutes(0,0,0);
  let hour=next.getHours();
  if(now.getMinutes()>0||now.getSeconds()>0||now.getMilliseconds()>0)hour+=1;
  if(hour%2!==0)hour+=1;
  if(hour>=24){
    next.setDate(next.getDate()+1);
    hour=0;
  }
  next.setHours(hour,0,0,0);
  if(next.getTime()<=now.getTime())next.setHours(next.getHours()+2);
  return next.getTime();
}

async function scheduleMonitor(){
  await chrome.alarms.clear(MONITOR_ALARM);
  const {seniorMonitor}=await chrome.storage.local.get("seniorMonitor");
  if(!seniorMonitor?.active||!seniorMonitor?.monitorToken)return;
  await chrome.alarms.create(MONITOR_ALARM,{
    when:nextEvenHourTimestamp(),
    periodInMinutes:120
  });
}

async function monitorStatus(){
  const {seniorMonitor,seniorMonitorLast}=await chrome.storage.local.get(["seniorMonitor","seniorMonitorLast"]);
  const alarm=await chrome.alarms.get(MONITOR_ALARM);
  return {
    active:Boolean(seniorMonitor?.active),
    nextRunAt:alarm?.scheduledTime||null,
    lastLocalRun:seniorMonitorLast||null
  };
}

async function postMonitorResult(config,body){
  const baseUrl=String(config?.baseUrl||"https://controle-termico-beta.onrender.com").replace(/\/$/,"");
  const response=await fetch(baseUrl+"/api/senior-sync/monitor/ingest",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-senior-monitor-token":config.monitorToken
    },
    body:JSON.stringify(body)
  });
  const raw=await response.text();
  let data={};
  try{data=raw?JSON.parse(raw):{};}catch{data={};}
  if(!response.ok)throw new Error(data.error||"Controle Térmico recusou a leitura automática.");
  return data;
}

function currentDateSaoPaulo(){
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(new Date());
  const get=type=>parts.find(part=>part.type===type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function runMonitor(){
  const {seniorMonitor}=await chrome.storage.local.get("seniorMonitor");
  if(!seniorMonitor?.active||!seniorMonitor?.monitorToken){
    return {ok:false,error:"Monitor Senior não está configurado."};
  }
  const startedAt=new Date().toISOString();
  try{
    const collected=await collectSenior();
    if(!collected?.ok){
      const error=collected?.error||"Falha na leitura automática da Senior.";
      try{await postMonitorResult(seniorMonitor,{error});}catch{}
      const result={ok:false,error,startedAt,finishedAt:new Date().toISOString()};
      await chrome.storage.local.set({seniorMonitorLast:result});
      return result;
    }
    const today=currentDateSaoPaulo();
    if(today<collected.payload.periodStart||today>collected.payload.periodEnd){
      const error=`A competência aberta na Senior (${collected.payload.periodStart} a ${collected.payload.periodEnd}) não inclui o dia atual (${today}). Selecione a competência atual na Senior.`;
      try{await postMonitorResult(seniorMonitor,{error});}catch{}
      const result={ok:false,error,startedAt,finishedAt:new Date().toISOString()};
      await chrome.storage.local.set({seniorMonitorLast:result});
      return result;
    }
    const server=await postMonitorResult(seniorMonitor,{payload:collected.payload});
    const result={ok:true,server,startedAt,finishedAt:new Date().toISOString()};
    await chrome.storage.local.set({seniorMonitorLast:result});
    return result;
  }catch(error){
    const message=error?.message||String(error);
    try{await postMonitorResult(seniorMonitor,{error:message});}catch{}
    const result={ok:false,error:message,startedAt,finishedAt:new Date().toISOString()};
    await chrome.storage.local.set({seniorMonitorLast:result});
    return result;
  }
}

chrome.runtime.onInstalled.addListener(()=>{scheduleMonitor().catch(()=>{});});
chrome.runtime.onStartup.addListener(()=>{scheduleMonitor().catch(()=>{});});
chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name===MONITOR_ALARM)runMonitor().catch(()=>{});
});

chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message?.type==="CT_SENIOR_COLLECT"){
    collectSenior()
      .then(result=>sendResponse(result))
      .catch(error=>sendResponse({ok:false,error:error?.message||String(error)}));
    return true;
  }
  if(message?.type==="CT_SENIOR_MONITOR_CONFIGURE"){
    (async()=>{
      const config=message.config||{};
      if(config.active){
        await chrome.storage.local.set({seniorMonitor:{
          active:true,
          monitorToken:String(config.monitorToken||""),
          baseUrl:String(config.baseUrl||"https://controle-termico-beta.onrender.com")
        }});
      }else{
        await chrome.storage.local.remove(["seniorMonitor","seniorMonitorLast"]);
      }
      await scheduleMonitor();
      sendResponse({ok:true,status:await monitorStatus()});
    })().catch(error=>sendResponse({ok:false,error:error?.message||String(error)}));
    return true;
  }
  if(message?.type==="CT_SENIOR_MONITOR_STATUS"){
    monitorStatus()
      .then(status=>sendResponse({ok:true,status}))
      .catch(error=>sendResponse({ok:false,error:error?.message||String(error)}));
    return true;
  }
  if(message?.type==="CT_SENIOR_MONITOR_RUN"){
    runMonitor()
      .then(result=>sendResponse(result))
      .catch(error=>sendResponse({ok:false,error:error?.message||String(error)}));
    return true;
  }
});

async function collectSenior(){
  const tabs=await chrome.tabs.query({});
  const seniorTab=tabs.find(tab=>/^https:\/\/[^/]*seniorcloud\.com\.br(?::\d+)?\/gestaoponto-frontend\//i.test(tab.url||""));
  if(!seniorTab?.id){
    return {ok:false,error:"Abra o Gestão do Ponto Senior em uma aba do Edge e mantenha a sessão autenticada."};
  }

  const executed=await chrome.scripting.executeScript({
    target:{tabId:seniorTab.id},
    world:"MAIN",
    func:async()=>{
      const clean=value=>String(value||"").replace(/\s+/g," ").trim();
      const jwtRegex=/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
      function scanValue(value,depth=0){
        if(depth>3||value==null)return null;
        if(typeof value==="string"){
          const direct=value.match(jwtRegex)?.[0];
          if(direct)return direct;
          if((value.startsWith("{")||value.startsWith("["))&&value.length<200000){
            try{return scanValue(JSON.parse(value),depth+1);}catch{}
          }
          return null;
        }
        if(Array.isArray(value)){
          for(const item of value){const found=scanValue(item,depth+1);if(found)return found;}
          return null;
        }
        if(typeof value==="object"){
          for(const [key,item] of Object.entries(value)){
            if(/assert|token|auth|jwt/i.test(key)){
              const found=scanValue(item,depth+1);
              if(found)return found;
            }
          }
          for(const item of Object.values(value)){
            const found=scanValue(item,depth+1);
            if(found)return found;
          }
        }
        return null;
      }
      function findAssertion(){
        for(const storage of [sessionStorage,localStorage]){
          for(let i=0;i<storage.length;i++){
            const key=storage.key(i);
            const found=scanValue(storage.getItem(key));
            if(found)return found;
          }
        }
        for(const key of Object.keys(window).filter(key=>/assert|token|auth|jwt|session/i.test(key)).slice(0,300)){
          try{
            const found=scanValue(window[key]);
            if(found)return found;
          }catch{}
        }
        return null;
      }
      function brToIso(value){
        const match=String(value||"").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        return match?match[3]+"-"+match[2]+"-"+match[1]:null;
      }

      const resources=performance.getEntriesByType("resource").map(entry=>entry.name).filter(Boolean);
      const reversed=[...resources].reverse();
      let calculationCode=null,periodStart=null,periodEnd=null,seniorCompanyNumber=null;

      for(const url of reversed){
        try{
          const parsed=new URL(url);
          calculationCode=calculationCode||parsed.searchParams.get("codigoCalculo");
          periodStart=periodStart||parsed.searchParams.get("dataInicial");
          periodEnd=periodEnd||parsed.searchParams.get("dataFinal");
          const companyMatch=parsed.pathname.match(/\/empresas\/(\d+)\/acerto-ponto-gestor\/pendencias-colaboradores/);
          if(companyMatch&&!seniorCompanyNumber)seniorCompanyNumber=companyMatch[1];
        }catch{}
        if(calculationCode&&periodStart&&periodEnd&&seniorCompanyNumber)break;
      }

      if(!periodStart||!periodEnd){
        const text=document.body?.innerText||"";
        const match=text.match(/(\d{2}\/\d{2}\/\d{4})\s+a\s+(\d{2}\/\d{2}\/\d{4})/);
        if(match){
          periodStart=periodStart||brToIso(match[1]);
          periodEnd=periodEnd||brToIso(match[2]);
        }
      }

      if(!calculationCode){
        const text=document.body?.innerText||"";
        const match=text.match(/(?:C[óo]digo\s+de\s+c[áa]lculo|c[áa]lculo)\s*[:#-]?\s*(\d{1,8})/i);
        if(match)calculationCode=match[1];
      }

      const assertion=findAssertion();
      const apiRoot=location.origin+"/gestaoponto-backend/api";
      async function seniorGet(relative){
        const headers={Accept:"application/json"};
        if(assertion)headers.assertion=assertion;
        const response=await fetch(apiRoot+relative,{method:"GET",credentials:"include",cache:"no-store",headers});
        if(!response.ok){
          if(response.status===401||response.status===403){
            throw new Error("A sessão da Senior não autorizou a leitura. Atualize a página da Senior, confirme que está logada e tente novamente.");
          }
          throw new Error("Senior respondeu "+response.status+" ao consultar "+relative.split("?")[0]+".");
        }
        return response.json();
      }

      if(!seniorCompanyNumber)seniorCompanyNumber="1";
      if(!calculationCode){
        throw new Error("Não foi possível identificar a competência da Senior. Abra 'Acertos da minha equipe' e tente novamente.");
      }
      if(!periodStart||!periodEnd){
        throw new Error("Não foi possível identificar o período de apuração. Abra um colaborador ou a competência desejada na Senior e tente novamente.");
      }

      const list=[];
      for(let start=0;start<1000;start+=50){
        const params=new URLSearchParams({
          codigoCalculo:String(calculationCode),
          filtraPendenciaGestor:"N",
          filtroUsuario:"1",
          gestor:"S",
          limit:"51",
          start:String(start)
        });
        const page=await seniorGet("/empresas/"+encodeURIComponent(seniorCompanyNumber)+"/acerto-ponto-gestor/pendencias-colaboradores?"+params);
        const rows=Array.isArray(page)?page:Array.isArray(page?.content)?page.content:[];
        list.push(...rows.slice(0,50));
        if(rows.length<50)break;
      }

      const unique=[];
      const seen=new Set();
      for(const row of list){
        const id=clean(row?.colaborador?.id);
        if(!id||seen.has(id))continue;
        seen.add(id);
        unique.push(row);
      }
      if(!unique.length)throw new Error("A Senior não retornou colaboradores para a competência aberta.");

      let cursor=0;
      const details=new Array(unique.length);
      const workers=Array.from({length:Math.min(6,unique.length)},async()=>{
        while(true){
          const index=cursor++;
          if(index>=unique.length)break;
          const base=unique[index]?.colaborador||{};
          const id=clean(base.id);
          const params=new URLSearchParams({
            codigoCalculo:String(calculationCode),
            dataFinal:periodEnd,
            dataInicial:periodStart,
            gestor:"S",
            isTelaColaborador:"N",
            orderby:"dataApuracao"
          });
          const detail=await seniorGet("/acertoPontoColaboradorPeriodo/colaborador/"+encodeURIComponent(id)+"?"+params);
          details[index]={
            colaborador:{
              id:clean(detail?.colaborador?.id||id),
              nome:clean(detail?.colaborador?.nome||base.nome),
              numeroCadastro:Number(detail?.colaborador?.numeroCadastro??base.numeroCadastro),
              numeroEmpresa:Number(detail?.colaborador?.numeroEmpresa??base.numeroEmpresa??seniorCompanyNumber),
              tipoColaborador:Number(detail?.colaborador?.tipoColaborador??base.tipoColaborador??1)
            },
            apuracao:(Array.isArray(detail?.apuracao)?detail.apuracao:[]).map(day=>({
              dataApuracao:day?.dataApuracao,
              dataInicial:day?.dataInicial,
              escala:day?.escala?{codigo:day.escala.codigo,descricao:day.escala.descricao}:null,
              horario:day?.horario?{codigo:day.horario.codigo,descricao:day.horario.descricao,jornadaPelaEntrada:day.horario.jornadaPelaEntrada,tipo:day.horario.tipo}:null,
              marcacoes:(Array.isArray(day?.marcacoes)?day.marcacoes:[]).map(mark=>({
                horaAcesso:mark?.horaAcesso,
                dataAcesso:mark?.dataAcesso,
                dataApuracao:mark?.dataApuracao,
                origem:mark?.origem
              })),
              situacoesApuradas:(Array.isArray(day?.situacoesApuradas)?day.situacoesApuradas:[]).map(item=>({
                quantidadeHoras:item?.quantidadeHoras,
                situacao:item?.situacao?{codigo:item.situacao.codigo,descricao:item.situacao.descricao,id:item.situacao.id}:null
              })),
              incidentes:(Array.isArray(day?.incidentes)?day.incidentes:[]).map(item=>({
                codigo:item?.codigo,
                descricao:item?.descricao,
                dataApuracao:item?.dataApuracao,
                justificativaIncidente:item?.justificativaIncidente?{status:item.justificativaIncidente.status}:null
              })),
              historicos:{
                afastamentos:(Array.isArray(day?.historicos?.afastamentos)?day.historicos.afastamentos:[]).map(item=>({
                  dataInicial:item?.dataInicial,
                  dataFinal:item?.dataFinal,
                  horaInicial:item?.horaInicial,
                  horaFinal:item?.horaFinal,
                  situacao:item?.situacao?{codigo:item.situacao.codigo,id:item.situacao.id}:null
                }))
              }
            }))
          };
        }
      });
      await Promise.all(workers);

      return {
        ok:true,
        payload:{
          source:"SENIOR_BROWSER_READ_ONLY",
          seniorCompanyNumber:String(seniorCompanyNumber),
          calculationCode:String(calculationCode),
          periodStart,
          periodEnd,
          employees:details.filter(Boolean)
        }
      };
    }
  });

  const result=executed?.[0]?.result;
  if(!result)return {ok:false,error:"O Edge não conseguiu executar a leitura dentro da aba da Senior."};
  return result;
}