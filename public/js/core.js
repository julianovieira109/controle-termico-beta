const $=id=>document.getElementById(id);

function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,character=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[character]);
}

function toast(message,type="info",title=""){
  const container=$("toast-container");
  const icons={success:"✓",error:"×",warning:"!",info:"i"};
  const labels={success:"Sucesso",error:"Erro",warning:"Atenção",info:"Informação"};
  const element=document.createElement("div");
  element.className=`toast ${type}`;
  element.innerHTML=`
    <span class="toast-icon">${icons[type]||"i"}</span>
    <div class="toast-content">
      <strong>${title||labels[type]||"Informação"}</strong>
      <p>${message}</p>
    </div>`;
  const supportHref=(type==="error"||type==="warning")&&/suporte/i.test(String(message||""))
    ? configuredSupportWhatsappHref(message)
    : "";
  if(supportHref){
    const link=document.createElement("a");
    link.className="toast-support-link";
    link.href=supportHref;
    link.target="_blank";
    link.rel="noopener noreferrer";
    link.textContent="Falar com o Suporte pelo WhatsApp";
    element.querySelector(".toast-content")?.appendChild(link);
  }
  container.appendChild(element);
  setTimeout(()=>{
    element.classList.add("leaving");
    setTimeout(()=>element.remove(),220);
  },supportHref?10000:3600);
}

function configuredSupportWhatsappHref(systemMessage=""){
  let whatsapp=String(visualSettings?.supportWhatsapp||"").replace(/\D/g,"");
  if(whatsapp.length===10||whatsapp.length===11)whatsapp=`55${whatsapp}`;
  if(!whatsapp)return "";
  const user=typeof currentUser!=="undefined"&&currentUser?currentUser:null;
  const message=[
    `Olá${visualSettings?.supportName?`, ${visualSettings.supportName}`:""}! Preciso de suporte no Controle Térmico.`,
    `Usuário: ${user?.name||"Não identificado"}`,
    `Perfil: ${user?.profileName||(user?.role==="ADMIN"?"Administrador":user?.role||"Não identificado")}`,
    `Versão: V1.0.26 Beta`,
    `Aviso apresentado: ${String(systemMessage||"Não informado").trim()}`,
    "Descreva aqui a alteração necessária: "
  ].join("\n");
  return `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`;
}

function setButtonLoading(button,loading,text=""){
  if(!button)return;
  if(loading){
    button.dataset.originalText=button.textContent;
    button.classList.add("is-loading");
    button.disabled=true;
    if(text)button.setAttribute("aria-label",text);
  }else{
    button.classList.remove("is-loading");
    button.disabled=false;
    button.removeAttribute("aria-label");
  }
}

function showLoading(text="Carregando..."){
  $("global-loading-text").textContent=text;
  $("global-loading").hidden=false;
}
function hideLoading(){
  $("global-loading").hidden=true;
}

function confirmAction(message,title="Confirmar ação"){
  return new Promise(resolve=>{
    $("confirm-modal-title").textContent=title;
    $("confirm-modal-message").textContent=message;
    $("confirm-modal").hidden=false;

    const finish=value=>{
      $("confirm-modal").hidden=true;
      $("confirm-modal-ok").onclick=null;
      $("confirm-modal-cancel").onclick=null;
      resolve(value);
    };

    $("confirm-modal-ok").onclick=()=>finish(true);
    $("confirm-modal-cancel").onclick=()=>finish(false);
  });
}
let token=sessionStorage.getItem("token");
let currentUser=JSON.parse(sessionStorage.getItem("user")||"null");
let companies=[],branches=[],users=[],userProfiles=[],catalogs={shifts:[],job_roles:[],departments:[]};
let jobReportPolicies=[];

document.querySelectorAll("[data-password-eye]").forEach(button=>{
  const selector=button.dataset.passwordEye;
  const input=document.querySelector(selector);
  if(!input)return;

  button.onclick=()=>{
    const visible=input.type==="text";
    input.type=visible?"password":"text";

    const openIcon=button.querySelector(".eye-open");
    const closedIcon=button.querySelector(".eye-closed");

    if(openIcon)openIcon.hidden=!visible;
    if(closedIcon)closedIcon.hidden=visible;

    const label=visible?"Mostrar senha":"Ocultar senha";
    button.setAttribute("aria-label",label);
    button.setAttribute("title",label);
  };
});

