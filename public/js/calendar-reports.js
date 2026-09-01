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

    ["visual","support","security-access","employee-history","calendar","shifts","thermal-rest","job-reports","senior-models","profiles","data"].forEach(tab=>{
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

let holidayTypeSettings={NATIONAL:true,STATE:false,MUNICIPAL:false,OPTIONAL:false};

function readHolidayTypeSettings(){
  return {
    NATIONAL:$("holiday-type-national")?.checked!==false,
    STATE:$("holiday-type-state")?.checked===true,
    MUNICIPAL:$("holiday-type-municipal")?.checked===true,
    OPTIONAL:$("holiday-type-optional")?.checked===true
  };
}

function applyHolidayTypeSettings(settings={}){
  holidayTypeSettings={
    NATIONAL:settings.NATIONAL!==false,
    STATE:settings.STATE===true,
    MUNICIPAL:settings.MUNICIPAL===true,
    OPTIONAL:settings.OPTIONAL===true
  };
  if($("holiday-type-national"))$("holiday-type-national").checked=holidayTypeSettings.NATIONAL;
  if($("holiday-type-state"))$("holiday-type-state").checked=holidayTypeSettings.STATE;
  if($("holiday-type-municipal"))$("holiday-type-municipal").checked=holidayTypeSettings.MUNICIPAL;
  if($("holiday-type-optional"))$("holiday-type-optional").checked=holidayTypeSettings.OPTIONAL;
}

async function loadHolidayTypeSettings(){
  try{
    applyHolidayTypeSettings(await api("/api/calendar/holiday-types"));
  }catch{
    applyHolidayTypeSettings(holidayTypeSettings);
  }
}

async function prepareCalendar(){
  const currentYear=new Date().getFullYear();
  const yearSelect=$("holiday-year");

  if(yearSelect&&!yearSelect.options.length){
    yearSelect.innerHTML=Array.from({length:9},(_,i)=>currentYear-3+i)
      .map(year=>`<option value="${year}" ${year===currentYear?"selected":""}>${year}</option>`).join("");
  }

  await loadHolidayTypeSettings();
  await generateAndLoadHolidays();
}

function formatApiDate(value){
  if(!value)return "-";
  const text=String(value);
  const iso=text.slice(0,10);
  const parts=iso.split("-");
  if(parts.length===3&&parts.every(Boolean))return `${parts[2]}/${parts[1]}/${parts[0]}`;
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"Data inválida":date.toLocaleDateString("pt-BR");
}

function holidayWeekday(value){
  const iso=String(value||"").slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))return "-";
  const [year,month,day]=iso.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR",{weekday:"long",timeZone:"UTC"})
    .format(new Date(Date.UTC(year,month-1,day)));
}

function renderAutomaticHolidays(year){
  const list=$("holiday-list");
  if(!list)return;
  $("holiday-list-title").textContent=`Feriados de ${year}`;
  $("holiday-count").textContent=`${holidays.length} feriado${holidays.length===1?"":"s"}`;

  list.innerHTML=holidays.length
    ? holidays.map(h=>`<tr>
        <td><strong>${formatApiDate(h.holiday_date)}</strong></td>
        <td>${escapeHtml(holidayWeekday(h.holiday_date))}</td>
        <td>${escapeHtml(h.description)}</td>
        <td>${h.branch_name
          ?`<span class="holiday-scope local">${escapeHtml(h.branch_name)}</span>`
          :'<span class="holiday-scope national">Todas as filiais</span>'}</td>
      </tr>`).join("")
    : `<tr><td colspan="4">Nenhum feriado encontrado para ${year} com os tipos selecionados.</td></tr>`;
}

async function loadHolidays(){
  let year=Number($("holiday-year")?.value||new Date().getFullYear());
  if(!Number.isInteger(year)||year<1900||year>2199)year=new Date().getFullYear();
  holidays=await api(`/api/calendar/holidays?year=${year}`);
  renderAutomaticHolidays(year);
}

async function generateAndLoadHolidays(){
  let year=Number($("holiday-year")?.value||new Date().getFullYear());
  const status=$("holiday-generate-status");
  if(!Number.isInteger(year)||year<1900||year>2199){
    year=new Date().getFullYear();
    if($("holiday-year"))$("holiday-year").value=String(year);
  }

  if(status){
    status.className="holiday-online-status loading";
    status.textContent=`Atualizando os tipos selecionados para ${year}...`;
  }

  try{
    const result=await api("/api/calendar/holidays/generate",{
      method:"POST",
      body:JSON.stringify({year})
    });
    holidays=Array.isArray(result.holidays)?result.holidays:[];
    invalidateReportHolidayCache(year);
    reportHolidayCache.set(year,holidays.map(item=>({...item})));
    renderAutomaticHolidays(year);

    if(status){
      const warnings=Array.isArray(result.warnings)?result.warnings:[];
      status.className=`holiday-online-status ${warnings.length?"warning":"success"}`;
      status.innerHTML=warnings.length
        ?`<strong>Calendário atualizado com ressalvas.</strong> ${holidays.length} registro(s) aplicado(s). ${escapeHtml(warnings[0])}${warnings.length>1?` (+${warnings.length-1} aviso(s))`:""}`
        :`<strong>Calendário atualizado.</strong> ${holidays.length} feriado(s) aplicado(s) para ${year}.`;
    }
  }catch(error){
    if(status){
      status.className="holiday-online-status error";
      status.textContent=error.message||"Não foi possível atualizar os feriados.";
    }
  }
}

