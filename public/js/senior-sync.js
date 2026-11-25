"use strict";

let seniorConnectorReady=false;
let seniorConnectorVersion="";
let seniorSyncPayload=null;
let seniorSyncRequest=null;
const seniorConnectorRequests=new Map();

function seniorSyncSetStatus(message,type=""){
  const el=$("senior-sync-status");
  if(!el)return;
  el.className=`feedback ${type||""}`;
  el.textContent=message||"";
}

function seniorSyncUpdateConnectorState(){
  const badge=$("senior-connector-state");
  if(!badge)return;
  const monitorReady=seniorConnectorReady&&["1.1.0","1.1.1","1.1.2","1.1.3"].includes(seniorConnectorVersion);
  badge.textContent=!seniorConnectorReady
    ?"Conector não detectado"
    :monitorReady?"Conector 24h detectado":"Atualização do conector necessária";
  badge.className=`point-import-badge ${monitorReady?"":"warning"}`;
}

function seniorSyncFillBranches(){
  const companyId=$("senior-sync-company")?.value||"";
  const select=$("senior-sync-branch");
  if(!select)return;
  const allowed=(branches||[]).filter(branch=>!companyId||String(branch.company_id)===String(companyId));
  select.innerHTML='<option value="">Selecione a filial</option>'+allowed
    .map(branch=>`<option value="${escapeHtml(branch.id)}">${escapeHtml(branch.name)}</option>`).join("");
  if(allowed.length===1)select.value=allowed[0].id;
  loadSeniorSyncHistory();
  loadSeniorMonitorConfig();
}

function seniorSyncFillCompanies(){
  const select=$("senior-sync-company");
  if(!select)return;
  select.innerHTML='<option value="">Selecione a empresa</option>'+(companies||[])
    .map(company=>`<option value="${escapeHtml(company.id)}">${escapeHtml(company.trade_name||company.legal_name)}</option>`).join("");
  if((companies||[]).length===1)select.value=companies[0].id;
  seniorSyncFillBranches();
}

function renderSeniorSyncPreview(result){
  const panel=$("senior-sync-preview");
  const summary=$("senior-sync-summary");
  const missing=$("senior-sync-missing");
  const confirm=$("senior-sync-confirm");
  if(!panel||!summary||!missing||!confirm)return;
  const item=result?.summary||{};
  panel.hidden=false;
  summary.innerHTML=[
    ["Colaboradores recebidos",item.employeesReceived||0],
    ["Localizados no sistema",item.employeesMatched||0],
    ["Não localizados",item.employeesMissing||0],
    ["Dias recebidos",item.daysReceived||0],
    ["Dias aptos ao repouso",item.eligibleDays||0],
    ["Dias para revisão",item.reviewDays||0]
  ].map(([label,value])=>`<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`).join("");

  const rows=item.missingEmployees||[];
  missing.innerHTML=rows.length
    ? `<div class="point-review-lock-note"><strong>Matrículas não localizadas (${rows.length})</strong><span>Esses vínculos não serão criados automaticamente. Regularize o cadastro e repita a sincronização quando necessário.</span></div>
       <div class="table-wrap"><table><thead><tr><th>Matrícula</th><th>Colaborador</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${escapeHtml(row.registration||"-")}</td><td>${escapeHtml(row.name||"-")}</td></tr>`).join("")}</tbody></table></div>`
    :"";
  confirm.disabled=!(item.employeesMatched>0);
  $("senior-sync-period").textContent=item.period?`${formatApiDate(item.period.start)} a ${formatApiDate(item.period.end)} · cálculo ${item.calculationCode||"-"}`:"";
}

async function loadSeniorSyncHistory(){
  const companyId=$("senior-sync-company")?.value||"";
  const branchId=$("senior-sync-branch")?.value||"";
  const box=$("senior-sync-history");
  if(!box)return;
  if(!companyId||!branchId){box.innerHTML="<p class=\"hint\">Selecione empresa e filial para consultar o histórico.</p>";return;}
  try{
    const data=await api(`/api/senior-sync/status?companyId=${encodeURIComponent(companyId)}&branchId=${encodeURIComponent(branchId)}`);
    const history=data.history||[];
    box.innerHTML=history.length
      ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Período</th><th>Colaboradores</th><th>Não localizados</th><th>Origem</th></tr></thead><tbody>${history.map(row=>{
          const period=row.details?.period||{};
          return `<tr><td>${escapeHtml(formatApiDate(row.created_at))}</td><td>${escapeHtml(period.start&&period.end?`${formatApiDate(period.start)} a ${formatApiDate(period.end)}`:"-")}</td><td>${escapeHtml(String(row.total_updated||0))}</td><td>${escapeHtml(String(row.total_not_found||0))}</td><td>Senior API · somente leitura</td></tr>`;
        }).join("")}</tbody></table></div>`
      :'<p class="hint">Ainda não há sincronizações diretas da Senior nesta filial.</p>';
  }catch(error){
    box.innerHTML=`<p class="feedback">${escapeHtml(error.message||"Não foi possível carregar o histórico.")}</p>`;
  }
}