let employeeRows=[];
let employeeStatusView="ATIVO";
let companyBranchHierarchy=[];
let selectedCompanyId=null;
let companySort={key:"trade_name",direction:1};
let branchSort={key:"name",direction:1};
let pdfImportPreview=null;
let pdfComparisonChecklist=null;
let unknownSeniorCodes=[];
let visualSettings=window.__controleTermicoVisualCache
  ? {...window.__controleTermicoVisualCache}
  : {};
const VISUAL_CACHE_KEY="controleTermicoVisual";

function readVisualCache(){
  try{
    const cached=localStorage.getItem(VISUAL_CACHE_KEY);
    return cached?JSON.parse(cached):null;
  }catch{return null;}
}

function persistVisualCache(raw={}){
  const {
    supportName:_supportName,supportWhatsapp:_supportWhatsapp,
    supportEmail:_supportEmail,supportHours:_supportHours,
    supportPasswordHelp:_supportPasswordHelp,...visualOnly
  }=raw;
  // Se faltar espaço, preserva primeiro cores, textos, tema e fonte.
  const attempts=[
    visualOnly,
    {...visualOnly,reportLogoData:""},
    {...visualOnly,reportLogoData:"",loginBackgroundData:""},
    {...visualOnly,reportLogoData:"",loginBackgroundData:"",menuLogoData:""},
    {...visualOnly,reportLogoData:"",loginBackgroundData:"",menuLogoData:"",logoData:"",faviconData:""}
  ];
  for(const value of attempts){
    try{
      localStorage.setItem(VISUAL_CACHE_KEY,JSON.stringify(value));
      return true;
    }catch{}
  }
  return false;
}

async function api(path,options={}){
  const response=await fetch(path,{
    ...options,
    headers:{
      "Content-Type":"application/json",
      ...(token?{Authorization:`Bearer ${token}`}:{})
    }
  });

  if(response.status===204)return null;

  const contentType=response.headers.get("content-type")||"";
  const raw=await response.text();
  let data=null;

  if(raw){
    if(contentType.includes("application/json")){
      try{
        data=JSON.parse(raw);
      }catch{
        throw new Error("O servidor retornou uma resposta JSON inválida.");
      }
    }else{
      const looksLikeHtml=raw.trim().startsWith("<");
      if(looksLikeHtml){
        throw new Error("A rota solicitada não foi encontrada no servidor. Atualize o deploy e tente novamente.");
      }
      data={error:raw};
    }
  }

  if(!response.ok){
    const message=data?.detail
      ? `${data?.error||`Erro ${response.status} na operação.`} ${data.detail}`
      : (data?.error||`Erro ${response.status} na operação.`);
    throw new Error(message);
  }

  return data;
}

function showCard(id){["login-form","forgot-form","email-reset-form","reset-form"].forEach(x=>$(x).hidden=x!==id);}
const forgotOpen=$("forgot-open");
if(forgotOpen){
  forgotOpen.onclick=()=>{
    $("forgot-email").value=$("email").value;
    showCard("forgot-form");
    loadPublicSupportContact();
    prepareEmailRecovery();
  };
}
if($("forgot-back"))$("forgot-back").onclick=()=>showCard("login-form");
if($("email-reset-back"))$("email-reset-back").onclick=()=>showCard("login-form");
if($("email-reset-resend"))$("email-reset-resend").onclick=()=>{
  $("forgot-email").value=$("email-reset-email").value;
  $("forgot-feedback").className="feedback forgot-recovery-feedback";
  $("forgot-feedback").textContent="Confirme a verificação de segurança para receber um novo código.";
  showCard("forgot-form");
  prepareEmailRecovery();
};
if($("reset-back"))$("reset-back").onclick=()=>showCard("forgot-form");
if($("forgot-master-open"))$("forgot-master-open").onclick=()=>{
  $("reset-email").value=$("forgot-email").value||$("email").value;
  $("reset-new-codes").hidden=true;
  showCard("reset-form");
};

let publicSupportContact={};
let recoveryConfig={};
let turnstileWidgetId=null;
let turnstileScriptPromise=null;

function loadTurnstileScript(){
  if(window.turnstile)return Promise.resolve(window.turnstile);
  if(turnstileScriptPromise)return turnstileScriptPromise;
  turnstileScriptPromise=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async=true;
    script.defer=true;
    script.onload=()=>resolve(window.turnstile);
    script.onerror=()=>reject(new Error("Não foi possível carregar a verificação de segurança."));
    document.head.appendChild(script);
  });
  return turnstileScriptPromise;
}

