"use strict";

function announce(){
  window.postMessage({type:"CT_SENIOR_CONNECTOR_READY",version:"1.1.0"},"*");
}
announce();

async function forward(type,payload={}){
  try{
    return await chrome.runtime.sendMessage({type,...payload});
  }catch(error){
    return {ok:false,error:error?.message||"Falha ao acionar o Conector Senior."};
  }
}

window.addEventListener("message",event=>{
  if(event.source!==window)return;
  const message=event.data||{};
  if(message.type==="CT_SENIOR_CONNECTOR_PING"){
    announce();
    return;
  }

  const routes={
    CT_SENIOR_COLLECT_REQUEST:["CT_SENIOR_COLLECT","CT_SENIOR_COLLECT_RESULT"],
    CT_SENIOR_MONITOR_CONFIG_REQUEST:["CT_SENIOR_MONITOR_CONFIGURE","CT_SENIOR_MONITOR_CONFIG_RESULT"],
    CT_SENIOR_MONITOR_STATUS_REQUEST:["CT_SENIOR_MONITOR_STATUS","CT_SENIOR_MONITOR_STATUS_RESULT"],
    CT_SENIOR_MONITOR_RUN_REQUEST:["CT_SENIOR_MONITOR_RUN","CT_SENIOR_MONITOR_RUN_RESULT"]
  };
  const route=routes[message.type];
  if(!route)return;
  const [runtimeType,responseType]=route;
  forward(runtimeType,{config:message.config})
    .then(result=>window.postMessage({type:responseType,requestId:message.requestId,result},"*"));
});