function requestSeniorCollection(){
  return new Promise((resolve,reject)=>{
    const requestId=(crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`);
    const timer=setTimeout(()=>{
      if(seniorSyncRequest?.requestId===requestId)seniorSyncRequest=null;
      reject(new Error("O Conector Senior não respondeu. Instale/ative a extensão, atualize esta página e mantenha a Senior aberta e logada."));
    },90000);
    seniorSyncRequest={requestId,resolve:result=>{clearTimeout(timer);seniorSyncRequest=null;resolve(result);}};
    window.postMessage({type:"CT_SENIOR_COLLECT_REQUEST",requestId},"*");
  });
}

function requestSeniorConnectorMessage(requestType,resultType,payload={},timeoutMs=120000){
  return new Promise((resolve,reject)=>{
    const requestId=(crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`);
    const timer=setTimeout(()=>{
      seniorConnectorRequests.delete(requestId);
      reject(new Error("O Conector Senior não respondeu ao comando do monitor."));
    },timeoutMs);
    seniorConnectorRequests.set(requestId,{
      resultType,
      resolve:result=>{clearTimeout(timer);seniorConnectorRequests.delete(requestId);resolve(result);}
    });
    window.postMessage({type:requestType,requestId,...payload},"*");
  });
}

function monitorDateTime(value){
  if(!value)return "—";
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"—":date.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"});
}

function renderSeniorMonitor(serverData={},extensionData=null){
  const config=serverData?.config||{};
  const active=config.active===true;
  const last=config.last_summary||{};
  if($("senior-monitor-state")){
    $("senior-monitor-state").textContent=active
      ?(config.last_status==="ERROR"?"Falha de conexão":"Monitor 24h ativo")
      :"Monitor desativado";
  }
  if($("senior-monitor-last"))$("senior-monitor-last").textContent=monitorDateTime(config.last_run_at);
  if($("senior-monitor-next"))$("senior-monitor-next").textContent=extensionData?.nextRunAt
    ?monitorDateTime(extensionData.nextRunAt):active?"Aguardando conector":"—";
  if($("senior-monitor-new"))$("senior-monitor-new").textContent=String(last.newIssueCount||0);
  if($("senior-monitor-current"))$("senior-monitor-current").textContent=String(last.currentIssueCount||0);
  if($("senior-monitor-changed"))$("senior-monitor-changed").textContent=String(last.changedDayCount||0);
  if($("senior-monitor-error")){
    $("senior-monitor-error").textContent=config.last_error||"";
    $("senior-monitor-error").hidden=!config.last_error;
  }
  if($("senior-monitor-enable"))$("senior-monitor-enable").hidden=active;
  if($("senior-monitor-disable"))$("senior-monitor-disable").hidden=!active;
  if($("senior-monitor-run"))$("senior-monitor-run").disabled=!active;
  if($("senior-monitor-schedule"))$("senior-monitor-schedule").textContent=
    "00h · 02h · 04h · 06h · 08h · 10h · 12h · 14h · 16h · 18h · 20h · 22h";
}

async function loadSeniorMonitorConfig(){
  const companyId=$("senior-sync-company")?.value||"";
  const branchId=$("senior-sync-branch")?.value||"";
  if(!companyId||!branchId){
    renderSeniorMonitor({config:{active:false,last_summary:{}}});
    return;
  }
  try{
    const server=await api(`/api/senior-sync/monitor-config?companyId=${encodeURIComponent(companyId)}&branchId=${encodeURIComponent(branchId)}`);
    let extensionStatus=null;
    if(seniorConnectorReady&&["1.1.0","1.1.1","1.1.2","1.1.3"].includes(seniorConnectorVersion)){
      try{
        const ext=await requestSeniorConnectorMessage("CT_SENIOR_MONITOR_STATUS_REQUEST","CT_SENIOR_MONITOR_STATUS_RESULT",{},8000);
        if(ext?.ok)extensionStatus=ext.status;
      }catch{}
    }
    renderSeniorMonitor(server,extensionStatus);
  }catch(error){
    seniorSyncSetStatus(error.message||"Não foi possível consultar o monitor Senior.","error");
  }
}