async function prepareEmailRecovery(){
  try{
    recoveryConfig=await api("/api/auth/recovery-config")||{};
    const container=$("forgot-turnstile");
    $("forgot-email-send").hidden=recoveryConfig.emailRecoveryEnabled!==true;
    if(recoveryConfig.emailRecoveryEnabled!==true){container.hidden=true;return;}
    if(!recoveryConfig.turnstileSiteKey){container.hidden=true;return;}
    const turnstile=await loadTurnstileScript();
    container.hidden=false;
    if(turnstileWidgetId===null){
      turnstileWidgetId=turnstile.render(container,{
        sitekey:recoveryConfig.turnstileSiteKey,
        theme:"light",
        language:"pt-BR"
      });
    }else turnstile.reset(turnstileWidgetId);
  }catch(error){
    recoveryConfig={};
    $("forgot-email-send").hidden=true;
    $("forgot-turnstile").hidden=true;
    $("forgot-feedback").textContent=error.message;
  }
}

async function loadPublicSupportContact(){
  // V1.0.0: recuperação de senha é feita exclusivamente por e-mail.
  // Mantemos a leitura das configurações públicas para outras áreas do sistema.
  try{
    publicSupportContact=await api("/api/settings/public-support")||{};
  }catch{
    publicSupportContact={};
  }
  if($("forgot-support-message")){
    $("forgot-support-message").textContent=
      "Enviaremos um código de 6 números para o seu e-mail. O código é válido por 15 minutos.";
  }
}

const remembered=localStorage.getItem("controle_termico_email");
if(remembered){$("email").value=remembered;$("remember-email").checked=true;}

$("login-form").onsubmit=async e=>{
  e.preventDefault();

  const button=e.submitter||$("login-form").querySelector('button[type="submit"],button:not([type])');
  $("login-feedback").textContent="";

  try{
    setButtonLoading(button,true,"Entrando");
    const data=await api("/api/auth/login",{
      method:"POST",
      body:JSON.stringify({
        email:$("email").value.trim(),
        password:$("password").value
      })
    });

    token=data.token;
    currentUser=data.user;
    sessionStorage.setItem("token",token);
    sessionStorage.setItem("user",JSON.stringify(currentUser));

    if($("remember-email").checked){
      localStorage.setItem("controle_termico_email",$("email").value.trim());
    }else{
      localStorage.removeItem("controle_termico_email");
    }

    showApp();
  }catch(error){
    $("login-feedback").textContent=error.message;
  }finally{
    setButtonLoading(button,false);
  }
};

$("forgot-form").onsubmit=async e=>{
  e.preventDefault();
  const f=$("forgot-feedback");f.textContent="";
  const button=e.submitter||$("forgot-email-send");
  try{
    setButtonLoading(button,true,"Enviando código");
    const email=$("forgot-email").value.trim();
    const turnstileToken=turnstileWidgetId!==null&&window.turnstile
      ? window.turnstile.getResponse(turnstileWidgetId)
      : "";
    const data=await api("/api/auth/forgot-password",{
      method:"POST",
      body:JSON.stringify({email,turnstileToken})
    });
    $("email-reset-form").reset();
    $("email-reset-email").value=email;
    $("email-reset-account").textContent=email;
    $("email-reset-feedback").className="feedback success forgot-recovery-feedback";
    $("email-reset-feedback").textContent=data.message;
    showCard("email-reset-form");
    setTimeout(()=>$("email-reset-code")?.focus(),50);
  }catch(error){
    f.className="feedback forgot-recovery-feedback";
    f.textContent=error.message;
  }finally{
    setButtonLoading(button,false);
    if(turnstileWidgetId!==null&&window.turnstile)window.turnstile.reset(turnstileWidgetId);
  }
};

$("email-reset-form").onsubmit=async e=>{
  e.preventDefault();
  const feedback=$("email-reset-feedback");
  const button=e.submitter||$("email-reset-submit");
  feedback.className="feedback forgot-recovery-feedback";
  feedback.textContent="";
  if($("email-reset-password").value!==$("email-reset-confirm").value){
    feedback.textContent="As senhas não coincidem.";
    return;
  }
  try{
    setButtonLoading(button,true,"Alterando senha");
    const email=$("email-reset-email").value;
    const data=await api("/api/auth/complete-password-reset",{
      method:"POST",
      body:JSON.stringify({
        email,
        code:$("email-reset-code").value,
        password:$("email-reset-password").value
      })
    });
    $("email").value=email;
    $("password").value="";
    $("login-feedback").className="feedback success login-feedback";
    $("login-feedback").textContent=data.message;
    $("email-reset-form").reset();
    showCard("login-form");
    setTimeout(()=>$("password")?.focus(),50);
  }catch(error){feedback.textContent=error.message;}
  finally{setButtonLoading(button,false);}
};

