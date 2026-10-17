let activeImportModule="point";
const initializedImportModules=new Set();

function canManageImports(){
  return currentUser?.role==="ADMIN"||currentUser?.permissions?.["imports.manage"]===true;
}

async function setImportModule(tab=activeImportModule){
  if(!canManageImports()){
    toast("Seu perfil não possui permissão para importar relatórios.","error");
    return;
  }
  const panels={point:"imports-point-panel",employees:"employee-import-area",shifts:"shift-import-panel"};
  const target=Object.hasOwn(panels,tab)?tab:"point";
  activeImportModule=target;
  document.querySelectorAll("[data-import-tab]").forEach(button=>{
    const active=button.dataset.importTab===target;
    button.classList.toggle("active",active);
    button.setAttribute("aria-selected",String(active));
  });
  Object.entries(panels).forEach(([key,id])=>{$(id).hidden=key!==target;});
  $("imports-feedback").textContent="";
  $("imports-retry").hidden=true;
  if(initializedImportModules.has(target))return;
  $("imports-feedback").textContent="Carregando opções de importação...";
  try{
    const scope=await api("/api/imports/scope-options");
    companies=scope.companies||[];
    branches=scope.branches||[];
    if(target==="point"){
      preparePointImportSelectors();
      await loadPointImportHistory();
    }else if(target==="employees"){
      await preparePdfImport({scopeLoaded:true});
    }else{
      fillShiftImportCompanies();
    }
    initializedImportModules.add(target);
    if(activeImportModule===target)$("imports-feedback").textContent="";
  }catch(error){
    if(activeImportModule===target){
      $("imports-feedback").textContent=error.message||"Não foi possível carregar as opções de importação.";
      $("imports-retry").hidden=false;
    }
  }
}

function prepareImports(){return setImportModule(activeImportModule);}
window.setImportModule=setImportModule;
window.prepareImports=prepareImports;
document.querySelectorAll("[data-import-tab]").forEach(button=>{
  button.onclick=()=>setImportModule(button.dataset.importTab);
});
$("imports-retry").onclick=()=>prepareImports();

// Refresh only areas this profile can access after a successful import.
async function refreshImportRelatedViews(){
  const allowed=key=>currentUser?.role==="ADMIN"||currentUser?.permissions?.[key]===true;
  if(allowed("employees.view"))await loadEmployees();
  if(allowed("dashboard.view"))await loadDashboard();
}
