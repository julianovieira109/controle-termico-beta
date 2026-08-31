function hasEffectivePermission(rule=""){
  const alternatives=String(rule||"").split("|").map(item=>item.trim()).filter(Boolean);
  if(!alternatives.length)return true;
  if(alternatives.includes("master"))return currentUser?.isMasterAdmin===true;
  if(currentUser?.role==="ADMIN")return true;
  if(alternatives.includes("admin"))return false;
  return alternatives.some(permission=>currentUser?.permissions?.[permission]===true);
}

function applyHelpScope(){
  document.querySelectorAll("[data-help-permission]").forEach(element=>{
    const allowed=hasEffectivePermission(element.dataset.helpPermission);
    element.dataset.helpAllowed=allowed?"true":"false";
    element.hidden=!allowed;
  });
  const scope=$("manual-profile-scope");
  if(scope){
    scope.textContent=currentUser?.isMasterAdmin===true
      ?"Manual completo do Administrador Master."
      :currentUser?.role==="ADMIN"
      ?"Manual adaptado ao perfil Administrador. Funções exclusivas do Master permanecem protegidas."
      :`Manual adaptado ao perfil ${currentUser?.profileName||"do usuário"}.`;
  }
}

function prepareManual(){
  applyHelpScope();
  const search=$("manual-search");
  if(search && !search.dataset.ready){
    search.dataset.ready="true";
    search.addEventListener("input",filterManualChapters);
  }
}

function normalizeManualText(value=""){
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
}

function filterManualChapters(){
  const term=normalizeManualText($("manual-search")?.value);
  let visible=0;
  document.querySelectorAll(".manual-chapter").forEach(chapter=>{
    const allowed=chapter.dataset.helpAllowed!=="false";
    const searchable=normalizeManualText(`${chapter.dataset.manualKeywords||""} ${chapter.textContent||""}`);
    const matches=allowed&&(!term||searchable.includes(term));
    chapter.hidden=!matches;
    if(matches){
      visible+=1;
      if(term)chapter.open=true;
    }
  });
  if($("manual-no-results"))$("manual-no-results").hidden=visible!==0;
}

