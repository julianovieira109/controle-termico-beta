"use strict";

function announce(){
  window.postMessage({type:"CT_SENIOR_CONNECTOR_READY",version:"1.0.0"},"*");
}
announce();

window.addEventListener("message",event=>{
  if(event.source!==window)return;
  const message=event.data||{};
  if(message.type==="CT_SENIOR_CONNECTOR_PING"){
    announce();
    return;
  }
  if(message.type!=="CT_SENIOR_COLLECT_REQUEST")return;
  const requestId=message.requestId;
  chrome.runtime.sendMessage({type:"CT_SENIOR_COLLECT"})
    .then(result=>{
      window.postMessage({type:"CT_SENIOR_COLLECT_RESULT",requestId,result},"*");
    })
    .catch(error=>{
      window.postMessage({
        type:"CT_SENIOR_COLLECT_RESULT",
        requestId,
        result:{ok:false,error:error?.message||"Falha ao acionar o conector Senior."}
      },"*");
    });
});