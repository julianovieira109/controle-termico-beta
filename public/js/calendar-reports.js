function prepareSettingsAccess(){
  const isAdmin=currentUser.role==="ADMIN";
  const isMasterAdmin=isAdmin&&currentUser.isMasterAdmin===true;
  if(isMasterAdmin)fillIdentityForm();

  // A identidade visual é uma configuração global e exclusiva do Master.
  document.querySelectorAll('[data-settings-tab="visual"], #settings-visual').forEach(el=>{
    el.style.display=isMasterAdmin?"":"none";
  });

  const canCalendar=isAdmin||currentUser.permissions?.["calendar.manage"]===true;
  document.querySelectorAll(".calendar-access-only").forEach(el=>el.style.display=canCalendar?"":"none");

  // Se o usuário não for Master, nunca deixa a aba Visual ativa em segundo plano.
  if(!isMasterAdmin){
    const visual=$("settings-visual");
    if(visual)visual.hidden=true;
    const visualTab=document.querySelector('[data-settings-tab="visual"]');
    if(visualTab)visualTab.classList.remove("active");

    const firstAllowed=[...document.querySelectorAll(".settings-tab")].find(tab=>
      !tab.hidden && tab.style.display!=="none"
    );
    if(firstAllowed){
      firstAllowed.click();
    }
  }
}

document.querySelectorAll(".settings-tab").forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll(".settings-tab").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");

    ["visual","support","calendar","shifts","job-reports","senior-models","profiles","data"].forEach(tab=>{
      const panel=$(`settings-${tab}`);
      if(panel)panel.hidden=tab!==btn.dataset.settingsTab;
    });

    if(btn.dataset.settingsTab==="calendar"){
      loadCalendarSection();
    }
    if(btn.dataset.settingsTab==="shifts"){
      loadShiftManagement();
    }
    if(btn.dataset.settingsTab==="job-reports"){
      loadJobReportPolicies();
    }
  };
});

let calendarEmployees=[];
let holidays=[];
let specificDaysOff=[];
let calendarLoading=false;

async function loadCalendarSection(){
  if(calendarLoading)return;
  calendarLoading=true;

  const status=$("holiday-generate-status");
  try{
    if(status)status.textContent="Carregando feriados...";
    await prepareCalendar();
    if(status && !status.textContent.includes("feriados disponíveis")){
      status.textContent="";
    }
  }catch(error){
    console.error("[CALENDAR_LOAD]",error);
    if(status)status.textContent=error.message||"Não foi possível carregar os feriados.";
    toast(error.message||"Não foi possível carregar os feriados.","error");
  }finally{
    calendarLoading=false;
  }
}

async function prepareCalendar(){
  const currentYear=new Date().getFullYear();
  if(!$("holiday-year").options.length){
    $("holiday-year").innerHTML=Array.from({length:7},(_,i)=>currentYear-2+i)
      .map(year=>`<option value="${year}" ${year===currentYear?"selected":""}>${year}</option>`).join("");
  }

  if(!companies.length)await loadCompanies();
  if(!branches.length)await loadBranches();

  calendarEmployees=await api("/api/reports/employees");
  fillHolidaySelectors();
  fillDayOffEmployees();
  await generateAndLoadHolidays();
  await loadDaysOff();
}

function fillHolidaySelectors(){
  const companyMap=[...new Map(calendarEmployees.map(e=>[e.company_name,e])).values()];
  $("holiday-company").innerHTML=`<option value="">Geral</option>`+
    companyMap.map(e=>`<option value="${companies.find(c=>c.trade_name===e.company_name)?.id||""}">${escapeHtml(e.company_name)}</option>`).join("");

  fillHolidayBranches();

  if(currentUser.role!=="ADMIN"){
    $("holiday-company").disabled=true;
    $("holiday-branch").disabled=false;
  }
}