$("reset-form").onsubmit=async e=>{
  e.preventDefault();
  const f=$("reset-feedback");f.textContent="";
  if($("reset-password").value!==$("reset-confirm").value){f.textContent="As senhas não coincidem.";return;}
  try{
    const data=await api("/api/auth/reset-password",{
      method:"POST",
      body:JSON.stringify({
        email:$("reset-email").value,
        recoveryCode:$("reset-token").value,
        password:$("reset-password").value
      })
    });
    f.className="feedback success";f.textContent=data.message;
    if(Array.isArray(data.recoveryCodes))renderRecoveryCodes($("reset-new-codes"),data.recoveryCodes,"Novos códigos de recuperação");
  }catch(error){f.textContent=error.message;}
};

function renderRecoveryCodes(container,codes,title){
  container.innerHTML="";
  const heading=document.createElement("strong");
  heading.textContent=title;
  const warning=document.createElement("p");
  warning.textContent="Guarde em local seguro. Eles não serão mostrados novamente.";
  const grid=document.createElement("div");
  grid.className="recovery-code-grid";
  codes.forEach(code=>{
    const item=document.createElement("code");
    item.textContent=code;
    grid.appendChild(item);
  });
  const copy=document.createElement("button");
  copy.type="button";
  copy.className="secondary";
  copy.textContent="Copiar todos os códigos";
  copy.onclick=async()=>{
    await copyText(codes.join("\n"));
    toast("Códigos copiados.","success");
  };
  container.append(heading,warning,grid,copy);
  container.hidden=false;
}