const helpTopics=[
  {id:"access",label:"Entrar, senha e menu",permission:"",view:"manual",chapter:"manual-access",answer:"Para entrar, informe o e-mail e a senha cadastrados. Use “Minha senha” para trocar a própria senha. Se esquecer, escolha “Esqueci minha senha”, solicite o código enviado por e-mail e crie uma nova senha. O WhatsApp e o Administrador Master continuam disponíveis como alternativas."},
  {id:"dashboard",label:"Entender o Painel",permission:"dashboard.view",view:"dashboard",chapter:"manual-dashboard",answer:"O Painel mostra os totais e alertas dentro do seu acesso. Se aparecer colaborador sem turno, abra a lista indicada e regularize antes de gerar fichas."},
  {id:"employee_new",label:"Cadastrar colaborador",permission:"employees.manage",view:"employees",chapter:"manual-employees",answer:"Abra Colaboradores, clique em “+ Novo colaborador”, selecione empresa e filial, preencha matrícula, nome, admissão, cargo, turno e situação, confira a regra de ficha e salve."},
  {id:"employee_find",label:"Pesquisar ou corrigir colaborador",permission:"employees.view",view:"employees",chapter:"manual-employees",answer:"Abra Colaboradores e pesquise pelo nome ou matrícula. Use as abas Ativos, Demitidos, Afastados/Inativos ou Todos. A edição somente aparecerá se o perfil tiver permissão para alterar cadastros."},
  {id:"import",label:"Importar PDF da Senior",permission:"imports.manage",view:"employees",chapter:"manual-import",answer:"Abra Colaboradores → Importar PDFs da Senior, selecione o arquivo e clique em “Ler e conferir PDF”. Confira registros montados, não reconhecidos e o checklist. Confirme somente quando os dados estiverem corretos."},
  {id:"shifts",label:"Atualizar turnos",permission:"settings.view|imports.manage",view:"employees",chapter:"manual-shifts",answer:"Para atualizar por PDF, abra Colaboradores → Atualizar turnos, leia o arquivo e confira matrícula, código e horários. Para cadastro manual de turno, use Configurações quando essa área estiver liberada."},
  {id:"reports",label:"Gerar e imprimir fichas",permission:"reports.view",view:"reports",chapter:"manual-reports",answer:"Abra Relatórios, selecione empresa, filial, colaborador ou todos, turno se desejar e mês. Clique em “Gerar ficha”. O Repouso Térmico automático usa o Cartão de Ponto confirmado da competência. A ficha de Refeição mantém a assinatura manual, mas apresenta DSR, faltas, férias, atestados, folgas e demais ausências identificadas no ponto."},
  {id:"missing_report",label:"Colaborador não aparece ou não gera ficha",permission:"reports.view",view:"reports",chapter:"manual-reports",answer:"Confira se o colaborador está Ativo, pertence à empresa e filial selecionadas e estava admitido no mês. Se ele aparece mas não gera ficha, confira turno e a regra do cargo/função. Regras Pendentes ou “Não gerar” bloqueiam a ficha."},
  {id:"calendar",label:"Feriados e folgas",permission:"calendar.manage",view:"settings",chapter:"manual-settings",answer:"Abra Configurações → Feriados e folgas. Escolha o ano, gere os feriados e cadastre ajustes ou folgas individuais. Essas informações serão refletidas nas fichas."},
  {id:"settings",label:"Configurar cargos e o sistema",permission:"settings.view",view:"settings",chapter:"manual-settings",answer:"Abra Configurações e escolha a área disponível no seu perfil. Cargos novos importados ficam Pendentes até que a regra de relatórios seja conferida."},
  {id:"companies",label:"Empresas e filiais",permission:"admin",view:"companies",chapter:"manual-companies",answer:"Abra Empresas para cadastrar ou editar a empresa e suas filiais. Confira CNPJ, código interno e vínculos antes de inativar qualquer registro."},
  {id:"users",label:"Usuários e perfis",permission:"admin",view:"users",chapter:"manual-users",answer:"Abra Usuários para cadastrar acessos e vincular filiais. Em Configurações → Perfis de usuário, libere somente as funções necessárias. O conteúdo de ajuda seguirá essas permissões."},
  {id:"safety",label:"Duplicidade, readmissão ou erro",permission:"",view:"manual",chapter:"manual-safety",answer:"Compare sempre as matrículas. Matrículas diferentes podem indicar readmissão; matrícula igual pode ser duplicidade. Não exclua histórico válido e não confirme importações incompletas."}
];

let activeHelpTopic=null;
let activeHelpCategory=null;

const helpCategories=[
  {id:"overview",label:"Painel, acesso e segurança",topics:["access","dashboard","safety"]},
  {id:"employees",label:"Colaboradores",topics:["employee_new","employee_find"]},
  {id:"imports",label:"Importação Senior e turnos",topics:["import","shifts"]},
  {id:"reports",label:"Relatórios e fichas",topics:["reports","missing_report"]},
  {id:"settings",label:"Configurações e calendário",topics:["calendar","settings"]},
  {id:"admin",label:"Administração do sistema",topics:["companies","users"]}
];

function allowedHelpTopics(){
  return helpTopics.filter(topic=>hasEffectivePermission(topic.permission));
}

function appendHelpMessage(text,type="bot"){
  const message=document.createElement("div");
  message.className=`help-message ${type}`;
  message.textContent=text;
  $("help-conversation").appendChild(message);
  $("help-conversation").scrollTop=$("help-conversation").scrollHeight;
}