function fillHolidayBranches(){
  const companyId=$("holiday-company").value;
  const allowed=currentUser.role==="ADMIN"
    ? branches
    : branches.filter(b=>(currentUser.branchIds||[]).includes(b.id));

  $("holiday-branch").innerHTML=`<option value="">Todas</option>`+
    allowed.filter(b=>!companyId||b.company_id===companyId)
      .map(b=>`<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
}
$("holiday-company").onchange=fillHolidayBranches;

function formatApiDate(value){
  if(!value)return "-";
  const text=String(value);
  const iso=text.slice(0,10);
  const parts=iso.split("-");
  if(parts.length===3 && parts.every(Boolean)){
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"Data inválida":date.toLocaleDateString("pt-BR");
}

async function loadHolidays(){
  const year=Number($("holiday-year")?.value||new Date().getFullYear());
  holidays=await api(`/api/calendar/holidays?year=${year}`);

  $("holiday-list-title").textContent=`Feriados de ${year}`;
  $("holiday-count").textContent=`${holidays.length} feriado${holidays.length===1?"":"s"}`;

  $("holiday-list").innerHTML=holidays.length
    ? holidays.map(h=>`<tr>
        <td>${formatApiDate(h.holiday_date)}</td>
        <td>${escapeHtml(h.description)}</td>
        <td>${escapeHtml(h.company_name||"Geral")}</td>
        <td>${escapeHtml(h.branch_name||"Todas")}</td>
        <td>${h.automatic?'<span class="auto-lock">Automático</span>':"Manual"}</td>
        <td>${h.automatic
          ? '<span class="auto-lock">Protegido</span>'
          : `<button class="action-btn" data-ui-action="editHoliday" data-ui-id="${h.id}">Editar</button>
             <button class="action-btn danger" data-ui-action="deleteHoliday" data-ui-id="${h.id}">Excluir</button>`}
        </td>
      </tr>`).join("")
    : `<tr><td colspan="6">Nenhum feriado encontrado para ${year}.</td></tr>`;

  if(typeof refreshHolidayGenerationState==="function"){
    await refreshHolidayGenerationState();
  }
}


async function refreshHolidayGenerationState(){
  let year=Number($("holiday-year").value);
  const status=$("holiday-generate-status");
  const button=$("holiday-generate");

  if(!Number.isInteger(year)||year<2000||year>2100){
    year=new Date().getFullYear();
    $("holiday-year").value=String(year);
  }

  const saved=holidays.filter(h=>h.automatic===true).length;
  if(saved>0){
    status.textContent=`${saved} feriado(s) automático(s) de ${year} estão gravados e permanecerão fixos até uma nova geração.`;
    button.textContent="Regerar feriados do ano";
  }else{
    status.textContent=`Nenhum feriado automático foi gerado para ${year}.`;
    button.textContent="Gerar feriados do ano";
  }
}

async function generateAndLoadHolidays(){
  let year=Number($("holiday-year").value);
  const status=$("holiday-generate-status");

  if(!Number.isInteger(year)||year<2000||year>2100){
    year=new Date().getFullYear();
    $("holiday-year").value=String(year);
  }

  const existingAutomatic=holidays.filter(h=>h.automatic===true).length;

  if(existingAutomatic>0){
    const confirmed=await confirmAction(
      `Os feriados automáticos de ${year} já estão gravados. Deseja gerar novamente? Os feriados automáticos desse ano serão substituídos pela lista padrão atual. Feriados manuais serão preservados.`,
      "Regerar feriados do ano"
    );
    if(!confirmed)return;
  }

  status.textContent=`${existingAutomatic>0?"Regerando":"Gerando"} feriados de ${year}...`;

  try{
    const result=await api("/api/calendar/holidays/generate",{
      method:"POST",
      body:JSON.stringify({year})
    });

    await loadHolidays();
    status.textContent=`${result.automaticTotal??0} feriado(s) automático(s) de ${year} gravados. Eles permanecerão fixos até você gerar novamente.`;
    $("holiday-generate").textContent="Regerar feriados do ano";
  }catch(error){
    status.textContent=error.message;
  }
}

$("holiday-year").onchange=async()=>{
  await loadHolidays();
  await refreshHolidayGenerationState();
};

$("holiday-generate").onclick=generateAndLoadHolidays;

$("holiday-form").onsubmit=async e=>{
  e.preventDefault();
  const id=$("holiday-id").value;
  const body={
    companyId:$("holiday-company").value||null,
    branchId:$("holiday-branch").value||null,
    holidayDate:$("holiday-date").value,
    description:$("holiday-description").value,
    automatic:$("holiday-automatic").value==="true"
  };

  await api(id?`/api/calendar/holidays/${id}`:"/api/calendar/holidays",{
    method:id?"PUT":"POST",
    body:JSON.stringify(body)
  });

  resetHolidayForm();
  await loadHolidays();
};

function resetHolidayForm(){
  $("holiday-form").reset();
  $("holiday-id").value="";
  fillHolidaySelectors();
}
$("holiday-cancel").onclick=resetHolidayForm;

window.editHoliday=id=>{
  const h=holidays.find(x=>x.id===id);
  if(!h)return;
  $("holiday-id").value=h.id;
  $("holiday-company").value=h.company_id||"";
  fillHolidayBranches();
  $("holiday-branch").value=h.branch_id||"";
  $("holiday-date").value=String(h.holiday_date).slice(0,10);
  $("holiday-description").value=h.description;
  $("holiday-automatic").value=String(h.automatic);
  window.scrollTo({top:0,behavior:"smooth"});
};

window.deleteHoliday=async id=>{
  if(!confirm("Excluir este feriado?"))return;
  await api(`/api/calendar/holidays/${id}`,{method:"DELETE"});
  await loadHolidays();
};

function fillDayOffEmployees(){
  $("day-off-employee-list").innerHTML=calendarEmployees
    .map(e=>`<option value="${escapeHtml(e.full_name)} — ${escapeHtml(e.registration||"sem matrícula")}"></option>`)
    .join("");
}

function selectedDayOffEmployee(){
  const value=$("day-off-employee").value.trim();
  return calendarEmployees.find(e=>`${e.full_name} — ${e.registration||"sem matrícula"}`===value)
      || calendarEmployees.find(e=>e.full_name.toLowerCase()===value.toLowerCase())
      || null;
}

async function loadDaysOff(){
  specificDaysOff=await api("/api/calendar/days-off");
  $("day-off-list").innerHTML=specificDaysOff.length
    ? specificDaysOff.map(d=>`<tr>
        <td>${formatApiDate(d.off_date)}</td>
        <td>${escapeHtml(d.full_name)}<br><small>${escapeHtml(d.registration||"-")}</small></td>
        <td>${escapeHtml(d.company_name)}<br><small>${escapeHtml(d.branch_name)}</small></td>
        <td>${escapeHtml(d.description)}</td>
        <td><button class="action-btn danger" data-ui-action="deleteDayOff" data-ui-id="${d.id}">Excluir</button></td>
      </tr>`).join("")
    : `<tr><td colspan="5">Nenhuma folga específica cadastrada.</td></tr>`;
}

$("day-off-form").onsubmit=async e=>{
  e.preventDefault();
  const employee=selectedDayOffEmployee();
  if(!employee){
    alert("Selecione um colaborador válido.");
    return;
  }

  await api("/api/calendar/days-off",{
    method:"POST",
    body:JSON.stringify({
      employeeId:employee.id,
      offDate:$("day-off-date").value,
      description:$("day-off-description").value||"Folga"
    })
  });

  $("day-off-form").reset();
  $("day-off-description").value="Folga";
  await loadDaysOff();
};

window.deleteDayOff=async id=>{
  if(!confirm("Excluir esta folga?"))return;
  await api(`/api/calendar/days-off/${id}`,{method:"DELETE"});
  await loadDaysOff();
};

document.querySelectorAll(".calendar-tab").forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll(".calendar-tab").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    const tab=btn.dataset.calendarTab;
    $("calendar-holidays").hidden=tab!=="holidays";
    $("calendar-days-off").hidden=tab!=="days-off";
  };
});

let reportEmployees=[];
let pointImportPreview=null;
let pointDataActive=false;
window.thermalRestSettings={mode:"AUTOMATIC",scopeMode:"ALL",authorizedCompanyIds:[],authorizedBranchIds:[],minWorkMinutes:50,workMinutes:100,restMinutes:20,maxRestMinutes:25,variationMinutes:15,cycleDays:31,restCount:3,fontSizePt:7.2};

function thermalAutomaticAllowed(employee,config=window.thermalRestSettings||{}){
  if(config.mode!=="AUTOMATIC")return false;
  if(config.scopeMode!=="SELECTED")return true;
  const companies=(config.authorizedCompanyIds||[]).map(String);
  const branches=(config.authorizedBranchIds||[]).map(String);
  if(branches.length)return branches.includes(String(employee.branch_id||""));
  return companies.includes(String(employee.company_id||""));
}

function reportMonthDays(monthValue){
  const [year,month]=monthValue.split("-").map(Number);
  const total=new Date(year,month,0).getDate();
  return Array.from({length:total},(_,i)=>{
    const day=i+1;
    const date=new Date(Date.UTC(year,month-1,day));
    return {
      day,
      iso:`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`,
      br:`${String(day).padStart(2,"0")}/${String(month).padStart(2,"0")}/${year}`,
      weekDay:date.getUTCDay(),
      weekName:new Intl.DateTimeFormat("pt-BR",{weekday:"short",timeZone:"UTC"}).format(date).replace(".","")
    };
  });
}

function reportMonthLabel(monthValue){
  const [year,month]=monthValue.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric",timeZone:"UTC"})
    .format(new Date(Date.UTC(year,month-1,1)));
}

function reportEmployeeSelected(){
  const id=$("report-employee-select").value;
  return reportEmployees.find(e=>String(e.id)===String(id))||null;
}

function employeeCanGenerateReports(employee){
  return String(employee?.status||"").trim().toUpperCase()==="ATIVO";
}

function reportPolicyAllows(policy,type){
  const value=String(policy||"PENDING").toUpperCase();
  if(type==="thermal")return value==="BOTH"||value==="THERMAL_ONLY";
  if(type==="meal")return value==="BOTH"||value==="MEAL_ONLY";
  return value==="BOTH"||value==="THERMAL_ONLY"||value==="MEAL_ONLY";
}

function reportSkippedReason(employee,type){
  if(type==="status")return `Situação ${String(employee?.status||"não ativa").toLowerCase()} — somente colaboradores ativos geram ficha`;
  if(type==="shift")return "Sem turno cadastrado";
  const policy=String(employee?.report_policy||"PENDING").toUpperCase();
  if(policy==="PENDING")return "Regra de relatórios pendente";
  if(policy==="NONE")return "Configurado para não gerar relatórios";
  return "A regra atual não permite gerar ficha";
}

function showReportSkippedDetails(items=[]){
  const panel=$("report-skipped-details");
  if(!panel)return;
  panel.innerHTML="";
  panel.hidden=!items.length;
  if(!items.length)return;

  const title=document.createElement("strong");
  title.textContent=`Colaboradores sem ficha (${items.length})`;
  const hint=document.createElement("p");
  hint.textContent="Confira o motivo abaixo para corrigir o cadastro ou a regra de relatórios.";
  const list=document.createElement("ul");

  items
    .slice()
    .sort((a,b)=>String(a.employee?.full_name||"").localeCompare(String(b.employee?.full_name||""),"pt-BR"))
    .forEach(item=>{
      const employee=item.employee||{};
      const row=document.createElement("li");
      const name=document.createElement("strong");
      name.textContent=employee.full_name||"Colaborador sem nome";
      const details=document.createElement("span");
      details.textContent=[
        `Matrícula: ${employee.registration||"não informada"}`,
        `Cargo: ${employee.job_role_name||"não informado"}`,
        `Motivo: ${reportSkippedReason(employee,item.type)}`
      ].join(" • ");
      row.append(name,details);
      list.appendChild(row);
    });

  panel.append(title,hint,list);
}

function reportHeader(employee,title,month){
  const v={...defaultVisualSettings,...visualSettings};
  const reportLogo=v.reportLogoData||v.logoData;

  return `
    <div class="report-header report-header-clean">
      <div class="report-header-brand">
        ${reportLogo?`<img class="report-logo" src="${reportLogo}" alt="Logo">`:""}
      </div>

      <div class="report-header-center">
        <h1>${title}</h1>
      </div>
    </div>

    <div class="report-identification administrative-identification">
      <div class="report-field report-company-field">
        <span class="report-field-label">Empresa</span>
        <span class="report-field-value">${escapeHtml(employee.company_name||"-")}</span>
      </div>
      <div class="report-field report-branch-field">
        <span class="report-field-label">Filial</span>
        <span class="report-field-value">${escapeHtml(employee.branch_name||"-")}</span>
      </div>
      <div class="report-field report-reference-field">
        <span class="report-field-label">Referência</span>
        <span class="report-field-value">${reportMonthLabel(month)}</span>
      </div>

      <div class="report-field report-employee-field">
        <span class="report-field-label">Colaborador</span>
        <span class="report-field-value">${escapeHtml(employee.full_name)}</span>
      </div>
      <div class="report-field report-registration-field">
        <span class="report-field-label">Matrícula</span>
        <span class="report-field-value">${escapeHtml(employee.registration||"-")}</span>
      </div>
      <div class="report-field report-shift-field">
        <span class="report-field-label">Turno</span>
        <span class="report-field-value">${escapeHtml(employee.shift_name||"-")}</span>
      </div>

      <div class="report-field report-role-field">
        <span class="report-field-label">Cargo</span>
        <span class="report-field-value">${escapeHtml(employee.job_role_name||"-")}</span>
      </div>
    </div>`;
}

function dayStatus(employee,d){
  const admission=employee.admission_date?String(employee.admission_date).slice(0,10):null;
  const termination=employee.termination_date?String(employee.termination_date).slice(0,10):null;
  if(admission&&d.iso<admission)return "NÃO ADMITIDO";
  if(termination&&d.iso>termination)return "DESLIGADO";

  const weeklyOff=(employee.weekly_days_off||[]).includes(d.weekDay);
  const specific=(employee.specific_days_off||[]).find(x=>String(x.date).slice(0,10)===d.iso);
  const holiday=holidays.find(h=>String(h.holiday_date).slice(0,10)===d.iso &&
    (!h.company_name||h.company_name===employee.company_name) &&
    (!h.branch_name||h.branch_name===employee.branch_name));
  if(specific)return specific.description||"FOLGA";
  if(holiday)return holiday.description||"FERIADO";
  if(weeklyOff)return "FOLGA / SEM JORNADA";
  return "";
}

function buildThermalSheet(employee,month,thermalPlan){
  const days=reportMonthDays(month);
  const maximumRests=Math.max(0,...days.map(day=>(thermalPlan?.get(`${employee.id}|${day.iso}`)||[]).length));
  const restsPerPage=4;
  const pageCount=Math.max(1,Math.ceil(maximumRests/restsPerPage));
  const pointLabels={DSR:"DSR",FOLGA:"FOLGA / SEM JORNADA",FERIAS:"FÉRIAS",FALTA:"FALTA",ATESTADO:"ATESTADO",LICENCA:"LICENÇA",SUSPENSAO:"SUSPENSÃO",AFASTAMENTO:"AFASTAMENTO",COMPENSADO:"COMPENSADO",CURSO:"CURSO",OBITO:"ÓBITO FAMILIAR",REVIEW:"REVISAR MARCAÇÕES DO PONTO",NO_MARKINGS:"SEM MARCAÇÕES"};
  return Array.from({length:pageCount},(_,pageIndex)=>{
    const offset=pageIndex*restsPerPage;
    const slots=pageIndex===pageCount-1&&maximumRests>offset?Math.min(restsPerPage,maximumRests-offset):restsPerPage;
    const rows=days.map(d=>{
      const pointState=employee.point_states?.[d.iso];
      const allRests=thermalPlan?.get(`${employee.id}|${d.iso}`)||[];
      let status=pointDataActive
        ?(pointState&&pointState!=="WORKED"?(pointLabels[pointState]||pointState):pointState?"":dayStatus(employee,d)||"PONTO NÃO IMPORTADO")
        :dayStatus(employee,d);
      if(pointDataActive&&pointState==="WORKED"&&!allRests.length)status="JORNADA ABAIXO DO MÍNIMO PARA REPOUSO";
      if(status)return `<tr class="non-work-row"><td>${d.br}</td><td>${d.weekName}</td><td colspan="${slots*2+1}">${escapeHtml(status)}</td></tr>`;
      const rests=allRests.slice(offset,offset+slots);
      const generated=rests.map(rest=>`<td class="thermal-time-cell">${ThermalSchedule.formatMinutes(rest.start)}</td><td class="thermal-time-cell">${ThermalSchedule.formatMinutes(rest.end)}</td>`).join("");
      const cells=generated+'<td class="thermal-time-cell"></td><td class="thermal-time-cell"></td>'.repeat(Math.max(0,slots-rests.length));
      return `<tr><td>${d.br}</td><td>${d.weekName}</td>${cells}<td class="signature-cell"></td></tr>`;
    }).join("");
    const restHeaders=Array.from({length:slots},(_,index)=>`<th class="print-head" colspan="2">Repouso ${offset+index+1}</th>`).join("");
    const subHeaders='<th class="print-head">Saída</th><th class="print-head">Retorno</th>'.repeat(slots);
    const continuation=pageCount>1?`<div class="thermal-continuation-label">${pageIndex===0?"Página principal":`Continuação ${pageIndex+1} de ${pageCount}`} — repousos ${offset+1} a ${offset+slots}</div>`:"";
    return `<section class="report-sheet thermal-report-sheet thermal-rests-${slots} month-days-${days.length}">
      ${reportHeader(employee,"FICHA DE CONTROLE DE REPOUSO TÉRMICO",month)}${continuation}
      <table class="report-table thermal-report-table"><colgroup><col class="col-date"><col class="col-day"><col span="${slots*2}" class="col-time"><col class="col-signature"></colgroup>
        <thead><tr><th class="print-head" rowspan="2">Data</th><th class="print-head" rowspan="2">Dia</th>${restHeaders}<th class="print-head print-sign-head" rowspan="2">Assinatura do colaborador</th></tr><tr>${subHeaders}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  }).join("");
}

