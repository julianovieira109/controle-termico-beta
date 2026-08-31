function dashboardAlertMonthValue(){
  const input=$("dashboard-alert-month");
  if(input?.value)return input.value;
  const now=new Date();
  const value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  if(input)input.value=value;
  return value;
}

function dashboardAlertPersonList(items=[]){
  const limit=12;
  const visible=items.slice(0,limit);
  const html=visible.map(item=>`
    <li>
      <strong>${escapeHtml(item.name||"Colaborador")}</strong>
      <span>${escapeHtml(item.registration||"Sem matrícula")} · ${escapeHtml(item.branchName||"-")}</span>
    </li>`).join("");
  const remaining=items.length-visible.length;
  return `<ul>${html}</ul>${remaining>0?`<small class="dashboard-alert-more">+ ${remaining} outro(s)</small>`:""}`;
}

function renderDashboardAlertGroup({title,description,severity,count,items=[],branches=[],action,label}){
  if(!count)return "";
  const body=branches.length
    ?`<ul>${branches.map(item=>`<li><strong>${escapeHtml(item.branchName||"-")}</strong><span>${escapeHtml(item.companyName||"-")}</span></li>`).join("")}</ul>`
    :dashboardAlertPersonList(items);
  return `
    <details class="dashboard-alert-group severity-${severity}">
      <summary>
        <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></div>
        <b>${count}</b>
      </summary>
      <div class="dashboard-alert-group-body">
        ${body}
        <button type="button" class="secondary compact" data-dashboard-alert-action="${escapeHtml(action)}">${escapeHtml(label)}</button>
      </div>
    </details>`;
}

async function loadDashboardAlerts(){
  const month=dashboardAlertMonthValue();
  const data=await api(`/api/dashboard/alerts?month=${encodeURIComponent(month)}`);
  $("dashboard-alert-critical").textContent=data.summary?.critical||0;
  $("dashboard-alert-warning").textContent=data.summary?.warnings||0;
  $("dashboard-alert-total").textContent=data.summary?.total||0;

  const groups=data.groups||{};
  const sections=[
    renderDashboardAlertGroup({
      title:"Colaboradores sem turno",
      description:"Impede o cálculo correto da jornada.",
      severity:"critical",
      count:groups.missingShift?.length||0,
      items:groups.missingShift||[],
      action:"missing-shift",
      label:"Abrir colaboradores"
    }),
    renderDashboardAlertGroup({
      title:"Filiais sem Cartão de Ponto",
      description:"Não há importação confirmada para a competência.",
      severity:"critical",
      count:groups.missingPointImport?.length||0,
      branches:groups.missingPointImport||[],
      action:"reports",
      label:"Abrir relatórios"
    }),
    renderDashboardAlertGroup({
      title:"Matrícula não informada",
      description:"Cadastro precisa ser conferido.",
      severity:"warning",
      count:groups.missingRegistration?.length||0,
      items:groups.missingRegistration||[],
      action:"employees",
      label:"Abrir colaboradores"
    }),
    renderDashboardAlertGroup({
      title:"Regra de relatório pendente",
      description:"Ainda não foi definido se o colaborador gera ficha.",
      severity:"warning",
      count:groups.pendingPolicy?.length||0,
      items:groups.pendingPolicy||[],
      action:"employees",
      label:"Abrir colaboradores"
    }),
    renderDashboardAlertGroup({
      title:"Colaborador não localizado no ponto",
      description:"A filial tem ponto importado, mas não há linhas do colaborador na competência.",
      severity:"warning",
      count:groups.missingPointRows?.length||0,
      items:groups.missingPointRows||[],
      action:"reports",
      label:"Abrir relatórios"
    })
  ].filter(Boolean);

  $("dashboard-alert-list").innerHTML=sections.join("");
  $("dashboard-alert-empty").hidden=sections.length>0;
}

async function loadDashboard(){
  const d=await api("/api/dashboard/summary");
  $("sum-employees").textContent=d.employees;
  $("sum-companies").textContent=d.companies;
  $("sum-branches").textContent=d.branches;
  $("sum-users").textContent=d.users;
  $("sum-missing-shift").textContent=d.missingShift||0;
  $("welcome-title").textContent=`Olá, ${currentUser.name}`;

  // O alerta legado de "sem turno" fica recolhido: a Central de Alertas
  // passa a ser o único local detalhado para pendências operacionais.
  if($("pending-shift-alert"))$("pending-shift-alert").hidden=true;

  try{
    await loadDashboardAlerts();
  }catch(error){
    console.error("[DASHBOARD_ALERTS]",error);
    if($("dashboard-alert-list")){
      $("dashboard-alert-list").innerHTML='<div class="dashboard-alert-load-error">Não foi possível carregar os alertas desta competência.</div>';
    }
  }
}

if($("dashboard-alert-refresh")){
  $("dashboard-alert-refresh").onclick=()=>loadDashboardAlerts().catch(error=>toast(error.message,"error"));
}
if($("dashboard-alert-month")){
  $("dashboard-alert-month").onchange=()=>loadDashboardAlerts().catch(error=>toast(error.message,"error"));
}
if($("dashboard-alert-list")){
  $("dashboard-alert-list").onclick=event=>{
    const button=event.target.closest("[data-dashboard-alert-action]");
    if(!button)return;
    const action=button.dataset.dashboardAlertAction;
    if(action==="missing-shift"){
      openMissingShiftEmployees();
      return;
    }
    if(action==="employees"){
      navigate("employees");
      loadEmployees();
      return;
    }
    if(action==="reports"){
      navigate("reports");
    }
  };
}

