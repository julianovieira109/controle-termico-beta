function effectiveTheme(theme){
  if(theme==="system"){
    return window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
  }
  return theme||"light";
}

function setImageElement(imgId,textId,data,fallbackText){
  const img=$(imgId);
  const text=$(textId);
  if(data){
    img.src=data;
    img.hidden=false;
    if(text)text.hidden=true;
  }else{
    img.removeAttribute("src");
    img.hidden=true;
    if(text){
      text.hidden=false;
      text.textContent=fallbackText;
    }
  }
}

function applyVisualSettings(raw={}){
  visualSettings={...defaultVisualSettings,...raw};

  persistVisualCache(visualSettings);

  document.documentElement.style.setProperty("--p",visualSettings.primaryColor);
  document.documentElement.style.setProperty("--d",visualSettings.menuColor);
  document.documentElement.style.setProperty("--bg",visualSettings.backgroundColor);
  document.documentElement.style.setProperty("--card",visualSettings.cardColor);
  document.documentElement.style.setProperty("--heading",visualSettings.headingColor);
  document.documentElement.style.setProperty("--link",visualSettings.linkColor);
  document.documentElement.style.setProperty("--font-family",visualSettings.fontFamily);
  document.documentElement.style.setProperty("--report-header-bg",visualSettings.reportHeaderColor);
  document.documentElement.style.setProperty("--report-header-text",visualSettings.reportHeaderTextColor);
  document.documentElement.style.setProperty("--report-border",visualSettings.reportBorderColor);
  document.documentElement.style.setProperty("--report-off-bg",visualSettings.reportOffDayColor);
  document.documentElement.style.setProperty("--report-off-text",visualSettings.reportOffDayTextColor);
  document.documentElement.style.setProperty("--report-off-border",visualSettings.reportOffDayBorderColor);
  document.documentElement.style.setProperty("--report-off-border-width",`${visualSettings.reportOffDayBorderWidth||"0.65"}pt`);
  document.documentElement.style.setProperty("--report-sheet-bg",visualSettings.reportSheetColor);
  document.documentElement.style.setProperty("--report-top-bar",visualSettings.reportTopBarColor);
  document.documentElement.style.setProperty("--report-title-area-bg",visualSettings.reportTitleAreaColor);
  document.documentElement.style.setProperty("--report-title-text",visualSettings.reportTitleColor);
  document.documentElement.style.setProperty("--report-title-border",visualSettings.reportTitleBorderColor);
  document.documentElement.style.setProperty("--report-identification-bg",visualSettings.reportIdentificationColor);
  document.documentElement.style.setProperty("--report-identification-border",visualSettings.reportIdentificationBorderColor);
  document.documentElement.style.setProperty("--report-identification-label",visualSettings.reportIdentificationLabelColor);
  document.documentElement.style.setProperty("--report-identification-text",visualSettings.reportIdentificationTextColor);
  document.documentElement.style.setProperty("--report-row-bg",visualSettings.reportNormalRowColor);
  document.documentElement.style.setProperty("--report-row-text",visualSettings.reportNormalTextColor);

  document.title=visualSettings.systemName;
  $("theme-color-meta").setAttribute("content",visualSettings.primaryColor);

  $("brand-title").textContent=visualSettings.systemName;
  $("brand-subtitle").textContent=visualSettings.systemSubtitle;

  const brandDescription=$("brand-description");
  const companyName=String(visualSettings.companyName||"").trim();

  if(companyName){
    brandDescription.textContent=companyName;
    brandDescription.hidden=false;
  }else{
    brandDescription.textContent="";
    brandDescription.hidden=true;
  }

  $("sidebar-system-name").textContent=visualSettings.systemName;
  if($("login-footer-company")) $("login-footer-company").textContent=visualSettings.footerText||visualSettings.systemName;

  setImageElement("brand-logo-image","brand-mark-text",visualSettings.logoData,visualSettings.shortName);
  setImageElement("sidebar-logo-image","sidebar-logo-text",visualSettings.menuLogoData||visualSettings.logoData,visualSettings.shortName);

  if(visualSettings.faviconData){
    $("app-favicon").href=visualSettings.faviconData;
  }else{
    $("app-favicon").href="data:image/svg+xml,"+encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${visualSettings.primaryColor}"/><text x="32" y="41" text-anchor="middle" font-family="Arial" font-size="26" font-weight="700" fill="white">${visualSettings.shortName.slice(0,2)}</text></svg>`
    );
  }

  if(visualSettings.loginBackgroundData){
    $("login-screen").querySelector(".login-brand").style.backgroundImage=`url("${visualSettings.loginBackgroundData}")`;
    $("login-screen").querySelector(".login-brand").classList.add("has-background");
  }else{
    $("login-screen").querySelector(".login-brand").style.backgroundImage="";
    $("login-screen").querySelector(".login-brand").classList.remove("has-background");
  }

  document.body.classList.toggle("theme-dark",effectiveTheme(visualSettings.theme)==="dark");
}