function buildMealSheet(employee,month){
  const rows=reportMonthDays(month).map(d=>{
    const status=dayStatus(employee,d);

    if(status){
      return `<tr class="non-work-row">
        <td>${d.br}</td>
        <td>${d.weekName}</td>
        <td class="meal-signature-cell">${escapeHtml(status)}</td>
      </tr>`;
    }

    return `<tr>
      <td>${d.br}</td>
      <td>${d.weekName}</td>
      <td class="meal-signature-cell"></td>
    </tr>`;
  }).join("");

  const totalDays=reportMonthDays(month).length;
  return `<section class="report-sheet meal-report-sheet month-days-${totalDays}">
    ${reportHeader(employee,"FICHA DE CONTROLE DE REFEIÇÃO",month)}
    <table class="report-table meal-report-table">
      <colgroup>
        <col class="meal-col-date">
        <col class="meal-col-day">
        <col class="meal-col-signature">
      </colgroup>
      <thead>
        <tr>
          <th class="print-head">Data</th>
          <th class="print-head">Dia</th>
          <th class="print-head print-sign-head">Assinatura do colaborador</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

async function prepareReports(){
  if(!holidays.length){
    try{ holidays=await api("/api/calendar/holidays"); }catch{}
  }
  if(!companies.length)await loadCompanies();
  if(!branches.length)await loadBranches();
  if(!catalogs.shifts.length) await loadCatalogs();
  try{window.thermalRestSettings=await api("/api/settings/thermal-rest");}catch{}
  document.documentElement.style.setProperty("--thermal-time-font-size",`${Number(thermalRestSettings.fontSizePt||7.2)}pt`);
  if($("report-thermal-mode-note"))$("report-thermal-mode-note").innerHTML=thermalRestSettings.mode==="MANUAL"
    ?"<strong>Repouso térmico manual:</strong> os campos serão gerados em branco. Altere em Configurações → Repouso automático."
    :thermalRestSettings.scopeMode==="SELECTED"
      ?"<strong>Repouso térmico autorizado por empresa e filial:</strong> somente colaboradores dentro da autorização receberão horários automáticos. Os demais terão os campos em branco. A refeição permanece manual."
      :"<strong>Repouso térmico automático:</strong> os horários serão preenchidos para todas as empresas e filiais conforme as regras de Configurações. A refeição permanece manual.";

  reportEmployees=(await api("/api/reports/employees"))
    .filter(employeeCanGenerateReports);
  preparePointImportSelectors();
  await loadPointImportHistory();

  const companyOptions=[...new Set(
    reportEmployees.map(e=>e.company_name).filter(Boolean)
  )].sort((a,b)=>a.localeCompare(b,"pt-BR"));

  $("report-company").innerHTML=`<option value="">Todas as empresas</option>`+
    companyOptions.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");

  $("report-month").value=new Date().toISOString().slice(0,7);
  refreshReportFilters();
}

function preparePointImportSelectors(){
  const companySelect=$("point-import-company");
  if(!companySelect)return;
  const allowedCompanies=currentUser.role==="ADMIN"
    ?companies
    :companies.filter(company=>String(company.id)===String(currentUser.companyId||currentUser.company_id||""));
  companySelect.innerHTML='<option value="">Selecione</option>'+allowedCompanies.filter(company=>company.active!==false).map(company=>`<option value="${company.id}">${escapeHtml(company.trade_name||company.legal_name)}</option>`).join("");
  fillPointImportBranches();
}

function fillPointImportBranches(){
  const companyId=$("point-import-company")?.value;
  const select=$("point-import-branch");
  if(!select)return;
  const allowed=branches.filter(branch=>branch.active!==false&&(!companyId||String(branch.company_id)===String(companyId))&&(currentUser.role==="ADMIN"||(currentUser.branchIds||[]).map(String).includes(String(branch.id))));
  select.innerHTML='<option value="">Selecione</option>'+allowed.map(branch=>`<option value="${branch.id}">${escapeHtml(branch.name)}</option>`).join("");
}

if($("point-import-company"))$("point-import-company").onchange=fillPointImportBranches;

async function sendPointImport(path){
  const file=$("point-import-file")?.files?.[0];
  if(!file)throw new Error("Selecione o PDF do Cartão Ponto.");
  const form=new FormData();
  form.append("file",file);
  form.append("companyId",$("point-import-company").value);
  form.append("branchId",$("point-import-branch").value);
  const response=await fetch(path,{method:"POST",headers:{Authorization:`Bearer ${token}`},body:form});
  const data=await response.json().catch(()=>({error:"Resposta inválida do servidor."}));
  if(!response.ok)throw new Error(data.error||"Não foi possível processar o cartão de ponto.");
  return data;
}

function renderPointImportPreview(data){
  pointImportPreview=data;
  $("point-import-preview").hidden=false;
  const period=data.period?`${formatApiDate(data.period.start)} a ${formatApiDate(data.period.end)}`:"não identificado";
  $("point-import-summary").innerHTML=`<div><strong>${data.totals.employees}</strong><span>colaboradores</span></div><div><strong>${data.totals.located}</strong><span>localizados</span></div><div><strong>${data.totals.eligibleDays}</strong><span>dias com 4 marcações</span></div><div><strong>${data.totals.reviewDays}</strong><span>dias para revisão</span></div><div><strong>${data.totals.notFound}</strong><span>não localizados</span></div><p class="full hint">Período: ${period}</p>`;
  $("point-import-body").innerHTML=data.rows.map(row=>`<tr><td>${escapeHtml(row.registration)}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.systemName||"-")}</td><td>${row.eligibleDays}</td><td>${row.reviewDays}</td><td>${row.nonWorkDays}</td><td><span class="import-result ${row.result}">${escapeHtml(row.result.replaceAll("_"," "))}</span></td></tr>`).join("");
}

if($("point-import-form"))$("point-import-form").onsubmit=async event=>{
  event.preventDefault();
  const button=event.submitter||event.currentTarget.querySelector('button[type="submit"]');
  try{
    setButtonLoading(button,true,"Lendo ponto");
    const data=await sendPointImport("/api/imports/timecard-preview");
    renderPointImportPreview(data);
    $("point-import-feedback").className="feedback full success";
    $("point-import-feedback").textContent="Leitura concluída. Confira os resultados antes de confirmar.";
  }catch(error){
    $("point-import-feedback").className="feedback full error";
    $("point-import-feedback").textContent=error.message;
    toast(error.message,"error");
  }finally{setButtonLoading(button,false);}
};

if($("point-import-confirm"))$("point-import-confirm").onclick=async()=>{
  if(!pointImportPreview)return toast("Leia o arquivo antes de confirmar.","warning");
  if(!confirm(`Confirmar as marcações de ${pointImportPreview.totals.located} colaborador(es) localizado(s)?`))return;
  const button=$("point-import-confirm");
  try{
    setButtonLoading(button,true,"Importando ponto");
    const data=await sendPointImport("/api/imports/timecard-confirm");
    $("point-import-feedback").className="feedback full success";
    $("point-import-feedback").textContent=`Importação concluída: ${data.employees} colaborador(es) e ${data.savedDays} dia(s) salvos.`;
    toast("Cartão de ponto importado com sucesso.","success");
    await loadPointImportHistory();
  }catch(error){toast(error.message,"error");$("point-import-feedback").textContent=error.message;}
  finally{setButtonLoading(button,false);}
};

if($("point-import-clear"))$("point-import-clear").onclick=()=>{
  $("point-import-form").reset();pointImportPreview=null;$("point-import-preview").hidden=true;$("point-import-feedback").textContent="";preparePointImportSelectors();
};

async function loadPointImportHistory(){
  const body=$("point-import-history");
  if(!body)return;
  try{
    const rows=await api("/api/imports/timecard-history");
    body.innerHTML=rows.length?rows.map(row=>`<tr><td>${new Date(row.created_at).toLocaleString("pt-BR")}</td><td>${escapeHtml(row.file_name)}</td><td>${row.details?.period?`${formatApiDate(row.details.period.start)} a ${formatApiDate(row.details.period.end)}`:"-"}</td><td>${escapeHtml(row.branch_name||"-")}</td><td>${row.total_updated}</td><td>${escapeHtml(row.user_name||"-")}</td></tr>`).join(""):'<tr><td colspan="6">Nenhum cartão de ponto importado.</td></tr>';
  }catch{body.innerHTML='<tr><td colspan="6">Histórico disponível para usuários com permissão de importação.</td></tr>';}
}

async function applyPointDataToEmployees(month){
  const rows=await api(`/api/reports/point-days?month=${encodeURIComponent(month)}`);
  pointDataActive=rows.length>0;
  const monthStart=`${month}-01`;
  const nextMonthDate=new Date(`${monthStart}T00:00:00Z`);
  nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth()+1);
  const nextMonth=nextMonthDate.toISOString().slice(0,10);
  const employeesById=new Map(reportEmployees.map(employee=>[String(employee.id),employee]));
  const byEmployee=new Map();
  rows.forEach(row=>{
    const id=String(row.employee_id);
    if(!byEmployee.has(id))byEmployee.set(id,{schedules:{},states:{}});
    const target=byEmployee.get(id);
    const sourceDate=String(row.work_date).slice(0,10);
    const date=ThermalSchedule.pointReportDate(sourceDate,employeesById.get(id));
    if(date<monthStart||date>=nextMonth)return;
    target.states[date]=row.point_state;
    if(row.eligible_for_automatic_rest&&Array.isArray(row.markings)&&row.markings.length===4)target.schedules[date]=row.markings.join("-");
  });
  reportEmployees.forEach(employee=>{
    const data=byEmployee.get(String(employee.id))||{schedules:{},states:{}};
    employee.point_schedules=data.schedules;
    employee.point_states=data.states;
  });
  return rows;
}

function refreshReportBranchOptions(){
  const company=$("report-company").value;
  const previous=$("report-branch").value;

  const options=[...new Set(
    reportEmployees
      .filter(e=>!company||e.company_name===company)
      .map(e=>e.branch_name)
      .filter(Boolean)
  )].sort((a,b)=>a.localeCompare(b,"pt-BR"));

  $("report-branch").innerHTML=`<option value="">Todas as filiais</option>`+
    options.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");

  if(options.includes(previous))$("report-branch").value=previous;
}

function refreshReportShiftOptions(){
  const company=$("report-company").value;
  const branch=$("report-branch").value;
  const previous=$("report-shift").value;

  const options=[...new Set(
    reportEmployees
      .filter(e=>
        (!company||e.company_name===company)&&
        (!branch||e.branch_name===branch)&&
        e.shift_name
      )
      .map(e=>e.shift_name)
  )].sort((a,b)=>a.localeCompare(b,"pt-BR"));

  $("report-shift").innerHTML=`<option value="">Todos os turnos</option>`+
    options.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");

  if(options.includes(previous))$("report-shift").value=previous;
}

function refreshReportFilters(){
  refreshReportBranchOptions();
  refreshReportShiftOptions();
  refreshReportEmployeeList();
}

function employeeActiveInReportMonth(employee){
  const month=$("report-month").value;
  if(!month)return true;
  const [year,monthNumber]=month.split("-").map(Number);
  const start=`${year}-${String(monthNumber).padStart(2,"0")}-01`;
  const end=`${year}-${String(monthNumber).padStart(2,"0")}-${String(new Date(year,monthNumber,0).getDate()).padStart(2,"0")}`;
  const admission=employee.admission_date?String(employee.admission_date).slice(0,10):null;
  const termination=employee.termination_date?String(employee.termination_date).slice(0,10):null;
  return (!admission||admission<=end)&&(!termination||termination>=start);
}

function filteredReportEmployees(){
  const company=$("report-company").value;
  const branch=$("report-branch").value;
  const shift=$("report-shift").value;

  return reportEmployees.filter(e=>
    employeeCanGenerateReports(e)&&
    employeeActiveInReportMonth(e)&&
    (!company||e.company_name===company)&&
    (!branch||e.branch_name===branch)&&
    (!shift||e.shift_name===shift)
  );
}

function refreshReportEmployeeList(){
  const filtered=filteredReportEmployees()
    .sort((a,b)=>String(a.full_name).localeCompare(String(b.full_name),"pt-BR"));

  const current=$("report-employee-select").value;

  $("report-employee-select").innerHTML=
    `<option value="">${filtered.length?"Selecione um colaborador":"Nenhum colaborador encontrado"}</option>`+
    filtered.map(e=>
      `<option value="${e.id}">${escapeHtml(e.full_name)} — ${escapeHtml(e.registration||"sem matrícula")} — ${escapeHtml(reportPolicyLabel(e.report_policy))}</option>`
    ).join("");

  if(filtered.some(e=>String(e.id)===String(current))){
    $("report-employee-select").value=current;
  }

  $("report-employee-count").textContent=
    `${filtered.length} colaborador(es) disponível(is) para os filtros selecionados`;

  $("report-employee-select").disabled=
    $("report-all-employees").checked || !filtered.length;
}


$("report-all-employees").onchange=()=>{
  if($("report-all-employees").checked){
    $("report-employee-select").value="";
  }
  refreshReportEmployeeList();
};

$("report-company").onchange=()=>{
  refreshReportBranchOptions();
  refreshReportShiftOptions();
  refreshReportEmployeeList();
};

$("report-branch").onchange=()=>{
  refreshReportShiftOptions();
  refreshReportEmployeeList();
};

["report-shift","report-month"].forEach(id=>{
  $(id).onchange=refreshReportEmployeeList;
});

$("report-generate").onclick=async()=>{
  const month=$("report-month").value;
  const all=$("report-all-employees").checked;
  const summary=$("report-generation-summary");
  summary.className="full feedback";
  summary.textContent="";
  showReportSkippedDetails([]);

  if(!month){
    alert("Selecione o mês de referência.");
    return;
  }
  try{await applyPointDataToEmployees(month);}catch(error){return alert(`Não foi possível consultar o ponto importado: ${error.message}`);}

  let selectedEmployees=[];
  if(all){
    selectedEmployees=filteredReportEmployees();
    if(!selectedEmployees.length){
      alert("Nenhum colaborador encontrado para os filtros selecionados.");
      return;
    }
  }else{
    const employee=reportEmployeeSelected();
    if(!employee){
      alert("Selecione um colaborador pelo nome ou matrícula, ou marque a opção de selecionar todos.");
      return;
    }
    selectedEmployees=[employee];
  }

  const skippedEmployees=[];
  const blockedEmployees=selectedEmployees.filter(e=>!employeeCanGenerateReports(e));
  if(blockedEmployees.length){
    blockedEmployees.forEach(employee=>skippedEmployees.push({employee,type:"status"}));
    selectedEmployees=selectedEmployees.filter(employeeCanGenerateReports);
    alert(
      `${blockedEmployees.length} colaborador(es) demitido(s), inativo(s) ou afastado(s) foram ignorados. `+
      `Somente colaboradores ativos podem gerar fichas de repouso térmico ou refeição.`
    );
  }

  if(!selectedEmployees.length){
    showReportSkippedDetails(skippedEmployees);
    alert("Nenhuma ficha foi gerada. Somente colaboradores ativos podem gerar relatórios.");
    return;
  }

  const policyBlocked=selectedEmployees.filter(e=>!reportPolicyAllows(e.report_policy));
  if(policyBlocked.length){
    policyBlocked.forEach(employee=>skippedEmployees.push({employee,type:"policy"}));
    selectedEmployees=selectedEmployees.filter(e=>reportPolicyAllows(e.report_policy));
    alert(
      `${policyBlocked.length} colaborador(es) não receberam ficha porque estão com a regra Pendente `+
      `ou configurados para não gerar relatórios. Consulte a lista exibida abaixo.`
    );
  }
  if(!selectedEmployees.length){
    summary.textContent="Nenhuma ficha foi gerada. Revise as regras do cargo/função ou a exceção individual.";
    showReportSkippedDetails(skippedEmployees);
    alert("Nenhuma ficha foi gerada. Os colaboradores selecionados estão com a regra Pendente ou configurados para não gerar relatórios.");
    return;
  }

  const withoutShift=selectedEmployees.filter(e=>!e.shift_name);
  if(withoutShift.length){
    const preview=withoutShift.slice(0,5).map(e=>`• ${e.full_name}`).join("\n");
    const more=withoutShift.length>5?`\n• e mais ${withoutShift.length-5}`:"";
    const proceed=confirm(
      `ATENÇÃO: ${withoutShift.length} colaborador(es) estão sem turno cadastrado:\n\n${preview}${more}\n\n`+
      `Eles não serão incluídos nas fichas. Deseja continuar com os demais?`
    );
    if(!proceed)return;
    withoutShift.forEach(employee=>skippedEmployees.push({employee,type:"shift"}));
    selectedEmployees=selectedEmployees.filter(e=>e.shift_name);
  }

  if(!selectedEmployees.length){
    showReportSkippedDetails(skippedEmployees);
    alert("Nenhuma ficha foi gerada porque todos os colaboradores selecionados estão sem turno.");
    return;
  }

  const monthDays=reportMonthDays(month);
  const automaticEmployees=reportEmployees.filter(employee=>thermalAutomaticAllowed(employee,thermalRestSettings));
  const thermalPlan=automaticEmployees.length
    ?ThermalSchedule.buildMonthPlan(automaticEmployees,monthDays,{...thermalRestSettings,usePointData:pointDataActive})
    :new Map();
  let html="";
  let thermalCount=0;
  let thermalAutomaticCount=0;
  let thermalManualCount=0;
  let mealCount=0;
  for(const employee of selectedEmployees){
    if(selectedEmployees.length>1){
      html+=`<div class="report-group-title">${escapeHtml(employee.full_name)} — ${escapeHtml(employee.registration||"sem matrícula")}</div>`;
    }
    if(reportPolicyAllows(employee.report_policy,"thermal")){
      html+=buildThermalSheet(employee,month,thermalPlan);
      thermalCount+=1;
      if(thermalAutomaticAllowed(employee,thermalRestSettings))thermalAutomaticCount+=1;
      else thermalManualCount+=1;
    }
    if(reportPolicyAllows(employee.report_policy,"meal")){
      html+=buildMealSheet(employee,month);
      mealCount+=1;
    }
  }
  $("report-output").innerHTML=html;
  const skippedCount=policyBlocked.length+blockedEmployees.length+withoutShift.length;
  summary.className="full feedback success";
  summary.textContent=`Geração concluída: ${thermalCount} ficha(s) de Repouso Térmico (${thermalAutomaticCount} automática(s) e ${thermalManualCount} manual(is)), ${mealCount} ficha(s) de Refeição manual`+
    `${skippedCount?` e ${skippedCount} colaborador(es) sem ficha`:""}.`;
  showReportSkippedDetails(skippedEmployees);
};

let reportPrintInProgress=false;
$("report-print").onclick=event=>{
  if(!$("report-output").innerHTML.trim()){
    alert("Gere a ficha antes de imprimir.");
    return;
  }

  // Impressão só pode ser iniciada por um toque/clique real do usuário.
  // Evita chamadas programáticas que navegadores móveis classificam como automáticas.
  if(event && event.isTrusted===false)return;
  if(reportPrintInProgress)return;

  reportPrintInProgress=true;
  try{
    window.print();
  }finally{
    setTimeout(()=>{ reportPrintInProgress=false; },800);
  }
};

$("report-clear").onclick=()=>{
  $("report-output").innerHTML="";
  $("report-employee-select").value="";
  $("report-all-employees").checked=false;
  $("report-generation-summary").className="full feedback";
  $("report-generation-summary").textContent="";
  showReportSkippedDetails([]);
  refreshReportEmployeeList();
};


const defaultVisualSettings={
  systemName:"Controle Térmico",
  shortName:"RT",
  systemSubtitle:"Sistema administrativo",
  companyName:"",
  companyCnpj:"",
  companyAddress:"",
  companyPhone:"",
  companyEmail:"",
  companySite:"",
  supportName:"",
  supportWhatsapp:"",
  supportEmail:"",
  supportHours:"",
  supportPasswordHelp:"Caso tenha esquecido a sua senha, entre em contato com o Suporte.",
  footerText:"Controle Térmico",
  primaryColor:"#154c79",
  menuColor:"#0e3554",
  backgroundColor:"#f3f6f9",
  cardColor:"#ffffff",
  headingColor:"#1f2937",
  linkColor:"#154c79",
  theme:"light",
  fontFamily:"Arial, sans-serif",
  logoData:"",
  menuLogoData:"",
  reportLogoData:"",
  faviconData:"",
  loginBackgroundData:"",
  reportHeaderColor:"#eef2f6",
  reportHeaderTextColor:"#111827",
  reportBorderColor:"#64748b",
  reportOffDayColor:"#e8edf2",
  reportOffDayTextColor:"#475569",
  reportOffDayBorderColor:"#87939e",
  reportOffDayBorderWidth:"0.65",
  reportSheetColor:"#ffffff",
  reportTopBarColor:"#154c79",
  reportTitleAreaColor:"#ffffff",
  reportTitleColor:"#111827",
  reportTitleBorderColor:"#64748b",
  reportIdentificationColor:"#ffffff",
  reportIdentificationBorderColor:"#cbd5e1",
  reportIdentificationLabelColor:"#475569",
  reportIdentificationTextColor:"#111827",
  reportNormalRowColor:"#ffffff",
  reportNormalTextColor:"#111827"
};