document.querySelectorAll("[data-company-tab]").forEach(button=>{
  button.onclick=()=>{
    document.querySelectorAll("[data-company-tab]").forEach(x=>x.classList.remove("active"));
    button.classList.add("active");

    document.querySelectorAll(".company-tab-panel").forEach(panel=>panel.hidden=true);
    $(button.dataset.companyTab).hidden=false;

    if(button.dataset.companyTab==="branches-tab"){
      fillBranchCompanySelect();
      fillBranchCompanyFilter();
      renderBranchesTable();
    }else{
      renderCompaniesTable();
    }
  };
});

async function loadCompanyBranchAdmin(){
  await loadCompanies();
  await loadBranches();
  fillBranchCompanySelect();
  fillBranchCompanyFilter();
  renderCompanySummary();
  renderCompaniesTable();
  renderBranchesTable();
}

async function loadCompanies(){
  if(currentUser?.role==="ADMIN"){
    companies=await api("/api/admin/companies");
  }else{
    const scoped=await api("/api/employees/scope-options");
    companies=scoped.companies||[];
    if(Array.isArray(scoped.branches))branches=scoped.branches;
  }
  fillCompanySelects();
}

function fillCompanySelects(){
  const opts=`<option value="">Selecione</option>`+
    companies.filter(c=>c.active!==false)
      .map(c=>`<option value="${c.id}">${escapeHtml(c.trade_name)}</option>`).join("");

  ["user-company","employee-company","pdf-import-company","holiday-company"].forEach(id=>{
    if($(id))$(id).innerHTML=opts;
  });

  if($("branch-company")){
    const current=$("branch-company").value;
    $("branch-company").innerHTML=opts;
    if(current)$("branch-company").value=current;
  }
}

async function loadBranches(){
  if(currentUser?.role==="ADMIN"){
    branches=await api("/api/admin/branches");
  }else{
    const scoped=await api("/api/employees/scope-options");
    branches=scoped.branches||[];
    if(Array.isArray(scoped.companies))companies=scoped.companies;
  }
}

function fillBranchCompanySelect(){
  const current=$("branch-company").value;
  $("branch-company").innerHTML=`<option value="">Selecione a empresa</option>`+
    companies.filter(c=>c.active!==false)
      .map(c=>`<option value="${c.id}">${escapeHtml(c.trade_name)}</option>`).join("");
  if(current)$("branch-company").value=current;
}

function fillBranchCompanyFilter(){
  const current=$("branch-company-filter").value;
  $("branch-company-filter").innerHTML=`<option value="">Todas as empresas</option>`+
    companies.map(c=>`<option value="${c.id}">${escapeHtml(c.trade_name)}</option>`).join("");
  if(current)$("branch-company-filter").value=current;
}

function renderCompanySummary(){
  $("company-total-count").textContent=companies.length;
  $("company-active-count").textContent=companies.filter(c=>c.active!==false).length;
  $("company-inactive-count").textContent=companies.filter(c=>c.active===false).length;
  $("branch-total-count").textContent=branches.length;
}

function companyBranchCount(companyId){
  return branches.filter(branch=>String(branch.company_id)===String(companyId)).length;
}

function sortRows(rows,sort){
  return [...rows].sort((a,b)=>{
    const av=String(a[sort.key]??"").toLocaleLowerCase("pt-BR");
    const bv=String(b[sort.key]??"").toLocaleLowerCase("pt-BR");
    return av.localeCompare(bv,"pt-BR",{numeric:true})*sort.direction;
  });
}

function renderCompaniesTable(){
  const search=($("company-search")?.value||"").trim().toLocaleLowerCase("pt-BR");

  let rows=companies.filter(company=>{
    const text=[
      company.trade_name,
      company.legal_name,
      company.cnpj,
      company.city,
      company.state
    ].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
    return !search||text.includes(search);
  });

  rows=sortRows(rows,companySort);

  $("companies-list").innerHTML=rows.length
    ? rows.map(company=>`<tr>
        <td><b>${escapeHtml(company.trade_name)}</b><br><small>${escapeHtml(company.legal_name||"")}</small></td>
        <td>${escapeHtml(company.cnpj||"-")}</td>
        <td>${escapeHtml([company.city,company.state].filter(Boolean).join("/")||"-")}</td>
        <td>${companyBranchCount(company.id)}</td>
        <td><span class="auto-lock">${company.active!==false?"Ativa":"Inativa"}</span></td>
        <td>
          <button class="action-btn" data-ui-action="editCompany" data-ui-id="${company.id}">Editar</button>
          <button class="action-btn danger" data-ui-action="deleteCompany" data-ui-id="${company.id}">Excluir</button>
        </td>
      </tr>`).join("")
    : `<tr><td colspan="6">Nenhuma empresa encontrada.</td></tr>`;
}