function renderHelpStart(resetConversation=true){
  activeHelpTopic=null;
  activeHelpCategory=null;
  if(resetConversation){
    $("help-conversation").innerHTML="";
    appendHelpMessage(currentUser?.isMasterAdmin===true
      ?"Olá! Você está no suporte completo do Administrador Master. Em que posso ajudar?"
      :currentUser?.role==="ADMIN"
      ?"Olá! Preparei a ajuda para o perfil Administrador, respeitando as proteções do Master. Em que posso ajudar?"
      :`Olá! Preparei a ajuda de acordo com o perfil ${currentUser?.profileName||"do seu usuário"}. Em que posso ajudar?`);
  }
  const options=$("help-options");
  options.innerHTML="";
  const allowedIds=new Set(allowedHelpTopics().map(topic=>topic.id));
  helpCategories.filter(category=>category.topics.some(topicId=>allowedIds.has(topicId))).forEach(category=>{
    const button=document.createElement("button");
    button.type="button";
    button.className="help-option";
    button.textContent=category.label;
    button.onclick=()=>openHelpCategory(category.id,true);
    options.appendChild(button);
  });
  $("help-back").hidden=true;
  $("help-whatsapp").hidden=true;
}

function openHelpCategory(categoryId,addMessage=false){
  const allowedById=new Map(allowedHelpTopics().map(topic=>[topic.id,topic]));
  const category=helpCategories.find(item=>item.id===categoryId);
  if(!category)return;
  const topics=category.topics.map(topicId=>allowedById.get(topicId)).filter(Boolean);
  if(!topics.length)return;
  activeHelpCategory=category;
  activeHelpTopic=null;
  if(addMessage){
    appendHelpMessage(category.label,"user");
    appendHelpMessage("Certo. Qual é a sua dúvida nesse assunto?");
  }
  const options=$("help-options");
  options.innerHTML="";
  topics.forEach(topic=>{
    const button=document.createElement("button");
    button.type="button";
    button.className="help-option";
    button.textContent=topic.label;
    button.onclick=()=>openHelpTopic(topic.id);
    options.appendChild(button);
  });
  $("help-back").hidden=false;
  $("help-whatsapp").hidden=true;
}

function openHelpTopic(topicId){
  const topic=allowedHelpTopics().find(item=>item.id===topicId);
  if(!topic)return;
  activeHelpTopic=topic;
  appendHelpMessage(topic.label,"user");
  appendHelpMessage(topic.answer);
  const options=$("help-options");
  options.innerHTML="";
  const actions=[
    ["Ir para essa tela",()=>navigate(topic.view)],
    ["Ver no Manual",()=>{navigate("manual");setTimeout(()=>$(topic.chapter)?.scrollIntoView({behavior:"smooth",block:"start"}),50);}],
    ["Minha dúvida foi resolvida",()=>{appendHelpMessage("Que bom! Se precisar, escolha outro assunto.");renderHelpStart(false);}],
    ["Ainda preciso de ajuda",()=>showHelpContact(topic)]
  ];
  actions.forEach(([label,handler])=>{
    const button=document.createElement("button");
    button.type="button";
    button.className="help-option";
    button.textContent=label;
    button.onclick=handler;
    options.appendChild(button);
  });
  $("help-back").hidden=false;
}

function showHelpContact(topic=activeHelpTopic){
  appendHelpMessage("Se a orientação não resolveu, escolha um dos canais de suporte disponíveis. Revise a mensagem antes de enviar.");
  if(visualSettings?.supportHours)appendHelpMessage(`Horário informado: ${visualSettings.supportHours}.`);
  $("help-options").innerHTML="";
  const whatsapp=String(visualSettings?.supportWhatsapp||"").replace(/\D/g,"");
  const email=String(visualSettings?.supportEmail||"").trim();
  $("help-whatsapp").hidden=!whatsapp;
  $("help-email").hidden=!email;
  if(!whatsapp&&!email){
    appendHelpMessage("O Administrador ainda não cadastrou WhatsApp ou e-mail de suporte. Consulte o responsável pelo sistema.");
  }
  $("help-back").hidden=false;
}