if($("holiday-year"))$("holiday-year").onchange=generateAndLoadHolidays;

if($("holiday-types-save"))$("holiday-types-save").onclick=async()=>{
  const button=$("holiday-types-save");
  const feedback=$("holiday-types-feedback");
  try{
    setButtonLoading(button,true,"Salvando");
    holidayTypeSettings=await api("/api/calendar/holiday-types",{
      method:"PUT",
      body:JSON.stringify(readHolidayTypeSettings())
    });
    applyHolidayTypeSettings(holidayTypeSettings);
    if(feedback)feedback.textContent="Tipos salvos. Atualizando calendário...";
    await generateAndLoadHolidays();
    if(feedback)feedback.textContent="Configuração salva.";
    toast("Tipos de feriados atualizados.","success");
  }catch(error){
    if(feedback)feedback.textContent=error.message;
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
};

let reportEmployees=[];
let pointImportPreview=null;
let pointDataActive=false;
let pointCompetenceBranches=new Set();
window.thermalRestSettings={mode:"AUTOMATIC",scopeMode:"ALL",authorizedCompanyIds:[],authorizedBranchIds:[],minWorkMinutes:100,workMinutes:100,restMinutes:20,maxRestMinutes:25,variationMinutes:15,cycleDays:31,restCount:3,fontSizePt:7.2};

function thermalAutomaticAllowed(employee,config=window.thermalRestSettings||{}){
  if(!["AUTOMATIC","AUTOMATIC_AND_BLANK"].includes(config.mode))return false;
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
  panel.open=false;
  if(!items.length)return;

  const summary=document.createElement("summary");
  const title=document.createElement("strong");
  title.textContent=`Colaboradores sem ficha (${items.length})`;
  const action=document.createElement("span");
  action.textContent="Ver detalhes";
  panel.ontoggle=()=>{action.textContent=panel.open?"Ocultar detalhes":"Ver detalhes";};
  summary.append(title,action);
  const content=document.createElement("div");
  content.className="report-skipped-content";
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

  content.append(hint,list);
  panel.append(summary,content);
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

function buildThermalSheet(employee,month,thermalPlan,{blankCopy=false}={}){
  const days=reportMonthDays(month);
  const maximumRests=Math.min(4,Math.max(0,...days.map(day=>(thermalPlan?.get(`${employee.id}|${day.iso}`)||[]).length)));
  const restsPerPage=4;
  const pageCount=1;
  const pointLabels={DSR:"DSR",FOLGA:"FOLGA / SEM JORNADA",FERIAS:"FÉRIAS",FALTA:"FALTA",ATESTADO:"ATESTADO",LICENCA:"LICENÇA",SUSPENSAO:"SUSPENSÃO",AFASTAMENTO:"AFASTAMENTO",COMPENSADO:"COMPENSADO",CURSO:"CURSO",OBITO:"ÓBITO FAMILIAR",REVIEW:"REVISAR MARCAÇÕES DO PONTO",NO_MARKINGS:"SEM MARCAÇÕES"};
  return Array.from({length:pageCount},(_,pageIndex)=>{
    const offset=pageIndex*restsPerPage;
    const slots=pageIndex===pageCount-1&&maximumRests>offset?Math.min(restsPerPage,maximumRests-offset):restsPerPage;
    const rows=days.map(d=>{
      const pointState=employee.point_states?.[d.iso];
      const allRests=(thermalPlan?.get(`${employee.id}|${d.iso}`)||[]).slice(0,4);
      // Cópia manual: deliberadamente NÃO consulta point_states, feriados, férias,
      // faltas, atestados, DSR ou qualquer outra ocorrência do ponto.
      // Somente folgas previamente configuradas podem ser pré-marcadas.
      let status=blankCopy
        ?BlankCopyStatus.status(employee,d)
        :(pointDataActive
          ?(pointState&&pointState!=="WORKED"?(pointLabels[pointState]||pointState):pointState?"":dayStatus(employee,d)||"PONTO NÃO IMPORTADO")
          :dayStatus(employee,d));
      if(!blankCopy&&pointDataActive&&pointState==="WORKED"&&!allRests.length)status="JORNADA ABAIXO DO MÍNIMO PARA REPOUSO";
      if(status)return `<tr class="non-work-row"><td>${d.br}</td><td>${d.weekName}</td><td colspan="${slots*2+1}">${escapeHtml(status)}</td></tr>`;
      const rests=blankCopy?[]:allRests.slice(offset,offset+slots);
      const generated=rests.map(rest=>`<td class="thermal-time-cell">${ThermalSchedule.formatMinutes(rest.start)}</td><td class="thermal-time-cell">${ThermalSchedule.formatMinutes(rest.end)}</td>`).join("");
      const cells=generated+'<td class="thermal-time-cell"></td><td class="thermal-time-cell"></td>'.repeat(Math.max(0,slots-rests.length));
      return `<tr><td>${d.br}</td><td>${d.weekName}</td>${cells}<td class="signature-cell"></td></tr>`;
    }).join("");
    const restHeaders=Array.from({length:slots},(_,index)=>`<th class="print-head" colspan="2">Repouso ${offset+index+1}</th>`).join("");
    const subHeaders='<th class="print-head">Saída</th><th class="print-head">Retorno</th>'.repeat(slots);
    const copyLabel=blankCopy?'<div class="thermal-continuation-label">Cópia para preenchimento manual</div>':"";
    const continuation=pageCount>1?`<div class="thermal-continuation-label">${pageIndex===0?"Página principal":`Continuação ${pageIndex+1} de ${pageCount}`} — repousos ${offset+1} a ${offset+slots}</div>`:"";
    const reportType=blankCopy?"thermal-blank":"thermal";
    return `<section class="report-sheet thermal-report-sheet thermal-rests-${slots} month-days-${days.length}" data-report-type="${reportType}" data-employee-id="${escapeHtml(employee.id)}" data-employee-name="${escapeHtml(employee.full_name)}">
      ${reportHeader(employee,"FICHA DE CONTROLE DE REPOUSO TÉRMICO",month)}${copyLabel}${continuation}
      <table class="report-table thermal-report-table"><colgroup><col class="col-date"><col class="col-day"><col span="${slots*2}" class="col-time"><col class="col-signature"></colgroup>
        <thead><tr><th class="print-head" rowspan="2">Data</th><th class="print-head" rowspan="2">Dia</th>${restHeaders}<th class="print-head print-sign-head" rowspan="2">Assinatura do colaborador</th></tr><tr>${subHeaders}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  }).join("");
}

function buildMealSheet(employee,month){
  // A ficha de refeição é manual: não antecipa ocorrências do ponto.
  // Pré-marca somente folgas previamente configuradas no sistema.
  const rows=reportMonthDays(month).map(d=>{
    const status=BlankCopyStatus.status(employee,d);

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
  return `<section class="report-sheet meal-report-sheet month-days-${totalDays}" data-report-type="meal" data-employee-id="${escapeHtml(employee.id)}" data-employee-name="${escapeHtml(employee.full_name)}">
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

const reportHolidayCache=new Map();

async function loadReportHolidaysForMonth(month){
  const match=String(month||"").match(/^(\d{4})-(\d{2})$/);
  if(!match)throw new Error("Competência inválida para carregar os feriados.");
  const year=Number(match[1]);

  // Relatórios usam primeiro os feriados já sincronizados no banco.
  // Assim a geração não fica aguardando uma consulta externa em toda execução.
  if(reportHolidayCache.has(year)){
    holidays=reportHolidayCache.get(year).map(item=>({...item}));
    return {year,source:"MEMORY_CACHE",provider:"Banco de dados",warnings:[],total:holidays.length};
  }

  let cached=await api(`/api/calendar/holidays?year=${year}`);
  cached=Array.isArray(cached)?cached:[];

  if(cached.length){
    holidays=cached;
    reportHolidayCache.set(year,cached.map(item=>({...item})));
    return {year,source:"DATABASE_CACHE",provider:"Banco de dados",warnings:[],total:cached.length};
  }

  // Primeira utilização de um ano ainda não sincronizado:
  // faz uma única sincronização automática para não gerar ficha sem feriados.
  const settings=await api("/api/calendar/holiday-types").catch(()=>({NATIONAL:true}));
  const hasEnabledType=["NATIONAL","STATE","MUNICIPAL","OPTIONAL"].some(type=>settings?.[type]===true);

  if(!hasEnabledType){
    holidays=[];
    reportHolidayCache.set(year,[]);
    return {year,source:"NO_HOLIDAYS_ENABLED",provider:null,warnings:[],total:0};
  }

  const result=await api("/api/calendar/holidays/generate",{
    method:"POST",
    body:JSON.stringify({year})
  });

  holidays=Array.isArray(result.holidays)?result.holidays:[];
  reportHolidayCache.set(year,holidays.map(item=>({...item})));

  return {
    year,
    source:result.source||"INITIAL_SYNC",
    provider:result.provider||null,
    warnings:Array.isArray(result.warnings)?result.warnings:[],
    total:Number(result.automaticTotal??holidays.length)
  };
}

function invalidateReportHolidayCache(year=null){
  if(Number.isInteger(Number(year)))reportHolidayCache.delete(Number(year));
  else reportHolidayCache.clear();
}

async function prepareReports(){
  if(!companies.length)await loadCompanies();
  if(!branches.length)await loadBranches();
  if(!catalogs.shifts.length) await loadCatalogs();
  try{window.thermalRestSettings=await api("/api/settings/thermal-rest");}catch{}
  document.documentElement.style.setProperty("--thermal-time-font-size",`${Number(thermalRestSettings.fontSizePt||7.2)}pt`);
  if($("report-thermal-mode-note"))$("report-thermal-mode-note").innerHTML=thermalRestSettings.mode==="MANUAL"
    ?"<strong>Repouso térmico manual:</strong> os campos serão gerados em branco. Altere em Configurações → Repouso automático."
    :thermalRestSettings.mode==="AUTOMATIC_AND_BLANK"
      ?"<strong>Automático + cópia manual:</strong> cada ficha automática completa será seguida de uma cópia sem horários e sem ocorrências do ponto, mantendo as folgas configuradas no sistema."
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


async function refreshReportsAfterPointImport(importResult){
  const importedMonth=String(importResult?.period?.end||importResult?.period?.start||"").slice(0,7);
  if(!/^\d{4}-\d{2}$/.test(importedMonth))return {importedMonth:null,regenerated:false};

  // Sempre descarta a validação anterior e recarrega as marcações diretamente do banco.
  invalidateReportValidation();
  await applyPointDataToEmployees(importedMonth);

  const currentMonth=$("report-month")?.value||"";
  if(currentMonth!==importedMonth){
    return {importedMonth,regenerated:false,differentMonth:true};
  }

  const output=$("report-output");
  const hadGeneratedSheets=Boolean(output?.querySelector(".report-sheet"));

  if(hadGeneratedSheets){
    // Não deixa a tela continuar exibindo uma ficha antiga após confirmação de um novo ponto.
    output.innerHTML="";
    const summary=$("report-generation-summary");
    if(summary){
      summary.className="full feedback";
      summary.textContent="Cartão de Ponto atualizado. Recalculando as fichas com as marcações mais recentes...";
    }

    // Reutiliza exatamente os filtros já escolhidos pelo usuário.
    await new Promise(resolve=>setTimeout(resolve,0));
    $("report-generate")?.click();
    return {importedMonth,regenerated:true};
  }

  const summary=$("report-generation-summary");
  if(summary){
    summary.className="full feedback success";
    summary.textContent=`Cartão de Ponto de ${reportMonthLabel(importedMonth)} atualizado. As próximas fichas serão geradas com os dados mais recentes.`;
  }
  return {importedMonth,regenerated:false};
}

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

    try{
      const refresh=await refreshReportsAfterPointImport(data);
      if(refresh.regenerated){
        toast("As fichas exibidas foram atualizadas com o novo Cartão de Ponto.","success");
      }else if(refresh.differentMonth){
        toast(`Ponto atualizado para ${reportMonthLabel(refresh.importedMonth)}. Selecione essa competência para gerar as fichas atualizadas.`,"success");
      }
    }catch(refreshError){
      console.error("[POINT_REPORT_REFRESH]",refreshError);
      const output=$("report-output");
      if(output?.querySelector(".report-sheet"))output.innerHTML="";
      const summary=$("report-generation-summary");
      if(summary){
        summary.className="full feedback warning";
        summary.textContent="O Cartão de Ponto foi salvo, mas as fichas abertas foram invalidadas. Clique em Gerar ficha para recalcular com os dados atualizados.";
      }
      toast("Ponto salvo. Gere novamente as fichas para aplicar as marcações atualizadas.","warning");
    }
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
  const [rows,competence]=await Promise.all([
    api(`/api/reports/point-days?month=${encodeURIComponent(month)}&_=${Date.now()}`),
    api(`/api/reports/point-competence?month=${encodeURIComponent(month)}&_=${Date.now()}`)
  ]);
  pointCompetenceBranches=new Set((competence.imports||[]).map(item=>String(item.branch_id)));
  pointDataActive=pointCompetenceBranches.size>0&&rows.length>0;
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
    if(row.eligible_for_automatic_rest&&Array.isArray(row.markings)&&[2,4].includes(row.markings.length))target.schedules[date]=row.markings.join("-");
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


if($("report-employee-select"))$("report-employee-select").onchange=invalidateReportValidation;

$("report-all-employees").onchange=()=>{
  if($("report-all-employees").checked){
    $("report-employee-select").value="";
  }
  refreshReportEmployeeList();
  invalidateReportValidation();
};

$("report-company").onchange=()=>{
  refreshReportBranchOptions();
  refreshReportShiftOptions();
  refreshReportEmployeeList();
  invalidateReportValidation();
};

$("report-branch").onchange=()=>{
  refreshReportShiftOptions();
  refreshReportEmployeeList();
  invalidateReportValidation();
};

["report-shift","report-month"].forEach(id=>{
  $(id).onchange=()=>{
    refreshReportEmployeeList();
    invalidateReportValidation();
  };
});

let lastReportValidation=null;

function invalidateReportValidation(){
  lastReportValidation=null;
  const panel=$("report-validation-panel");
  const toggle=$("report-validation-toggle");
  if(panel)panel.hidden=true;
  if(toggle){ toggle.hidden=true; toggle.textContent="Ver validação"; }
}

function setReportValidationVisibility(show){
  const panel=$("report-validation-panel");
  const toggle=$("report-validation-toggle");
  if(!panel)return;
  panel.hidden=!show;
  if(toggle){
    toggle.hidden=!lastReportValidation;
    if(show){
      toggle.textContent="Ocultar validação";
    }else if(lastReportValidation?.summary){
      toggle.textContent=lastReportValidation.summary;
    }else{
      toggle.textContent="Ver validação";
    }
  }
}

if($("report-validation-toggle"))$("report-validation-toggle").onclick=()=>{
  const panel=$("report-validation-panel");
  if(panel)setReportValidationVisibility(panel.hidden);
};

function renderReportValidation(result,month){
  const panel=$("report-validation-panel");
  if(!panel)return;
  panel.classList.remove("is-ok","has-warning","has-blocker");
  const hasBlocker=result.blockers.length>0;
  const hasWarning=result.warnings.length>0;
  panel.classList.add(hasBlocker?"has-blocker":hasWarning?"has-warning":"is-ok");
  $("report-validation-badge").textContent=hasBlocker?"Bloqueado":hasWarning?"Com avisos":"Aprovado";
  $("report-validation-subtitle").textContent=`Competência ${reportMonthLabel(month)} — conferência executada antes da geração.`;
  $("report-validation-counts").innerHTML=`
    <div><strong>${result.counts.employees}</strong><span>Selecionados</span></div>
    <div><strong>${result.counts.ok}</strong><span>Aptos</span></div>
    <div><strong>${result.counts.warnings}</strong><span>Avisos</span></div>
    <div><strong>${result.counts.blockers}</strong><span>Bloqueios</span></div>`;
  const groups=[];
  if(result.blockers.length)groups.push(`<div class="report-validation-group"><h4>Bloqueios — corrija antes de gerar</h4><ul>${result.blockers.map(item=>`<li>${escapeHtml(item.message)}</li>`).join("")}</ul></div>`);
  if(result.warnings.length)groups.push(`<div class="report-validation-group"><h4>Avisos para conferência</h4><ul>${result.warnings.map(item=>`<li>${escapeHtml(item.message)}</li>`).join("")}</ul></div>`);
  if(!result.blockers.length&&!result.warnings.length)groups.push('<div class="report-validation-group"><strong>✓ Nenhuma inconsistência encontrada para a seleção atual.</strong></div>');
  $("report-validation-details").innerHTML=groups.join("");
  // Mantém a validação sempre recolhida após a conferência.
  // Avisos e bloqueios permanecem visíveis no resumo compacto e os detalhes
  // só são exibidos quando o usuário solicitar.
  setReportValidationVisibility(false);
}

function validateReportBeforeGeneration(month,employees){
  if(!window.ReportValidator)throw new Error("O módulo de validação prévia não foi carregado.");
  const result=window.ReportValidator.validate({
    month,
    employees,
    thermalConfig:thermalRestSettings,
    pointCompetenceBranches
  });
  lastReportValidation={
    month,
    valid:result.valid,
    generated:false,
    summary:`Validação: ${result.counts.ok} aptos · ${result.counts.warnings} avisos · ${result.counts.blockers} bloqueios — Ver detalhes`
  };
  renderReportValidation(result,month);
  return result;
}


function simulatorSelectedEmployee(){
  if($("report-all-employees")?.checked)return null;
  return reportEmployeeSelected();
}

function simulatorParseMarkings(description=""){
  return String(description||"").match(/(?:[01]?\d|2[0-3]):[0-5]\d/g)||[];
}

function simulatorTimelineSegments(employee,day,rests=[]){
  const markings=simulatorParseMarkings(employee.point_schedules?.[day.iso]||"");
  if(markings.length<2)return {markings,segments:[]};

  const toMinutes=value=>{
    const [h,m]=String(value).split(":").map(Number);
    return h*60+m;
  };
  let values=markings.map(toMinutes);
  for(let i=1;i<values.length;i++){
    while(values[i]<=values[i-1])values[i]+=1440;
  }

  const segments=[];
  const addWork=(start,end,label)=>{
    if(end>start)segments.push({type:"work",start,end,label});
  };
  const addBreak=(start,end,label,type="meal")=>{
    if(end>start)segments.push({type,start,end,label});
  };

  if(values.length===2){
    addWork(values[0],values[1],"Jornada");
  }else{
    addWork(values[0],values[1],"Trabalho");
    addBreak(values[1],values[2],"Refeição","meal");
    addWork(values[2],values[3],"Trabalho");
  }

  // Split work segments around rests, preserving meal.
  let finalSegments=[];
  for(const segment of segments){
    if(segment.type!=="work"){
      finalSegments.push(segment);
      continue;
    }
    let cursor=segment.start;
    const inside=(rests||[])
      .filter(rest=>rest.start>=segment.start&&rest.end<=segment.end)
      .sort((a,b)=>a.start-b.start);
    for(const rest of inside){
      if(rest.start>cursor)finalSegments.push({type:"work",start:cursor,end:rest.start,label:"Trabalho"});
      finalSegments.push({type:"rest",start:rest.start,end:rest.end,label:"Repouso térmico"});
      cursor=rest.end;
    }
    if(cursor<segment.end)finalSegments.push({type:"work",start:cursor,end:segment.end,label:"Trabalho"});
  }
  return {markings,segments:finalSegments};
}

function simulatorFormatDuration(start,end){
  const minutes=Math.max(0,Math.round(end-start));
  const h=Math.floor(minutes/60);
  const m=minutes%60;
  return h?`${h}h${m?` ${m}min`:""}`:`${m} min`;
}

function renderReportSimulator(employee,day,plan){
  const rests=(plan?.get(`${employee.id}|${day.iso}`)||[]).slice(0,4);
  const {markings,segments}=simulatorTimelineSegments(employee,day,rests);
  const message=$("report-simulator-message");
  const timeline=$("report-simulator-timeline");
  const details=$("report-simulator-details");

  if(!segments.length){
    message.className="report-simulator-message warning";
    message.textContent="Não há marcações de jornada suficientes neste dia para montar a simulação.";
    timeline.innerHTML="";
    details.innerHTML="";
    if($("report-rest-audit"))$("report-rest-audit").innerHTML="";
    return;
  }

  message.className="report-simulator-message success";
  message.textContent=`${day.br} (${day.weekName}) · ${rests.length} repouso(s) calculado(s).`;

  const start=Math.min(...segments.map(x=>x.start));
  const end=Math.max(...segments.map(x=>x.end));
  const span=Math.max(1,end-start);

  timeline.innerHTML=`
    <div class="simulator-scale">
      <span>${ThermalSchedule.formatMinutes(start)}</span>
      <span>${ThermalSchedule.formatMinutes(end)}</span>
    </div>
    <div class="simulator-track">
      ${segments.map(segment=>{
        const left=((segment.start-start)/span)*100;
        const width=Math.max(1.5,((segment.end-segment.start)/span)*100);
        return `<div class="simulator-segment ${segment.type}" style="left:${left}%;width:${width}%"
          title="${escapeHtml(segment.label)}: ${ThermalSchedule.formatMinutes(segment.start)}–${ThermalSchedule.formatMinutes(segment.end)}">
          <span>${escapeHtml(segment.label)}</span>
        </div>`;
      }).join("")}
    </div>`;

  const cards=[];
  if(markings.length){
    cards.push(`<article><span>Marcações do ponto</span><strong>${markings.map(escapeHtml).join(" · ")}</strong></article>`);
  }
  rests.forEach((rest,index)=>{
    cards.push(`<article class="rest-detail">
      <span>Repouso ${index+1}</span>
      <strong>${ThermalSchedule.formatMinutes(rest.start)} – ${ThermalSchedule.formatMinutes(rest.end)}</strong>
      <small>${simulatorFormatDuration(rest.start,rest.end)}</small>
    </article>`);
  });
  if(markings.length===4){
    cards.push(`<article><span>Refeição</span><strong>${escapeHtml(markings[1])} – ${escapeHtml(markings[2])}</strong></article>`);
  }
  details.innerHTML=cards.join("");

  const auditContainer=$("report-rest-audit");
  if(auditContainer&&window.RestAudit){
    const audit=RestAudit.auditDay(
      employee.point_schedules?.[day.iso]||"",
      rests,
      employee.shift_description||""
    );
    const summaryCards=[
      `<article><span>Regra aplicada</span><strong>${audit.ruleWorkMinutes} min contínuos</strong><small>limite de trabalho contínuo</small></article>`,
      `<article><span>Duração-base</span><strong>${audit.ruleRestMinutes} min</strong><small>por repouso calculado</small></article>`,
      `<article><span>Fonte do cálculo</span><strong>Cartão de ponto</strong><small>${audit.markings.length} marcação(ões) utilizada(s)</small></article>`,
      `<article><span>Limite diário</span><strong>até ${audit.dailyLimit} repouso(s)</strong><small>${audit.overtimeMinutes>0?`${audit.overtimeMinutes} min extras identificados`:"sem acréscimo por hora extra"}</small></article>`
    ].join("");

    const restRows=audit.items.length
      ?audit.items.map(item=>`
        <article class="rest-audit-item ${item.status==="Conforme"?"ok":"review"}">
          <div class="rest-audit-title">
            <div><span>Repouso ${item.index}</span><strong>${item.startLabel} – ${item.endLabel}</strong></div>
            <b>${item.status}</b>
          </div>
          <dl>
            <div><dt>Trecho do ponto</dt><dd>${item.periodLabel}</dd></div>
            <div><dt>Trabalho antes</dt><dd>${item.continuousBefore} min</dd></div>
            <div><dt>Duração</dt><dd>${item.duration} min</dd></div>
            <div><dt>Contagem</dt><dd>reinicia após o repouso</dd></div>
          </dl>
          <p>${escapeHtml(item.explanation)}</p>
        </article>`).join("")
      :`<div class="rest-audit-empty">Nenhum repouso foi calculado para este dia.</div>`;

    const mealNote=audit.meal
      ?`<div class="rest-audit-meal"><strong>Refeição:</strong> ${RestAudit.formatMinutes(audit.meal.start)} – ${RestAudit.formatMinutes(audit.meal.end)}. A refeição separa os períodos de trabalho usados na conferência.</div>`
      :"";

    auditContainer.innerHTML=`
      <div class="rest-audit-heading">
        <div><span class="eyebrow">V1.0.27 · Auditoria explicativa</span><h5>Por que cada repouso foi gerado?</h5></div>
        <small>Somente leitura — nenhuma regra ou horário é alterado aqui.</small>
      </div>
      <div class="rest-audit-summary">${summaryCards}</div>
      ${mealNote}
      <div class="rest-audit-list">${restRows}</div>`;
  }
}

async function openReportSimulator(){
  const month=$("report-month")?.value;
  if(!month)return toast("Selecione o mês de referência.","warning");
  if($("report-all-employees")?.checked){
    return toast("Para simular, selecione apenas um colaborador.","warning");
  }
  const employee=simulatorSelectedEmployee();
  if(!employee)return toast("Selecione um colaborador para visualizar a jornada.","warning");

  try{
    await applyPointDataToEmployees(month);
  }catch(error){
    return toast(`Não foi possível consultar o ponto: ${error.message}`,"error");
  }

  const monthDays=reportMonthDays(month);
  const plan=ThermalSchedule.buildMonthPlan([employee],monthDays,{
    ...thermalRestSettings,
    usePointData:pointDataActive
  });
  const available=monthDays.filter(day=>employee.point_schedules?.[day.iso]);

  $("report-simulator-panel").hidden=false;
  $("report-simulator-employee").innerHTML=`
    <strong>${escapeHtml(employee.full_name)}</strong>
    <span>${escapeHtml(employee.registration||"sem matrícula")} · ${escapeHtml(employee.shift_name||"sem turno")}</span>`;

  const select=$("report-simulator-day");
  select.innerHTML=available.length
    ?available.map(day=>`<option value="${day.iso}">${day.br} — ${escapeHtml(day.weekName)}</option>`).join("")
    :'<option value="">Nenhum dia com jornada disponível</option>';

  if(!available.length){
    $("report-simulator-message").className="report-simulator-message warning";
    $("report-simulator-message").textContent="Não há dias com marcações do ponto para este colaborador na competência selecionada.";
    $("report-simulator-timeline").innerHTML="";
    $("report-simulator-details").innerHTML="";
    if($("report-rest-audit"))$("report-rest-audit").innerHTML="";
    return;
  }

  const render=()=>{
    const day=monthDays.find(item=>item.iso===select.value)||available[0];
    renderReportSimulator(employee,day,plan);
  };
  select.onchange=render;
  render();
}

if($("report-simulator-open"))$("report-simulator-open").onclick=openReportSimulator;
if($("report-simulator-close"))$("report-simulator-close").onclick=()=>{
  $("report-simulator-panel").hidden=true;
};

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

  summary.textContent="Carregando feriados da competência...";
  try{
    await loadReportHolidaysForMonth(month);
  }catch(error){
    summary.className="full feedback error";
    summary.textContent=`Não foi possível carregar os feriados da competência: ${error.message}`;
    alert(`Não foi possível carregar os feriados da competência ${reportMonthLabel(month)}.\n\n${error.message}`);
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

  const validation=validateReportBeforeGeneration(month,selectedEmployees);
  if(!validation.valid){
    summary.className="full feedback error";
    summary.textContent=`Validação bloqueou a geração: ${validation.blockers.length} pendência(s) crítica(s). Corrija os itens indicados acima.`;
    return;
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

  const automaticSelected=selectedEmployees.filter(employee=>
    reportPolicyAllows(employee.report_policy,"thermal")&&thermalAutomaticAllowed(employee,thermalRestSettings)
  );
  if(automaticSelected.length){
    const missingBranches=[...new Map(
      automaticSelected
        .filter(employee=>!pointCompetenceBranches.has(String(employee.branch_id)))
        .map(employee=>[String(employee.branch_id),employee.branch_name||"Filial não identificada"])
    ).values()];
    if(missingBranches.length){
      const competence=reportMonthLabel(month);
      summary.className="full feedback error";
      summary.textContent=`Relatório automático bloqueado: importe e confirme o Cartão de Ponto da competência ${competence}.`;
      alert(
        `RELATÓRIO AUTOMÁTICO BLOQUEADO\n\n`+
        `Não existe Cartão de Ponto confirmado da competência ${competence} para: ${missingBranches.join(", ")}.\n\n`+
        `Importe o PDF correto em Configurações → Repouso automático ou altere o modo para Manual.`
      );
      return;
    }
  }

  const monthDays=reportMonthDays(month);
  const automaticEmployees=reportEmployees.filter(employee=>
    thermalAutomaticAllowed(employee,thermalRestSettings)&&pointCompetenceBranches.has(String(employee.branch_id))
  );
  const thermalPlan=automaticEmployees.length
    ?ThermalSchedule.buildMonthPlan(automaticEmployees,monthDays,{...thermalRestSettings,usePointData:pointDataActive})
    :new Map();
  let html="";
  let thermalCount=0;
  let thermalAutomaticCount=0;
  let thermalManualCount=0;
  let thermalBlankCopyCount=0;
  let mealCount=0;
  for(const employee of selectedEmployees){
    if(selectedEmployees.length>1){
      html+=`<div class="report-group-title" data-employee-id="${escapeHtml(employee.id)}">${escapeHtml(employee.full_name)} — ${escapeHtml(employee.registration||"sem matrícula")}</div>`;
    }
    if(reportPolicyAllows(employee.report_policy,"thermal")){
      html+=buildThermalSheet(employee,month,thermalPlan);
      thermalCount+=1;
      if(thermalAutomaticAllowed(employee,thermalRestSettings)){
        thermalAutomaticCount+=1;
        if(thermalRestSettings.mode==="AUTOMATIC_AND_BLANK"){
          html+=buildThermalSheet(employee,month,thermalPlan,{blankCopy:true});
          thermalBlankCopyCount+=1;
        }
      }
      else thermalManualCount+=1;
    }
    if(reportPolicyAllows(employee.report_policy,"meal")){
      html+=buildMealSheet(employee,month);
      mealCount+=1;
    }
  }
  $("report-output").innerHTML=html;
  const skippedCount=policyBlocked.length+blockedEmployees.length+withoutShift.length;
  if(lastReportValidation&&lastReportValidation.month===month){
    lastReportValidation.valid=true;
    lastReportValidation.generated=true;
  }
  summary.className="full feedback success";
  summary.textContent=`Geração concluída: ${thermalCount} ficha(s) de Repouso Térmico (${thermalAutomaticCount} automática(s), ${thermalBlankCopyCount} cópia(s) manual(is) e ${thermalManualCount} manual(is)), ${mealCount} ficha(s) de Refeição manual`+
    `${skippedCount?` e ${skippedCount} colaborador(es) sem ficha`:""}.`;
  showReportSkippedDetails(skippedEmployees);
};

let reportPrintInProgress=false;

function reportPrintSheets(){
  return [...document.querySelectorAll("#report-output .report-sheet[data-report-type]")];
}

function printCenterSelection(){
  const selectedTypes=new Set();
  if($("print-center-type-thermal")?.checked)selectedTypes.add("thermal");
  if($("print-center-type-blank")?.checked)selectedTypes.add("thermal-blank");
  if($("print-center-type-meal")?.checked)selectedTypes.add("meal");
  return {
    selectedTypes,
    employeeId:$("print-center-employee")?.value||""
  };
}

function printCenterMatchingSheets(){
  const {selectedTypes,employeeId}=printCenterSelection();
  return reportPrintSheets().filter(sheet=>
    selectedTypes.has(sheet.dataset.reportType) &&
    (!employeeId||String(sheet.dataset.employeeId)===String(employeeId))
  );
}

function updatePrintCenterSummary(){
  const all=reportPrintSheets();
  const matches=printCenterMatchingSheets();
  const count=type=>all.filter(sheet=>sheet.dataset.reportType===type).length;

  if($("print-center-thermal-count"))$("print-center-thermal-count").textContent=String(count("thermal"));
  if($("print-center-blank-count"))$("print-center-blank-count").textContent=String(count("thermal-blank"));
  if($("print-center-meal-count"))$("print-center-meal-count").textContent=String(count("meal"));
  if($("print-center-total-count"))$("print-center-total-count").textContent=String(matches.length);

  const feedback=$("print-center-feedback");
  if(feedback){
    feedback.className=`feedback ${matches.length?"":"warning"}`;
    feedback.textContent=matches.length
      ?`${matches.length} ficha(s) selecionada(s) para impressão.`
      :"Nenhuma ficha corresponde à seleção atual.";
  }
}

function populatePrintCenterEmployees(){
  const select=$("print-center-employee");
  if(!select)return;
  const employees=new Map();
  reportPrintSheets().forEach(sheet=>{
    const id=String(sheet.dataset.employeeId||"");
    const name=String(sheet.dataset.employeeName||"");
    if(id&&name)employees.set(id,name);
  });
  select.innerHTML='<option value="">Todos os colaboradores gerados</option>'+
    [...employees.entries()]
      .sort((a,b)=>a[1].localeCompare(b[1],"pt-BR"))
      .map(([id,name])=>`<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`)
      .join("");
}

function openPrintCenter(){
  if(!$("report-output").innerHTML.trim()){
    alert("Gere a ficha antes de abrir a Central de impressão.");
    return;
  }
  const currentMonth=$("report-month").value;
  if(!lastReportValidation||!lastReportValidation.valid||!lastReportValidation.generated||lastReportValidation.month!==currentMonth){
    alert("A impressão foi bloqueada porque a seleção atual não possui uma validação concluída. Gere novamente as fichas para validar antes de imprimir.");
    return;
  }

  populatePrintCenterEmployees();
  if($("print-center-type-thermal"))$("print-center-type-thermal").checked=true;
  if($("print-center-type-blank"))$("print-center-type-blank").checked=true;
  if($("print-center-type-meal"))$("print-center-type-meal").checked=true;
  if($("print-center-employee"))$("print-center-employee").value="";
  updatePrintCenterSummary();
  $("report-print-center").hidden=false;
}

function closePrintCenter(){
  if($("report-print-center"))$("report-print-center").hidden=true;
}

function clearPrintFiltering(){
  reportPrintSheets().forEach(sheet=>sheet.classList.remove("print-center-excluded"));
  document.querySelectorAll("#report-output .report-group-title").forEach(title=>title.classList.remove("print-center-excluded"));
  document.body.classList.remove("print-center-active");
}

function applyPrintCenterFiltering(matches){
  const selected=new Set(matches);
  const employeeIds=new Set(matches.map(sheet=>String(sheet.dataset.employeeId||"")));

  reportPrintSheets().forEach(sheet=>{
    sheet.classList.toggle("print-center-excluded",!selected.has(sheet));
  });

  document.querySelectorAll("#report-output .report-group-title").forEach(title=>{
    title.classList.toggle("print-center-excluded",!employeeIds.has(String(title.dataset.employeeId||"")));
  });

  document.body.classList.add("print-center-active");
}

$("report-print").onclick=openPrintCenter;

document.querySelectorAll("[data-close-print-center]").forEach(button=>{
  button.onclick=closePrintCenter;
});

["print-center-type-thermal","print-center-type-blank","print-center-type-meal","print-center-employee"].forEach(id=>{
  if($(id))$(id).onchange=updatePrintCenterSummary;
});

if($("print-center-select-all"))$("print-center-select-all").onclick=()=>{
  $("print-center-type-thermal").checked=true;
  $("print-center-type-blank").checked=true;
  $("print-center-type-meal").checked=true;
  $("print-center-employee").value="";
  updatePrintCenterSummary();
};

if($("print-center-confirm"))$("print-center-confirm").onclick=event=>{
  if(event && event.isTrusted===false)return;
  if(reportPrintInProgress)return;

  const matches=printCenterMatchingSheets();
  if(!matches.length){
    updatePrintCenterSummary();
    return;
  }

  reportPrintInProgress=true;
  applyPrintCenterFiltering(matches);
  closePrintCenter();

  try{
    window.print();
  }finally{
    setTimeout(()=>{
      clearPrintFiltering();
      reportPrintInProgress=false;
    },900);
  }
};

window.addEventListener("afterprint",()=>{
  clearPrintFiltering();
  reportPrintInProgress=false;
});

$("report-clear").onclick=()=>{
  $("report-output").innerHTML="";
  $("report-employee-select").value="";
  $("report-all-employees").checked=false;
  $("report-generation-summary").className="full feedback";
  $("report-generation-summary").textContent="";
  showReportSkippedDetails([]);
  invalidateReportValidation();
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