function renderBranchesTable(){
  const search=($("branch-search")?.value||"").trim().toLocaleLowerCase("pt-BR");
  const companyId=$("branch-company-filter")?.value||"";

  let rows=branches.filter(branch=>{
    const text=[
      branch.name,
      branch.company_name,
      branch.cnpj,
      branch.internal_code,
      branch.city,
      branch.state
    ].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");

    return (!companyId||String(branch.company_id)===String(companyId))&&
      (!search||text.includes(search));
  });

  rows=sortRows(rows,branchSort);

  $("branches-list").innerHTML=rows.length
    ? rows.map(branch=>`<tr>
        <td><b>${escapeHtml(branch.name)}</b></td>
        <td><span class="company-link-badge">${escapeHtml(branch.company_name||"Sem vínculo")}</span></td>
        <td>${escapeHtml(branch.cnpj||"-")}</td>
        <td>${escapeHtml(branch.internal_code||"-")}</td>
        <td>${escapeHtml([branch.city,branch.state].filter(Boolean).join("/")||"-")}</td>
        <td><span class="branch-count">${branch.employee_count||0}</span></td>
        <td><span class="branch-count">${branch.rh_count||0}</span></td>
        <td><span class="status-dot ${branch.active!==false?"active":"inactive"}"></span>${branch.active!==false?"Ativa":"Inativa"}</td>
        <td>
          <button class="action-btn" data-ui-action="editBranch" data-ui-id="${branch.id}">Editar</button>
          <button class="action-btn danger" data-ui-action="deleteBranch" data-ui-id="${branch.id}">Excluir</button>
        </td>
      </tr>`).join("")
    : `<tr><td colspan="9">Nenhuma filial encontrada.</td></tr>`;
}

$("company-search").oninput=renderCompaniesTable;
$("branch-search").oninput=renderBranchesTable;
$("branch-company-filter").onchange=renderBranchesTable;

document.querySelectorAll("[data-company-sort]").forEach(header=>{
  header.onclick=()=>{
    const key=header.dataset.companySort;
    companySort={
      key,
      direction:companySort.key===key?companySort.direction*-1:1
    };
    renderCompaniesTable();
  };
});

document.querySelectorAll("[data-branch-sort]").forEach(header=>{
  header.onclick=()=>{
    const key=header.dataset.branchSort;
    branchSort={
      key,
      direction:branchSort.key===key?branchSort.direction*-1:1
    };
    renderBranchesTable();
  };
});

function openCompanyTab(tabId){
  const button=document.querySelector(`[data-company-tab="${tabId}"]`);
  if(button)button.click();
}


function openCompanyModal(title){
  const modal=$("company-modal");
  const modalTitle=$("company-modal-title");
  if(!modal||!modalTitle){
    toast("A janela de edição da empresa não foi carregada.","error");
    return;
  }
  modalTitle.textContent=title;
  modal.hidden=false;
  document.body.classList.add("modal-open");
  setTimeout(()=>$("company-legal")?.focus(),50);
}

function closeCompanyModal(){
  const modal=$("company-modal");
  if(modal)modal.hidden=true;
  document.body.classList.remove("modal-open");
}

document.querySelectorAll("[data-close-company-modal]").forEach(element=>{
  element.onclick=()=>{
    resetCompanyForm();
    closeCompanyModal();
  };
});

$("company-new-button").onclick=()=>{
  resetCompanyForm();
  openCompanyModal("Nova empresa");
};


function resetCompanyForm(){
  $("company-form").reset();
  $("company-id").value="";
  $("company-modal-title").textContent="Nova empresa";
  $("company-save-button").textContent="Salvar empresa";
}

$("company-cancel").onclick=()=>{resetCompanyForm();closeCompanyModal();};