async function loadSupportUserContext(){
  if(!currentUser||!token)return;
  const identity=await api("/api/auth/me");
  currentUser={
    ...currentUser,
    companyName:identity?.company_name||null,
    branchNames:Array.isArray(identity?.branch_names)?identity.branch_names.filter(Boolean):[]
  };
  sessionStorage.setItem("user",JSON.stringify(currentUser));
}

function supportAccessIdentity(){
  const isAdmin=currentUser?.role==="ADMIN";
  const companyFromCache=companies.find(company=>String(company.id)===String(currentUser?.companyId));
  const company=currentUser?.companyName||companyFromCache?.trade_name||companyFromCache?.legal_name||
    (isAdmin?"Acesso administrativo geral":"Não identificada");
  const cachedBranches=Array.isArray(currentUser?.branchNames)?currentUser.branchNames.filter(Boolean):[];
  const branchIds=new Set((currentUser?.branchIds||[]).map(String));
  const branchesFromCache=branches
    .filter(branch=>branchIds.has(String(branch.id)))
    .map(branch=>branch.name)
    .filter(Boolean);
  const branchNames=cachedBranches.length?cachedBranches:branchesFromCache;
  return {
    company,
    branches:isAdmin?"Todas as filiais":(branchNames.join(", ")||"Não identificada")
  };
}

function supportSelectionPath(channel="WhatsApp"){
  return [
    activeHelpCategory?.label,
    activeHelpTopic?.label,
    "Ainda preciso de ajuda",
    channel==="E-mail"?"Enviar e-mail ao suporte":"Falar pelo WhatsApp"
  ].filter(Boolean);
}

function supportRequestDetails(channel="WhatsApp"){
  const profile=currentUser?.profileName||(currentUser?.role==="ADMIN"?"Administrador":currentUser?.role||"Usuário");
  const access=supportAccessIdentity();
  const selection=supportSelectionPath(channel);
  return {
    subject:`Ajuda no Controle Térmico — ${activeHelpTopic?.label||"Dúvida no sistema"}`,
    message:[
      `Olá${visualSettings?.supportName?`, ${visualSettings.supportName}`:""}! Meu nome é ${currentUser?.name||"Usuário"} e preciso de suporte no Controle Térmico.`,
      "",
      "Dados do acesso:",
      `Usuário: ${currentUser?.name||"Não identificado"}`,
      `Perfil: ${profile}`,
      `Empresa: ${access.company}`,
      `Filial: ${access.branches}`,
      "",
      "Opções selecionadas no Assistente:",
      ...selection.map((label,index)=>`${index+1}. ${label}`),
      "",
      `Assunto: ${activeHelpTopic?.label||"Dúvida no sistema"}`,
      `Versão: V1.0.24 Beta`,
      "",
      "Descreva aqui o que aconteceu: "
    ].join("\n")
  };
}

function prepareHelpAssistant(){
  if(!$("help-conversation").children.length)renderHelpStart(true);
}

const HELP_WIDGET_POSITION_KEY="controle_termico_help_position";
let helpDragState=null;

function helpWidgetCanDrag(){
  return window.innerWidth>650;
}

function clampHelpWidgetPosition(left,top){
  const widget=$("help");
  const margin=8;
  const width=widget?.offsetWidth||410;
  const height=widget?.offsetHeight||650;
  return {
    left:Math.min(Math.max(margin,left),Math.max(margin,window.innerWidth-width-margin)),
    top:Math.min(Math.max(margin,top),Math.max(margin,window.innerHeight-height-margin))
  };
}

function applyHelpWidgetPosition(position){
  const widget=$("help");
  if(!widget)return;
  if(!helpWidgetCanDrag()){
    widget.style.removeProperty("left");
    widget.style.removeProperty("top");
    widget.style.removeProperty("right");
    widget.style.removeProperty("bottom");
    return;
  }
  const left=Number(position?.left);
  const top=Number(position?.top);
  const next=clampHelpWidgetPosition(Number.isFinite(left)?left:20,Number.isFinite(top)?top:16);
  widget.style.left=`${next.left}px`;
  widget.style.top=`${next.top}px`;
  widget.style.right="auto";
  widget.style.bottom="auto";
}