function readFileAsDataUrl(file){
  return new Promise((resolve,reject)=>{
    if(!file)return resolve("");
    if(file.size>2*1024*1024){
      return reject(new Error("A imagem deve ter no máximo 2 MB."));
    }
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
}

function updatePreviewImage(imgId,emptyId,data){
  const img=$(imgId);
  const empty=$(emptyId);
  if(data){
    img.src=data;
    img.hidden=false;
    empty.hidden=true;
  }else{
    img.removeAttribute("src");
    img.hidden=true;
    empty.hidden=false;
  }
}

function fillIdentityForm(){
  const v={...defaultVisualSettings,...visualSettings};
  $("setting-name").value=v.systemName;
  $("setting-short-name").value=v.shortName;
  $("setting-subtitle").value=v.systemSubtitle;
  $("setting-company-name").value=v.companyName;
  $("setting-company-cnpj").value=v.companyCnpj;
  $("setting-company-address").value=v.companyAddress;
  $("setting-company-phone").value=v.companyPhone;
  $("setting-company-email").value=v.companyEmail;
  $("setting-company-site").value=v.companySite;
  $("setting-support-name").value=v.supportName;
  $("setting-support-whatsapp").value=v.supportWhatsapp;
  $("setting-support-email").value=v.supportEmail;
  $("setting-support-hours").value=v.supportHours;
  $("setting-support-password-help").value=v.supportPasswordHelp;
  $("setting-footer").value=v.footerText;
  $("setting-primary").value=v.primaryColor;
  $("setting-menu").value=v.menuColor;
  $("setting-background").value=v.backgroundColor;
  $("setting-card").value=v.cardColor;
  $("setting-heading").value=v.headingColor;
  $("setting-link").value=v.linkColor;
  $("setting-theme").value=v.theme;
  $("setting-font").value=v.fontFamily;
  $("setting-report-header").value=v.reportHeaderColor;
  $("setting-report-header-text").value=v.reportHeaderTextColor;
  $("setting-report-border").value=v.reportBorderColor;
  $("setting-report-off").value=v.reportOffDayColor;
  $("setting-report-off-text").value=v.reportOffDayTextColor;
  $("setting-report-off-border").value=v.reportOffDayBorderColor;
  $("setting-report-off-width").value=v.reportOffDayBorderWidth;
  $("setting-report-sheet").value=v.reportSheetColor;
  $("setting-report-top-bar").value=v.reportTopBarColor;
  $("setting-report-title-area").value=v.reportTitleAreaColor;
  $("setting-report-title-text").value=v.reportTitleColor;
  $("setting-report-title-border").value=v.reportTitleBorderColor;
  $("setting-report-identification").value=v.reportIdentificationColor;
  $("setting-report-identification-border").value=v.reportIdentificationBorderColor;
  $("setting-report-identification-label").value=v.reportIdentificationLabelColor;
  $("setting-report-identification-text").value=v.reportIdentificationTextColor;
  $("setting-report-row").value=v.reportNormalRowColor;
  $("setting-report-row-text").value=v.reportNormalTextColor;
  refreshSupportPreview();
  refreshReportStylePreview(v);

  updatePreviewImage("preview-logo","preview-logo-empty",v.logoData);
  updatePreviewImage("preview-menu-logo","preview-menu-logo-empty",v.menuLogoData);
  updatePreviewImage("preview-report-logo","preview-report-logo-empty",v.reportLogoData);
  updatePreviewImage("preview-favicon","preview-favicon-empty",v.faviconData);
  updatePreviewImage("preview-login-background","preview-login-background-empty",v.loginBackgroundData);
  refreshIdentityPreview();
}

function refreshSupportPreview(){
  const whatsapp=String($("setting-support-whatsapp")?.value||"").replace(/\D/g,"");
  const email=String($("setting-support-email")?.value||"").trim();
  if($("support-preview-whatsapp")){
    $("support-preview-whatsapp").textContent=whatsapp?`✓ WhatsApp: ${whatsapp}`:"WhatsApp não configurado";
    $("support-preview-whatsapp").classList.toggle("configured",Boolean(whatsapp));
  }
  if($("support-preview-email")){
    $("support-preview-email").textContent=email?`✓ E-mail: ${email}`:"E-mail não configurado";
    $("support-preview-email").classList.toggle("configured",Boolean(email));
  }
}

function identityValuesFromForm(){
  const {
    supportName:_supportName,
    supportWhatsapp:_supportWhatsapp,
    supportEmail:_supportEmail,
    supportHours:_supportHours,
    supportPasswordHelp:_supportPasswordHelp,
    ...visualOnly
  }=visualSettings;
  return {
    ...visualOnly,
    systemName:$("setting-name").value.trim()||defaultVisualSettings.systemName,
    shortName:$("setting-short-name").value.trim()||defaultVisualSettings.shortName,
    systemSubtitle:$("setting-subtitle").value.trim()||defaultVisualSettings.systemSubtitle,
    companyName:$("setting-company-name").value.trim(),
    companyCnpj:$("setting-company-cnpj").value.trim(),
    companyAddress:$("setting-company-address").value.trim(),
    companyPhone:$("setting-company-phone").value.trim(),
    companyEmail:$("setting-company-email").value.trim(),
    companySite:$("setting-company-site").value.trim(),
    footerText:$("setting-footer").value.trim()||defaultVisualSettings.footerText,
    primaryColor:$("setting-primary").value,
    menuColor:$("setting-menu").value,
    backgroundColor:$("setting-background").value,
    cardColor:$("setting-card").value,
    headingColor:$("setting-heading").value,
    linkColor:$("setting-link").value,
    theme:$("setting-theme").value,
    fontFamily:$("setting-font").value
    ,reportHeaderColor:$("setting-report-header").value
    ,reportHeaderTextColor:$("setting-report-header-text").value
    ,reportBorderColor:$("setting-report-border").value
    ,reportOffDayColor:$("setting-report-off").value
    ,reportOffDayTextColor:$("setting-report-off-text").value
    ,reportOffDayBorderColor:$("setting-report-off-border").value
    ,reportOffDayBorderWidth:$("setting-report-off-width").value
    ,reportSheetColor:$("setting-report-sheet").value
    ,reportTopBarColor:$("setting-report-top-bar").value
    ,reportTitleAreaColor:$("setting-report-title-area").value
    ,reportTitleColor:$("setting-report-title-text").value
    ,reportTitleBorderColor:$("setting-report-title-border").value
    ,reportIdentificationColor:$("setting-report-identification").value
    ,reportIdentificationBorderColor:$("setting-report-identification-border").value
    ,reportIdentificationLabelColor:$("setting-report-identification-label").value
    ,reportIdentificationTextColor:$("setting-report-identification-text").value
    ,reportNormalRowColor:$("setting-report-row").value
    ,reportNormalTextColor:$("setting-report-row-text").value
  };
}

function refreshIdentityPreview(){
  const v=identityValuesFromForm();
  const preview=$("identity-preview");
  preview.style.setProperty("--p",v.primaryColor);
  preview.style.setProperty("--d",v.menuColor);
  preview.style.setProperty("--bg",v.backgroundColor);
  preview.style.setProperty("--card",v.cardColor);
  preview.style.setProperty("--heading",v.headingColor);
  preview.style.fontFamily=v.fontFamily;
  refreshReportStylePreview(v);

  $("identity-preview-name").textContent=v.systemName;
  $("identity-preview-subtitle").textContent=v.systemSubtitle;

  const logo=$("identity-preview-logo");
  if(v.logoData){
    logo.innerHTML=`<img alt="Logo" src="${v.logoData}">`;
  }else{
    logo.textContent=v.shortName;
  }
}

function refreshReportStylePreview(values){
  const v=values||identityValuesFromForm();
  const preview=$("report-style-preview");
  if(preview){
    preview.style.setProperty("--report-header-bg",v.reportHeaderColor||defaultVisualSettings.reportHeaderColor);
    preview.style.setProperty("--report-header-text",v.reportHeaderTextColor||defaultVisualSettings.reportHeaderTextColor);
    preview.style.setProperty("--report-border",v.reportBorderColor||defaultVisualSettings.reportBorderColor);
    preview.style.setProperty("--report-off-bg",v.reportOffDayColor||defaultVisualSettings.reportOffDayColor);
    preview.style.setProperty("--report-off-text",v.reportOffDayTextColor||defaultVisualSettings.reportOffDayTextColor);
    preview.style.setProperty("--report-off-border",v.reportOffDayBorderColor||defaultVisualSettings.reportOffDayBorderColor);
    preview.style.setProperty("--report-off-border-width",`${v.reportOffDayBorderWidth||defaultVisualSettings.reportOffDayBorderWidth}pt`);
    preview.style.setProperty("--report-sheet-bg",v.reportSheetColor||defaultVisualSettings.reportSheetColor);
    preview.style.setProperty("--report-top-bar",v.reportTopBarColor||defaultVisualSettings.reportTopBarColor);
    preview.style.setProperty("--report-title-area-bg",v.reportTitleAreaColor||defaultVisualSettings.reportTitleAreaColor);
    preview.style.setProperty("--report-title-text",v.reportTitleColor||defaultVisualSettings.reportTitleColor);
    preview.style.setProperty("--report-title-border",v.reportTitleBorderColor||defaultVisualSettings.reportTitleBorderColor);
    preview.style.setProperty("--report-identification-bg",v.reportIdentificationColor||defaultVisualSettings.reportIdentificationColor);
    preview.style.setProperty("--report-identification-border",v.reportIdentificationBorderColor||defaultVisualSettings.reportIdentificationBorderColor);
    preview.style.setProperty("--report-identification-label",v.reportIdentificationLabelColor||defaultVisualSettings.reportIdentificationLabelColor);
    preview.style.setProperty("--report-identification-text",v.reportIdentificationTextColor||defaultVisualSettings.reportIdentificationTextColor);
    preview.style.setProperty("--report-row-bg",v.reportNormalRowColor||defaultVisualSettings.reportNormalRowColor);
    preview.style.setProperty("--report-row-text",v.reportNormalTextColor||defaultVisualSettings.reportNormalTextColor);
  }

  [
    ["setting-report-header","setting-report-header-code"],
    ["setting-report-header-text","setting-report-header-text-code"],
    ["setting-report-border","setting-report-border-code"],
    ["setting-report-off","setting-report-off-code"],
    ["setting-report-off-text","setting-report-off-text-code"],
    ["setting-report-off-border","setting-report-off-border-code"],
    ["setting-report-sheet","setting-report-sheet-code"],
    ["setting-report-top-bar","setting-report-top-bar-code"],
    ["setting-report-title-area","setting-report-title-area-code"],
    ["setting-report-title-text","setting-report-title-text-code"],
    ["setting-report-title-border","setting-report-title-border-code"],
    ["setting-report-identification","setting-report-identification-code"],
    ["setting-report-identification-border","setting-report-identification-border-code"],
    ["setting-report-identification-label","setting-report-identification-label-code"],
    ["setting-report-identification-text","setting-report-identification-text-code"],
    ["setting-report-row","setting-report-row-code"],
    ["setting-report-row-text","setting-report-row-text-code"]
  ].forEach(([inputId,codeId])=>{
    const input=$(inputId), code=$(codeId);
    if(input&&code)code.textContent=String(input.value||"").toUpperCase();
  });
}

function resetReportStyle(){
  $("setting-report-header").value=defaultVisualSettings.reportHeaderColor;
  $("setting-report-header-text").value=defaultVisualSettings.reportHeaderTextColor;
  $("setting-report-border").value=defaultVisualSettings.reportBorderColor;
  $("setting-report-off").value=defaultVisualSettings.reportOffDayColor;
  $("setting-report-off-text").value=defaultVisualSettings.reportOffDayTextColor;
  $("setting-report-off-border").value=defaultVisualSettings.reportOffDayBorderColor;
  $("setting-report-off-width").value=defaultVisualSettings.reportOffDayBorderWidth;
  $("setting-report-sheet").value=defaultVisualSettings.reportSheetColor;
  $("setting-report-top-bar").value=defaultVisualSettings.reportTopBarColor;
  $("setting-report-title-area").value=defaultVisualSettings.reportTitleAreaColor;
  $("setting-report-title-text").value=defaultVisualSettings.reportTitleColor;
  $("setting-report-title-border").value=defaultVisualSettings.reportTitleBorderColor;
  $("setting-report-identification").value=defaultVisualSettings.reportIdentificationColor;
  $("setting-report-identification-border").value=defaultVisualSettings.reportIdentificationBorderColor;
  $("setting-report-identification-label").value=defaultVisualSettings.reportIdentificationLabelColor;
  $("setting-report-identification-text").value=defaultVisualSettings.reportIdentificationTextColor;
  $("setting-report-row").value=defaultVisualSettings.reportNormalRowColor;
  $("setting-report-row-text").value=defaultVisualSettings.reportNormalTextColor;
  refreshReportStylePreview();
}

function bindIdentityControls(){
  [
    "setting-name","setting-short-name","setting-subtitle","setting-company-name",
    "setting-primary","setting-menu","setting-background","setting-card",
    "setting-heading","setting-link","setting-theme","setting-font",
    "setting-report-header","setting-report-header-text","setting-report-border",
    "setting-report-off","setting-report-off-text","setting-report-off-border","setting-report-off-width",
    "setting-report-sheet","setting-report-top-bar","setting-report-title-area","setting-report-title-text",
    "setting-report-title-border","setting-report-identification","setting-report-identification-border",
    "setting-report-identification-label","setting-report-identification-text","setting-report-row","setting-report-row-text"
  ].forEach(id=>{
    $(id).addEventListener("input",refreshIdentityPreview);
    $(id).addEventListener("change",refreshIdentityPreview);
  });

  const uploads=[
    ["setting-logo-file","logoData","preview-logo","preview-logo-empty"],
    ["setting-menu-logo-file","menuLogoData","preview-menu-logo","preview-menu-logo-empty"],
    ["setting-report-logo-file","reportLogoData","preview-report-logo","preview-report-logo-empty"],
    ["setting-favicon-file","faviconData","preview-favicon","preview-favicon-empty"],
    ["setting-login-background-file","loginBackgroundData","preview-login-background","preview-login-background-empty"]
  ];

  uploads.forEach(([inputId,key,imgId,emptyId])=>{
    $(inputId).onchange=async()=>{
      try{
        visualSettings[key]=await readFileAsDataUrl($(inputId).files[0]);
        updatePreviewImage(imgId,emptyId,visualSettings[key]);
        refreshIdentityPreview();
      }catch(error){
        alert(error.message);
        $(inputId).value="";
      }
    };
  });

  document.querySelectorAll(".remove-image").forEach(button=>{
    button.onclick=()=>{
      const key=button.dataset.imageKey;
      visualSettings[key]="";
      const map={
        logoData:["preview-logo","preview-logo-empty","setting-logo-file"],
        menuLogoData:["preview-menu-logo","preview-menu-logo-empty","setting-menu-logo-file"],
        reportLogoData:["preview-report-logo","preview-report-logo-empty","setting-report-logo-file"],
        faviconData:["preview-favicon","preview-favicon-empty","setting-favicon-file"],
        loginBackgroundData:["preview-login-background","preview-login-background-empty","setting-login-background-file"]
      };
      const [imgId,emptyId,inputId]=map[key];
      $(inputId).value="";
      updatePreviewImage(imgId,emptyId,"");
      refreshIdentityPreview();
    };
  });

  if($("report-style-reset")){
    $("report-style-reset").onclick=()=>{
      resetReportStyle();
      toast("Cores padrão dos relatórios restauradas na prévia. Clique em Salvar para confirmar.","success");
    };
  }

  $("identity-reset").onclick=()=>{
    if(!confirm("Restaurar a identidade visual padrão?"))return;
    const support={
      supportName:visualSettings.supportName||"",
      supportWhatsapp:visualSettings.supportWhatsapp||"",
      supportEmail:visualSettings.supportEmail||"",
      supportHours:visualSettings.supportHours||"",
      supportPasswordHelp:visualSettings.supportPasswordHelp||defaultVisualSettings.supportPasswordHelp
    };
    visualSettings={...defaultVisualSettings,...support};
    fillIdentityForm();
  };
}

async function loadPublicSettings(){
  try{
    const v=await api("/api/settings/public");
    applyVisualSettings(v||{});
    if($("settings-form"))fillIdentityForm();
  }catch(error){
    console.error("[VISUAL_SETTINGS_LOAD]",error);
    applyVisualSettings(readVisualCache()||{});
  }
}

async function loadSupportSettings(){
  if(!token)return;
  try{
    const support=await api("/api/settings/support");
    visualSettings={
      ...visualSettings,
      supportName:support?.supportName||"",
      supportWhatsapp:support?.supportWhatsapp||"",
      supportEmail:support?.supportEmail||"",
      supportHours:support?.supportHours||"",
      supportPasswordHelp:support?.supportPasswordHelp||defaultVisualSettings.supportPasswordHelp
    };
    fillIdentityForm();
  }catch(error){
    console.error("[SUPPORT_SETTINGS_LOAD]",error);
  }
}
$("settings-form").onsubmit=async e=>{
  e.preventDefault();

  const feedback=$("identity-feedback");
  const button=$("identity-save");
  let previousVisual=null;
  feedback.className="feedback";
  feedback.textContent="Salvando...";

  try{
    setButtonLoading(button,true,"Salvando");

    const value=identityValuesFromForm();
    previousVisual={...visualSettings};
    const support={
      supportName:visualSettings.supportName||"",
      supportWhatsapp:visualSettings.supportWhatsapp||"",
      supportEmail:visualSettings.supportEmail||"",
      supportHours:visualSettings.supportHours||"",
      supportPasswordHelp:visualSettings.supportPasswordHelp||defaultVisualSettings.supportPasswordHelp
    };

    applyVisualSettings({...value,...support});
    feedback.textContent="Aplicado. Confirmando no banco...";

    const result=await api("/api/settings/visual",{
      method:"PUT",
      body:JSON.stringify({
        companyId:null,
        branchId:null,
        value
      })
    });

    const persisted=result?.value||value;
    applyVisualSettings({...persisted,...support});
    fillIdentityForm();

    feedback.className="feedback success";
    feedback.textContent="Identidade visual salva e confirmada no banco.";
    toast("Identidade visual salva com sucesso.","success");
  }catch(error){
    if(previousVisual){
      applyVisualSettings(previousVisual);
      fillIdentityForm();
    }
    feedback.className="feedback";
    feedback.textContent=error.message;
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
};

bindIdentityControls();

["setting-support-whatsapp","setting-support-email"].forEach(id=>{
  $(id)?.addEventListener("input",refreshSupportPreview);
});

if($("support-settings-form"))$("support-settings-form").onsubmit=async event=>{
  event.preventDefault();
  const button=$("support-settings-save");
  const feedback=$("support-settings-feedback");
  const whatsapp=String($("setting-support-whatsapp").value||"").replace(/\D/g,"");
  const email=String($("setting-support-email").value||"").trim();

  feedback.className="feedback full";
  feedback.textContent="";

  if(whatsapp&&(whatsapp.length<10||whatsapp.length>13)){
    feedback.textContent="Informe um WhatsApp válido com DDD.";
    $("setting-support-whatsapp").focus();
    return;
  }

  try{
    setButtonLoading(button,true,"Salvando suporte");
    const value={
      ...visualSettings,
      supportName:$("setting-support-name").value.trim(),
      supportWhatsapp:whatsapp,
      supportEmail:email,
      supportHours:$("setting-support-hours").value.trim(),
      supportPasswordHelp:$("setting-support-password-help").value.trim()||defaultVisualSettings.supportPasswordHelp
    };
    const result=await api("/api/settings/support",{
      method:"PUT",
      body:JSON.stringify({companyId:null,branchId:null,value})
    });
    visualSettings={...visualSettings,...(result?.value||value)};
    fillIdentityForm();
    feedback.className="feedback success full";
    feedback.textContent=whatsapp||email
      ?"Contato do suporte salvo com sucesso."
      :"Canais de suporte desativados. O Assistente continuará com as orientações internas.";
    toast("Configuração de suporte salva com sucesso.","success");
  }catch(error){
    feedback.textContent=error.message;
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
};

if($("senior-intelligence-refresh")){
  $("senior-intelligence-refresh").onclick=()=>loadSeniorIntelligenceModels();
}

if(token&&currentUser)showApp();else loadPublicSettings();

let latestSystemBackupToken=null;

$("system-run-tests").onclick=async()=>{
  const button=$("system-run-tests");
  try{
    setButtonLoading(button,true,"Testando");
    const result=await api("/api/system/tests");
    $("system-test-results").innerHTML=result.checks.map(check=>`
      <article class="${check.success?"test-success":"test-error"}">
        <strong>${check.success?"✓":"✕"} ${check.name}</strong>
        <span>${check.detail}</span>
      </article>
    `).join("");
    toast(result.success?"Testes concluídos com sucesso.":"Alguns testes apresentaram falha.",result.success?"success":"warning");
  }catch(error){
    $("system-test-results").innerHTML=`<article class="test-error"><strong>Falha nos testes</strong><span>${error.message}</span></article>`;
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
};

$("system-backup").onclick=async()=>{
  const button=$("system-backup");
  try{
    setButtonLoading(button,true,"Gerando backup");
    const response=await fetch("/api/system/backup",{
      headers:{Authorization:`Bearer ${token}`}
    });

    const raw=await response.text();
    if(!response.ok){
      let error={};
      try{error=JSON.parse(raw);}catch{}
      throw new Error(error.error||raw||"Não foi possível gerar o backup.");
    }

    JSON.parse(raw); // valida o conteúdo antes de baixar
    latestSystemBackupToken=response.headers.get("X-Reset-Token");

    const blob=new Blob([raw],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;
    link.download=`controle-termico-backup-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    const canReset=currentUser?.isMasterAdmin===true;
    $("system-reset").disabled=!canReset;
    $("system-backup-status").textContent=canReset
      ?"Backup gerado e baixado. A zeragem foi liberada por 30 minutos."
      :"Backup gerado e baixado com sucesso.";
    toast("Backup baixado com sucesso.","success");
  }catch(error){
    latestSystemBackupToken=null;
    $("system-reset").disabled=true;
    $("system-backup-status").textContent=error.message;
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
};

$("system-reset").onclick=async()=>{
  const password=$("system-reset-password").value;
  const confirmation=$("system-reset-confirmation").value;

  if(!latestSystemBackupToken){
    toast("Gere um backup antes de zerar o sistema.","warning");
    return;
  }

  const confirmed=await confirmAction(
    "Esta ação apagará todos os cadastros e manterá somente o Administrador atual. Deseja continuar?",
    "Zerar sistema"
  );
  if(!confirmed)return;

  const button=$("system-reset");
  try{
    setButtonLoading(button,true,"Zerando sistema");
    const result=await api("/api/system/reset",{
      method:"POST",
      body:JSON.stringify({
        password,
        confirmation,
        resetToken:latestSystemBackupToken,
        preserveVisualSettings:$("system-preserve-visual").checked
      })
    });

    latestSystemBackupToken=null;
    $("system-reset").disabled=true;
    $("system-reset-password").value="";
    $("system-reset-confirmation").value="";
    $("system-reset-status").textContent=result.message;
    toast(result.message,"success");

    await loadDashboard();
    companies=[];
    branches=[];
    users=[];
    employeeRows=[];
  }catch(error){
    $("system-reset-status").textContent=error.message;
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
};

$("system-restore-form").onsubmit=async event=>{
  event.preventDefault();

  const file=$("system-restore-file").files[0];
  if(!file){
    toast("Selecione o arquivo de backup.","warning");
    return;
  }

  if(!latestSystemBackupToken){
    toast("Antes de restaurar, gere e baixe um backup atual do sistema.","warning");
    return;
  }

  const confirmed=await confirmAction(
    "A restauração substituirá os dados atuais. O backup de segurança atual já foi baixado. Deseja continuar?",
    "Restaurar backup"
  );
  if(!confirmed)return;

  const button=event.submitter;
  try{
    setButtonLoading(button,true,"Restaurando");
    const form=new FormData();
    form.append("file",file);
    form.append("confirmation",$("system-restore-confirmation").value);
    form.append("restoreToken",latestSystemBackupToken);

    const response=await fetch("/api/system/restore",{
      method:"POST",
      headers:{Authorization:`Bearer ${token}`},
      body:form
    });

    const raw=await response.text();
    let data={};
    try{data=raw?JSON.parse(raw):{};}catch{}

    if(!response.ok){
      throw new Error(data.error||raw||"Não foi possível restaurar o backup.");
    }

    latestSystemBackupToken=null;
    toast(data.message,"success");
    $("system-restore-form").reset();

    if(data.requiresRelogin){
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("user");
      token=null;
      currentUser=null;
      setTimeout(()=>location.reload(),700);
      return;
    }

    await loadDashboard();
  }catch(error){
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
};

async function loadShiftManagement(){
  if(!companies.length)await loadCompanies();
  await loadCatalogs();

  const companyOptions=`<option value="">Selecione</option>`+
    companies.filter(company=>company.active!==false)
      .map(company=>`<option value="${escapeHtml(company.id)}">${escapeHtml(company.trade_name)}</option>`).join("");

  const filterOptions=`<option value="">Todas as empresas</option>`+
    companies.map(company=>`<option value="${escapeHtml(company.id)}">${escapeHtml(company.trade_name)}</option>`).join("");

  const currentCompany=$("shift-company").value;
  const currentFilter=$("shift-company-filter").value;

  $("shift-company").innerHTML=companyOptions;
  $("shift-company-filter").innerHTML=filterOptions;

  if(currentCompany)$("shift-company").value=currentCompany;
  if(currentFilter)$("shift-company-filter").value=currentFilter;

  if(!$("shift-id").value&&!document.querySelector("[data-shift-weekday]:checked")){
    fillShiftDaysOff([0]);
  }

  renderShiftTable();
  refreshEmployeeShiftSelects();
}

const REPORT_POLICY_OPTIONS=[
  ["PENDING","Pendente — não gerar"],
  ["BOTH","Repouso térmico + refeição"],
  ["THERMAL_ONLY","Somente repouso térmico"],
  ["MEAL_ONLY","Somente refeição"],
  ["NONE","Não gerar relatórios"]
];

function reportPolicyLabel(value){
  return REPORT_POLICY_OPTIONS.find(([key])=>key===value)?.[1]||"Pendente — não gerar";
}

function escapeReportPolicyHtml(value){
  return String(value??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

async function loadJobReportPolicies(){
  if(!companies.length)await loadCompanies();
  if(!branches.length)await loadBranches();
  jobReportPolicies=await api("/api/catalogs/job-report-policies");
  const filter=$("job-report-company-filter");
  const current=filter.value;
  filter.innerHTML=`<option value="">Selecione a empresa</option>`+
    companies.map(company=>`<option value="${company.id}">${escapeReportPolicyHtml(company.trade_name||company.legal_name)}</option>`).join("");
  $("job-role-company").innerHTML=`<option value="">Selecione</option>`+
    companies.filter(company=>company.active!==false).map(company=>`<option value="${company.id}">${escapeReportPolicyHtml(company.trade_name||company.legal_name)}</option>`).join("");
  $("job-role-policy").innerHTML=REPORT_POLICY_OPTIONS.map(([value,label])=>`<option value="${value}">${label}</option>`).join("");
  filter.value=current;
  if(!filter.value&&companies.length===1)filter.value=companies[0].id;
  refreshJobReportBranchFilter(false);
  refreshJobRoleBranchSelect(false);
  renderJobReportPolicies();
}

function refreshJobReportBranchFilter(reset=false){
  const companyId=$("job-report-company-filter").value;
  const select=$("job-report-branch-filter");
  const previous=reset?"":select.value;
  const available=companyId
    ? branches.filter(branch=>String(branch.company_id)===String(companyId)&&branch.active!==false)
    : [];
  select.innerHTML=`<option value="">Selecione a filial</option>`+
    available.map(branch=>`<option value="${branch.id}">${escapeReportPolicyHtml(branch.name)}</option>`).join("");
  select.disabled=!companyId;
  if(available.some(branch=>String(branch.id)===String(previous)))select.value=previous;
  else if(available.length===1)select.value=available[0].id;
}

function refreshJobRoleBranchSelect(reset=false){
  const companyId=$("job-role-company").value;
  const select=$("job-role-branch");
  if(!select)return;
  const previous=reset?"":select.value;
  const available=companyId
    ? branches.filter(branch=>String(branch.company_id)===String(companyId)&&branch.active!==false)
    : [];
  select.innerHTML=`<option value="">${companyId?"Selecione a filial":"Selecione primeiro a empresa"}</option>`+
    available.map(branch=>`<option value="${branch.id}">${escapeReportPolicyHtml(branch.name)}</option>`).join("");
  select.disabled=!companyId;
  if(available.some(branch=>String(branch.id)===String(previous)))select.value=previous;
  else if(available.length===1)select.value=available[0].id;
}

window.editJobRole=editJobRole;
window.deleteJobRole=deleteJobRole;

function renderJobReportPolicies(){
  const companyId=$("job-report-company-filter").value;
  const branchId=$("job-report-branch-filter").value;
  const rows=jobReportPolicies.filter(item=>!companyId||String(item.company_id)===String(companyId));
  const body=$("job-report-policy-body");
  body.innerHTML=rows.length?rows.map(item=>{
    const branchPolicy=(item.branch_policies||[]).find(policy=>String(policy.branch_id)===String(branchId));
    const selectedPolicy=branchId?(branchPolicy?.report_policy||"INHERIT"):item.report_policy;
    const choices=branchId
      ? [["INHERIT",`Usar regra geral — ${reportPolicyLabel(item.report_policy)}`],...REPORT_POLICY_OPTIONS]
      : REPORT_POLICY_OPTIONS;
    const options=choices.map(([value,label])=>
      `<option value="${value}" ${selectedPolicy===value?"selected":""}>${escapeReportPolicyHtml(label)}</option>`
    ).join("");
    const employeeCount=branchId?Number(item.employee_counts_by_branch?.[branchId]||0):Number(item.employee_count||0);
    return `<tr>
      <td><strong>${escapeReportPolicyHtml(item.name)}</strong></td>
      <td>${escapeReportPolicyHtml(item.company_name||"")}</td>
      <td>${employeeCount}</td>
      <td><select class="job-report-policy-select" data-job-role-id="${item.id}" data-branch-id="${branchId}">${options}</select></td>
      <td><span class="status-pill ${item.active!==false?"status-active":"status-warning"}">${item.active!==false?"Ativo":"Inativo"}</span></td>
      <td class="actions">
        <button type="button" class="action-btn" data-ui-action="editJobRole" data-ui-id="${item.id}">Editar</button>
        <button type="button" class="action-btn danger" data-ui-action="deleteJobRole" data-ui-id="${item.id}">Excluir</button>
      </td>
    </tr>`;
  }).join(""):`<tr><td colspan="6">Nenhum cargo encontrado.</td></tr>`;
  body.querySelectorAll(".job-report-policy-select").forEach(select=>{
    select.onchange=()=>updateJobReportPolicy(select);
  });
}

async function updateJobReportPolicy(select){
  const id=select.dataset.jobRoleId;
  const branchId=select.dataset.branchId||"";
  const item=jobReportPolicies.find(entry=>String(entry.id)===String(id));
  const previous=branchId
    ? (item?.branch_policies||[]).find(policy=>String(policy.branch_id)===String(branchId))?.report_policy||"INHERIT"
    : item?.report_policy||"PENDING";
  select.disabled=true;
  try{
    await api(branchId
      ? `/api/catalogs/job-report-policies/${id}/branches/${branchId}`
      : `/api/catalogs/job-report-policies/${id}`,{
      method:"PUT",
      body:JSON.stringify({reportPolicy:select.value})
    });
    if(item&&branchId){
      item.branch_policies=(item.branch_policies||[]).filter(policy=>String(policy.branch_id)!==String(branchId));
      if(select.value!=="INHERIT")item.branch_policies.push({branch_id:branchId,report_policy:select.value});
    }else if(item){
      item.report_policy=select.value;
    }
    toast(branchId&&select.value==="INHERIT"?"A filial voltou a usar a regra geral.":`Regra atualizada: ${reportPolicyLabel(select.value)}.`,"success");
    renderJobReportPolicies();
  }catch(error){
    select.value=previous;
    toast(error.message,"error");
  }finally{
    select.disabled=false;
  }
}

if($("job-report-company-filter"))$("job-report-company-filter").onchange=()=>{
  refreshJobReportBranchFilter(true);
  renderJobReportPolicies();
};
if($("job-report-branch-filter"))$("job-report-branch-filter").onchange=renderJobReportPolicies;
if($("job-role-company"))$("job-role-company").onchange=()=>refreshJobRoleBranchSelect(true);

function resetJobRoleForm(){
  $("job-role-id").value="";
  $("job-role-name").value="";
  $("job-role-policy").value="PENDING";
  $("job-role-active").value="true";
  $("job-role-company").disabled=false;
  $("job-role-form-title").textContent="Novo cargo";
  const filteredCompany=$("job-report-company-filter").value;
  if(filteredCompany)$("job-role-company").value=filteredCompany;
  refreshJobRoleBranchSelect(true);
  const filteredBranch=$("job-report-branch-filter").value;
  if(filteredBranch)$("job-role-branch").value=filteredBranch;
}

function openNewJobRole(){
  resetJobRoleForm();
  $("job-role-form-panel").hidden=false;
  $("job-role-name").focus();
}

function editJobRole(id){
  const item=jobReportPolicies.find(role=>String(role.id)===String(id));
  if(!item)return;
  $("job-role-id").value=item.id;
  $("job-role-company").value=item.company_id;
  $("job-role-company").disabled=true;
  refreshJobRoleBranchSelect(true);
  const filteredBranch=$("job-report-branch-filter").value;
  if(filteredBranch)$("job-role-branch").value=filteredBranch;
  $("job-role-name").value=item.name||"";
  $("job-role-policy").value=item.report_policy||"PENDING";
  $("job-role-active").value=String(item.active!==false);
  $("job-role-form-title").textContent="Editar cargo";
  $("job-role-form-panel").hidden=false;
  $("job-role-form-panel").scrollIntoView({behavior:"smooth",block:"start"});
}

async function saveJobRole(event){
  event.preventDefault();
  const id=$("job-role-id").value;
  const payload={
    companyId:$("job-role-company").value,
    name:$("job-role-name").value.trim(),
    reportPolicy:$("job-role-policy").value,
    active:$("job-role-active").value==="true"
  };
  const branchId=$("job-role-branch").value;
  if(!branchId){
    toast("Selecione a filial que receberá esta regra de relatórios.","warning");
    return;
  }
  try{
    const saved=await api(id?`/api/catalogs/job-roles/${id}`:"/api/catalogs/job-roles",{
      method:id?"PUT":"POST",
      body:JSON.stringify(payload)
    });
    const roleId=id||saved.id;
    await api(`/api/catalogs/job-report-policies/${roleId}/branches/${branchId}`,{
      method:"PUT",
      body:JSON.stringify({reportPolicy:payload.reportPolicy})
    });
    toast(id?"Cargo atualizado.":"Cargo incluído.","success");
    $("job-role-form-panel").hidden=true;
    await loadJobReportPolicies();
    await loadCatalogs();
  }catch(error){toast(error.message,"error");}
}

async function deleteJobRole(id){
  const item=jobReportPolicies.find(role=>String(role.id)===String(id));
  if(!item)return;
  if(!confirm(`Excluir o cargo “${item.name}”?`))return;
  try{
    await api(`/api/catalogs/job-roles/${id}`,{method:"DELETE"});
    toast("Cargo excluído.","success");
    await loadJobReportPolicies();
    await loadCatalogs();
  }catch(error){toast(error.message,"error");}
}

if($("job-role-new"))$("job-role-new").onclick=openNewJobRole;
if($("job-role-cancel"))$("job-role-cancel").onclick=()=>{$("job-role-form-panel").hidden=true;resetJobRoleForm();};
if($("job-role-form"))$("job-role-form").onsubmit=saveJobRole;

function refreshEmployeeShiftSelects(){
  const activeShifts=catalogs.shifts.filter(shift=>shift.active!==false);
  const options=`<option value="">Selecione</option>`+
    activeShifts.map(shift=>`<option value="${shift.id}">${shift.name}</option>`).join("");
  if($("employee-shift")){
    const current=$("employee-shift").value;
    $("employee-shift").innerHTML=options;
    if(current)$("employee-shift").value=current;
  }
}

const shiftWeekdayNames=["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
const shiftWeekdayInitials=["D","S","T","Q","Q","S","S"];

function suggestedShiftDaysOff(name){
  const normalized=String(name||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  return /(^|\D)3\s*[º°o]?\s*(turno)?|terceir/.test(normalized)?[6]:[0];
}

function fillShiftDaysOff(days=[0]){
  const selected=new Set(Array.isArray(days)?days.map(Number):[0]);
  document.querySelectorAll("[data-shift-weekday]").forEach(input=>{
    input.checked=selected.has(Number(input.dataset.shiftWeekday));
  });
}

function shiftDaysOffLabel(days){
  const labels=(Array.isArray(days)?days:[]).map(Number).filter(day=>day>=0&&day<=6).map(day=>shiftWeekdayNames[day]);
  return labels.length?labels.join(", "):"Sem folga semanal";
}

function shiftInlineDaysOff(shift){
  const selected=new Set((shift.weekly_days_off||[]).map(Number));
  return `<div class="shift-inline-days" data-shift-days-row="${shift.id}">
    <div class="shift-inline-checks">
      ${shiftWeekdayNames.map((name,day)=>`<label title="${name}"><input type="checkbox" data-shift-row-weekday="${day}" ${selected.has(day)?"checked":""}><span>${shiftWeekdayInitials[day]}</span></label>`).join("")}
    </div>
    <small>${shiftDaysOffLabel(shift.weekly_days_off)}</small>
    <button type="button" class="action-btn" data-ui-action="saveShiftDaysOff" data-ui-id="${shift.id}">Salvar folga</button>
  </div>`;
}

function renderShiftTable(){
  const companyId=$("shift-company-filter").value;
  const rows=catalogs.shifts.filter(shift=>
    !companyId||String(shift.company_id)===String(companyId)
  );

  $("shifts-list").innerHTML=rows.length
    ? rows.map(shift=>`<tr>
        <td><b>${escapeHtml(shift.name)}</b></td>
        <td>${escapeHtml(shift.senior_code||"-")}</td>
        <td>${escapeHtml(companies.find(company=>String(company.id)===String(shift.company_id))?.trade_name||"-")}</td>
        <td>${escapeHtml(shift.description||"-")}</td>
        <td>${shiftInlineDaysOff(shift)}</td>
        <td>${shift.active!==false?"Ativo":"Inativo"}</td>
        <td>
          <button class="action-btn" data-ui-action="editShift" data-ui-id="${shift.id}">Editar</button>
          <button class="action-btn danger" data-ui-action="deleteShift" data-ui-id="${shift.id}">Excluir</button>
        </td>
      </tr>`).join("")
    : `<tr><td colspan="7">Nenhum turno cadastrado.</td></tr>`;
}

function resetShiftForm(){
  $("shift-form").reset();
  $("shift-id").value="";
  $("shift-form-title").textContent="Cadastrar turno";
  $("shift-save-button").textContent="Salvar turno";
  fillShiftDaysOff([0]);
}

$("shift-cancel").onclick=resetShiftForm;
$("shift-company-filter").onchange=renderShiftTable;

$("shift-form").onsubmit=async event=>{
  event.preventDefault();
  const id=$("shift-id").value;
  const button=$("shift-save-button");

  try{
    setButtonLoading(button,true,"Salvando turno");
    await api(id?`/api/catalogs/shifts/${id}`:"/api/catalogs/shifts",{
      method:id?"PUT":"POST",
      body:JSON.stringify({
        companyId:$("shift-company").value,
        name:$("shift-name").value.trim(),
        description:$("shift-description").value.trim(),
        seniorCode:$("shift-senior-code").value.trim(),
        weeklyDaysOff:Array.from(document.querySelectorAll("[data-shift-weekday]:checked"))
          .map(input=>Number(input.dataset.shiftWeekday)),
        active:$("shift-active").value==="true"
      })
    });

    toast(id?"Turno atualizado com sucesso.":"Turno cadastrado com sucesso.","success");
    resetShiftForm();
    await loadCatalogs();
    await loadShiftManagement();
  }catch(error){
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
};

window.editShift=id=>{
  const shift=catalogs.shifts.find(item=>String(item.id)===String(id));
  if(!shift)return;

  $("shift-id").value=shift.id;
  $("shift-company").value=shift.company_id;
  $("shift-name").value=shift.name||"";
  $("shift-description").value=shift.description||"";
  $("shift-senior-code").value=shift.senior_code||"";
  fillShiftDaysOff(shift.weekly_days_off||[0]);
  $("shift-active").value=String(shift.active!==false);
  $("shift-form-title").textContent="Editar turno";
  $("shift-save-button").textContent="Salvar alterações";
  $("shift-form").scrollIntoView({behavior:"smooth"});
};

window.saveShiftDaysOff=async(id,button)=>{
  const row=document.querySelector(`[data-shift-days-row="${id}"]`);
  if(!row)return;
  const weeklyDaysOff=Array.from(row.querySelectorAll("[data-shift-row-weekday]:checked"))
    .map(input=>Number(input.dataset.shiftRowWeekday));

  try{
    setButtonLoading(button,true,"Salvando");
    await api(`/api/catalogs/shifts/${id}/weekly-days-off`,{
      method:"PATCH",
      body:JSON.stringify({weeklyDaysOff})
    });
    toast("Folga semanal do turno atualizada.","success");
    await loadCatalogs();
    renderShiftTable();
  }catch(error){
    toast(error.message,"error");
  }finally{
    if(document.body.contains(button))setButtonLoading(button,false);
  }
};

$("shift-name").oninput=()=>{
  if(!$("shift-id").value)fillShiftDaysOff(suggestedShiftDaysOff($("shift-name").value));
};

window.deleteShift=async id=>{
  const shift=catalogs.shifts.find(item=>String(item.id)===String(id));
  if(!shift)return;

  const confirmed=await confirmAction(
    `Deseja excluir o turno ${shift.name}? A exclusão será bloqueada se houver colaboradores vinculados.`,
    "Excluir turno"
  );
  if(!confirmed)return;

  try{
    await api(`/api/catalogs/shifts/${id}`,{method:"DELETE"});
    toast("Turno excluído com sucesso.","success");
    await loadCatalogs();
    await loadShiftManagement();
  }catch(error){
    toast(error.message,"error");
  }
};

document.addEventListener("keydown",event=>{
  if(event.key!=="Escape")return;
  if(!$("company-modal")?.hidden){
    resetCompanyForm();
    closeCompanyModal();
  }
  if(!$("branch-modal")?.hidden){
    resetBranchForm();
    closeBranchModal();
  }
});

async function loadThermalRestSettings(){
  if(!catalogs.shifts.length)await loadCatalogs();
  if(!companies.length)await loadCompanies();
  if(!branches.length)await loadBranches();
  const config=await api("/api/settings/thermal-rest");
  window.thermalRestSettings=config;
  $("thermal-rest-mode").value=config.mode;
  $("thermal-min-work-minutes").value=100;
  $("thermal-work-minutes").value=config.workMinutes;
  $("thermal-duration-minutes").value=config.restMinutes;
  $("thermal-max-duration-minutes").value=config.maxRestMinutes;
  $("thermal-variation-minutes").value=config.variationMinutes;
  $("thermal-cycle-days").value=config.cycleDays;
  $("thermal-rest-count").value=config.restCount;
  $("thermal-font-size").value=config.fontSizePt;
  renderThermalAuthorization(config);
  document.documentElement.style.setProperty("--thermal-time-font-size",`${config.fontSizePt}pt`);
  renderThermalShiftList(config);
  if(typeof preparePointImportSelectors==="function")preparePointImportSelectors();
  if(typeof loadPointImportHistory==="function")await loadPointImportHistory();
}

function renderThermalAuthorization(config=window.thermalRestSettings||{}){
  const mode=$("thermal-scope-mode");
  const selection=$("thermal-scope-selection");
  const list=$("thermal-scope-list");
  if(!mode||!selection||!list)return;
  mode.value=config.scopeMode==="SELECTED"?"SELECTED":"ALL";
  selection.hidden=mode.value!=="SELECTED";
  const selectedCompanies=new Set((config.authorizedCompanyIds||[]).map(String));
  const selectedBranches=new Set((config.authorizedBranchIds||[]).map(String));
  const activeCompanies=(companies||[]).filter(company=>company.active!==false);
  list.innerHTML=activeCompanies.map(company=>{
    const companyId=String(company.id);
    const companyBranches=(branches||[]).filter(branch=>
      String(branch.company_id)===companyId&&branch.active!==false
    );
    const allBranchesSelected=companyBranches.length>0&&companyBranches.every(branch=>selectedBranches.has(String(branch.id)));
    const legacyCompanySelected=selectedCompanies.has(companyId);
    return `<div class="thermal-scope-company" data-company-id="${escapeHtml(companyId)}">
      <div class="thermal-company-name">${escapeHtml(company.trade_name||company.legal_name||"Empresa")}</div>
      <div class="thermal-company-head"><label><input type="checkbox" data-thermal-company value="${escapeHtml(companyId)}" ${(legacyCompanySelected||allBranchesSelected)?"checked":""}><span>Selecionar todas as filiais</span></label><span class="thermal-company-status"></span></div>
      <p class="thermal-branches-title">Filiais desta empresa</p>
      <div class="thermal-scope-branches">
        ${companyBranches.length?companyBranches.map(branch=>{
          const branchId=String(branch.id);
          return `<label><input type="checkbox" data-thermal-branch value="${escapeHtml(branchId)}" ${(legacyCompanySelected||selectedBranches.has(branchId))?"checked":""}><span>${escapeHtml(branch.name||"Filial")}</span></label>`;
        }).join(""):'<span class="hint">Nenhuma filial ativa cadastrada.</span>'}
      </div>
    </div>`;
  }).join("")||'<p class="hint">Nenhuma empresa ativa cadastrada.</p>';

  const refreshCompanyCard=card=>{
    const companyInput=card.querySelector("[data-thermal-company]");
    const branchInputs=[...card.querySelectorAll("[data-thermal-branch]")];
    const selectedCount=branchInputs.filter(input=>input.checked).length;
    const allSelected=branchInputs.length>0&&selectedCount===branchInputs.length;
    companyInput.checked=allSelected;
    companyInput.indeterminate=selectedCount>0&&!allSelected;
    card.classList.toggle("is-company-authorized",allSelected);
    const status=card.querySelector(".thermal-company-status");
    if(status)status.textContent=allSelected?"Todas autorizadas":selectedCount?`${selectedCount} filial(is) autorizada(s)`:"Nenhuma autorizada";
    updateThermalScopeSummary();
  };
  list.querySelectorAll(".thermal-scope-company").forEach(card=>{
    refreshCompanyCard(card);
    card.querySelector("[data-thermal-company]")?.addEventListener("change",event=>{
      card.querySelectorAll("[data-thermal-branch]").forEach(input=>input.checked=event.currentTarget.checked);
      refreshCompanyCard(card);
    });
    card.querySelectorAll("[data-thermal-branch]").forEach(input=>input.addEventListener("change",updateThermalScopeSummary));
    card.querySelectorAll("[data-thermal-branch]").forEach(input=>input.addEventListener("change",()=>refreshCompanyCard(card)));
  });
}

function updateThermalScopeSummary(){
  const summary=$("thermal-scope-summary");
  if(!summary)return;
  const branchCount=document.querySelectorAll("[data-thermal-branch]:checked").length;
  if(!branchCount){
    summary.textContent="Nenhuma empresa ou filial autorizada — as fichas térmicas serão geradas em branco.";
    return;
  }
  summary.textContent=`Autorização atual: ${branchCount} filial(is) selecionada(s). Somente elas receberão horários automáticos.`;
}

if($("thermal-scope-mode"))$("thermal-scope-mode").onchange=()=>{
  $("thermal-scope-selection").hidden=$("thermal-scope-mode").value!=="SELECTED";
  updateThermalScopeSummary();
};

function renderThermalShiftList(config=window.thermalRestSettings||{}){
  const body=$("thermal-shifts-list");
  if(!body)return;
  body.innerHTML=(catalogs.shifts||[]).map(shift=>{
    const rests=ThermalSchedule.baseThermalRests(shift.description,config);
    const preview=rests.length
      ?rests.map((rest,index)=>`R${index+1}: ${ThermalSchedule.formatMinutes(rest.start)}–${ThermalSchedule.formatMinutes(rest.end)}`).join(" · ")
      :"Não foi possível calcular";
    return `<tr><td>${escapeHtml(shift.senior_code||"-")}</td><td>${escapeHtml(shift.name)}</td><td>${escapeHtml(shift.description||"-")}</td><td>${escapeHtml(preview)}</td><td>${rests.length>=Number(config.restCount||3)?"Apto":"Revisar horário"}</td></tr>`;
  }).join("")||'<tr><td colspan="5">Nenhum turno cadastrado.</td></tr>';
}

if($("thermal-rest-form"))$("thermal-rest-form").onsubmit=async event=>{
  event.preventDefault();
  const value={
    mode:$("thermal-rest-mode").value,
    scopeMode:$("thermal-scope-mode").value,
    authorizedCompanyIds:[],
    authorizedBranchIds:[...document.querySelectorAll("[data-thermal-branch]:checked")].map(input=>input.value),
    minWorkMinutes:Number($("thermal-min-work-minutes").value),
    workMinutes:Number($("thermal-work-minutes").value),
    restMinutes:Number($("thermal-duration-minutes").value),
    maxRestMinutes:Number($("thermal-max-duration-minutes").value),
    variationMinutes:Number($("thermal-variation-minutes").value),
    cycleDays:Number($("thermal-cycle-days").value),
    restCount:Number($("thermal-rest-count").value),
    fontSizePt:Number($("thermal-font-size").value)
  };
  const result=await api("/api/settings/thermal-rest",{method:"PUT",body:JSON.stringify({value})});
  window.thermalRestSettings=result.value;
  document.documentElement.style.setProperty("--thermal-time-font-size",`${result.value.fontSizePt}pt`);
  $("thermal-rest-feedback").className="feedback full success";
  $("thermal-rest-feedback").textContent=result.value.mode==="MANUAL"
    ?"Modo manual salvo. As próximas fichas terão os horários em branco."
    :result.value.mode==="AUTOMATIC_AND_BLANK"
      ?"Modo automático com cópia manual salvo. A cópia mantém faltas, DSR, férias e demais justificativas, deixando somente os horários em branco."
    :result.value.scopeMode==="SELECTED"
      ?"Modo automático salvo para as empresas e filiais autorizadas."
      :"Modo automático salvo para todas as empresas e filiais.";
  renderThermalAuthorization(result.value);
  renderThermalShiftList(result.value);
};

document.addEventListener("keydown",event=>{
  if(event.key==="Escape"&&!$("user-modal")?.hidden){
    resetUserForm();
    closeUserModal();
  }
});

let duplicateGroups=[];

function duplicateRecordScore(record){
  let score=0;
  if(Number(record.daysOffCount||0)>0)score+=100;
  if(record.shiftName)score+=20;
  if(record.source==="SENIOR")score+=10;
  return score;
}

function renderDuplicateGroups(){
  const container=$("duplicates-list");
  if(!container)return;

  if(!duplicateGroups.length){
    container.innerHTML=`
      <div class="duplicates-empty">
        <strong>Nenhuma matrícula duplicada encontrada.</strong>
        <span>A proteção global de matrícula está funcionando.</span>
      </div>`;
    return;
  }

  container.innerHTML=duplicateGroups.map(group=>{
    const suggested=group.suggestedKeepId ||
      group.records.slice().sort((a,b)=>duplicateRecordScore(b)-duplicateRecordScore(a))[0]?.id;

    return `
      <section class="duplicate-group" data-registration="${escapeHtml(group.registration)}">
        <div class="duplicate-group-head">
          <div>
            <span class="duplicate-badge">${group.total} cadastros</span>
            <h4>Matrícula ${escapeHtml(group.registration)}</h4>
          </div>
          <span class="duplicate-hint">Escolha o cadastro que deverá permanecer.</span>
        </div>

        <div class="duplicate-records">
          ${group.records.map(record=>`
            <label class="duplicate-record ${String(record.id)===String(suggested)?"recommended":""}">
              <div class="duplicate-radio">
                <input type="radio"
                       name="keep-${escapeHtml(group.registration)}"
                       value="${record.id}"
                       ${String(record.id)===String(suggested)?"checked":""}>
              </div>
              <div class="duplicate-record-main">
                <strong>${escapeHtml(record.fullName||"-")}</strong>
                <span>${escapeHtml(record.companyName||"-")} / ${escapeHtml(record.branchName||"-")}</span>
                <span>Cargo: ${escapeHtml(record.jobTitle||"-")}</span>
              </div>
              <div class="duplicate-record-meta">
                <span>Turno: <b>${escapeHtml(record.shiftName||"Não definido")}</b></span>
                <span>Situação: <b>${escapeHtml(record.status||"-")}</b></span>
                <span>Origem: <b>${escapeHtml(record.source||"-")}</b></span>
                <span>Histórico: <b>${record.daysOffCount||0}</b></span>
              </div>
              ${String(record.id)===String(suggested)
                ? `<span class="recommended-tag">Sugerido</span>`
                : ``}
            </label>
          `).join("")}
        </div>

        <div class="duplicate-group-actions">
          <button type="button"
                  class="danger-button"
                  data-ui-action="resolveDuplicateGroup" data-ui-id="${group.registration}">
            Remover duplicados e manter selecionado
          </button>
        </div>
      </section>
    `;
  }).join("");
}

async function loadDuplicateGroups(){
  const button=$("duplicates-load");
  const feedback=$("duplicates-feedback");

  try{
    setButtonLoading(button,true,"Verificando");
    feedback.textContent="";

    const data=await api("/api/admin/employees/duplicates");
    duplicateGroups=data.groups||[];

    const summary=$("duplicates-summary");
    summary.hidden=false;
    summary.innerHTML=`
      <article><span>Matrículas duplicadas</span><strong>${data.totalGroups||0}</strong></article>
      <article><span>Cadastros envolvidos</span><strong>${data.totalRecords||0}</strong></article>
    `;

    renderDuplicateGroups();
  }catch(error){
    feedback.textContent=error.message;
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
}

window.resolveDuplicateGroup=async registration=>{
  const group=duplicateGroups.find(item=>String(item.registration)===String(registration));
  if(!group)return;

  const selected=document.querySelector(`input[name="keep-${CSS.escape(String(registration))}"]:checked`);
  if(!selected){
    toast("Escolha o cadastro que deverá permanecer.","warning");
    return;
  }

  const keepId=selected.value;
  const deleteIds=group.records
    .map(record=>String(record.id))
    .filter(id=>id!==String(keepId));

  const keepRecord=group.records.find(record=>String(record.id)===String(keepId));

  const confirmed=await confirmAction(
    `Manter ${keepRecord?.fullName||"o cadastro selecionado"} em ${keepRecord?.companyName||"-"} / ${keepRecord?.branchName||"-"} e remover ${deleteIds.length} duplicado(s)?`,
    "Resolver duplicidade"
  );
  if(!confirmed)return;

  try{
    const result=await api("/api/admin/employees/duplicates/resolve",{
      method:"POST",
      body:JSON.stringify({
        registration,
        keepId,
        deleteIds
      })
    });

    toast(result.message,"success");
    await loadDuplicateGroups();
    await loadEmployees();
  }catch(error){
    toast(error.message,"error");
  }
};

if($("duplicates-load")){
  $("duplicates-load").onclick=loadDuplicateGroups;
}

function visibleEmployeeChecks(){
  return [...document.querySelectorAll(".employee-row-check")];
}

function updateEmployeeBulkState(){
  const checks=visibleEmployeeChecks();
  const selectedIds=selectedEmployeeIdsForBulkDelete();
  const selected=checks.filter(check=>check.checked);
  const selectAll=$("employee-select-all");

  if(selectAll){
    selectAll.checked=checks.length>0&&selected.length===checks.length;
    selectAll.indeterminate=selected.length>0&&selected.length<checks.length;
  }

  const bar=$("employee-bulk-bar");
  const count=$("employee-selected-count");
  if(bar)bar.hidden=selectedIds.length===0;
  if(count)count.textContent=`${selectedIds.length} selecionado(s)`;

  const visibleDelete=$("employee-bulk-delete-visible");
  if(visibleDelete)visibleDelete.hidden=selectedIds.length===0;
}

function wireEmployeeSelection(){
  const selectAll=$("employee-select-all");
  if(selectAll){
    selectAll.onchange=()=>{
      visibleEmployeeChecks().forEach(check=>{check.checked=selectAll.checked;});
      updateEmployeeBulkState();
    };
  }

  visibleEmployeeChecks().forEach(check=>{
    check.onchange=updateEmployeeBulkState;
  });

  updateEmployeeBulkState();
}

function selectedEmployeeIdsForBulkDelete(){
  const ids=new Set();

  try{
    const current=selectedEmployees;
    if(current instanceof Set){
      current.forEach(id=>ids.add(String(id)));
    }else if(Array.isArray(current)){
      current.forEach(id=>ids.add(String(id)));
    }
  }catch(_error){}

  document.querySelectorAll(
    'input[type="checkbox"][data-employee], '+
    'input[type="checkbox"][data-employee-id], '+
    'input[type="checkbox"][name="employee-select"]:checked, '+
    '.employee-row-check:checked'
  ).forEach(check=>{
    if(!check.checked)return;
    const id=check.dataset.employeeId||check.dataset.employee||check.value;
    if(id)ids.add(String(id));
  });

  return [...ids];
}

async function deleteSelectedEmployees(){
  const ids=selectedEmployeeIdsForBulkDelete();

  if(!ids.length){
    toast("Selecione pelo menos um colaborador.","warning");
    return;
  }

  const first=await confirmAction(
    `Você selecionou ${ids.length} colaborador(es). Deseja continuar?`,
    "Excluir selecionados"
  );
  if(!first)return;

  const second=await confirmAction(
    `Confirma a exclusão definitiva de ${ids.length} colaborador(es)? Esta ação não pode ser desfeita.`,
    "Confirmar exclusão em lote"
  );
  if(!second)return;

  const button=$("employee-bulk-delete-visible")||$("employee-bulk-delete");

  try{
    setButtonLoading(button,true,"Excluindo");

    const result=await api("/api/employees/bulk-delete",{
      method:"POST",
      body:JSON.stringify({ids})
    });

    toast(result.message,"success");
    await loadEmployees();
  }catch(error){
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
}

if($("employee-bulk-delete")){
  $("employee-bulk-delete").onclick=deleteSelectedEmployees;
}

if($("employee-bulk-delete-visible")){
  $("employee-bulk-delete-visible").onclick=deleteSelectedEmployees;
}

let shiftImportPreview=null;

function fillShiftImportBranches(){
  const companyId=$("shift-import-company")?.value;
  if(!$("shift-import-branch"))return;

  $("shift-import-branch").innerHTML=`<option value="">Selecione</option>`+
    branches
      .filter(branch=>String(branch.company_id)===String(companyId)&&branch.active!==false)
      .map(branch=>`<option value="${escapeHtml(branch.id)}">${escapeHtml(branch.name)}</option>`)
      .join("");
}

function fillShiftImportCompanies(){
  if(!$("shift-import-company"))return;

  $("shift-import-company").innerHTML=`<option value="">Selecione</option>`+
    companies
      .filter(company=>company.active!==false)
      .map(company=>`<option value="${escapeHtml(company.id)}">${escapeHtml(company.trade_name)}</option>`)
      .join("");

  fillShiftImportBranches();
}

function clearShiftImport(){
  shiftImportPreview=null;
  unknownSeniorCodes=[];
  renderUnknownSeniorCodes();
  if($("shift-import-file"))$("shift-import-file").value="";
  if($("shift-import-result"))$("shift-import-result").hidden=true;
  if($("shift-import-body"))$("shift-import-body").innerHTML="";
  if($("shift-new-proposals")){
    $("shift-new-proposals").hidden=true;
    $("shift-new-proposals").innerHTML="";
  }
  if($("shift-import-feedback"))$("shift-import-feedback").textContent="";
  if($("shift-import-confirm"))$("shift-import-confirm").disabled=false;
}

function renderShiftImportPreview(data){
  shiftImportPreview=data;
  unknownSeniorCodes=Array.isArray(data.unknownCodes)?data.unknownCodes:[];
  renderUnknownSeniorCodes(data.companyId);
  $("shift-import-result").hidden=false;

  $("shift-import-summary").innerHTML=`
    <article><span>Registros identificados</span><strong>${data.total||0}</strong></article>
    <article><span>Prontos para atualizar</span><strong>${data.ready||0}</strong></article>
    <article><span>Já configurados</span><strong>${data.alreadyConfigured||0}</strong></article>
    <article><span>Não localizados</span><strong>${data.notFound||0}</strong></article>
    <article><span>Códigos a vincular</span><strong>${data.unconfigured||0}</strong></article>
    <article class="intelligence-summary"><span>Confiança do leitor</span><strong>${data.intelligence?.score??0}%</strong></article>
  `;

  $("shift-import-feedback").innerHTML=intelligentReaderCard(data.intelligence);
  const unresolvedShiftRegistrations=data.diagnostics?.unresolvedRegistrations||[];
  if(unresolvedShiftRegistrations.length){
    $("shift-import-feedback").innerHTML+=`
      <div class="import-warning"><b>Não confirme:</b> ${unresolvedShiftRegistrations.length} matrícula(s) não foram montadas: ${unresolvedShiftRegistrations.join(", ")}.</div>
    `;
  }
  $("shift-import-confirm").disabled=unresolvedShiftRegistrations.length>0;

  const proposals=Array.isArray(data.newShiftProposals)?data.newShiftProposals:[];
  const proposalPanel=$("shift-new-proposals");
  const canApproveNewShifts=currentUser?.role==="ADMIN";
  proposalPanel.hidden=!proposals.length;
  proposalPanel.innerHTML=proposals.length?`
    <div class="shift-proposal-head">
      <div>
        <h4>Novo turno identificado no PDF</h4>
        <p>Confira o código e os horários. O turno só será cadastrado depois da confirmação.</p>
      </div>
    </div>
    ${proposals.map((proposal,index)=>`
      <div class="shift-proposal-card ${proposal.canCreate?"ready":"manual-review"}">
        <label class="shift-proposal-check">
          <input type="checkbox" data-new-shift-select="${index}" ${
            canApproveNewShifts?"":"disabled"
          }>
          Cadastrar este turno
        </label>
        <label>Código Senior
          <input value="${proposal.displayCode||String(proposal.code||"").padStart(4,"0")}" disabled>
        </label>
        <label>Nome do turno
          <input data-new-shift-name="${index}" maxlength="100" value="${proposal.suggestedName||""}" ${
            canApproveNewShifts?"":"disabled"
          }>
        </label>
        <label class="shift-proposal-description">${proposal.canCreate?"Horário do turno":"Informe os horários"}
          <input
            data-new-shift-description="${index}"
            maxlength="180"
            value="${proposal.description||""}"
            placeholder="Ex.: 07:00 às 12:00 / 13:00 às 16:00"
            ${canApproveNewShifts?"":"disabled"}
          >
        </label>
        <p class="shift-proposal-reason">${
          proposal.canCreate
            ? (proposal.reason||"Confira antes de cadastrar.")
            : "Os horários não vieram completos no PDF. Informe manualmente os 4 horários (entrada, saída, retorno e fim) antes de confirmar."
        }${!canApproveNewShifts?" Somente o Administrador pode confirmar o novo turno.":""}</p>
      </div>
    `).join("")}
  `:"";

  const reviewUpdates=(data.rows||[]).filter(row=>row.result==="ATUALIZAR");
  const reviewMissing=(data.rows||[]).filter(row=>row.result==="NAO_LOCALIZADO");
  if(reviewUpdates.length||reviewMissing.length||proposals.length){
    $("shift-import-feedback").innerHTML+=`
      <div class="shift-review-summary">
        <b>Conferência antes de atualizar:</b>
        ${reviewUpdates.length?` ${reviewUpdates.length} colaborador(es) com turno diferente do cadastro.`:""}
        ${proposals.length?` ${proposals.length} código(s) novo(s) exigem confirmação explícita.`:""}
        ${reviewMissing.length?` ${reviewMissing.length} matrícula(s) não localizada(s) serão ignoradas.`:""}
      </div>
    `;
  }

  $("shift-import-body").innerHTML=(data.rows||[]).length
    ? data.rows.map((row,index)=>`
      <tr>
        <td><input class="shift-import-check" data-shift-import-index="${index}" type="checkbox" ${
  row.result==="NAO_LOCALIZADO" ||
  row.result==="CODIGO_NAO_CONFIGURADO" ||
  row.nameMatches===false ||
  data.intelligence?.requiresReview ? "" : "checked"
}></td>
        <td>${row.registration||"-"}</td>
        <td>
          ${row.pdfName||"-"}
          ${row.effectiveDate?`<small class="shift-effective-date">Escala em ${row.effectiveDate}</small>`:""}
        </td>
        <td>
          ${row.fullName||"-"}
          ${row.nameMatches===false?`<small class="shift-name-warning">Nome diferente do PDF</small>`:""}
          ${!row.fullName&&row.registrationElsewhere?`
            <small class="shift-possible-match">
              Mesma matrícula encontrada em ${escapeHtml(row.registrationElsewhere.branchName||"outra filial")}
              ${row.registrationElsewhere.status?` — ${escapeHtml(row.registrationElsewhere.status)}`:""}
              ${row.registrationElsewhere.currentShift?` — turno ${escapeHtml(row.registrationElsewhere.currentShift)}`:""}
            </small>
          `:!row.fullName&&row.possibleMatch?`
            <small class="shift-possible-match">
              Possível cadastro pelo nome: ${escapeHtml(row.possibleMatch.fullName)} —
              matrícula ${escapeHtml(row.possibleMatch.registration)}
              ${row.possibleMatch.branchName?` — ${escapeHtml(row.possibleMatch.branchName)}`:""}
              ${row.possibleMatch.status?` — ${escapeHtml(row.possibleMatch.status)}`:""}
              ${row.possibleMatch.currentShift?` — turno ${escapeHtml(row.possibleMatch.currentShift)}`:""}
            </small>
          `:""}
        </td>
        <td><b>${row.rawShiftCode||row.shiftCode||"-"}</b></td>
        <td><b>${row.targetShiftName||"Código não configurado"}</b></td>
        <td>${row.currentShift||"Não definido"}</td>
        <td>
          ${
            row.nameMatches===false
              ? `<span class="import-result DIVERGENCIA">DIVERGÊNCIA - CONFERIR CADASTRO</span>`
              : row.result==="NAO_LOCALIZADO"
                ? `<span class="import-result NAO_LOCALIZADO">MATRÍCULA NÃO LOCALIZADA</span>`
                : `<span class="import-result ${row.result}">${row.result.replaceAll("_"," ")}</span>`
          }
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="9">Nenhuma matrícula, nome e turno configurado foram reconhecidos no PDF.</td></tr>`;

  const rowChecks=[...document.querySelectorAll(".shift-import-check")];
  const safeIndexes=new Set(
    (data.rows||[])
      .map((row,index)=>({row,index}))
      .filter(item=>
        item.row.result==="ATUALIZAR" &&
        item.row.nameMatches!==false &&
        !unresolvedShiftRegistrations.length
      )
      .map(item=>String(item.index))
  );

  $("shift-import-select-all").checked=
    rowChecks.length>0 &&
    rowChecks.every(check=>!safeIndexes.has(String(check.dataset.shiftImportIndex))||check.checked);

  $("shift-import-select-all").onchange=()=>{
    rowChecks.forEach(check=>{
      const safe=safeIndexes.has(String(check.dataset.shiftImportIndex));
      check.checked=safe && $("shift-import-select-all").checked;
    });
  };

  rowChecks.forEach(check=>{
    check.onchange=()=>{
      const safeChecks=rowChecks.filter(item=>safeIndexes.has(String(item.dataset.shiftImportIndex)));
      $("shift-import-select-all").checked=
        safeChecks.length>0 && safeChecks.every(item=>item.checked);
    };
  });
}

if($("open-shift-import")){
  $("open-shift-import").onclick=async()=>{
    if(typeof window.setEmployeeModule==="function"){
      await window.setEmployeeModule("shift");
    }else{
      $("shift-import-panel").hidden=false;
      fillShiftImportCompanies();
    }
  };
}

if($("shift-import-close")){
  $("shift-import-close").onclick=async()=>{
    clearShiftImport();
    if(typeof window.setEmployeeModule==="function"){
      await window.setEmployeeModule("register");
    }else{
      $("shift-import-panel").hidden=true;
    }
  };
}

if($("shift-import-company")){
  $("shift-import-company").onchange=fillShiftImportBranches;
}

if($("shift-import-clear")){
  $("shift-import-clear").onclick=clearShiftImport;
}

if($("shift-import-read")){
  $("shift-import-read").onclick=async()=>{
    const file=$("shift-import-file").files?.[0];
    const companyId=$("shift-import-company").value;
    const branchId=$("shift-import-branch").value;

    if(!companyId||!branchId){
      toast("Selecione a empresa e a filial.","warning");
      return;
    }

    if(!file){
      toast("Selecione o PDF de escala da Senior.","warning");
      return;
    }

    const button=$("shift-import-read");
    const form=new FormData();
    form.append("file",file);
    form.append("companyId",companyId);
    form.append("branchId",branchId);

    try{
      setButtonLoading(button,true,"Lendo turnos");

      const response=await fetch("/api/imports/shift-preview",{
        method:"POST",
        headers:{Authorization:`Bearer ${token}`},
        body:form
      });

      const data=await response.json();
      if(!response.ok)throw new Error([data.error,data.detail].filter(Boolean).join(" — ")||"Não foi possível analisar o PDF de turnos.");

      renderShiftImportPreview(data);
      if(data.total){
        toast(`${data.total} colaborador(es) identificado(s) no PDF para conferência.`,"success");
      }else{
        const d=data.diagnostics||{};
        const detail=[
          d.readerUsed?`Leitor: ${d.readerUsed}`:"",
          Number.isFinite(d.extractedCharacters)?`Texto extraído: ${d.extractedCharacters} caracteres`:"",
          Number.isFinite(d.registrationCandidates)?`Matrículas candidatas: ${d.registrationCandidates}`:"",
          Array.isArray(d.configuredCodes)?`Códigos configurados: ${d.configuredCodes.join(", ")}`:"",
        Array.isArray(d.configuredShiftCatalog)&&d.configuredShiftCatalog.length?`Escalas reconhecidas no sistema: ${d.configuredShiftCatalog.map(item=>`${item.code} → ${item.name}`).join(" | ")}`:"",
          Array.isArray(d.detectedCodes)?`Códigos detectados no PDF: ${d.detectedCodes.join(", ")}`:"",
          Number.isFinite(d.parsedRows)?`Registros montados pelo leitor: ${d.parsedRows}`:"",
          d.reportFormat?`Formato: ${d.reportFormat}`:""
        ].filter(Boolean).join(" | ");
        $("shift-import-feedback").textContent=
          `Diagnóstico: ${detail}${d.sample?` | Amostra: ${d.sample}`:""}`;
        toast("O PDF foi lido, mas nenhum registro foi montado. O diagnóstico foi exibido abaixo.","warning");
      }
    }catch(error){
      toast(error.message,"error");
      $("shift-import-feedback").textContent=error.message;
    }finally{
      setButtonLoading(button,false);
    }
  };
}

if($("shift-import-confirm")){
  $("shift-import-confirm").onclick=async()=>{
    if(!shiftImportPreview)return;

    if(Number(shiftImportPreview.diagnostics?.unresolvedCount||0)>0){
      toast("A atualização está bloqueada porque existem matrículas não reconhecidas no PDF.","warning");
      return;
    }

    const newShifts=(shiftImportPreview.newShiftProposals||[]).map((proposal,index)=>({
      code:proposal.code,
      name:document.querySelector(`[data-new-shift-name="${index}"]`)?.value?.trim()||"",
      description:document.querySelector(`[data-new-shift-description="${index}"]`)?.value?.trim()||"",
      selected:Boolean(document.querySelector(`[data-new-shift-select="${index}"]`)?.checked)
    })).filter(proposal=>proposal.selected);
    const selectedNewCodes=new Set(newShifts.map(proposal=>String(proposal.code)));

    const rows=shiftImportPreview.rows.map((row,index)=>({
      ...row,
      selected:Boolean(document.querySelector(`[data-shift-import-index="${index}"]`)?.checked)||(
        selectedNewCodes.has(String(row.shiftCode))&&
        row.result==="CODIGO_NAO_CONFIGURADO"&&
        Boolean(row.employeeId)&&
        row.nameMatches!==false
      )
    }));

    const selected=rows.filter(row=>
      row.selected &&
      row.result!=="NAO_LOCALIZADO" &&
      (row.result!=="CODIGO_NAO_CONFIGURADO"||selectedNewCodes.has(String(row.shiftCode)))
    );

    for(const proposal of newShifts){
      if(!proposal.name){
        toast(`Informe o nome do turno para o código ${proposal.code}.`,"warning");
        return;
      }
      const times=(String(proposal.description||"").match(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/g)||[]);
      if(times.length!==4){
        toast(`Informe exatamente 4 horários válidos para o código ${proposal.code}. Ex.: 07:00 às 12:00 / 13:00 às 16:00.`,"warning");
        const field=[...document.querySelectorAll("[data-new-shift-description]")]
          .find(input=>String(input.dataset.newShiftDescription)===String(
            (shiftImportPreview.newShiftProposals||[]).findIndex(item=>String(item.code)===String(proposal.code))
          ));
        field?.focus();
        return;
      }
    }

    if(!selected.length&&!newShifts.length){
      const pendingCodes=[...new Set(rows
        .filter(row=>row.result==="CODIGO_NAO_CONFIGURADO")
        .map(row=>row.shiftCode)
        .filter(Boolean)
      )];
      toast(
        pendingCodes.length
          ? `Nenhuma atualização pronta. Vincule primeiro o(s) código(s) Senior: ${pendingCodes.join(", ")} em Configurações → Turnos.`
          : "Nenhuma atualização de turno foi selecionada.",
        "warning"
      );
      return;
    }

    const confirmed=await confirmAction(
      `${newShifts.length?`Cadastrar ${newShifts.length} novo(s) turno(s) após conferir código e horários. `:""}Atualizar o campo Turno no cadastro de ${selected.length} colaborador(es) selecionado(s)? Divergências de nome só serão atualizadas se você as tiver marcado manualmente. Nenhum colaborador novo será criado.`,
      newShifts.length?"Cadastrar e atualizar turnos":"Atualizar turnos"
    );
    if(!confirmed)return;

    const button=$("shift-import-confirm");

    try{
      setButtonLoading(button,true,"Atualizando");

      const result=await api("/api/imports/shift-confirm",{
        method:"POST",
        body:JSON.stringify({
          companyId:shiftImportPreview.companyId,
          branchId:shiftImportPreview.branchId,
          fileName:shiftImportPreview.fileName,
          readerUsed:shiftImportPreview.readerUsed,
          optimizedPath:shiftImportPreview.diagnostics?.optimizedPath||null,
          intelligence:shiftImportPreview.intelligence,
          detectedOperationalBranch:shiftImportPreview.detectedOperationalBranch,
          parsingDiagnostics:{
            unresolvedCount:shiftImportPreview.diagnostics?.unresolvedCount||0,
            unresolvedRegistrations:shiftImportPreview.diagnostics?.unresolvedRegistrations||[]
          },
          newShifts,
          rows
        })
      });

      toast(result.message,"success");
      await loadEmployees();
      await loadDashboard();
      clearShiftImport();
    }catch(error){
      toast(error.message,"error");
    }finally{
      setButtonLoading(button,false);
    }
  };
}

function renderUnknownSeniorCodes(companyId=""){
  const panel=$("senior-unknown-codes-panel");
  const list=$("senior-unknown-codes-list");
  if(!panel||!list)return;

  if(!unknownSeniorCodes.length){
    panel.hidden=true;
    list.innerHTML="";
    return;
  }

  const availableShifts=catalogs.shifts
    .filter(shift=>!companyId||String(shift.company_id)===String(companyId))
    .filter(shift=>shift.active!==false);

  panel.hidden=false;
  list.innerHTML=unknownSeniorCodes.map(code=>`
    <div class="unknown-code-row">
      <div>
        <strong>Código Senior ${code}</strong>
        <span>Encontrado no PDF e ainda sem vínculo.</span>
      </div>
      <select data-unknown-code-shift="${code}">
        <option value="">Selecione o turno</option>
        ${availableShifts.map(shift=>`<option value="${shift.id}">${formatShiftOptionLabel(shift)}</option>`).join("")}
      </select>
      <button type="button" class="primary" data-ui-action="mapUnknownSeniorCode" data-ui-id="${code}">Vincular</button>
    </div>
  `).join("");
}

window.mapUnknownSeniorCode=async code=>{
  const select=document.querySelector(`[data-unknown-code-shift="${code}"]`);
  const shiftId=select?.value||"";
  if(!shiftId){
    toast("Selecione o turno para esse código.","warning");
    return;
  }

  const shift=catalogs.shifts.find(item=>String(item.id)===String(shiftId));
  if(!shift){
    toast("Turno não encontrado.","error");
    return;
  }

  try{
    await api("/api/catalogs/shifts/map-code",{
      method:"POST",
      body:JSON.stringify({
        companyId:shift.company_id,
        shiftId,
        seniorCode:code
      })
    });

    toast(`Código ${code} vinculado ao turno ${shift.name}.`,"success");
    unknownSeniorCodes=unknownSeniorCodes.filter(item=>String(item)!==String(code));
    await loadCatalogs();
    renderUnknownSeniorCodes(shift.company_id);
  }catch(error){
    toast(error.message,"error");
  }
};

async function loadSeniorIntelligenceModels(){
  const summary=$("senior-models-summary");
  const reportsBody=$("senior-models-reports-body");
  const readersBody=$("senior-models-readers-body");
  const codesBody=$("senior-models-codes-body");
  const branchesBody=$("senior-models-branches-body");
  const confidenceBody=$("senior-models-confidence-body");

  if(!summary||!reportsBody||!readersBody||!codesBody||!branchesBody||!confidenceBody)return;

  summary.innerHTML=`<article><span>Status</span><strong>Carregando...</strong></article>`;

  try{
    const data=await api("/api/imports/intelligence-models");
    const s=data.summary||{};

    summary.innerHTML=`
      <article><span>Modelos de relatório</span><strong>${s.reportModels||0}</strong></article>
      <article><span>Empresas</span><strong>${s.companies||0}</strong></article>
      <article><span>Filiais</span><strong>${s.branches||0}</strong></article>
      <article><span>Códigos aprendidos</span><strong>${s.learnedCodes||0}</strong></article>
      <article><span>Histórico analisado</span><strong>${s.historicalImports||0}</strong></article>
    `;

    reportsBody.innerHTML=(data.recognizedReports||[]).map(item=>`
      <tr>
        <td><strong>${item.name}</strong><br><small>${item.key}</small></td>
        <td>${(item.fields||[]).join(", ")}</td>
        <td>${item.learned?"Reconhecimento + aprendizado":"Reconhecimento automático"}</td>
        <td><span class="import-result CONFERIR">${item.status}</span></td>
      </tr>
    `).join("")||`<tr><td colspan="4">Nenhum modelo reconhecido.</td></tr>`;

    readersBody.innerHTML=(data.readers||[]).map(item=>`
      <tr>
        <td><strong>${item.name}</strong><br><small>${item.key}</small></td>
        <td>${item.priority}</td>
        <td>${item.purpose}</td>
        <td>${item.successfulUses||0}</td>
        <td>${item.lastUsedAt?new Date(item.lastUsedAt).toLocaleString("pt-BR"):"Sem histórico ainda"}</td>
      </tr>
    `).join("")||`<tr><td colspan="5">Nenhum leitor disponível.</td></tr>`;

    codesBody.innerHTML=(data.learnedCodes||[]).map(item=>`
      <tr>
        <td><strong>${item.code}</strong></td>
        <td>${item.shiftName}</td>
        <td>${item.description||"-"}</td>
        <td>${item.companyName||"-"}</td>
      </tr>
    `).join("")||`<tr><td colspan="4">Nenhum Código Senior vinculado ainda.</td></tr>`;

    branchesBody.innerHTML=(data.branches||[]).map(item=>`
      <tr>
        <td>${item.company_name||"-"}</td>
        <td><strong>${item.name}</strong></td>
        <td>${item.internal_code||"-"}</td>
        <td><span class="import-result CONFERIR">RECONHECÍVEL</span></td>
      </tr>
    `).join("")||`<tr><td colspan="4">Nenhuma filial ativa.</td></tr>`;

    confidenceBody.innerHTML=(data.confidenceHistory||[]).map(item=>`
      <tr>
        <td>${new Date(item.createdAt).toLocaleString("pt-BR")}</td>
        <td>${item.fileName}</td>
        <td>${item.importType}</td>
        <td>${item.companyName||"-"}<br><small>${item.branchName||"-"}</small></td>
        <td>${item.readerUsed||"Histórico anterior"}</td>
        <td><strong>${item.score}%</strong><br><small>${item.level||"-"}</small></td>
      </tr>
    `).join("")||`<tr><td colspan="6">O histórico de confiança começará a aparecer após as próximas importações.</td></tr>`;

    $("senior-model-engine-name").textContent=data.engine?.name||"Leitor Inteligente Senior";
    $("senior-model-engine-mode").textContent=
      data.engine?.externalAi===false
        ?"Processamento local — sem envio para IA externa"
        :"Processamento inteligente";
  }catch(error){
    summary.innerHTML=`<article><span>Erro</span><strong>${error.message}</strong></article>`;
    toast(error.message,"error");
  }
}

async function loadUserProfilesSettings(){
  userProfiles=await api("/api/admin/user-profiles");
  const body=$("profiles-body");
  if(!body)return;

  body.innerHTML=userProfiles.length
    ? userProfiles.map(p=>`
      <tr>
        <td>
          <strong>${escapeHtml(p.name)}</strong>
          ${p.protected?`<br><small>Perfil protegido do sistema</small>`:""}
        </td>
        <td>${p.base_role==="ADMIN"?"Administrador":"Operacional / DP"}</td>
        <td>
          ${p.protected
            ? `<span class="hint">Protegido</span>`
            : `<button type="button" class="action-btn" data-ui-action="openProfileEdit" data-ui-id="${p.id}">Editar</button>
               <button type="button" class="action-btn danger" data-ui-action="deleteProfile" data-ui-id="${p.id}">Excluir</button>`}
        </td>
      </tr>`).join("")
    : `<tr><td colspan="3">Nenhum perfil cadastrado.</td></tr>`;
}

function readProfilePermissions(){
  return Object.fromEntries(
    Array.from(document.querySelectorAll("[data-profile-permission]"))
      .map(input=>[input.dataset.profilePermission,input.checked])
  );
}

function fillProfilePermissions(permissions={}){
  document.querySelectorAll("[data-profile-permission]").forEach(input=>{
    input.checked=permissions?.[input.dataset.profilePermission]===true;
  });
}

function openProfileModal(mode="create"){
  $("profile-modal").hidden=false;
  $("profile-feedback").textContent="";

  if(mode==="create"){
    $("profile-form").reset();
    $("profile-id").value="";
    $("profile-modal-title").textContent="Novo perfil";
    $("profile-save").textContent="Cadastrar perfil";
    fillProfilePermissions({
      "dashboard.view":true,
      "employees.view":true,
      "reports.view":true
    });
    $("profile-name").focus();
  }
}

function closeProfileModal(){
  $("profile-modal").hidden=true;
  $("profile-form").reset();
  $("profile-id").value="";
  $("profile-feedback").textContent="";
}

window.openProfileEdit=id=>{
  const p=userProfiles.find(x=>String(x.id)===String(id));
  if(!p||p.protected)return;

  $("profile-id").value=p.id;
  $("profile-name").value=p.name;
  $("profile-modal-title").textContent="Editar perfil";
  $("profile-save").textContent="Salvar alterações";
  fillProfilePermissions(p.permissions||{});
  $("profile-feedback").textContent="";
  $("profile-modal").hidden=false;
  $("profile-name").focus();
};

window.deleteProfile=async id=>{
  const p=userProfiles.find(x=>String(x.id)===String(id));
  if(!p||p.protected)return;

  const confirmed=await confirmAction(
    `Deseja realmente excluir o perfil ${p.name}? A exclusão só será permitida se ele não estiver em uso.`,
    "Excluir perfil"
  );
  if(!confirmed)return;

  try{
    await api(`/api/admin/user-profiles/${id}`,{method:"DELETE"});
    toast("Perfil excluído com sucesso.","success");
    await loadUserProfilesSettings();
  }catch(error){
    toast(error.message,"error");
  }
};

if($("profile-new-button"))$("profile-new-button").onclick=()=>openProfileModal("create");

document.querySelectorAll("[data-close-profile-modal]").forEach(el=>{
  el.onclick=closeProfileModal;
});

if($("profile-cancel"))$("profile-cancel").onclick=closeProfileModal;

if($("profile-form"))$("profile-form").onsubmit=async e=>{
  e.preventDefault();

  const id=$("profile-id").value;
  const name=$("profile-name").value.trim();
  const feedback=$("profile-feedback");
  const button=$("profile-save");

  if(!name){
    feedback.textContent="Informe o nome do perfil.";
    return;
  }

  try{
    setButtonLoading(button,true,id?"Salvando":"Cadastrando");

    await api(id?`/api/admin/user-profiles/${id}`:"/api/admin/user-profiles",{
      method:id?"PUT":"POST",
      body:JSON.stringify({name,permissions:readProfilePermissions()})
    });

    toast(id?"Perfil atualizado com sucesso.":"Perfil cadastrado com sucesso.","success");
    closeProfileModal();
    await loadUserProfilesSettings();
  }catch(error){
    feedback.textContent=error.message;
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
};

document.addEventListener("keydown",event=>{
  if(event.key==="Escape" && $("profile-modal") && !$("profile-modal").hidden){
    closeProfileModal();
  }
});

document.querySelectorAll(".settings-tab").forEach(button=>{
  button.addEventListener("click",async()=>{
    document.querySelectorAll(".settings-tab").forEach(x=>x.classList.remove("active"));
    button.classList.add("active");

    document.querySelectorAll("[id^='settings-']").forEach(panel=>panel.hidden=true);

    const panel=document.getElementById(`settings-${button.dataset.settingsTab}`);
    if(panel)panel.hidden=false;

    try{
      if(button.dataset.settingsTab==="profiles")await loadUserProfilesSettings();
      if(button.dataset.settingsTab==="senior-models")await loadSeniorIntelligenceModels();
      if(button.dataset.settingsTab==="job-reports")await loadJobReportPolicies();
      if(button.dataset.settingsTab==="thermal-rest")await loadThermalRestSettings();
      if(button.dataset.settingsTab==="security-access")await window.loadSecurityAccess?.();
    }catch(error){
      console.error("[SETTINGS_TAB_PROFILES]",error);
      toast(error.message||"Não foi possível carregar os perfis de usuário.","error");
    }
  });
});

function finalizeSettingsTabsV129(){
  const settingsRoot=document.querySelector("#settings-panel, #settings-view, .settings-panel, [data-view='settings']");
  const visualButton=document.querySelector(
    "[data-settings-tab='visual'],[data-config-tab='visual'],[data-tab='visual'],#settings-tab-visual,#config-tab-visual"
  );
  const visualPanel=document.querySelector(
    "#settings-visual,#config-visual,[data-settings-panel='visual'],[data-config-panel='visual'],[data-panel='visual']"
  );

  const isMasterAdmin=typeof currentUser!=="undefined"&&
    currentUser?.role==="ADMIN"&&currentUser?.isMasterAdmin===true;

  if(visualButton){
    visualButton.hidden=!isMasterAdmin;
    visualButton.style.display=isMasterAdmin?"":"none";
  }
  if(visualPanel && !isMasterAdmin){
    visualPanel.hidden=true;
    visualPanel.classList.remove("active","is-active");
  }

  if(isMasterAdmin && settingsRoot && visualButton && visualPanel){
    const active=settingsRoot.querySelector(
      ".settings-tab.active,.config-tab.active,[data-settings-tab].active,[data-config-tab].active,[data-settings-panel].active,[data-config-panel].active"
    );
    if(!active){
      visualButton.hidden=false;
      visualButton.style.display="";
      visualButton.classList.add("active");
      visualPanel.hidden=false;
      visualPanel.classList.add("active");
    }
  }
}

function releaseVisualBootV129(){
  document.documentElement.classList.add("visual-ready");
  document.documentElement.classList.remove("visual-loading");
}

document.addEventListener("DOMContentLoaded",()=>{
  setTimeout(finalizeSettingsTabsV129,0);
  setTimeout(finalizeSettingsTabsV129,250);
  releaseVisualBootV129();
});

window.addEventListener("load",()=>{
  setTimeout(finalizeSettingsTabsV129,0);
  releaseVisualBootV129();
});