$("company-form").onsubmit=async e=>{
  e.preventDefault();
  const id=$("company-id").value;
  const button=$("company-save-button");

  try{
    setButtonLoading(button,true,"Salvando empresa");
    const body={
      legalName:$("company-legal").value.trim(),
      tradeName:$("company-trade").value.trim(),
      cnpj:$("company-cnpj").value.trim(),
      city:$("company-city").value.trim(),
      state:$("company-state").value.trim().toUpperCase(),
      active:$("company-active").value==="true"
    };

    await api(id?`/api/admin/companies/${id}`:"/api/admin/companies",{
      method:id?"PUT":"POST",
      body:JSON.stringify(body)
    });

    toast(id?"Empresa atualizada com sucesso.":"Empresa cadastrada com sucesso.","success");
    resetCompanyForm();
    closeCompanyModal();
    await loadCompanyBranchAdmin();
  }catch(error){
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
};

window.editCompany=id=>{
  const company=companies.find(c=>String(c.id)===String(id));
  if(!company)return;

  openCompanyTab("companies-tab");
  $("company-id").value=company.id;
  $("company-legal").value=company.legal_name||"";
  $("company-trade").value=company.trade_name||"";
  $("company-cnpj").value=company.cnpj||"";
  $("company-city").value=company.city||"";
  $("company-state").value=company.state||"";
  $("company-active").value=String(company.active!==false);
  $("company-modal-title").textContent="Editar empresa";
  $("company-save-button").textContent="Salvar alterações";
  openCompanyModal("Editar empresa");
};

window.deleteCompany=async id=>{
  const company=companies.find(c=>String(c.id)===String(id));
  if(!company)return;

  const confirmed=await confirmAction(
    `Deseja excluir a empresa ${company.trade_name}? A exclusão só será permitida se não existirem filiais, usuários ou colaboradores vinculados.`,
    "Excluir empresa"
  );
  if(!confirmed)return;

  try{
    await api(`/api/admin/companies/${id}`,{method:"DELETE"});
    toast("Empresa excluída com sucesso.","success");
    await loadCompanyBranchAdmin();
  }catch(error){
    toast(error.message,"error");
  }
};


function openBranchModal(title){
  const modal=$("branch-modal");
  const modalTitle=$("branch-modal-title");
  if(!modal||!modalTitle){
    toast("A janela de edição da filial não foi carregada.","error");
    return;
  }
  modalTitle.textContent=title;
  modal.hidden=false;
  document.body.classList.add("modal-open");
  setTimeout(()=>$("branch-company")?.focus(),50);
}

function closeBranchModal(){
  const modal=$("branch-modal");
  if(modal)modal.hidden=true;
  document.body.classList.remove("modal-open");
}

document.querySelectorAll("[data-close-branch-modal]").forEach(element=>{
  element.onclick=()=>{
    resetBranchForm();
    closeBranchModal();
  };
});

$("branch-new-button").onclick=()=>{
  resetBranchForm();
  openBranchModal("Nova filial");
};


function resetBranchForm(){
  $("branch-form").reset();
  $("branch-id").value="";
  $("branch-modal-title").textContent="Nova filial";
  $("branch-save-button").textContent="Salvar filial";
  fillBranchCompanySelect();
}

$("branch-cancel").onclick=()=>{resetBranchForm();closeBranchModal();};

$("branch-form").onsubmit=async e=>{
  e.preventDefault();
  const id=$("branch-id").value;
  const companyId=$("branch-company").value;
  const button=$("branch-save-button");

  if(!companyId){
    toast("Selecione a empresa que será vinculada à filial.","warning");
    return;
  }

  try{
    setButtonLoading(button,true,"Salvando filial");
    const body={
      companyId,
      name:$("branch-name").value.trim(),
      cnpj:$("branch-cnpj").value.trim(),
      internalCode:$("branch-code").value.trim(),
      city:$("branch-city").value.trim(),
      state:$("branch-state").value.trim().toUpperCase(),
      active:$("branch-active").value==="true"
    };

    await api(id?`/api/admin/branches/${id}`:"/api/admin/branches",{
      method:id?"PUT":"POST",
      body:JSON.stringify(body)
    });

    toast(id?"Filial atualizada com sucesso.":"Filial cadastrada e vinculada à empresa.","success");
    resetBranchForm();
    closeBranchModal();
    await loadCompanyBranchAdmin();
  }catch(error){
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
};

window.editBranch=id=>{
  const branch=branches.find(b=>String(b.id)===String(id));
  if(!branch)return;

  openCompanyTab("branches-tab");
  $("branch-id").value=branch.id;
  fillBranchCompanySelect();
  $("branch-company").value=branch.company_id||"";
  $("branch-name").value=branch.name||"";
  $("branch-cnpj").value=branch.cnpj||"";
  $("branch-code").value=branch.internal_code||"";
  $("branch-city").value=branch.city||"";
  $("branch-state").value=branch.state||"";
  $("branch-active").value=String(branch.active!==false);
  $("branch-modal-title").textContent="Editar filial";
  $("branch-save-button").textContent="Salvar alterações";
  openBranchModal("Editar filial");
};

window.deleteBranch=async id=>{
  const branch=branches.find(b=>String(b.id)===String(id));
  if(!branch)return;

  const confirmed=await confirmAction(
    `Deseja excluir a filial ${branch.name}? A exclusão só será permitida se não existirem usuários ou colaboradores vinculados.`,
    "Excluir filial"
  );
  if(!confirmed)return;

  try{
    await api(`/api/admin/branches/${id}`,{method:"DELETE"});
    toast("Filial excluída com sucesso.","success");
    await loadCompanyBranchAdmin();
  }catch(error){
    toast(error.message,"error");
  }
};

if($("user-company"))$("user-company").onchange=()=>fillUserBranchChecks();
if($("user-role"))$("user-role").onchange=updateUserRoleFields;

function updateUserRoleFields(){
  const roleField=$("user-role");
  if(!roleField)return;

  const profile=selectedUserProfile();
  const isRh=(profile?.base_role||"RH")==="RH";
  const companyLabel=$("user-company-label");
  const branchesArea=$("user-branches-area");
  const calendarPermission=$("user-calendar-permission");
  const companyField=$("user-company");

  if(companyLabel)companyLabel.hidden=!isRh;
  if(branchesArea)branchesArea.hidden=!isRh;
  if(calendarPermission)calendarPermission.hidden=!isRh;
  if(companyField)companyField.required=isRh;

  if(!isRh){
    if(companyField)companyField.value="";
    if($("user-branch-checks"))$("user-branch-checks").innerHTML="";
    if($("user-select-all-branches"))$("user-select-all-branches").checked=false;
    if($("user-calendar-access"))$("user-calendar-access").checked=false;
    if($("user-branch-feedback"))$("user-branch-feedback").hidden=true;
  }else if(companyField?.value){
    fillUserBranchChecks(selectedUserBranches());
  }
}

function fillUserBranchChecks(selectedIds=[]){
  const companyId=String($("user-company").value||"");
  const selected=new Set(selectedIds.map(String));

  const companyBranches=branches.filter(
    branch=>String(branch.company_id)===companyId&&branch.active!==false
  );

  $("user-select-all-branches").checked=
    companyBranches.length>0&&companyBranches.every(branch=>selected.has(String(branch.id)));

  $("user-branch-checks").innerHTML=companyBranches.length
    ? companyBranches.map(branch=>`
        <label class="branch-check-item">
          <input type="checkbox" data-user-branch="${securityEscapeHtml(branch.id)}" ${selected.has(String(branch.id))?"checked":""}>
          <span>
            <b>${securityEscapeHtml(branch.name)}</b>
            <br><small>${securityEscapeHtml([branch.city,branch.state].filter(Boolean).join("/")||"Local não informado")}</small>
          </span>
        </label>
      `).join("")
    : `<div class="branch-empty">
         Nenhuma filial ativa está vinculada a esta empresa.
         Cadastre ou vincule uma filial no menu <b>Filiais</b> antes de salvar o usuário operacional.
       </div>`;

  $("user-branch-feedback").hidden=true;
}

function selectedUserBranches(){
  return Array.from(document.querySelectorAll("[data-user-branch]:checked"))
    .map(x=>x.dataset.userBranch);
}

if($("user-select-all-branches"))$("user-select-all-branches").onchange=()=>{
  document.querySelectorAll("[data-user-branch]").forEach(
    checkbox=>checkbox.checked=$("user-select-all-branches").checked
  );
  $("user-branch-feedback").hidden=selectedUserBranches().length>0;
};

if($("user-branch-checks"))$("user-branch-checks").onchange=()=>{
  const checkboxes=Array.from(document.querySelectorAll("[data-user-branch]"));
  $("user-select-all-branches").checked=
    checkboxes.length>0&&checkboxes.every(x=>x.checked);
  $("user-branch-feedback").hidden=selectedUserBranches().length>0;
};


async function loadUserProfilesForUsers(){
  userProfiles=await api("/api/admin/user-profiles");

  fillUserProfileOptions(null);
}

function fillUserProfileOptions(editingUser=null){

  const select=$("user-role");
  if(!select)return;

  const current=select.value;
  const canKeepMaster=Boolean(
    editingUser?.is_master_admin&&currentUser?.isMasterAdmin===true&&
    String(editingUser.id)===String(currentUser.id)
  );
  const available=userProfiles.filter(profile=>!profile.master_admin||canKeepMaster);
  select.innerHTML=available
    .filter(p=>p.active!==false)
    .map(p=>`<option value="${p.id}" data-base-role="${p.base_role}">${p.name}</option>`)
    .join("");

  if(available.some(p=>String(p.id)===String(current))){
    select.value=current;
  }else{
    const rh=userProfiles.find(p=>p.name==="RH")||userProfiles.find(p=>p.base_role==="RH");
    const admin=userProfiles.find(p=>p.name==="Administrador"&&p.base_role==="ADMIN");
    select.value=(rh||admin||userProfiles[0])?.id||"";
  }
}

function selectedUserProfile(){
  return userProfiles.find(p=>String(p.id)===String($("user-role")?.value||""))||null;
}

async function loadUsers(){
  if(!companies.length)await loadCompanies();
  if(!branches.length)await loadBranches();
  await loadUserProfilesForUsers();

  users=await api("/api/admin/users");
  renderUserSummary();
  renderUsersTable();

  if(!$("user-id").value){
    prepareNewUserForm();
  }
}



function renderUserSummary(){
  if(!$("users-total-count"))return;
  $("users-total-count").textContent=users.length;
  $("users-active-count").textContent=users.filter(user=>user.active!==false).length;
  $("users-admin-count").textContent=users.filter(user=>user.role==="ADMIN").length;
  $("users-rh-count").textContent=users.filter(user=>user.role==="RH").length;
}

function openUserModal(title){
  $("user-modal-title").textContent=title;
  $("user-modal").hidden=false;
  document.body.classList.add("modal-open");
  setTimeout(()=>$("user-fullname")?.focus(),50);
}

function closeUserModal(){
  $("user-modal").hidden=true;
  document.body.classList.remove("modal-open");
}

document.querySelectorAll("[data-close-user-modal]").forEach(element=>{
  element.onclick=()=>{
    resetUserForm();
    closeUserModal();
  };
});

$("user-new-button").onclick=()=>{
  resetUserForm();
  openUserModal("Novo usuário");
};


function renderUsersTable(){
  const search=($("user-search")?.value||"").trim().toLocaleLowerCase("pt-BR");
  const role=$("user-role-filter")?.value||"";
  const status=$("user-status-filter")?.value||"";

  const rows=users.filter(user=>{
    const text=[
      user.name,
      user.email,
      user.company_name,
      user.profile_name,
      ...(user.branches||[]).map(b=>b.name)
    ].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");

    return (!search||text.includes(search))&&
      (!role||user.role===role)&&
      (!status||String(user.active!==false)===status);
  });

  $("users-list").innerHTML=rows.length
    ? rows.map(u=>{
      const masterProtected=u.is_master_admin&&currentUser?.isMasterAdmin!==true;
      return `<tr>
        <td><b>${escapeHtml(u.name)}</b><br><small>${escapeHtml(u.email)}</small>${u.must_change_password?'<br><span class="badge-count">Troca de senha pendente</span>':""}</td>
        <td>${escapeHtml(u.profile_name|| (u.role==="ADMIN"?"Administrador":"Operacional / DP"))}</td>
        <td>${escapeHtml(u.company_name||"Acesso geral")}</td>
        <td>${u.role==="ADMIN"?"Todas":escapeHtml((u.branches||[]).map(b=>b.name).join(", ")||"Nenhuma")}</td>
        <td>${u.role==="ADMIN"?"Total":(u.calendar_access?"Permitido":"Bloqueado")}</td>
        <td><span class="status-dot ${u.active!==false?"active":"inactive"}"></span>${u.active!==false?"Ativo":"Inativo"}</td>
        <td>
          <div class="user-actions-inline">
            ${masterProtected
              ? '<span class="auto-lock">Protegido pelo Master</span>'
              : `<button class="action-btn" data-ui-action="editUser" data-ui-id="${u.id}">Editar</button>
                 ${u.is_master_admin?'<span class="auto-lock">Use Minha senha</span>':""}`}
            ${masterProtected?"":u.id===currentUser.id
              ? '<span class="auto-lock">Usuário atual</span>'
              : `<button class="action-btn" data-ui-action="toggleUserActive" data-ui-id="${u.id}" data-ui-active="${u.active===false}">${u.active===false?"Desbloquear":"Bloquear"}</button>
                 <button class="action-btn danger" data-ui-action="deleteUser" data-ui-id="${u.id}">Excluir</button>`}
          </div>
        </td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="7">Nenhum usuário encontrado.</td></tr>`;
}

if($("user-search"))$("user-search").oninput=renderUsersTable;
if($("user-role-filter"))$("user-role-filter").onchange=renderUsersTable;
if($("user-status-filter"))$("user-status-filter").onchange=renderUsersTable;

let securityAccessRows=[];

function securityEscapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,character=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[character]);
}

function securityDateTime(value){
  if(!value)return "Sem registro";
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"Sem registro":date.toLocaleString("pt-BR",{
    day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"
  });
}

function renderSecurityAccess(){
  const body=$("security-access-list");
  if(!body)return;
  const search=String($("security-access-search")?.value||"").trim().toLocaleLowerCase("pt-BR");
  const status=$("security-access-status")?.value||"";
  const filtered=securityAccessRows.filter(user=>{
    const text=`${user.name||""} ${user.email||""} ${user.profile_name||""}`.toLocaleLowerCase("pt-BR");
    const matchesStatus=!status||
      (status==="active"&&user.active!==false)||
      (status==="inactive"&&user.active===false)||
      (status==="attention"&&Number(user.failed_logins||0)>0)||
      (status==="pending"&&user.must_change_password===true);
    return (!search||text.includes(search))&&matchesStatus;
  });

  body.innerHTML=filtered.length?filtered.map(user=>{
    const success=Number(user.successful_logins||0);
    const failed=Number(user.failed_logins||0);
    const recoveries=Number(user.recovery_requests||0);
    const lastAttempt=user.last_attempt_at?new Date(user.last_attempt_at).getTime():0;
    const lastFailed=user.last_failed_at?new Date(user.last_failed_at).getTime():0;
    const lastResult=lastAttempt&&lastFailed===lastAttempt?"Senha incorreta":"Acesso realizado";
    const action=user.is_master_admin
      ? '<span class="auto-lock">Use Minha senha</span>'
      : user.active===false
        ? '<span class="auto-lock">Ative o usuário primeiro</span>'
        : `<button type="button" class="action-btn security-temp-password" data-user-id="${securityEscapeHtml(user.id)}">Gerar senha temporária</button>`;
    return `<tr>
      <td><b>${securityEscapeHtml(user.name)}</b><br><small>${securityEscapeHtml(user.email)}</small><br><span class="security-user-state ${user.active===false?"inactive":"active"}">${user.active===false?"Inativo":"Ativo"}</span>${user.must_change_password?'<span class="security-user-state pending">Troca pendente</span>':""}</td>
      <td><strong class="security-count success">${success}</strong><small>realizado(s)</small></td>
      <td><strong class="security-count ${failed?"danger":"neutral"}">${failed}</strong><small>${failed?"requer atenção":"sem falhas"}</small></td>
      <td><strong class="security-count neutral">${recoveries}</strong><small>por e-mail</small></td>
      <td>${securityDateTime(user.last_attempt_at)}<br><small>${lastAttempt?lastResult:"Contagem iniciada nesta versão"}</small></td>
      <td>${action}</td>
    </tr>`;
  }).join(""):'<tr><td colspan="6">Nenhum usuário encontrado com os filtros selecionados.</td></tr>';

  body.querySelectorAll(".security-temp-password").forEach(button=>{
    button.addEventListener("click",()=>generateSecurityTemporaryPassword(button.dataset.userId));
  });
}

async function loadSecurityAccess(){
  if(currentUser?.isMasterAdmin!==true)return;
  const button=$("security-access-refresh");
  setButtonLoading(button,true,"Atualizando dados de segurança");
  try{
    securityAccessRows=await api("/api/admin/security-access");
    $("security-users-total").textContent=securityAccessRows.length;
    $("security-success-total").textContent=securityAccessRows.reduce((total,user)=>total+Number(user.successful_logins||0),0);
    $("security-failed-total").textContent=securityAccessRows.reduce((total,user)=>total+Number(user.failed_logins||0),0);
    $("security-recovery-total").textContent=securityAccessRows.reduce((total,user)=>total+Number(user.recovery_requests||0),0);
    renderSecurityAccess();
  }finally{
    setButtonLoading(button,false);
  }
}
window.loadSecurityAccess=loadSecurityAccess;

async function generateSecurityTemporaryPassword(userId){
  const user=securityAccessRows.find(item=>String(item.id)===String(userId));
  if(!user)return;
  const confirmed=await confirmAction(
    `Gerar uma senha temporária para ${user.name}? A senha atual deixará de funcionar.`,
    "Gerar senha temporária"
  );
  if(!confirmed)return;
  try{
    const data=await api(`/api/admin/users/${user.id}/temporary-password`,{method:"POST"});
    $("temporary-password-user").textContent=`Usuário: ${user.name} (${user.email})`;
    $("temporary-password-value").value=data.temporaryPassword;
    $("temporary-password-modal").hidden=false;
    document.body.classList.add("modal-open");
    await loadSecurityAccess();
  }catch(error){
    toast(error.message,"error");
  }
}

if($("security-access-search"))$("security-access-search").addEventListener("input",renderSecurityAccess);
if($("security-access-status"))$("security-access-status").addEventListener("change",renderSecurityAccess);
if($("security-access-refresh"))$("security-access-refresh").addEventListener("click",async()=>{
  try{await loadSecurityAccess();}catch(error){toast(error.message,"error");}
});

window.resetUserPassword=async id=>{
  const user=users.find(x=>x.id===id);
  if(!user)return;

  const confirmed=await confirmAction(
    `Gerar uma nova senha temporária para ${user.name}? A senha atual deixará de funcionar.`,
    "Gerar senha temporária"
  );
  if(!confirmed)return;

  try{
    const data=await api(`/api/admin/users/${id}/temporary-password`,{method:"POST"});
    $("temporary-password-user").textContent=`Usuário: ${user.name} (${user.email})`;
    $("temporary-password-value").value=data.temporaryPassword;
    $("temporary-password-modal").hidden=false;
    document.body.classList.add("modal-open");
    await loadUsers();
  }catch(error){
    toast(error.message,"error");
  }
};

if($("temporary-password-copy"))$("temporary-password-copy").onclick=async()=>{
  await copyText($("temporary-password-value").value);
  toast("Senha temporária copiada.","success");
};
if($("temporary-password-close"))$("temporary-password-close").onclick=()=>{
  $("temporary-password-modal").hidden=true;
  $("temporary-password-value").value="";
  document.body.classList.remove("modal-open");
};

async function openMasterRecoveryCodes(){
  $("master-recovery-modal").hidden=false;
  $("master-recovery-result").hidden=true;
  $("master-recovery-feedback").textContent="";
  document.body.classList.add("modal-open");
  try{
    const status=await api("/api/auth/master-recovery-codes/status");
    $("master-recovery-status").textContent=status.available
      ? `${status.available} código(s) de recuperação disponível(is). Gere novos somente se perdeu os anteriores.`
      : "Nenhum código disponível. Gere agora e guarde em local seguro.";
  }catch(error){$("master-recovery-status").textContent=error.message;}
}

function closeMasterRecoveryCodes(){
  $("master-recovery-modal").hidden=true;
  $("master-recovery-form").reset();
  $("master-recovery-result").innerHTML="";
  $("master-recovery-result").hidden=true;
  document.body.classList.remove("modal-open");
}

if($("master-recovery-open"))$("master-recovery-open").onclick=openMasterRecoveryCodes;
document.querySelectorAll("[data-close-master-recovery]").forEach(element=>element.onclick=closeMasterRecoveryCodes);
if($("master-recovery-form"))$("master-recovery-form").onsubmit=async event=>{
  event.preventDefault();
  const feedback=$("master-recovery-feedback");
  feedback.textContent="";
  try{
    const data=await api("/api/auth/master-recovery-codes/regenerate",{
      method:"POST",
      body:JSON.stringify({currentPassword:$("master-recovery-password").value})
    });
    feedback.className="feedback success";
    feedback.textContent=data.message;
    renderRecoveryCodes($("master-recovery-result"),data.recoveryCodes,"Seus códigos de recuperação");
    $("master-recovery-status").textContent=`${data.recoveryCodes.length} código(s) disponível(is).`;
    $("master-recovery-password").value="";
  }catch(error){feedback.className="feedback";feedback.textContent=error.message;}
};

window.toggleUserActive=async(id,active)=>{
  const user=users.find(x=>x.id===id);
  if(!user)return;

  const confirmed=await confirmAction(
    active
      ? `Deseja desbloquear o usuário ${user.name}?`
      : `Deseja bloquear o usuário ${user.name}?`,
    active?"Desbloquear usuário":"Bloquear usuário"
  );
  if(!confirmed)return;

  try{
    await api(`/api/admin/users/${id}/active`,{
      method:"PATCH",
      body:JSON.stringify({active})
    });
    toast(active?"Usuário desbloqueado.":"Usuário bloqueado.","success");
    await loadUsers();
  }catch(error){
    toast(error.message,"error");
  }
};


function prepareNewUserForm(){
  fillUserProfileOptions(null);
  const rhProfile=userProfiles.find(p=>p.name==="RH")||userProfiles.find(p=>p.base_role==="RH");
  if(rhProfile)$("user-role").value=rhProfile.id;
  $("user-active").value="true";
  $("user-password").required=true;
  $("user-password-label").hidden=false;
  $("user-save-button").textContent="Cadastrar usuário";

  if(!$("user-company").value){
    const firstCompany=companies.find(c=>c.active!==false);
    if(firstCompany)$("user-company").value=firstCompany.id;
  }

  updateUserRoleFields();
  fillUserBranchChecks();
}

$("user-form").onsubmit=async e=>{
  e.preventDefault();

  const feedback=$("user-form-feedback");
  const saveButton=$("user-save-button");
  feedback.className="feedback";
  feedback.textContent="Salvando...";
  setButtonLoading(saveButton,true,"Salvando usuário");

  try{
    const id=$("user-id").value;
    const profile=selectedUserProfile();
    if(!profile)throw new Error("Selecione um perfil válido.");
    const role=profile.base_role;
    const profileId=profile.id;
    const branchIds=selectedUserBranches();

    if(role==="RH"&&!$("user-company").value){
      throw new Error("Selecione a empresa do usuário Operacional / DP.");
    }

    if(role==="RH"&&!branchIds.length){
      $("user-branch-feedback").hidden=false;
      throw new Error("Selecione pelo menos uma filial permitida.");
    }

    if(!id&&$("user-password").value.length<8){
      throw new Error("Informe uma senha com pelo menos 8 caracteres.");
    }

    const body={
      name:$("user-fullname").value.trim(),
      email:$("user-email").value.trim(),
      password:$("user-password").value,
      profileId,
      companyId:role==="RH"?$("user-company").value:null,
      branchIds:role==="RH"?branchIds:[],
      calendarAccess:role==="RH"&&$("user-calendar-access").checked,
      active:$("user-active").value==="true"
    };

    await api(id?`/api/admin/users/${id}`:"/api/admin/users",{
      method:id?"PUT":"POST",
      body:JSON.stringify(body)
    });

    feedback.className="feedback success";
    feedback.textContent=id?"Usuário atualizado com sucesso.":"Usuário cadastrado com sucesso.";
    toast(feedback.textContent,"success");

    resetUserForm();
    closeUserModal();
    await loadUsers();
    await loadDashboard();
  }catch(error){
    feedback.className="feedback";
    feedback.textContent=error.message;
    toast(error.message,"error");
  }finally{
    setButtonLoading(saveButton,false);
  }
};

function resetUserForm(){
  $("user-form").reset();
  $("user-id").value="";
  $("user-calendar-access").checked=false;
  $("user-select-all-branches").checked=false;
  $("user-branch-feedback").hidden=true;
  $("user-form-feedback").textContent="";
  prepareNewUserForm();
}

$("user-cancel").onclick=()=>{resetUserForm();closeUserModal();};


window.deleteUser=async id=>{
  const user=users.find(x=>x.id===id);
  if(!user)return;

  const confirmed=await confirmAction(
    `Deseja realmente excluir o usuário ${user.name}? Esta operação não poderá ser desfeita.`,
    "Excluir usuário"
  );
  if(!confirmed)return;

  try{
    const button=document.querySelector(`button[data-ui-action="deleteUser"][data-ui-id="${id}"]`);
    setButtonLoading(button,true,"Excluindo usuário");
    await api(`/api/admin/users/${id}`,{method:"DELETE"});

    const row=button?.closest("tr");
    if(row){
      row.classList.add("delete-row");
      await new Promise(resolve=>setTimeout(resolve,250));
    }

    toast("Usuário excluído com sucesso.","success");
    await loadUsers();
    await loadDashboard();
  }catch(error){
    toast(error.message,"error");
  }
};

window.editUser=id=>{
  const u=users.find(x=>x.id===id);
  if(!u)return;

  $("user-id").value=u.id;
  fillUserProfileOptions(u);
  $("user-fullname").value=u.name;
  $("user-email").value=u.email;
  $("user-role").value=u.profile_id
    || userProfiles.find(p=>p.base_role===u.role && (
      u.role!=="ADMIN"||Boolean(p.master_admin)===Boolean(u.is_master_admin)
    ))?.id
    || "";
  $("user-active").value=String(u.active!==false);
  $("user-password").value="";
  $("user-password").required=false;
  $("user-password-label").hidden=true;
  $("user-save-button").textContent="Salvar alterações";
  $("user-calendar-access").checked=Boolean(u.calendar_access);

  updateUserRoleFields();

  if(u.role==="RH"){
    $("user-company").value=u.company_id||"";
    fillUserBranchChecks((u.branches||[]).map(b=>b.id));
  }

  $("user-form-feedback").textContent="";
  openUserModal("Editar usuário");
};