async function copyText(value){
  if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(value);
  const area=document.createElement("textarea");
  area.value=value;
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function openMyPassword(force=false){
  const modal=$("my-password-modal");
  modal.dataset.forced=force?"true":"false";
  $("my-password-title").textContent=force?"Crie sua senha pessoal":"Trocar minha senha";
  $("my-password-instruction").textContent=force
    ?"Você entrou com uma senha temporária. Crie uma nova senha antes de utilizar o sistema."
    :"Informe a senha atual e escolha uma nova senha com pelo menos 8 caracteres.";
  modal.querySelectorAll("[data-close-my-password]").forEach(element=>element.style.display=force?"none":"");
  modal.hidden=false;
  document.body.classList.add("modal-open");
  setTimeout(()=>$("my-current-password")?.focus(),50);
}

function closeMyPassword(){
  if($("my-password-modal").dataset.forced==="true")return;
  $("my-password-modal").hidden=true;
  $("my-password-form").reset();
  $("my-password-feedback").textContent="";
  document.body.classList.remove("modal-open");
}

document.querySelectorAll("[data-close-my-password]").forEach(element=>element.onclick=closeMyPassword);
if($("my-password-open"))$("my-password-open").onclick=()=>openMyPassword(false);

if($("my-password-form"))$("my-password-form").onsubmit=async event=>{
  event.preventDefault();
  const feedback=$("my-password-feedback");
  feedback.textContent="";
  if($("my-new-password").value!==$("my-new-password-confirm").value){
    feedback.textContent="As novas senhas não coincidem.";
    return;
  }
  try{
    const data=await api("/api/auth/change-password",{
      method:"POST",
      body:JSON.stringify({
        currentPassword:$("my-current-password").value,
        newPassword:$("my-new-password").value
      })
    });
    token=data.token;
    currentUser.mustChangePassword=false;
    sessionStorage.setItem("token",token);
    sessionStorage.setItem("user",JSON.stringify(currentUser));
    $("my-password-modal").dataset.forced="false";
    closeMyPassword();
    toast(data.message,"success");
    showApp();
  }catch(error){feedback.textContent=error.message;}
};

function showApp(){
  $("login-screen").hidden=true;$("app").hidden=false;
  setTimeout(()=>sanitizeEmployeeSearch(),250);
  setTimeout(()=>sanitizeEmployeeSearch(),900);
  const currentAccessName=currentUser.profileName||(
    currentUser.role==="ADMIN"?"Administrador":"Operacional / DP"
  );
  $("user-name").textContent=`${currentUser.name} — ${currentAccessName}`;
  const isAdmin=currentUser.role==="ADMIN";
  const isMasterAdmin=isAdmin&&currentUser.isMasterAdmin===true;
  document.querySelectorAll(".admin-only").forEach(el=>el.style.display=isAdmin?"":"none");
  document.querySelectorAll(".master-only").forEach(el=>el.style.display=isMasterAdmin?"":"none");
  document.querySelectorAll(".non-master-admin-only").forEach(el=>{
    const visible=isAdmin&&!isMasterAdmin;
    el.hidden=!visible;
    el.style.display=visible?"":"none";
  });

  const hasPermission=key=>isAdmin||currentUser.permissions?.[key]===true;
  const hasOccurrencesAccess=isMasterAdmin||(isAdmin&&currentUser.permissions?.["occurrences.view"]===true);

  document.querySelectorAll("[data-permission]").forEach(el=>{
    el.style.display=hasPermission(el.dataset.permission)?"":"none";
  });
  document.querySelectorAll('[data-special-permission="occurrences.view"]').forEach(el=>{
    el.style.display=hasOccurrencesAccess?"":"none";
  });

  const canCalendar=hasPermission("calendar.manage");
  document.querySelectorAll(".calendar-access-only").forEach(el=>el.style.display=canCalendar?"":"none");

  // Configurações permanece visível quando o perfil possui qualquer configuração permitida.
  const settingsButton=document.querySelector('[data-view="settings"]');
  if(settingsButton && !isAdmin){
    const canSettings=hasPermission("settings.view")||hasPermission("calendar.manage");
    settingsButton.style.display=canSettings?"":"none";
  }

  // Importação exige permissão própria.
  document.querySelectorAll("#pdf-import-tab,[data-employee-tab='import'],[data-employee-tab='shift'],#open-shift-import,#shift-import-open").forEach(el=>{
    el.style.display=hasPermission("imports.manage")?"":"none";
  });

  // Ações de alteração de colaboradores.
  document.querySelectorAll(".employee-manage-only").forEach(el=>{
    el.style.display=hasPermission("employees.manage")?"":"none";
  });
  if(currentUser.mustChangePassword===true){
    openMyPassword(true);
    return;
  }
  if(hasPermission("dashboard.view"))loadDashboard();
  else if(hasPermission("reports.view"))navigate("reports");
  else if(hasPermission("employees.view"))navigate("employees");
  else if(hasPermission("settings.view")||hasPermission("calendar.manage"))navigate("settings");
  else navigate("manual");
  loadSupportUserContext().catch(error=>console.error("[SUPPORT_USER_CONTEXT]",error));
  loadPublicSettings().then(()=>loadSupportSettings()).catch(error=>console.error("[SUPPORT_SETTINGS_BOOT]",error));
}


function openMissingShiftEmployees(){
  navigate("employees");
  $("employee-missing-shift-filter").checked=true;
  loadEmployees();
}
$("open-missing-shift").onclick=openMissingShiftEmployees;
$("missing-shift-card").onclick=openMissingShiftEmployees;

$("logout").onclick=()=>{sessionStorage.clear();location.reload();};


// V7.57 — Menu lateral responsivo
function isMobileLayout(){
  return window.matchMedia("(max-width: 900px)").matches;
}

function openMobileMenu(){
  if(!isMobileLayout())return;
  $("sidebar")?.classList.add("mobile-open");
  const overlay=$("mobile-menu-overlay");
  if(overlay)overlay.hidden=false;
  document.body.classList.add("mobile-menu-open");
  $("mobile-menu-button")?.setAttribute("aria-expanded","true");
  $("mobile-menu-button")?.setAttribute("aria-label","Fechar menu");
}

function closeMobileMenu(){
  $("sidebar")?.classList.remove("mobile-open");
  const overlay=$("mobile-menu-overlay");
  if(overlay)overlay.hidden=true;
  document.body.classList.remove("mobile-menu-open");
  $("mobile-menu-button")?.setAttribute("aria-expanded","false");
  $("mobile-menu-button")?.setAttribute("aria-label","Abrir menu");
}

if($("mobile-menu-overlay")){
  $("mobile-menu-overlay").onclick=closeMobileMenu;
}

window.addEventListener("resize",()=>{
  if(!isMobileLayout())closeMobileMenu();
});

document.addEventListener("keydown",event=>{
  if(event.key==="Escape" && $("sidebar")?.classList.contains("mobile-open"))closeMobileMenu();
});


if($("mobile-menu-button")){
  $("mobile-menu-button").onclick=()=>{
    const sidebar=$("sidebar");
    if(sidebar?.classList.contains("mobile-open"))closeMobileMenu();
    else openMobileMenu();
  };
}

$("menu-toggle").onclick=()=>{
  if(isMobileLayout()){
    const sidebar=$("sidebar");
    if(sidebar?.classList.contains("mobile-open"))closeMobileMenu();
    else openMobileMenu();
  }else{
    const collapsed=$("sidebar").classList.toggle("collapsed");
    $("menu-toggle").setAttribute("aria-label",collapsed?"Expandir menu":"Recolher menu");
    $("menu-toggle").setAttribute("title",collapsed?"Expandir menu":"Recolher menu");
  }
};
document.querySelectorAll(".nav-btn").forEach(btn=>btn.onclick=()=>{
  navigate(btn.dataset.view);
  if(isMobileLayout())closeMobileMenu();
});

function navigate(view){
  const button=document.querySelector(`[data-view="${view}"]`);
  if(button?.dataset.permission && currentUser.role!=="ADMIN" && currentUser.permissions?.[button.dataset.permission]!==true){
    toast("Seu perfil não possui acesso a esta área.","error");
    return;
  }
  if(view==="occurrences"){
    const allowed=currentUser.isMasterAdmin===true||
      (currentUser.role==="ADMIN"&&currentUser.permissions?.["occurrences.view"]===true);
    if(!allowed){
      toast("Seu usuário não possui autorização para acessar o Controle de Ocorrências.","error");
      return;
    }
  }

  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(v=>{v.classList.remove("active");v.removeAttribute("aria-current");});
  $(view).classList.add("active");
  const activeNavigationButton=document.querySelector(`[data-view="${view}"]`);
  activeNavigationButton?.classList.add("active");
  activeNavigationButton?.setAttribute("aria-current","page");
  const titles={dashboard:"Painel",companies:"Empresas e filiais",users:"Usuários",employees:"Colaboradores",reports:"Relatórios",occurrences:"Controle de Ocorrências",settings:"Configurações",help:"Assistente de Ajuda",manual:"Manual do Sistema"};
  $("page-title").textContent=titles[view];
  $("page-title").classList.toggle("help-title-contrast",view==="help");
  if(view==="companies")loadCompanyBranchAdmin();
  if(view==="users")loadUsers();
  if(view==="employees"){
    sanitizeEmployeeSearch();
    loadEmployees();
  }
  if(view==="reports")prepareReports();
  if(view==="occurrences" && typeof loadOccurrencesControl==="function")loadOccurrencesControl();
  if(view==="settings")prepareSettingsAccess();
  if(view==="manual")prepareManual();
}


/* Ações dinâmicas compatíveis com CSP: substitui onclick inline legado. */
document.addEventListener("click",event=>{
  const control=event.target.closest("[data-ui-action]");
  if(!control)return;

  const allowed=new Set([
    "editCompany","deleteCompany","editBranch","deleteBranch",
    "editUser","toggleUserActive","deleteUser",
    "editJobRole","deleteJobRole","saveShiftDaysOff","editShift","deleteShift",
    "resolveDuplicateGroup","mapUnknownSeniorCode","openProfileEdit","deleteProfile",
    "editHoliday","deleteHoliday","deleteDayOff"
  ]);
  const action=control.dataset.uiAction;
  if(!allowed.has(action))return;

  event.preventDefault();
  event.stopPropagation();

  const fn=window[action];
  if(typeof fn!=="function"){
    console.error("[UI_ACTION_NOT_AVAILABLE]",action,control.dataset.uiId);
    if(typeof toast==="function")toast("Ação temporariamente indisponível. Atualize a página e tente novamente.","error");
    return;
  }

  try{
    const id=control.dataset.uiId;
    let result;
    if(action==="toggleUserActive"){
      result=fn(id,control.dataset.uiActive==="true");
    }else if(action==="saveShiftDaysOff"){
      result=fn(id,control);
    }else{
      result=fn(id);
    }
    if(result&&typeof result.catch==="function"){
      result.catch(error=>{
        console.error("[UI_ACTION_ERROR]",action,error);
        if(typeof toast==="function")toast(error?.message||"Não foi possível concluir a ação.","error");
      });
    }
  }catch(error){
    console.error("[UI_ACTION_ERROR]",action,error);
    if(typeof toast==="function")toast(error?.message||"Não foi possível concluir a ação.","error");
  }
});