async function setSeniorMonitor(active){
  const companyId=$("senior-sync-company")?.value||"";
  const branchId=$("senior-sync-branch")?.value||"";
  if(!companyId||!branchId){
    seniorSyncSetStatus("Selecione empresa e filial antes de configurar o monitor.","error");
    return;
  }
  if(active&&(!seniorConnectorReady||!["1.1.0","1.1.1","1.1.2","1.1.3"].includes(seniorConnectorVersion))){
    seniorSyncSetStatus("Atualize o Conector Senior para a versão 24h antes de ativar o monitor.","error");
    return;
  }
  const button=active?$("senior-monitor-enable"):$("senior-monitor-disable");
  try{
    setButtonLoading(button,true,active?"Ativando":"Desativando");
    const result=await api("/api/senior-sync/monitor-config",{
      method:"POST",
      body:JSON.stringify({companyId,branchId,active})
    });
    const ext=await requestSeniorConnectorMessage(
      "CT_SENIOR_MONITOR_CONFIG_REQUEST",
      "CT_SENIOR_MONITOR_CONFIG_RESULT",
      {config:{
        active,
        monitorToken:result.monitorToken||"",
        baseUrl:location.origin
      }},
      15000
    );
    if(!ext?.ok)throw new Error(ext?.error||"O Edge não confirmou a configuração do monitor.");
    seniorSyncSetStatus(result.message||"Configuração do monitor atualizada.","success");
    await loadSeniorMonitorConfig();
  }catch(error){
    if(active){
      try{
        await api("/api/senior-sync/monitor-config",{
          method:"POST",
          body:JSON.stringify({companyId,branchId,active:false})
        });
      }catch{}
    }
    seniorSyncSetStatus(error.message||"Não foi possível configurar o monitor Senior.","error");
  }finally{
    setButtonLoading(button,false);
  }
}

async function runSeniorMonitorNow(){
  const button=$("senior-monitor-run");
  try{
    setButtonLoading(button,true,"Verificando");
    seniorSyncSetStatus("Executando uma leitura automática agora...");
    const result=await requestSeniorConnectorMessage(
      "CT_SENIOR_MONITOR_RUN_REQUEST",
      "CT_SENIOR_MONITOR_RUN_RESULT",
      {},
      180000
    );
    if(!result?.ok)throw new Error(result?.error||"A verificação automática falhou.");
    seniorSyncSetStatus(`Monitor atualizado: ${result.server?.newIssues||0} nova(s) pendência(s) e ${result.server?.changedDays||0} dia(s) alterado(s).`,"success");
    await loadSeniorMonitorConfig();
    await loadSeniorSyncHistory();
    if(typeof refreshImportRelatedViews==="function")await refreshImportRelatedViews();
  }catch(error){
    seniorSyncSetStatus(error.message||"Falha na verificação automática.","error");
    await loadSeniorMonitorConfig();
  }finally{
    setButtonLoading(button,false);
  }
}


window.addEventListener("message",event=>{
  if(event.source!==window)return;
  const message=event.data||{};
  if(message.type==="CT_SENIOR_CONNECTOR_READY"){
    seniorConnectorReady=true;
    seniorConnectorVersion=String(message.version||"");
    seniorSyncUpdateConnectorState();
    const statusEl=$("senior-sync-status");
    if(statusEl&&/Atualize o Conector Senior para a versão 24h/i.test(statusEl.textContent||"")){
      seniorSyncSetStatus("Conector Senior 24h detectado e pronto para uso.","success");
    }
    loadSeniorMonitorConfig();
    return;
  }
  if(message.type==="CT_SENIOR_COLLECT_RESULT"&&seniorSyncRequest&&message.requestId===seniorSyncRequest.requestId){
    seniorSyncRequest.resolve(message.result||{ok:false,error:"Resposta vazia do conector."});
    return;
  }
  const pending=seniorConnectorRequests.get(message.requestId);
  if(pending&&message.type===pending.resultType){
    pending.resolve(message.result||{ok:false,error:"Resposta vazia do conector."});
  }
});