function restoreHelpWidgetPosition(){
  if(!helpWidgetCanDrag())return applyHelpWidgetPosition(null);
  try{
    const saved=JSON.parse(localStorage.getItem(HELP_WIDGET_POSITION_KEY)||"null");
    if(Number.isFinite(saved?.left)&&Number.isFinite(saved?.top))applyHelpWidgetPosition(saved);
  }catch(error){}
}

function saveHelpWidgetPosition(){
  const widget=$("help");
  if(!widget||!helpWidgetCanDrag())return;
  const rect=widget.getBoundingClientRect();
  try{
    localStorage.setItem(HELP_WIDGET_POSITION_KEY,JSON.stringify({left:Math.round(rect.left),top:Math.round(rect.top)}));
  }catch(error){}
}

function openHelpWidget(){
  const widget=$("help");
  if(!widget)return;
  prepareHelpAssistant();
  widget.hidden=false;
  widget.classList.add("open");
  $("help-floating-launcher")?.classList.add("active");
  $("help-floating-launcher")?.setAttribute("aria-label","Fechar Assistente Virtual");
  restoreHelpWidgetPosition();
}

function closeHelpWidget(){
  const widget=$("help");
  if(!widget)return;
  widget.classList.remove("open");
  widget.hidden=true;
  $("help-floating-launcher")?.classList.remove("active");
  $("help-floating-launcher")?.setAttribute("aria-label","Abrir Assistente Virtual");
}

function toggleHelpWidget(){
  if($("help")?.hidden)openHelpWidget();
  else closeHelpWidget();
}

if($("help-floating-launcher"))$("help-floating-launcher").onclick=toggleHelpWidget;
if($("help-close"))$("help-close").onclick=closeHelpWidget;

const helpDragHandle=$("help-drag-handle");
if(helpDragHandle){
  helpDragHandle.addEventListener("pointerdown",event=>{
    if(!helpWidgetCanDrag()||event.button!==0||event.target.closest("button"))return;
    const widget=$("help");
    const rect=widget.getBoundingClientRect();
    helpDragState={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,left:rect.left,top:rect.top};
    widget.classList.add("dragging");
    widget.style.left=`${rect.left}px`;
    widget.style.top=`${rect.top}px`;
    widget.style.right="auto";
    widget.style.bottom="auto";
    helpDragHandle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  helpDragHandle.addEventListener("pointermove",event=>{
    if(!helpDragState||helpDragState.pointerId!==event.pointerId)return;
    const next=clampHelpWidgetPosition(
      helpDragState.left+event.clientX-helpDragState.startX,
      helpDragState.top+event.clientY-helpDragState.startY
    );
    $("help").style.left=`${next.left}px`;
    $("help").style.top=`${next.top}px`;
    event.preventDefault();
  });
  const finishHelpDrag=event=>{
    if(!helpDragState||helpDragState.pointerId!==event.pointerId)return;
    helpDragHandle.releasePointerCapture?.(event.pointerId);
    helpDragState=null;
    $("help")?.classList.remove("dragging");
    saveHelpWidgetPosition();
  };
  helpDragHandle.addEventListener("pointerup",finishHelpDrag);
  helpDragHandle.addEventListener("pointercancel",finishHelpDrag);
}

window.addEventListener("resize",()=>{
  if(!$("help")?.hidden){
    if(helpWidgetCanDrag())restoreHelpWidgetPosition();
    else applyHelpWidgetPosition(null);
  }
});

document.addEventListener("keydown",event=>{
  if(event.key==="Escape"&&!$("help")?.hidden)closeHelpWidget();
});

if($("help-restart"))$("help-restart").onclick=()=>renderHelpStart(true);
if($("help-back"))$("help-back").onclick=()=>{
  if(activeHelpTopic&&activeHelpCategory)openHelpCategory(activeHelpCategory.id,false);
  else renderHelpStart(false);
};
if($("help-whatsapp"))$("help-whatsapp").onclick=()=>{
  let whatsapp=String(visualSettings?.supportWhatsapp||"").replace(/\D/g,"");
  if(whatsapp.length===10||whatsapp.length===11)whatsapp=`55${whatsapp}`;
  if(!whatsapp){toast("WhatsApp de suporte não configurado.","warning");return;}
  const {message}=supportRequestDetails("WhatsApp");
  window.open(`https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`,"_blank","noopener,noreferrer");
};

if($("help-email"))$("help-email").onclick=()=>{
  const email=String(visualSettings?.supportEmail||"").trim().replace(/[\r\n?&#]/g,"");
  if(!email){toast("E-mail de suporte não configurado.","warning");return;}
  const {subject,message}=supportRequestDetails("E-mail");
  window.location.href=`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
};

if($("manual-expand-all")){
  $("manual-expand-all").onclick=()=>{
    const visibleChapters=Array.from(document.querySelectorAll(".manual-chapter:not([hidden])"));
    const shouldOpen=visibleChapters.some(chapter=>!chapter.open);
    visibleChapters.forEach(chapter=>chapter.open=shouldOpen);
    $("manual-expand-all").textContent=shouldOpen?"Fechar todos":"Abrir todos";
  };
}

function prepareManualForPrint(){
  document.querySelectorAll(".manual-chapter:not([hidden])").forEach(chapter=>chapter.open=true);
  document.body.classList.add("printing-manual");
}

function finishManualPrint(){
  document.body.classList.remove("printing-manual");
}

function escapeManualPrintHtml(value=""){
  return String(value)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

window.addEventListener("beforeprint",()=>{
  if($("manual")?.classList.contains("active"))prepareManualForPrint();
});
window.addEventListener("afterprint",finishManualPrint);

if($("manual-print")){
  $("manual-print").onclick=()=>{
    const printWindow=window.open("","_blank","width=1100,height=820");
    if(!printWindow){
      toast("O navegador bloqueou a janela de impressão. Permita pop-ups para este sistema.","error");
      return;
    }

    const source=$("manual-content").cloneNode(true);
    source.querySelector("#manual-no-results")?.remove();
    source.querySelectorAll(".manual-chapter[hidden]").forEach(chapter=>chapter.remove());
    source.querySelectorAll(".manual-chapter").forEach(chapter=>{
      chapter.open=true;
      chapter.removeAttribute("hidden");
    });

    const title=visualSettings?.systemName||"Controle Térmico";
    const printedAt=new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(new Date());
    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
      <html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Manual do Sistema — ${escapeManualPrintHtml(title)}</title>
      <style>
        @page{size:A4 portrait;margin:12mm}
        *{box-sizing:border-box}body{margin:0;background:#fff;color:#1f2937;font-family:Arial,sans-serif;font-size:12px;line-height:1.45}
        .print-actions{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 18px;background:#0e3554;color:#fff}
        .print-actions button{border:0;border-radius:8px;padding:9px 15px;background:#fff;color:#0e3554;font-weight:800;cursor:pointer}
        .print-cover{padding:24px;margin-bottom:12px;border-radius:14px;background:#0e3554;color:#fff}.print-cover h1{margin:0 0 6px;font-size:25px}.print-cover p{margin:0;color:#e6f1f8}
        .manual-content{display:block}.manual-no-results{display:none!important}.manual-chapter{display:block!important;margin:0 0 12px;border:1px solid #cfd8df;border-radius:11px;overflow:hidden;break-inside:auto;box-shadow:none}
        .manual-chapter summary{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#f4f8fb;border-bottom:1px solid #d9e0e7;list-style:none}.manual-chapter summary::-webkit-details-marker{display:none}.manual-chapter summary::after{display:none!important}
        .manual-chapter summary>span:last-child{display:grid;gap:2px}.manual-chapter summary strong{font-size:15px;color:#173a55}.manual-chapter summary small{color:#5f6b75}
        .manual-number{display:grid;place-items:center;min-width:30px;height:30px;border-radius:8px;background:#dcebf5;color:#154c79;font-weight:900}
        .manual-body{display:block!important;padding:13px 15px}.manual-body h4{margin:12px 0 4px;color:#0e3554}.manual-body p{margin:4px 0 8px}.manual-body li{margin-bottom:3px}
        .manual-note{margin-top:9px;padding:9px 11px;border-radius:7px;border-left:4px solid}.manual-note.info{background:#edf7ff;border-color:#1976a8}.manual-note.warning{background:#fff8e7;border-color:#d28b00}.manual-note.danger{background:#fff0f0;border-color:#bd2c2c}
        .manual-illustration,.manual-flow,.manual-mini-dashboard,.manual-permission-illustration,.manual-status-grid,.manual-import-types,.manual-settings-grid,.manual-record-card,.manual-shift-clock,.manual-report-preview,.manual-checklist{margin:0 0 10px;padding:11px;border:1px solid #d9e0e7;border-radius:8px;background:#f8fafc}
        .illustration-window{width:260px;max-width:100%;margin:auto;display:grid;gap:5px;padding:10px;background:#fff;border:1px solid #d9e0e7}.illustration-logo{display:grid;place-items:center;width:34px;height:34px;margin:auto;border-radius:8px;background:#0e3554;color:#fff;font-weight:900}.illustration-window i,.illustration-window b{padding:5px;border:1px solid #d9e0e7;font-style:normal}.illustration-window b{background:#154c79;color:#fff;text-align:center}
        .manual-flow,.manual-shift-clock{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap}.manual-flow span{padding:6px 9px;border:1px solid #bfcfd9;border-radius:6px;background:#fff;font-weight:800}.manual-flow i{font-style:normal}
        .manual-mini-dashboard,.manual-permission-illustration,.manual-status-grid,.manual-import-types,.manual-settings-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.manual-mini-dashboard span,.manual-permission-illustration span,.manual-status-grid span,.manual-import-types article,.manual-settings-grid article{display:grid;gap:2px;padding:7px;border:1px solid #d9e0e7;border-radius:6px;background:#fff}.manual-mini-dashboard b{font-size:18px}.manual-import-types span,.manual-settings-grid span{color:#5f6b75;font-size:10px}
        .manual-record-card{position:relative;display:grid}.manual-record-card span{color:#5f6b75}.manual-record-card em{position:absolute;right:10px;top:10px;color:#137333;font-weight:900;font-style:normal}.manual-shift-clock{background:#0e3554;color:#fff}.manual-shift-clock i{width:24px;height:2px;background:#79b6dd}
        .manual-report-preview{text-align:center}.manual-report-preview>*{display:block}.manual-report-preview i{height:14px;margin-top:4px;border:1px solid #aab3ba}.manual-checklist{display:grid;gap:3px;background:#edf8f1}.manual-checklist label{display:block}.manual-status-grid{grid-template-columns:repeat(4,1fr)}
        .print-footer{margin-top:14px;padding-top:8px;border-top:1px solid #d9e0e7;color:#6b7280;text-align:center;font-size:10px}
        @media print{.print-actions{display:none!important}.print-cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}.manual-chapter{break-inside:avoid}.manual-note,.manual-shift-clock{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style></head><body>
      <div class="print-actions"><strong>Pré-visualização do Manual</strong><button id="manual-print-action" type="button">Imprimir</button></div>
      <header class="print-cover"><h1>Manual do Sistema</h1><p>${escapeManualPrintHtml(title)} — instruções completas de utilização</p></header>
      ${source.outerHTML}
      <footer class="print-footer">Manual gerado em ${escapeManualPrintHtml(printedAt)}</footer>
      </body></html>`);
    printWindow.document.close();
  const manualPrintButton=printWindow.document.getElementById("manual-print-action");
  if(manualPrintButton)manualPrintButton.onclick=()=>printWindow.print();
    printWindow.focus();
    setTimeout(()=>printWindow.print(),350);
  };
}