async function downloadSeniorConnector(){
  const button=$("senior-connector-download");
  try{
    setButtonLoading(button,true,"Preparando");
    const response=await fetch("/api/senior-sync/connector.zip",{
      headers:token?{Authorization:`Bearer ${token}`}:{}
    });
    if(!response.ok)throw new Error("Não foi possível baixar o Conector Senior.");
    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;
    link.download="Controle-Termico-Conector-Senior-Beta115.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
    seniorSyncSetStatus("Conector 24h baixado. Substitua/recarregue a extensão em edge://extensions e depois atualize esta página.","success");
  }catch(error){
    seniorSyncSetStatus(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
}

async function readSeniorAndPreview(){
  const companyId=$("senior-sync-company")?.value||"";
  const branchId=$("senior-sync-branch")?.value||"";
  if(!companyId||!branchId){
    seniorSyncSetStatus("Selecione a empresa e a filial antes da leitura.","error");
    return;
  }
  const button=$("senior-sync-read");
  seniorSyncPayload=null;
  $("senior-sync-preview").hidden=true;
  try{
    setButtonLoading(button,true,"Lendo Senior");
    seniorSyncSetStatus("Conectando à aba autenticada da Senior e coletando os colaboradores da competência aberta...");
    const result=await requestSeniorCollection();
    if(!result?.ok)throw new Error(result?.error||"A Senior não retornou os dados.");
    seniorSyncPayload=result.payload;
    seniorSyncSetStatus(`Leitura concluída no Edge. Conferindo ${result.payload?.employees?.length||0} colaborador(es) com o cadastro do Controle Térmico...`);
    const preview=await api("/api/senior-sync/preview",{
      method:"POST",
      body:JSON.stringify({companyId,branchId,payload:seniorSyncPayload})
    });
    renderSeniorSyncPreview(preview);
    seniorSyncSetStatus("Prévia pronta. Confira os números abaixo antes de confirmar a gravação.","success");
  }catch(error){
    seniorSyncSetStatus(error.message||"Falha na leitura da Senior.","error");
  }finally{
    setButtonLoading(button,false);
  }
}

async function confirmSeniorSync(){
  if(!seniorSyncPayload){
    seniorSyncSetStatus("Faça uma nova leitura da Senior antes de confirmar.","error");
    return;
  }
  const companyId=$("senior-sync-company")?.value||"";
  const branchId=$("senior-sync-branch")?.value||"";
  const confirmed=await confirmAction(
    "Confirmar a sincronização desta competência? O Controle Térmico substituirá somente os registros de ponto desse período para as matrículas localizadas. Nenhum dado será alterado na Senior.",
    "Confirmar sincronização Senior"
  );
  if(!confirmed)return;
  const button=$("senior-sync-confirm");
  try{
    setButtonLoading(button,true,"Gravando");
    seniorSyncSetStatus("Gravando no Controle Térmico os dados já conferidos...");
    const result=await api("/api/senior-sync/commit",{
      method:"POST",
      body:JSON.stringify({companyId,branchId,payload:seniorSyncPayload})
    });
    seniorSyncSetStatus(result.message||"Sincronização concluída.","success");
    seniorSyncPayload=null;
    $("senior-sync-preview").hidden=true;
    await loadSeniorSyncHistory();
    if(typeof refreshImportRelatedViews==="function")await refreshImportRelatedViews();
    toast("Dados da Senior sincronizados com sucesso.","success");
  }catch(error){
    seniorSyncSetStatus(error.message||"Não foi possível concluir a sincronização.","error");
    toast(error.message||"Falha na sincronização.","error");
  }finally{
    setButtonLoading(button,false);
  }
}

async function prepareSeniorSync(){
  seniorSyncFillCompanies();
  seniorSyncUpdateConnectorState();
  window.postMessage({type:"CT_SENIOR_CONNECTOR_PING"},"*");
  await loadSeniorSyncHistory();
  await loadSeniorMonitorConfig();
}

window.prepareSeniorSync=prepareSeniorSync;

if($("senior-sync-company"))$("senior-sync-company").onchange=seniorSyncFillBranches;
if($("senior-sync-branch"))$("senior-sync-branch").onchange=()=>{loadSeniorSyncHistory();loadSeniorMonitorConfig();};
if($("senior-connector-download"))$("senior-connector-download").onclick=downloadSeniorConnector;
if($("senior-sync-read"))$("senior-sync-read").onclick=readSeniorAndPreview;
if($("senior-sync-confirm"))$("senior-sync-confirm").onclick=confirmSeniorSync;

if($("senior-monitor-enable"))$("senior-monitor-enable").onclick=()=>setSeniorMonitor(true);
if($("senior-monitor-disable"))$("senior-monitor-disable").onclick=()=>setSeniorMonitor(false);
if($("senior-monitor-run"))$("senior-monitor-run").onclick=runSeniorMonitorNow;
