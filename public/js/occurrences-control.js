(function(global){
  const $=id=>document.getElementById(id);
  const config=[
    ["days_off","Folgas","occ-sum-days-off"],
    ["absences","Faltas","occ-sum-absences"],
    ["bank_hours","BH / Banco de Horas","occ-sum-bank-hours"],
    ["medical","Atestados","occ-sum-medical"],
    ["vacations","Férias","occ-sum-vacations"],
    ["dsr","DSR","occ-sum-dsr"],
    ["licenses","Licenças","occ-sum-licenses"],
    ["leaves","Afastamentos","occ-sum-leaves"],
    ["compensated","Compensados","occ-sum-compensated"],
    ["courses","Curso","occ-sum-courses"],
    ["bereavement","Óbito","occ-sum-bereavement"],
    ["review_days","Dias para revisão","occ-sum-review-days"]
  ];
  const labels=Object.fromEntries(config.map(([key,label])=>[key,label]));
  let rows=[];
  let activeKey="";
  let loadedKey="";
  let companies=[];
  let branches=[];
  let lastData={summary:{},imports:[]};
  let management={shiftCoordinators:{},employeeCoordinators:{}};

  function esc(value){
    return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function normalize(value){
    return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  }
  function number(row,key){return Number(row?.[key]||0);}
  function formatDuration(minutes,{signed=true}={}){
    const value=Math.round(Number(minutes)||0);
    const sign=signed?(value>0?"+":value<0?"-":""):"";
    const abs=Math.abs(value);
    return `${sign}${String(Math.floor(abs/60)).padStart(2,"0")}:${String(abs%60).padStart(2,"0")}`;
  }
  function currentFilters(){
    return {
      month:$("occurrences-month")?.value||new Date().toISOString().slice(0,7),
      companyId:$("occurrences-company")?.value||"",
      branchId:$("occurrences-branch")?.value||"",
      shiftId:$("occurrences-shift")?.value||"",
      coordinator:$("occurrences-coordinator")?.value||"",
      employeeId:$("occurrences-employee")?.value||"",
      status:$("occurrences-status")?.value||""
    };
  }
  function requestKey(){
    const f=currentFilters();
    return `${f.month}|${f.companyId}|${f.branchId}`;
  }
  function monthLabel(month){
    const [year,m]=String(month||"").split("-").map(Number);
    return year&&m?new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric"}).format(new Date(year,m-1,1)):"-";
  }

  function formatDate(value){
    const match=String(value||"").slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match?`${match[3]}/${match[2]}/${match[1]}`:"-";
  }
  function importPeriod(imports=[]){
    const starts=imports.map(item=>String(item.period_start||"").slice(0,10)).filter(Boolean).sort();
    const ends=imports.map(item=>String(item.period_end||"").slice(0,10)).filter(Boolean).sort();
    return starts.length&&ends.length?{start:starts[0],end:ends[ends.length-1]}:null;
  }
  function selectedText(id,fallback){
    const select=$(id);
    if(!select||!select.value)return fallback;
    return select.options[select.selectedIndex]?.textContent||fallback;
  }

  async function loadScopeOptions(){
    if(companies.length||branches.length)return;
    const [companyRows,branchRows]=await Promise.all([
      api("/api/admin/companies"),
      api("/api/admin/branches")
    ]);
    companies=(companyRows||[]).filter(item=>item.active!==false);
    branches=(branchRows||[]).filter(item=>item.active!==false);
    fillCompanies();
    fillBranches();
  }
  function fillCompanies(){
    const current=$("occurrences-company")?.value||"";
    if(!$("occurrences-company"))return;
    $("occurrences-company").innerHTML='<option value="">Todas as empresas</option>'+
      companies.map(item=>`<option value="${esc(item.id)}">${esc(item.trade_name)}</option>`).join("");
    $("occurrences-company").value=current;
  }
  function fillBranches(){
    const companyId=$("occurrences-company")?.value||"";
    const current=$("occurrences-branch")?.value||"";
    const available=branches.filter(item=>!companyId||String(item.company_id)===String(companyId));
    if(!$("occurrences-branch"))return;
    $("occurrences-branch").innerHTML='<option value="">Todas as filiais</option>'+
      available.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
    if(available.some(item=>String(item.id)===String(current)))$("occurrences-branch").value=current;
    else $("occurrences-branch").value="";
  }

  function setLoading(){
    for(const [, ,id] of config)if($(id))$(id).textContent="—";
    if($("occurrences-import-status"))$("occurrences-import-status").textContent="Consultando competência...";
    if($("occurrences-table-body"))$("occurrences-table-body").innerHTML='<tr><td colspan="7" class="muted">Carregando ocorrências...</td></tr>';
    if($("occurrences-bar-chart"))$("occurrences-bar-chart").innerHTML='<div class="occurrences-chart-loading">Carregando indicadores...</div>';
  }
  function renderSummary(summary={}){
    for(const [key,,id] of config)if($(id))$(id).textContent=Number(summary[key]||0);
    if($("occ-kpi-absences"))$("occ-kpi-absences").textContent=Number(summary.absences||0);
    if($("occ-kpi-bank-hours"))$("occ-kpi-bank-hours").textContent=summary.bh_net||formatDuration(summary.bh_net_minutes||0);
    if($("occ-kpi-bank-hours-positive"))$("occ-kpi-bank-hours-positive").textContent=summary.bh_positive||formatDuration(summary.bh_positive_minutes||0);
    if($("occ-kpi-bank-hours-negative"))$("occ-kpi-bank-hours-negative").textContent=summary.bh_negative||`-${formatDuration(summary.bh_negative_minutes||0,{signed:false})}`;
    if($("occ-kpi-review"))$("occ-kpi-review").textContent=Number(summary.review_days||0);
    const early=rows.reduce((sum,row)=>sum+number(row,"early_exits"),0);
    if($("occ-kpi-early-exits"))$("occ-kpi-early-exits").textContent=early;
  }
  function dashboardRows(){
    const f=currentFilters();
    return rows.filter(row=>{
      if(f.shiftId && String(row.shift_id||"")!==String(f.shiftId))return false;
      if(f.coordinator && normalize(row.coordinator?.name||"")!==normalize(f.coordinator))return false;
      if(f.employeeId && String(row.employee_id)!==String(f.employeeId))return false;
      return true;
    });
  }
  function renderStatusSummary(){
    const base=dashboardRows();
    const counts={GREEN:0,YELLOW:0,RED:0};
    base.forEach(row=>{const key=String(row.indicator_status||"");if(key in counts)counts[key]++;});
    const total=base.length||0;
    if($("occ-status-green"))$("occ-status-green").textContent=counts.GREEN;
    if($("occ-status-yellow"))$("occ-status-yellow").textContent=counts.YELLOW;
    if($("occ-status-red"))$("occ-status-red").textContent=counts.RED;
    if($("occ-status-green-pct"))$("occ-status-green-pct").textContent=total?`${Math.round(counts.GREEN/total*100)}% da equipe`:'Dentro do padrão';
    if($("occ-status-yellow-pct"))$("occ-status-yellow-pct").textContent=total?`${Math.round(counts.YELLOW/total*100)}% da equipe`:'Requer acompanhamento';
    if($("occ-status-red-pct"))$("occ-status-red-pct").textContent=total?`${Math.round(counts.RED/total*100)}% da equipe`:'Ação prioritária';
    if($("occ-kpi-total-employees"))$("occ-kpi-total-employees").textContent=total;
    document.querySelectorAll("#occurrences-primary-kpis [data-status]").forEach(button=>button.classList.toggle("active-filter",button.dataset.status===$("occurrences-status")?.value));
  }
  function visibleRows(){
    const query=normalize($("occurrences-search")?.value);
    return rows.filter(row=>{
      const f=currentFilters();
      if(activeKey && number(row,activeKey)<=0)return false;
      if(f.shiftId && String(row.shift_id||"")!==String(f.shiftId))return false;
      if(f.coordinator && normalize(row.coordinator?.name||"")!==normalize(f.coordinator))return false;
      if(f.employeeId && String(row.employee_id)!==String(f.employeeId))return false;
      if(f.status && String(row.indicator_status||"")!==String(f.status))return false;
      if(!query)return true;
      return normalize(`${row.full_name} ${row.registration||""} ${row.company_name||""} ${row.branch_name||""} ${row.shift_name||""} ${row.coordinator?.name||""}`).includes(query);
    });
  }
  function fillOperationalFilters(){
    const keep={shift:$("occurrences-shift")?.value||"",coord:$("occurrences-coordinator")?.value||"",employee:$("occurrences-employee")?.value||""};
    const shifts=[...new Map(rows.filter(r=>r.shift_id).map(r=>[String(r.shift_id),r.shift_name||"Turno"])).entries()].sort((a,b)=>a[1].localeCompare(b[1],"pt-BR"));
    const coordinators=[...new Set(rows.map(r=>r.coordinator?.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
    const employees=[...rows].sort((a,b)=>String(a.full_name).localeCompare(String(b.full_name),"pt-BR"));
    if($("occurrences-shift")){$("occurrences-shift").innerHTML='<option value="">Todos os turnos</option>'+shifts.map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join("");$("occurrences-shift").value=shifts.some(([id])=>id===keep.shift)?keep.shift:"";}
    if($("occurrences-coordinator")){$("occurrences-coordinator").innerHTML='<option value="">Todos os coordenadores</option>'+coordinators.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join("");$("occurrences-coordinator").value=coordinators.includes(keep.coord)?keep.coord:"";}
    if($("occurrences-employee")){$("occurrences-employee").innerHTML='<option value="">Todos os colaboradores</option>'+employees.map(r=>`<option value="${esc(r.employee_id)}">${esc(r.full_name)}</option>`).join("");$("occurrences-employee").value=employees.some(r=>String(r.employee_id)===keep.employee)?keep.employee:"";}
    fillManagementSelectors();
  }

  function branchManagementRows(){
    const f=currentFilters();
    if(!f.companyId||!f.branchId)return [];
    return rows.filter(r=>String(r.company_id||"")===String(f.companyId)&&String(r.branch_id||"")===String(f.branchId));
  }
  function coordinatorOptions(emptyLabel,sourceRows=branchManagementRows()){
    return `<option value="">${esc(emptyLabel)}</option>`+[...sourceRows].sort((a,b)=>String(a.full_name).localeCompare(String(b.full_name),"pt-BR")).map(r=>`<option value="${esc(r.employee_id)}" data-name="${esc(r.full_name)}">${esc(r.full_name)} · ${esc(r.shift_name||"Sem turno")}</option>`).join("");
  }
  function fillManagementSelectors(){
    const scoped=branchManagementRows();
    if($("occurrences-manage-employee"))$("occurrences-manage-employee").innerHTML='<option value="">Selecione o colaborador</option>'+[...scoped].sort((a,b)=>String(a.full_name).localeCompare(String(b.full_name),"pt-BR")).map(r=>`<option value="${esc(r.employee_id)}">${esc(r.full_name)} · ${esc(r.shift_name||"Sem turno")}</option>`).join("");
    if($("occurrences-manage-employee-coordinator"))$("occurrences-manage-employee-coordinator").innerHTML=coordinatorOptions("Usar coordenador do turno",scoped);
    renderTeamManagement();
  }
  function teamShiftRows(){
    const map=new Map();
    branchManagementRows().filter(r=>r.shift_id).forEach(r=>{
      const id=String(r.shift_id), item=map.get(id)||{id,name:r.shift_name||"Turno",employees:[],green:0,yellow:0,red:0};
      item.employees.push(r);
      const status=String(r.indicator_status||"").toLowerCase(); if(status==="green")item.green++; else if(status==="yellow")item.yellow++; else if(status==="red")item.red++;
      map.set(id,item);
    });
    return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));
  }
  function renderTeamManagement(){
    const holder=$("occurrences-team-cards"); if(!holder)return;
    const f=currentFilters();
    if(!f.companyId||!f.branchId){holder.innerHTML='<div class="muted">Selecione uma empresa e uma filial no painel antes de configurar as equipes.</div>';return;}
    const shifts=teamShiftRows();
    if(!shifts.length){holder.innerHTML='<div class="muted">Nenhum turno encontrado para esta filial.</div>';return;}
    holder.innerHTML=shifts.map(item=>{
      const current=management.shiftCoordinators?.[item.id]?.id||"";
      const options=coordinatorOptions("Sem coordenador").replace(`value="${esc(current)}"`,`value="${esc(current)}" selected`);
      return `<article class="occ-team-card" data-shift-id="${esc(item.id)}"><div class="occ-team-card-info"><strong>${esc(item.name)}</strong><span>${item.employees.length} colaborador${item.employees.length===1?"":"es"}</span><small><b class="green">🟢 ${item.green}</b><b class="yellow">🟡 ${item.yellow}</b><b class="red">🔴 ${item.red}</b></small></div><label>Coordenador responsável<select class="occ-team-coordinator-select">${options}</select></label><button type="button" class="secondary occ-team-save">Salvar</button></article>`;
    }).join("");
  }
  function openTeamManagement(){
    const modal=$("occurrences-management"); if(!modal)return;
    const f=currentFilters(); if(!f.companyId||!f.branchId){toast?.("Selecione empresa e filial antes de gerenciar as equipes.","error");return;}
    renderTeamManagement(); modal.hidden=false; modal.setAttribute("aria-hidden","false"); document.body.classList.add("occ-team-modal-open");
  }
  function closeTeamManagement(){const modal=$("occurrences-management");if(!modal)return;modal.hidden=true;modal.setAttribute("aria-hidden","true");document.body.classList.remove("occ-team-modal-open");}

  async function loadManagement(){
    const f=currentFilters(); management={shiftCoordinators:{},employeeCoordinators:{}};
    if(!f.companyId||!f.branchId)return;
    try{management=await api(`/api/dashboard/occurrences/management?companyId=${encodeURIComponent(f.companyId)}&branchId=${encodeURIComponent(f.branchId)}`)||management;}catch(_error){}
  }
  function selectedCoordinator(selectId){
    const el=$(selectId); if(!el||!el.value)return null;
    return {id:String(el.value),name:el.options[el.selectedIndex]?.textContent||""};
  }
  async function saveManagement(kind,payload={}){
    const f=currentFilters(); if(!f.companyId||!f.branchId){toast?.("Selecione empresa e filial.","error");return;}
    if(kind==="shift"){
      const id=payload.shiftId||""; if(!id){toast?.("Selecione o turno.","error");return;}
      const coord=payload.coordinator||null; if(coord)management.shiftCoordinators[id]=coord; else delete management.shiftCoordinators[id];
    }else{
      const id=$("occurrences-manage-employee")?.value; if(!id){toast?.("Selecione o colaborador.","error");return;}
      const coord=selectedCoordinator("occurrences-manage-employee-coordinator"); if(coord)management.employeeCoordinators[id]=coord; else delete management.employeeCoordinators[id];
    }
    await api("/api/dashboard/occurrences/management",{method:"PUT",body:JSON.stringify({companyId:f.companyId,branchId:f.branchId,...management})});
    if($("occurrences-management-status"))$("occurrences-management-status").textContent="Coordenadores salvos. Atualizando indicadores...";
    loadedKey=""; await load(true); toast?.("Configuração de coordenadores salva.","success");
  }

  function timeToMinutes(value){const m=String(value||"").match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null;}
  function intervalMinutes(markings){if(!Array.isArray(markings)||markings.length<4)return null;let a=timeToMinutes(markings[1]),b=timeToMinutes(markings[2]);if(a==null||b==null)return null;if(b<a)b+=1440;return b-a;}
  function pairDuration(start,end){let a=timeToMinutes(start),b=timeToMinutes(end);if(a==null||b==null)return 0;if(b<a)b+=1440;return Math.max(0,b-a);}
  function workedMinutes(markings){if(!Array.isArray(markings)||markings.length<2)return null;let total=0,pairs=0;for(let i=0;i+1<markings.length;i+=2){const value=pairDuration(markings[i],markings[i+1]);if(value||markings[i]===markings[i+1]){total+=value;pairs++;}}return pairs?total:null;}
  function plannedIntervalMinutes(description){
    const schedule=global.ThermalSchedule?.parseShiftSchedule?.(description);
    return schedule?Math.max(0,schedule.breakEnd-schedule.breakStart):null;
  }
  function journeyDayAnalysis(day){
    const marks=Array.isArray(day.markings)?day.markings:[];
    const actual=intervalMinutes(marks);
    const planned=plannedIntervalMinutes(day.shift_description);
    const worked=String(day.point_state||'').toUpperCase()==='WORKED';
    if(!worked)return {level:'neutral',label:String(day.point_state||'-'),actual,planned};
    if(marks.length<4)return {level:'red',label:'Jornada incompleta',actual,planned};
    if(actual==null)return {level:'red',label:'Intervalo não confirmado',actual,planned};
    if(planned!=null){
      const intervalDiff=Math.abs(actual-planned);
      if(intervalDiff>10)return {level:'red',label:`Intervalo fora do padrão (${actual} min / previsto ${planned} min)`,actual,planned,intervalDiff};
      if(intervalDiff>5)return {level:'yellow',label:`Intervalo fora do padrão (${actual} min / previsto ${planned} min)`,actual,planned,intervalDiff};
    }
    if(/SA[ÍI]DA\s+ANTECIPADA/i.test(day.occurrence||''))return {level:'red',label:'Saída antecipada',actual,planned};
    if(/BH|HORA\s*EXTRA/i.test(day.occurrence||''))return {level:'yellow',label:'BH / hora adicional',actual,planned};
    return {level:'green',label:'Dentro do padrão',actual,planned};
  }
  async function showJourney(employeeId){
    const row=rows.find(r=>String(r.employee_id)===String(employeeId)); if(!row)return;
    const panel=$("occurrences-journey-panel"),body=$("occurrences-journey-body"); if(panel)panel.hidden=false;
    if($("occurrences-journey-title"))$("occurrences-journey-title").textContent=row.full_name;
    if($("occurrences-journey-subtitle"))$("occurrences-journey-subtitle").textContent=`${row.shift_name||"Sem turno"} · Coordenador: ${row.coordinator?.name||"Não definido"}`;
    if(body)body.innerHTML='<tr><td colspan="8" class="muted">Carregando jornada...</td></tr>';
    try{
      const data=await api(`/api/dashboard/occurrences/journey?month=${encodeURIComponent(currentFilters().month)}&employeeId=${encodeURIComponent(employeeId)}`); const days=Array.isArray(data.days)?data.days:[];
      const analyses=days.map(day=>journeyDayAnalysis(day));
      const irregular=analyses.filter(item=>(item.level==='yellow'||item.level==='red')&&item.label.startsWith('Intervalo')).length;
      const incomplete=analyses.filter(item=>item.level==='red'&&/Jornada|Intervalo/.test(item.label)).length;
      const additional=analyses.filter((item,index)=>/BH|HORA\s*EXTRA/i.test(days[index]?.occurrence||'')).length;
      const early=analyses.filter((item,index)=>/SA[ÍI]DA\s+ANTECIPADA/i.test(days[index]?.occurrence||'')).length;
      if($("occurrences-journey-summary"))$("occurrences-journey-summary").innerHTML=`<strong>Resumo da competência</strong><span>${days.length} dias encontrados · ${irregular} intervalo${irregular===1?'':'s'} fora do padrão · ${additional} dia${additional===1?'':'s'} com BH/hora adicional · ${early} saída${early===1?'':'s'} antecipada${early===1?'':'s'} · ${incomplete} pendência${incomplete===1?'':'s'} de jornada</span>`;
      const actions=[];
      if(irregular)actions.push('Reforçar e acompanhar o cumprimento do intervalo previsto.');
      if(additional)actions.push('Verificar necessidade e autorização das horas adicionais/BH.');
      if(early)actions.push('Conferir as saídas antecipadas e suas justificativas.');
      if(incomplete)actions.push('Regularizar as marcações incompletas antes da análise definitiva.');
      if(!actions.length)actions.push('Manter o acompanhamento da jornada e do intervalo no padrão atual.');
      if($("occurrences-journey-suggestion"))$("occurrences-journey-suggestion").innerHTML=`<strong>Sugestão de melhoria</strong><span>${esc(actions.join(' '))}</span>`;
      if(body)body.innerHTML=days.length?days.map((day,index)=>{const marks=Array.isArray(day.markings)?day.markings:[];const a=analyses[index];return `<tr class="occ-journey-${a.level}"><td>${formatDate(day.work_date)}</td><td>${esc(day.shift_description||day.schedule_code||"-")}</td><td>${esc(marks[0]||"-")}</td><td>${esc(marks[1]||"-")}</td><td>${esc(marks[2]||"-")}</td><td>${esc(marks[3]||"-")}</td><td>${a.actual==null?"-":`${a.actual} min${a.planned!=null?` / ${a.planned} prev.`:''}`}</td><td><strong>${a.level==='red'?'🔴':a.level==='yellow'?'🟡':a.level==='green'?'🟢':'⚪'} ${esc(a.label)}</strong><small class="occurrence-subline">${esc(day.occurrence||"")}</small></td></tr>`;}).join(""):'<tr><td colspan="8" class="muted">Nenhuma jornada encontrada nesta competência.</td></tr>';
      panel?.scrollIntoView({behavior:"smooth",block:"start"});
    }catch(error){if(body)body.innerHTML=`<tr><td colspan="8" class="muted">${esc(error.message||"Não foi possível carregar a jornada.")}</td></tr>`;}
  }

  function renderTable(){
    const visible=visibleRows();
    if($("occurrences-visible-count"))$("occurrences-visible-count").textContent=`${visible.length} colaborador${visible.length===1?"":"es"} exibido${visible.length===1?"":"s"}`;
    const tbody=$("occurrences-table-body");
    if(!tbody)return;
    if(!visible.length){
      tbody.innerHTML='<tr><td colspan="7" class="muted">Nenhum colaborador encontrado para o filtro atual.</td></tr>';
      return;
    }
    tbody.innerHTML=visible.map(row=>`
      <tr>
        <td class="occurrence-employee"><strong>${esc(row.full_name)}</strong><small>${esc(row.registration||"Sem matrícula")} · ${esc(row.company_name||"-")} / ${esc(row.branch_name||"-")}</small></td>
        <td><strong>${esc(row.shift_name||"Sem turno")}</strong><small class="occurrence-subline">${esc(row.coordinator?.name||"Sem coordenador")}</small></td>
        <td><span class="occ-status ${row.indicator_status==="RED"?"is-red":row.indicator_status==="YELLOW"?"is-yellow":"is-green"}" title="${esc((row.indicator_reasons||[]).join(" · ")||"Dentro do padrão")}">${row.indicator_status==="RED"?"🔴 Vermelho":row.indicator_status==="YELLOW"?"🟡 Amarelo":"🟢 Verde"}</span><small class="occurrence-subline occ-status-reason">${esc((row.indicator_reasons||[]).join(" · ")||"Dentro do padrão")}</small></td>
        <td>${number(row,"absences")}</td><td><strong class="${number(row,'bh_net_minutes')<0?'occ-bh-negative':number(row,'bh_net_minutes')>0?'occ-bh-positive':''}">${esc(row.bh_net||formatDuration(row.bh_net_minutes||0))}</strong><small class="occurrence-subline">+${formatDuration(row.bh_positive_minutes||0,{signed:false})} / -${formatDuration(row.bh_negative_minutes||0,{signed:false})}</small></td>
        <td class="${number(row,"review_days")>0?"occurrence-review":""}">${number(row,"review_days")}</td>
        <td><button type="button" class="secondary occ-journey-button" data-employee-id="${esc(row.employee_id)}">Ver jornada</button></td>
      </tr>`).join("");
    tbody.querySelectorAll(".occ-journey-button").forEach(button=>button.addEventListener("click",()=>showJourney(button.dataset.employeeId)));
  }
  function renderFilter(){
    const box=$("occurrences-active-filter");
    if(!box)return;
    if(!activeKey){box.hidden=true;box.textContent="";return;}
    box.hidden=false;
    box.innerHTML=`Filtro ativo: <strong>${esc(labels[activeKey]||activeKey)}</strong>`;
  }
  function selectKey(key){
    activeKey=activeKey===key?"":key;
    document.querySelectorAll("#occurrences-summary article").forEach(card=>card.classList.toggle("active-filter",card.dataset.key===activeKey));
    renderFilter();
    renderTable();
  }

  function renderCharts(summary={}){
    const chartKeys=config.filter(([key])=>key!=="review_days");
    const values=chartKeys.map(([key,label])=>({key,label,value:Number(summary[key]||0)}));
    const max=Math.max(1,...values.map(item=>item.value));
    const total=config.reduce((sum,[key])=>sum+Number(summary[key]||0),0);
    const employeesWithOccurrence=rows.filter(row=>config.some(([key])=>number(row,key)>0)).length;
    if($("occurrences-kpi-total"))$("occurrences-kpi-total").textContent=total;
    if($("occurrences-kpi-employees"))$("occurrences-kpi-employees").textContent=employeesWithOccurrence;

    if($("occurrences-bar-chart")){
      $("occurrences-bar-chart").innerHTML=values.map(item=>`
        <div class="occurrences-bar-row">
          <div class="occurrences-bar-label"><span>${esc(item.label)}</span><b>${item.value}</b></div>
          <div class="occurrences-bar-track"><i style="width:${Math.max(item.value?4:0,Math.round((item.value/max)*100))}%"></i></div>
        </div>`).join("");
    }

    const donutItems=[
      ["absences","Faltas"],
      ["bank_hours","BH"],
      ["medical","Atestados"],
      ["vacations","Férias"],
      ["review_days","Revisão"]
    ].map(([key,label])=>({key,label,value:Number(summary[key]||0)}));
    const mainTotal=donutItems.reduce((sum,item)=>sum+item.value,0);
    const other=Math.max(0,total-mainTotal);
    if(other)donutItems.push({key:"other",label:"Outras",value:other});
    const donutTotal=donutItems.reduce((sum,item)=>sum+item.value,0);
    if($("occurrences-donut-total"))$("occurrences-donut-total").textContent=donutTotal;

    let cursor=0;
    const stops=[];
    donutItems.forEach((item,index)=>{
      const pct=donutTotal?item.value/donutTotal*100:0;
      const start=cursor,end=cursor+pct;
      stops.push(`var(--occ-chart-${index+1}) ${start}% ${end}%`);
      cursor=end;
    });
    if($("occurrences-donut"))$("occurrences-donut").style.background=donutTotal?`conic-gradient(${stops.join(",")})`:"var(--line)";
    if($("occurrences-donut-legend")){
      $("occurrences-donut-legend").innerHTML=donutItems.map((item,index)=>`
        <span><i style="background:var(--occ-chart-${index+1})"></i><b>${esc(item.label)}</b>${item.value}</span>`).join("");
    }
  }

  function renderExecutiveInsights(){
    const base=dashboardRows();
    const counts={GREEN:0,YELLOW:0,RED:0};
    base.forEach(row=>{const key=String(row.indicator_status||'');if(key in counts)counts[key]++;});
    const total=base.length;
    if($('occ-team-total'))$('occ-team-total').textContent=total;
    const greenPct=total?counts.GREEN/total*100:0;
    const yellowPct=total?counts.YELLOW/total*100:0;
    const donut=$('occ-team-donut');
    if(donut)donut.style.background=total?`conic-gradient(#159455 0 ${greenPct}%, #f4ad14 ${greenPct}% ${greenPct+yellowPct}%, #e23a3a ${greenPct+yellowPct}% 100%)`:'var(--line)';
    const statusMeta={GREEN:{label:'Regulares',color:'#159455',tone:'green'},YELLOW:{label:'Em atenção',color:'#f4ad14',tone:'yellow'},RED:{label:'Críticos',color:'#e23a3a',tone:'red'}};
    if($('occ-team-legend'))$('occ-team-legend').innerHTML=['GREEN','YELLOW','RED'].map(k=>{
      const meta=statusMeta[k],pct=total?Math.round(counts[k]/total*100):0;
      return `<div class="occ-team-status ${meta.tone}"><div class="occ-team-status-top"><span><i style="background:${meta.color}"></i>${meta.label}</span><strong>${counts[k]}</strong></div><div class="occ-team-status-bar"><i style="width:${pct}%;background:${meta.color}"></i></div><small>${pct}% da equipe</small></div>`;
    }).join('');
    const dominantKey=['RED','YELLOW','GREEN'].sort((a,b)=>counts[b]-counts[a])[0];
    const dominant=statusMeta[dominantKey],dominantPct=total?Math.round(counts[dominantKey]/total*100):0;
    if($('occ-team-dominant'))$('occ-team-dominant').innerHTML=total?`<span>Leitura da equipe</span><strong class="${dominant.tone}">${dominantPct}% ${dominant.label.toLowerCase()}</strong><small>${dominantKey==='RED'?'Prioridade para ações corretivas':dominantKey==='YELLOW'?'Equipe requer acompanhamento':'Maioria dentro do padrão'}</small>`:'<span>Leitura da equipe</span><strong>—</strong><small>Sem colaboradores neste filtro</small>';

    const impacts=[
      {key:'absences',label:'Faltas',value:base.reduce((a,r)=>a+number(r,'absences'),0),tone:'red'},
      {key:'bh_positive_minutes',label:'BH positivo',value:base.reduce((a,r)=>a+number(r,'bh_positive_minutes'),0),tone:'blue',isMinutes:true},
      {key:'bh_negative_minutes',label:'BH negativo',value:base.reduce((a,r)=>a+number(r,'bh_negative_minutes'),0),tone:'red',isMinutes:true},
      {key:'early_exits',label:'Saídas antecipadas',value:base.reduce((a,r)=>a+number(r,'early_exits'),0),tone:'yellow'},
      {key:'incomplete_days',label:'Jornadas incompletas',value:base.reduce((a,r)=>a+number(r,'incomplete_days'),0),tone:'gray'},
      {key:'review_days',label:'Dias para revisão',value:base.reduce((a,r)=>a+number(r,'review_days'),0),tone:'gray'}
    ].sort((a,b)=>b.value-a.value);
    const max=Math.max(1,...impacts.map(i=>i.value));
    if($('occ-impact-bars'))$('occ-impact-bars').innerHTML=impacts.map(item=>`<div class="occ-impact-row"><span>${esc(item.label)}</span><div class="occ-impact-track"><i class="${item.tone}" style="width:${item.value?Math.max(7,Math.round(item.value/max*100)):0}%"></i></div><b>${item.isMinutes?formatDuration(item.value,{signed:false}):item.value}</b></div>`).join('');

    const groups=new Map();
    base.forEach(row=>{const name=row.shift_name||'Sem turno';if(!groups.has(name))groups.set(name,{GREEN:0,YELLOW:0,RED:0,total:0});const g=groups.get(name);g.total++;if(row.indicator_status in g)g[row.indicator_status]++;});
    const shifts=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR'));
    if($('occ-shift-grid'))$('occ-shift-grid').innerHTML=shifts.length?shifts.map(([name,g])=>`<div class="occ-shift-card"><strong>${esc(name)}</strong><div><span class="green">${g.GREEN} (${Math.round(g.GREEN/g.total*100)}%)</span><span class="yellow">${g.YELLOW} (${Math.round(g.YELLOW/g.total*100)}%)</span><span class="red">${g.RED} (${Math.round(g.RED/g.total*100)}%)</span></div></div>`).join(''):'<span class="muted">Sem turnos neste filtro.</span>';

    const affectedCount=key=>base.filter(r=>number(r,key)>0).length;
    if($('occ-attention-list'))$('occ-attention-list').innerHTML=impacts.filter(i=>i.value>0).slice(0,5).map((item,index)=>`<div class="occ-insight-item"><b>${index+1}</b><span><strong>${esc(item.label)}</strong><small>${item.isMinutes?formatDuration(item.value,{signed:false}):`${item.value} ocorrência${item.value===1?'':'s'}`} · afeta ${affectedCount(item.key)} colaborador${affectedCount(item.key)===1?'':'es'}</small></span></div>`).join('')||'<div class="occ-empty-good">Nenhum ponto crítico encontrado.</div>';

    const positives=[];
    const regularPct=total?Math.round(counts.GREEN/total*100):0;
    positives.push(`${counts.GREEN} colaborador${counts.GREEN===1?'':'es'} dentro do padrão (${regularPct}%).`);
    const noAbs=base.filter(r=>number(r,'absences')===0).length;
    positives.push(`${noAbs} colaborador${noAbs===1?'':'es'} sem faltas na competência.`);
    if(shifts.length){const best=shifts.map(([name,g])=>({name,pct:g.total?g.GREEN/g.total*100:0})).sort((a,b)=>b.pct-a.pct)[0];positives.push(`${best.name} apresenta ${Math.round(best.pct)}% de colaboradores regulares.`);}
    if($('occ-positive-list'))$('occ-positive-list').innerHTML=positives.map(text=>`<div class="occ-positive-item"><i>●</i><span>${esc(text)}</span></div>`).join('');

    const top=impacts[0];
    let suggestion='Manter o acompanhamento da jornada e das ocorrências da equipe.';
    if(top?.value){
      suggestion={absences:'Priorizar os colaboradores com faltas e verificar reincidências, justificativas e necessidade de orientação individual.',bh_positive_minutes:'Revisar onde o BH positivo está sendo gerado e confirmar necessidade e autorização das horas adicionais.',bh_negative_minutes:'Identificar a origem do BH negativo e acompanhar a regularização do saldo com a liderança.',early_exits:'Conferir as saídas antecipadas, separar os casos justificados e acompanhar os colaboradores com repetição.',incomplete_days:'Regularizar as marcações incompletas antes de tomar decisões sobre jornada e reforçar o registro correto do ponto.',review_days:'Priorizar a conferência dos dias para revisão para que o painel reflita somente dados de ponto confirmados.'}[top.key]||suggestion;
    }
    if($('occ-general-suggestion'))$('occ-general-suggestion').textContent=suggestion;
  }

  function renderImportStatus(imports=[]){
    const status=$("occurrences-import-status");
    if(!status)return;
    if(imports.length){
      const branchNames=[...new Set(imports.map(item=>item.branch_name).filter(Boolean))];
      const period=importPeriod(imports);
      status.textContent=`Confirmado · Competência ${monthLabel(currentFilters().month)}${period?` · Período Senior ${formatDate(period.start)} a ${formatDate(period.end)}`:""} · ${imports.length} filial${imports.length===1?"":"is"}${branchNames.length&&branchNames.length<=4?` · ${branchNames.join(", ")}`:""}`;
      status.closest(".occurrences-source-status")?.classList.remove("is-missing");
    }else{
      status.textContent="Nenhum Cartão de Ponto confirmado neste filtro";
      status.closest(".occurrences-source-status")?.classList.add("is-missing");
    }
  }

  function updatePrintHeader(){
    const f=currentFilters();
    const period=importPeriod(Array.isArray(lastData.imports)?lastData.imports:[]);
    if($("occurrences-print-reference"))$("occurrences-print-reference").textContent=`Competência: ${monthLabel(f.month)}${period?` · Período do Cartão de Ponto Senior: ${formatDate(period.start)} a ${formatDate(period.end)}`:""}`;
    if($("occurrences-print-company"))$("occurrences-print-company").textContent=selectedText("occurrences-company","Todas as empresas");
    if($("occurrences-print-branch"))$("occurrences-print-branch").textContent=selectedText("occurrences-branch","Todas as filiais");
    if($("occurrences-print-generated"))$("occurrences-print-generated").textContent=`Emitido em ${new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(new Date())}`;
  }

  async function load(force=false){
    const f=currentFilters();
    if(!f.month)return;
    const key=requestKey();
    if(!force&&loadedKey===key&&rows.length){renderTable();return;}
    setLoading();
    try{
      await loadScopeOptions();
      const query=new URLSearchParams({month:f.month});
      if(f.companyId)query.set("companyId",f.companyId);
      if(f.branchId)query.set("branchId",f.branchId);
      query.set("_",String(Date.now()));
      const data=await api(`/api/dashboard/occurrences?${query.toString()}`);
      loadedKey=key;
      lastData=data;
      rows=Array.isArray(data.employees)?data.employees:[];
      analysisJourneyDays=[];analysisJourneyKey="";
      await loadManagement();
      fillOperationalFilters();
      activeKey="";
      renderSummary(data.summary||{});
      renderStatusSummary();
      renderCharts(data.summary||{});
      renderExecutiveInsights();
      renderFilter();
      renderTable();
      renderImportStatus(Array.isArray(data.imports)?data.imports:[]);
      updatePrintHeader();
    }catch(error){
      rows=[];
      lastData={summary:{},imports:[]};
      renderSummary({});
      renderStatusSummary();
      renderCharts({});
      renderExecutiveInsights();
      renderTable();
      renderAnalysis();
      if($("occurrences-import-status"))$("occurrences-import-status").textContent=error.message||"Não foi possível carregar as ocorrências.";
    }
  }

  function journeyPrintRows(dayRows=[]){
    return dayRows.map(day=>{
      const marks=Array.isArray(day.markings)?day.markings:[];
      const analysis=journeyDayAnalysis(day);
      const work=workedMinutes(marks);
      const bhPos=Number(day.bh_positive_minutes||0);
      const bhNeg=Number(day.bh_negative_minutes||0);
      const classes=[analysis.level==='red'?'is-critical':analysis.level==='yellow'?'is-attention':''];
      if(bhPos)classes.push('has-bh-positive');
      if(bhNeg)classes.push('has-bh-negative');
      return `<tr class="${classes.join(' ')}">
        <td>${formatDate(day.work_date)}</td>
        <td>${esc(marks[0]||'-')}</td><td>${esc(marks[1]||'-')}</td><td>${esc(marks[2]||'-')}</td><td>${esc(marks[3]||'-')}</td>
        <td>${work==null?'-':formatDuration(work,{signed:false})}</td>
        <td>${analysis.actual==null?'-':`${analysis.actual} min${analysis.planned!=null?` / ${analysis.planned} prev.`:''}`}</td>
        <td>${bhPos?`<span class="bh-chip positive">+${formatDuration(bhPos,{signed:false})}</span>`:'-'}</td>
        <td>${bhNeg?`<span class="bh-chip negative">-${formatDuration(bhNeg,{signed:false})}</span>`:'-'}</td>
        <td><strong>${analysis.level==='red'?'CRÍTICO':analysis.level==='yellow'?'ATENÇÃO':analysis.level==='green'?'OK':esc(analysis.label||'-')}</strong><small>${esc(day.occurrence||'')}</small></td>
      </tr>`;
    }).join('');
  }

  function buildJourneyPrintAppendix(journeyDays=[]){
    const byEmployee=new Map();
    (journeyDays||[]).forEach(day=>{
      const key=String(day.employee_id||'');
      if(!key)return;
      const list=byEmployee.get(key)||[]; list.push(day); byEmployee.set(key,list);
    });
    const reportRows=rows;
    if(!reportRows.length)return null;
    const section=document.createElement('section');
    section.className='occurrences-journey-appendix';
    section.innerHTML=`<div class="journey-appendix-title"><span class="eyebrow">Jornadas</span><h2>Jornada, Banco de Horas e Intervalos</h2><p>Marcações do Cartão Senior com destaque para BH positivo, BH negativo e intervalos fora do padrão.</p></div>`+
      reportRows.map((row,index)=>{
        const days=byEmployee.get(String(row.employee_id))||[];
        const bhPositive=days.reduce((sum,d)=>sum+Number(d.bh_positive_minutes||0),0);
        const bhNegative=days.reduce((sum,d)=>sum+Number(d.bh_negative_minutes||0),0);
        const intervalIssues=days.filter(day=>{const a=journeyDayAnalysis(day);return (a.level==='yellow'||a.level==='red')&&String(a.label||'').startsWith('Intervalo fora do padrão');}).length;
        const coordinator=row.coordinator?.name||'Não definido';
        return `<article class="journey-employee-section${index?' journey-page-break':''}">
          <header class="journey-employee-head">
            <div><span class="employee-index">${index+1}</span><strong>${esc(row.full_name)}</strong><small>Matrícula ${esc(row.registration||'-')} · ${esc(row.shift_name||'Sem turno')} · Coordenador: ${esc(coordinator)}</small></div>
            <div class="journey-employee-kpis"><span>BH+ <b class="positive">+${formatDuration(bhPositive,{signed:false})}</b></span><span>BH- <b class="negative">-${formatDuration(bhNegative,{signed:false})}</b></span><span>Intervalos fora do padrão <b>${intervalIssues}</b></span></div>
          </header>
          <table class="journey-print-table">
            <thead><tr><th>Data</th><th>Entrada</th><th>Início int.</th><th>Retorno</th><th>Saída</th><th>Jornada</th><th>Intervalo</th><th>BH+</th><th>BH-</th><th>Situação / ocorrência</th></tr></thead>
            <tbody>${days.length?journeyPrintRows(days):'<tr><td colspan="10">Nenhuma jornada encontrada nesta competência.</td></tr>'}</tbody>
          </table>
        </article>`;
      }).join('');
    return section;
  }

  function buildPrintDocument(journeyDays=[]){
    updatePrintHeader();
    const holder=$("occurrences-print-document");
    if(!holder)return false;

    const header=document.querySelector("#occurrences .occurrences-print-header")?.cloneNode(true);
    const summary=document.querySelector("#occurrences .occurrences-summary")?.cloneNode(true);
    const charts=document.querySelector("#occurrences .occurrences-charts")?.cloneNode(true);

    if(!header||!summary||!charts)return false;

    [header,summary,charts].forEach(root=>{
      root.querySelectorAll("[id]").forEach(el=>el.removeAttribute("id"));
    });

    const reportRows=rows;
    const tableRows=rows.length
      ?rows.map((row,index)=>`
        <tr>
          <td class="occurrence-rank">${index+1}</td>
          <td class="occurrence-employee"><strong>${esc(row.full_name)}</strong><small>${esc(row.company_name||"-")} / ${esc(row.branch_name||"-")}</small></td>
          <td class="occurrence-registration">${esc(row.registration||"-")}</td>
          <td>${number(row,"days_off")}</td><td>${number(row,"absences")}</td>
          <td class="bh-positive-cell">+${formatDuration(row.bh_positive_minutes||0,{signed:false})}</td>
          <td class="bh-negative-cell">-${formatDuration(row.bh_negative_minutes||0,{signed:false})}</td>
          <td>${number(row,"medical")}</td><td>${number(row,"vacations")}</td><td>${number(row,"dsr")}</td>
          <td>${number(row,"licenses")}</td><td>${number(row,"leaves")}</td><td>${number(row,"review_days")}</td>
        </tr>`).join("")
      :'<tr><td colspan="13">Nenhum registro encontrado para o filtro selecionado.</td></tr>';

    const detail=document.createElement("section");
    detail.className="panel occurrences-detail-panel";
    detail.innerHTML=`
      <div class="panel-head occurrences-detail-head">
        <div><span class="eyebrow">Detalhamento</span><h3>Ocorrências por colaborador</h3><p class="hint">Resumo gerencial da competência selecionada.</p></div>
      </div>
      <div class="table-wrap occurrences-table-wrap">
        <table class="occurrences-table">
          <thead><tr><th>#</th><th>Colaborador</th><th>Matrícula</th><th>Folgas</th><th>Faltas</th><th>BH+</th><th>BH-</th><th>Atest.</th><th>Férias</th><th>DSR</th><th>Lic.</th><th>Afast.</th><th>Revisão</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      <div class="occurrences-footer"><span>${reportRows.length} colaborador${reportRows.length===1?"":"es"} no relatório</span><small>Fonte: Cartão de Ponto Senior importado no Controle Térmico.</small></div>`;

    const f=currentFilters();
    const period=importPeriod(Array.isArray(lastData.imports)?lastData.imports:[]);
    const totalOccurrences=config.reduce((sum,[key])=>sum+Number(lastData.summary?.[key]||0),0);
    const context=document.createElement("section");
    context.className="occurrences-print-context";
    context.innerHTML=`
      <div><span>Competência</span><strong>${esc(monthLabel(f.month))}</strong><small>${period?`${formatDate(period.start)} a ${formatDate(period.end)}`:"Período da competência"}</small></div>
      <div><span>Empresa</span><strong>${esc(selectedText("occurrences-company","Todas as empresas"))}</strong><small>Escopo do relatório</small></div>
      <div><span>Filial</span><strong>${esc(selectedText("occurrences-branch","Todas as filiais"))}</strong><small>Unidade selecionada</small></div>
      <div><span>Totais gerais</span><strong>${reportRows.length} colaboradores</strong><small>${totalOccurrences} ocorrências registradas</small></div>`;

    const journeyAppendix=buildJourneyPrintAppendix(journeyDays);
    holder.replaceChildren(header,context,summary,charts,detail,...(journeyAppendix?[journeyAppendix]:[]));
    holder.setAttribute("aria-hidden","false");
    return true;
  }

  function printWindowHtml(journeyDays=[]){
    if(!buildPrintDocument(journeyDays))return "";
    const content=$("occurrences-print-document")?.innerHTML||"";
    return global.OccurrencesPrintTemplate?.document(content)||"";
  }

  async function printReport(){
    const f=currentFilters();
    let journeyDays=[];
    try{
      if(typeof toast==="function")toast("Preparando jornadas para o relatório...","success");
      const query=new URLSearchParams({month:f.month});
      if(f.companyId)query.set('companyId',f.companyId);
      if(f.branchId)query.set('branchId',f.branchId);
      const data=await api(`/api/dashboard/occurrences/journeys?${query.toString()}`);
      journeyDays=Array.isArray(data?.days)?data.days:[];
    }catch(error){
      if(typeof toast==="function")toast(error.message||"Não foi possível carregar as jornadas para impressão.","error");
      return;
    }
    const html=printWindowHtml(journeyDays);
    if(!html){if(typeof toast==="function")toast("Não foi possível preparar o relatório para impressão.","error");return;}
    const printWindow=window.open("","_blank","width=1200,height=850");
    if(!printWindow){if(typeof toast==="function")toast("O navegador bloqueou a janela de impressão. Permita pop-ups para este sistema.","error");return;}
    printWindow.document.open(); printWindow.document.write(html); printWindow.document.close(); clearPrintMode();
  }
  function clearPrintMode(){
    document.body.classList.remove("occurrences-print-active");
    const holder=$("occurrences-print-document");
    if(holder){
      holder.replaceChildren();
      holder.setAttribute("aria-hidden","true");
    }
  }


  // Beta.41 — análises especializadas sem alterar os cálculos de origem.
  let analysisTab="overview", analysisJourneyDays=[], analysisJourneyKey="", analysisShiftFilter="";
  const analysisMeta={
    intervals:{title:"Intervalos",subtitle:"Compare o intervalo realizado com o previsto e identifique desvios por colaborador."},
    absences:{title:"Faltas",subtitle:"Concentre a análise em faltas, reincidências, turno e liderança."},
    "bh-positive":{title:"Banco de Horas Positivo",subtitle:"Veja quem está acumulando BH+, o total e os dias que geraram crédito."},
    "bh-negative":{title:"Banco de Horas Negativo",subtitle:"Veja quem está acumulando BH-, o total e os dias que geraram débito."},
    justifications:{title:"Justificativas",subtitle:"Atestados, férias, DSR, licenças, afastamentos, compensados, cursos e óbitos."},
    reviews:{title:"Revisões",subtitle:"Dias com marcações incompletas ou situações que exigem conferência do DP."}
  };
  async function ensureAnalysisJourneys(){
    const f=currentFilters(),key=[f.month,f.companyId,f.branchId].join('|');
    if(analysisJourneyKey===key&&analysisJourneyDays.length)return analysisJourneyDays;
    const q=new URLSearchParams({month:f.month});if(f.companyId)q.set('companyId',f.companyId);if(f.branchId)q.set('branchId',f.branchId);
    const data=await api(`/api/dashboard/occurrences/journeys?${q.toString()}`);analysisJourneyDays=Array.isArray(data?.days)?data.days:[];analysisJourneyKey=key;return analysisJourneyDays;
  }
  function analysisScopedRows(){return visibleRows();}
  function analysisDayAllowed(day){const ids=new Set(analysisScopedRows().map(r=>String(r.employee_id)));return ids.has(String(day.employee_id));}
  function analysisKpis(items){const box=$("occ-analysis-kpis");if(box)box.innerHTML=items.map(([label,value])=>`<span>${esc(label)}<strong>${esc(String(value))}</strong></span>`).join('');}
  function analysisBars(groups){const box=$("occ-analysis-chart");if(!box)return;const arr=Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,6),max=Math.max(1,...arr.map(x=>x[1]));box.innerHTML=arr.map(([name,value])=>`<div class="occ-analysis-bar"><small>${esc(name)}</small><b>${value}</b><i style="width:${Math.round(value/max*100)}%"></i></div>`).join('');}
  function renderIntervalShiftFilter(items){
    const box=$("occ-analysis-chart");if(!box)return;
    const groups=new Map();
    items.forEach(x=>{const name=x.emp?.shift_name||x.day.shift_name||'Sem turno';groups.set(name,(groups.get(name)||0)+1);});
    const arr=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR'));
    if(analysisShiftFilter&&!groups.has(analysisShiftFilter))analysisShiftFilter='';
    const buttons=[["",'Todos os turnos',items.length],...arr.map(([name,count])=>[name,name,count])];
    box.classList.add('occ-analysis-shift-filter');
    box.innerHTML=buttons.map(([value,label,count])=>`<button type="button" class="occ-analysis-shift-btn ${analysisShiftFilter===value?'active':''}" data-analysis-shift="${esc(value)}"><small>${esc(label)}</small><strong>${count}</strong><span>${value?'jornadas':'total'}</span></button>`).join('');
  }
  function renderIntervalEmployeeSummary(items,employeeId){
    const box=$("occ-analysis-chart");if(!box)return;
    box.classList.remove('occ-analysis-shift-filter');
    const first=items[0],emp=first?.emp||employeeById(employeeId)||{},day=first?.day||{};
    const name=emp.full_name||day.full_name||'Colaborador';
    const registration=emp.registration||day.registration||'-';
    const shift=emp.shift_name||day.shift_name||'Sem turno';
    const totalWork=items.reduce((sum,x)=>sum+(Number.isFinite(x.work)?x.work:0),0);
    const totalBhPos=items.reduce((sum,x)=>sum+(x.bhPos||0),0);
    const totalBhNeg=items.reduce((sum,x)=>sum+(x.bhNeg||0),0);
    const abnormal=items.filter(x=>x.abnormal).length;
    box.innerHTML=`<div class="occ-employee-journey-summary">
      <div class="occ-employee-summary-head">
        <div><small>Jornada individual</small><strong>${esc(name)}</strong><span>Matrícula ${esc(registration)} · ${esc(shift)}</span></div>
        <button type="button" class="btn secondary occ-back-all-employees" data-back-all-employees="1">← Voltar para todos os colaboradores</button>
      </div>
      <div class="occ-employee-summary-metrics">
        <span><small>Jornadas</small><strong>${items.length}</strong></span>
        <span><small>Horas trabalhadas</small><strong>${formatDuration(totalWork,{signed:false})}</strong></span>
        <span><small>BH +</small><strong class="occ-analysis-bh-plus">${totalBhPos?`+${formatDuration(totalBhPos,{signed:false})}`:'00:00'}</strong></span>
        <span><small>BH -</small><strong class="occ-analysis-bh-minus">${totalBhNeg?`-${formatDuration(totalBhNeg,{signed:false})}`:'00:00'}</strong></span>
        <span><small>Intervalos fora do padrão</small><strong>${abnormal}</strong></span>
      </div>
    </div>`;
  }
  function setAnalysisTable(headers,bodyRows,empty="Nenhum registro encontrado para os filtros atuais."){$("occ-analysis-thead").innerHTML=`<tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr>`;$("occ-analysis-tbody").innerHTML=bodyRows.length?bodyRows.join(''):`<tr><td colspan="${headers.length}" class="occ-analysis-empty">${esc(empty)}</td></tr>`;$("occ-analysis-count").textContent=`${bodyRows.length} registro${bodyRows.length===1?'':'s'}`;}
  function employeeById(id){return rows.find(r=>String(r.employee_id)===String(id));}
  function focusIntervalEmployee(employeeId){
    const select=$("occurrences-employee"),id=String(employeeId||"");
    if(!select||!id||![...select.options].some(option=>String(option.value)===id))return;
    select.value=id;
    analysisShiftFilter="";
    renderStatusSummary();
    renderExecutiveInsights();
    renderTable();
    renderAnalysis();
  }
  async function renderAnalysis(){
    if(analysisTab==='overview'){document.body.classList.remove('occ-analysis-specialized');$("occ-analysis-panel").hidden=true;return;}
    document.body.classList.add('occ-analysis-specialized');$("occ-analysis-panel").hidden=false;$("occ-analysis-chart")?.classList.remove('occ-analysis-shift-filter');const meta=analysisMeta[analysisTab];$("occ-analysis-title").textContent=meta.title;$("occ-analysis-subtitle").textContent=meta.subtitle;$("occ-analysis-tbody").innerHTML='<tr><td class="occ-analysis-empty">Carregando análise...</td></tr>';
    const scoped=analysisScopedRows();
    if(analysisTab==='absences'){
      const list=scoped.filter(r=>number(r,'absences')>0).sort((a,b)=>number(b,'absences')-number(a,'absences'));const total=list.reduce((a,r)=>a+number(r,'absences'),0),groups={};list.forEach(r=>groups[r.shift_name||'Sem turno']=(groups[r.shift_name||'Sem turno']||0)+number(r,'absences'));analysisKpis([["Faltas",total],["Colaboradores",list.length],["Reincidentes",list.filter(r=>number(r,'absences')>1).length]]);analysisBars(groups);setAnalysisTable(['Colaborador','Turno / Coordenador','Faltas','Situação'],list.map(r=>`<tr><td><strong>${esc(r.full_name)}</strong><small>${esc(r.registration||'Sem matrícula')}</small></td><td>${esc(r.shift_name||'Sem turno')}<small>${esc(r.coordinator?.name||'Sem coordenador')}</small></td><td><strong>${number(r,'absences')}</strong></td><td><span class="occ-analysis-alert ${number(r,'absences')>1?'red':'yellow'}">${number(r,'absences')>1?'Reincidente':'Acompanhar'}</span></td></tr>`));return;
    }
    if(analysisTab==='bh-positive'||analysisTab==='bh-negative'){
      const positive=analysisTab==='bh-positive',key=positive?'bh_positive_minutes':'bh_negative_minutes',label=positive?'BH+':'BH-';
      const list=scoped.filter(r=>number(r,key)>0).sort((a,b)=>number(b,key)-number(a,key));
      const total=list.reduce((a,r)=>a+number(r,key),0),groups={};
      list.forEach(r=>groups[r.shift_name||'Sem turno']=(groups[r.shift_name||'Sem turno']||0)+number(r,key));
      const selectedEmployee=currentFilters().employeeId;
      let bhDays=[];
      try{bhDays=(await ensureAnalysisJourneys()).filter(day=>analysisDayAllowed(day)&&Number(day[key]||0)>0);}catch(_){bhDays=[];}
      const occurrenceCount=new Map();
      bhDays.forEach(day=>{const id=String(day.employee_id||'');occurrenceCount.set(id,(occurrenceCount.get(id)||0)+1);});
      analysisKpis([[label,formatDuration(total,{signed:false})],["Colaboradores",list.length],["Ocorrências",bhDays.length],["Maior saldo",list.length?formatDuration(number(list[0],key),{signed:false}):'00:00']]);
      if(selectedEmployee){
        const employee=list.find(r=>String(r.employee_id)===String(selectedEmployee))||employeeById(selectedEmployee)||{};
        const days=bhDays.filter(day=>String(day.employee_id)===String(selectedEmployee)).sort((a,b)=>String(a.work_date||'').localeCompare(String(b.work_date||'')));
        const employeeTotal=days.reduce((sum,day)=>sum+Number(day[key]||0),0);
        const box=$("occ-analysis-chart");
        if(box)box.innerHTML=`<div class="occ-employee-journey-summary"><div class="occ-employee-summary-head"><div><small>${label} individual</small><strong>${esc(employee.full_name||days[0]?.full_name||'Colaborador')}</strong><span>Matrícula ${esc(employee.registration||days[0]?.registration||'-')} · ${esc(employee.shift_name||days[0]?.shift_name||'Sem turno')}</span></div><button type="button" class="btn secondary occ-back-all-employees" data-back-all-bh="1">← Voltar para todos os colaboradores</button></div><div class="occ-employee-summary-metrics occ-bh-summary-metrics"><span><small>Ocorrências ${label}</small><strong>${days.length}</strong></span><span><small>Total ${label}</small><strong class="${positive?'occ-analysis-bh-plus':'occ-analysis-bh-minus'}">${positive?'+':'-'}${formatDuration(employeeTotal,{signed:false})}</strong></span><span><small>Saldo BH</small><strong>${esc(employee.bh_net||'00:00')}</strong></span></div></div>`;
        setAnalysisTable(['Data','Hor','Ocorrência','Trabalho',label,'Situação'],days.map(day=>{const marks=Array.isArray(day.markings)?day.markings:[];const work=workedMinutes(marks);const minutes=Number(day[key]||0);return `<tr><td>${formatDate(day.work_date)}</td><td>${esc(day.schedule_code||'-')}</td><td><strong>${esc(day.occurrence||label)}</strong><small>${esc(marks.join(' ')||'Sem marcações')}</small></td><td>${work==null?'-':formatDuration(work,{signed:false})}</td><td class="${positive?'occ-analysis-bh-plus':'occ-analysis-bh-minus'}"><strong>${positive?'+':'-'}${formatDuration(minutes,{signed:false})}</strong></td><td><span class="occ-analysis-alert ${positive?(minutes>=600?'red':'yellow'):(minutes>=240?'red':'yellow')}">${positive?(minutes>=600?'Crítico':'Acompanhar'):(minutes>=240?'Crítico':'Acompanhar')}</span></td></tr>`;}));
      }else{
        analysisBars(Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,Math.round(v/60)])));
        setAnalysisTable(['Colaborador','Turno','Coordenador',`Ocorrências ${label}`,label,'Saldo BH','Situação'],list.map(r=>{const minutes=number(r,key),critical=positive?minutes>=600:minutes>=240;return `<tr><td><button type="button" class="occ-interval-employee-link" data-bh-employee="${esc(String(r.employee_id||''))}"><strong>${esc(r.full_name)}</strong><small>${esc(r.registration||'Sem matrícula')} · Clique para detalhar ${label}</small></button></td><td>${esc(r.shift_name||'Sem turno')}</td><td>${esc(r.coordinator?.name||'Sem coordenador')}</td><td><strong>${occurrenceCount.get(String(r.employee_id||''))||0}</strong></td><td class="${positive?'occ-analysis-bh-plus':'occ-analysis-bh-minus'}"><strong>${positive?'+':'-'}${formatDuration(minutes,{signed:false})}</strong></td><td>${esc(r.bh_net||'00:00')}</td><td><span class="occ-analysis-alert ${critical?'red':'yellow'}">${critical?'Crítico':'Acompanhar'}</span></td></tr>`;}));
      }
      return;
    }
    if(analysisTab==='justifications'){
      const defs=[['medical','Atestado'],['vacations','Férias'],['dsr','DSR'],['licenses','Licença'],['leaves','Afastamento'],['compensated','Compensado'],['courses','Curso'],['bereavement','Óbito']];const out=[];const groups={};scoped.forEach(r=>defs.forEach(([k,label])=>{const n=number(r,k);if(n){groups[label]=(groups[label]||0)+n;out.push({r,label,n});}}));out.sort((a,b)=>b.n-a.n);analysisKpis([["Registros",out.reduce((a,x)=>a+x.n,0)],["Colaboradores",new Set(out.map(x=>x.r.employee_id)).size],["Tipos",Object.keys(groups).length]]);analysisBars(groups);setAnalysisTable(['Colaborador','Turno / Coordenador','Justificativa','Dias'],out.map(x=>`<tr><td><strong>${esc(x.r.full_name)}</strong><small>${esc(x.r.registration||'Sem matrícula')}</small></td><td>${esc(x.r.shift_name||'Sem turno')}<small>${esc(x.r.coordinator?.name||'Sem coordenador')}</small></td><td><strong>${esc(x.label)}</strong></td><td>${x.n}</td></tr>`));return;
    }
    if(analysisTab==='reviews'){
      const list=scoped.filter(r=>number(r,'review_days')>0||number(r,'incomplete_days')>0).sort((a,b)=>(number(b,'review_days')+number(b,'incomplete_days'))-(number(a,'review_days')+number(a,'incomplete_days')));analysisKpis([["Para revisão",list.reduce((a,r)=>a+number(r,'review_days'),0)],["Jornadas incompletas",list.reduce((a,r)=>a+number(r,'incomplete_days'),0)],["Colaboradores",list.length]]);const groups={};list.forEach(r=>groups[r.shift_name||'Sem turno']=(groups[r.shift_name||'Sem turno']||0)+number(r,'review_days')+number(r,'incomplete_days'));analysisBars(groups);setAnalysisTable(['Colaborador','Turno / Coordenador','Revisão','Incompletas','Prioridade'],list.map(r=>`<tr><td><strong>${esc(r.full_name)}</strong><small>${esc(r.registration||'Sem matrícula')}</small></td><td>${esc(r.shift_name||'Sem turno')}<small>${esc(r.coordinator?.name||'Sem coordenador')}</small></td><td>${number(r,'review_days')}</td><td>${number(r,'incomplete_days')}</td><td><span class="occ-analysis-alert ${(number(r,'review_days')+number(r,'incomplete_days'))>=3?'red':'yellow'}">${(number(r,'review_days')+number(r,'incomplete_days'))>=3?'Prioritário':'Conferir'}</span></td></tr>`));return;
    }
    if(analysisTab==='intervals'){
      try{
        const days=(await ensureAnalysisJourneys()).filter(analysisDayAllowed);
        const weekday=value=>{const d=new Date(`${String(value).slice(0,10)}T12:00:00`);return ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'][d.getDay()]||'-';};
        const rowsInterval=days.map(day=>{
          const a=journeyDayAnalysis(day),marks=Array.isArray(day.markings)?day.markings:[],emp=employeeById(day.employee_id);
          const diff=a?.planned==null||a?.actual==null?null:Math.abs(a.actual-a.planned);
          const abnormal=diff!=null&&diff>5;
          const critical=diff!=null&&diff>10;
          const markHtml=marks.map((mark,index)=>{
            const text=esc(mark||'-');
            return abnormal&&(index===1||index===2)?`<span class="occ-interval-mark ${critical?'critical':'attention'}">${text}</span>`:text;
          }).join(' ');
          const occurrence=String(day.occurrence||'').trim();
          const work=workedMinutes(marks);
          const bhPos=Number(day.bh_positive_minutes||0),bhNeg=Number(day.bh_negative_minutes||0);
          return {day,a,emp,diff,abnormal,critical,markHtml,occurrence,work,bhPos,bhNeg};
        });
        const selectedEmployee=currentFilters().employeeId;
        rowsInterval.sort((a,b)=>{
          const aName=String(a.emp?.full_name||a.day.full_name||''),bName=String(b.emp?.full_name||b.day.full_name||'');
          const aDate=String(a.day.work_date||''),bDate=String(b.day.work_date||'');
          return selectedEmployee?(aDate.localeCompare(bDate)||aName.localeCompare(bName,'pt-BR')):(aName.localeCompare(bName,'pt-BR')||aDate.localeCompare(bDate));
        });
        if(selectedEmployee){analysisShiftFilter="";renderIntervalEmployeeSummary(rowsInterval,selectedEmployee);}else{renderIntervalShiftFilter(rowsInterval);}
        const filteredIntervals=!selectedEmployee&&analysisShiftFilter?rowsInterval.filter(x=>(x.emp?.shift_name||x.day.shift_name||'Sem turno')===analysisShiftFilter):rowsInterval;
        const irregular=filteredIntervals.filter(x=>x.abnormal).length;
        const attention=filteredIntervals.filter(x=>x.abnormal&&!x.critical).length;
        const critical=filteredIntervals.filter(x=>x.critical).length;
        analysisKpis([["Jornadas",filteredIntervals.length],["Fora do padrão",irregular],["Atenção",attention],["Críticos",critical]]);
        let rowHtml,headers;
        if(selectedEmployee){
          rowHtml=filteredIntervals.map(x=>{
            const common=`<td>${formatDate(x.day.work_date)}</td><td>${weekday(x.day.work_date)}</td><td>${esc(x.day.schedule_code||'-')}</td><td class="occ-interval-markings">${x.markHtml}</td><td class="occ-interval-occurrence">${x.occurrence?esc(x.occurrence):'-'}</td><td>${x.work==null?'-':formatDuration(x.work,{signed:false})}</td><td class="occ-analysis-bh-minus">${x.bhNeg?formatDuration(x.bhNeg,{signed:false}):''}</td><td class="occ-analysis-bh-plus">${x.bhPos?formatDuration(x.bhPos,{signed:false}):''}</td><td>${x.abnormal?`<span class="occ-analysis-alert ${x.critical?'red':'yellow'}">${x.critical?'Crítico':'Atenção'} · ${x.diff} min</span>`:'<span class="occ-analysis-alert green">Normal</span>'}</td>`;
            return `<tr class="${x.critical?'occ-interval-row-critical':x.abnormal?'occ-interval-row-attention':''}">${common}</tr>`;
          });
          headers=['Data','Sem','Hor','Marcações','Ocorrência / BH','Trabalho','BH -','BH +','Situação'];
        }else{
          const byEmployee=new Map();
          filteredIntervals.forEach(x=>{
            const employeeId=String(x.day.employee_id||x.emp?.employee_id||'');
            if(!employeeId)return;
            if(!byEmployee.has(employeeId))byEmployee.set(employeeId,{employeeId,emp:x.emp||{},day:x.day,items:[],work:0,bhPos:0,bhNeg:0,attention:0,critical:0});
            const g=byEmployee.get(employeeId);g.items.push(x);g.work+=Number.isFinite(x.work)?x.work:0;g.bhPos+=x.bhPos||0;g.bhNeg+=x.bhNeg||0;if(x.critical)g.critical++;else if(x.abnormal)g.attention++;
          });
          const summaries=[...byEmployee.values()].sort((a,b)=>String(a.emp?.full_name||a.day.full_name||'').localeCompare(String(b.emp?.full_name||b.day.full_name||''),'pt-BR'));
          rowHtml=summaries.map(g=>{
            const registration=g.emp?.registration||g.day.registration||'-',employeeName=g.emp?.full_name||g.day.full_name||'Colaborador não identificado',shift=g.emp?.shift_name||g.day.shift_name||'Sem turno';
            const abnormal=g.attention+g.critical;
            const situation=g.critical?`<span class="occ-analysis-alert red">${g.critical} crítico${g.critical===1?'':'s'}</span>`:g.attention?`<span class="occ-analysis-alert yellow">${g.attention} atenção</span>`:'<span class="occ-analysis-alert green">Normal</span>';
            const employeeCell=`<button type="button" class="occ-interval-employee-link" data-interval-employee="${esc(g.employeeId)}"><strong>${esc(employeeName)}</strong><small>Clique para abrir a jornada completa</small></button>`;
            return `<tr class="${g.critical?'occ-interval-row-critical':g.attention?'occ-interval-row-attention':''}"><td class="occ-interval-registration">${esc(registration)}</td><td class="occ-interval-employee">${employeeCell}</td><td>${esc(shift)}</td><td><strong>${g.items.length}</strong></td><td>${formatDuration(g.work,{signed:false})}</td><td class="occ-analysis-bh-minus">${g.bhNeg?`-${formatDuration(g.bhNeg,{signed:false})}`:'00:00'}</td><td class="occ-analysis-bh-plus">${g.bhPos?`+${formatDuration(g.bhPos,{signed:false})}`:'00:00'}</td><td>${abnormal}</td><td>${g.attention}</td><td>${g.critical}</td><td>${situation}</td></tr>`;
          });
          headers=['Matrícula','Colaborador','Turno','Jornadas','Horas trabalhadas','BH -','BH +','Fora do padrão','Atenção','Críticos','Situação'];
        }
        setAnalysisTable(headers,rowHtml);
      }catch(error){analysisKpis([]);analysisBars({});setAnalysisTable(['Intervalos'],[],error.message||'Não foi possível carregar os intervalos.');}return;
    }
  }
  function selectAnalysisTab(tab){analysisTab=tab||'overview';document.querySelectorAll('#occ-analysis-tabs [data-occ-tab]').forEach(b=>b.classList.toggle('active',b.dataset.occTab===analysisTab));renderAnalysis();}

  function init(){
    const month=$("occurrences-month");
    if(month&&!month.value)month.value=new Date().toISOString().slice(0,7);

    $("occurrences-company")?.addEventListener("change",()=>{
      fillBranches();
      loadedKey="";
      load(true);
    });
    $("occurrences-branch")?.addEventListener("change",()=>{loadedKey="";load(true);});
    month?.addEventListener("change",()=>{loadedKey="";load(true);});
    $("occurrences-search")?.addEventListener("input",renderTable);
    ["occurrences-shift","occurrences-coordinator","occurrences-employee"].forEach(id=>$(id)?.addEventListener("change",()=>{renderStatusSummary();renderExecutiveInsights();renderTable();renderAnalysis();}));
    $("occurrences-status")?.addEventListener("change",()=>{renderStatusSummary();renderTable();renderAnalysis();});
    document.querySelectorAll("#occurrences-primary-kpis [data-status]").forEach(button=>button.addEventListener("click",()=>{const select=$("occurrences-status");if(!select)return;select.value=select.value===button.dataset.status?"":button.dataset.status;renderStatusSummary();renderTable();}));
    $("occurrences-save-employee-coordinator")?.addEventListener("click",()=>saveManagement("employee").catch(error=>toast?.(error.message||"Falha ao salvar.","error")));
    $("occurrences-management-open")?.addEventListener("click",openTeamManagement);
    $("occurrences-management-close")?.addEventListener("click",closeTeamManagement);
    document.querySelectorAll("[data-management-close]").forEach(el=>el.addEventListener("click",closeTeamManagement));
    $("occurrences-team-cards")?.addEventListener("click",event=>{const button=event.target.closest(".occ-team-save");if(!button)return;const card=button.closest(".occ-team-card"),select=card?.querySelector(".occ-team-coordinator-select");if(!card||!select)return;const coordinator=select.value?{id:String(select.value),name:select.options[select.selectedIndex]?.textContent||""}:null;saveManagement("shift",{shiftId:card.dataset.shiftId,coordinator}).then(renderTeamManagement).catch(error=>toast?.(error.message||"Falha ao salvar.","error"));});
    $("occurrences-manage-employee")?.addEventListener("change",()=>{const id=$("occurrences-manage-employee")?.value;$("occurrences-manage-employee-coordinator").value=management.employeeCoordinators?.[id]?.id||"";});
    $("occurrences-journey-close")?.addEventListener("click",()=>{if($("occurrences-journey-panel"))$("occurrences-journey-panel").hidden=true;});
    $("occurrences-clear-filter")?.addEventListener("click",()=>{
      activeKey="";
      if($("occurrences-search"))$("occurrences-search").value="";
      ["occurrences-shift","occurrences-coordinator","occurrences-employee","occurrences-status"].forEach(id=>{if($(id))$(id).value="";});
      renderStatusSummary();
      renderExecutiveInsights();
      document.querySelectorAll("#occurrences-summary article").forEach(card=>card.classList.remove("active-filter"));
      renderFilter();
      renderTable();
    });
    $("occurrences-presentation")?.addEventListener("click",()=>{
      document.body.classList.toggle("occurrences-presentation-mode");
      const active=document.body.classList.contains("occurrences-presentation-mode");
      if($("occurrences-presentation"))$("occurrences-presentation").textContent=active?"✕ Sair da apresentação":"▣ Modo Apresentação";
      if(active&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});
      else if(!active&&document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{});
    });
    document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement&&document.body.classList.contains("occurrences-presentation-mode")){document.body.classList.remove("occurrences-presentation-mode");if($("occurrences-presentation"))$("occurrences-presentation").textContent="▣ Modo Apresentação";}});
    $("occ-analysis-tabs")?.addEventListener("click",event=>{const button=event.target.closest("[data-occ-tab]");if(button)selectAnalysisTab(button.dataset.occTab);});
    $("occ-analysis-chart")?.addEventListener("click",event=>{const button=event.target.closest("[data-analysis-shift]");if(!button||analysisTab!=="intervals")return;analysisShiftFilter=button.dataset.analysisShift||"";renderAnalysis();});
    $("occ-analysis-tbody")?.addEventListener("click",event=>{const button=event.target.closest("[data-interval-employee]");if(!button||analysisTab!=="intervals")return;focusIntervalEmployee(button.dataset.intervalEmployee);});
    $("occ-analysis-tbody")?.addEventListener("click",event=>{const button=event.target.closest("[data-bh-employee]");if(!button||!(analysisTab==="bh-positive"||analysisTab==="bh-negative"))return;const select=$("occurrences-employee");if(!select)return;select.value=button.dataset.bhEmployee||"";renderStatusSummary();renderExecutiveInsights();renderTable();renderAnalysis();});
    $("occ-analysis-chart")?.addEventListener("click",event=>{const button=event.target.closest("[data-back-all-bh]");if(!button||!(analysisTab==="bh-positive"||analysisTab==="bh-negative"))return;const select=$("occurrences-employee");if(!select)return;select.value="";renderStatusSummary();renderExecutiveInsights();renderTable();renderAnalysis();});
    $("occ-analysis-chart")?.addEventListener("click",event=>{const button=event.target.closest("[data-back-all-employees]");if(!button||analysisTab!=="intervals")return;const select=$("occurrences-employee");if(!select)return;select.value="";analysisShiftFilter="";renderStatusSummary();renderExecutiveInsights();renderTable();renderAnalysis();});
    $("occurrences-print")?.addEventListener("click",printReport);
    window.addEventListener("afterprint",clearPrintMode);
    document.querySelectorAll("#occurrences-summary article[data-key]").forEach(card=>card.addEventListener("click",()=>selectKey(card.dataset.key)));
    loadScopeOptions().then(()=>load(true)).catch(error=>{
      if($("occurrences-import-status"))$("occurrences-import-status").textContent=error.message||"Não foi possível carregar empresas e filiais.";
    });
  }

  document.addEventListener("DOMContentLoaded",init);
  function invalidate(){
    loadedKey="";
    rows=[];
    activeKey="";
    lastData={summary:{},imports:[]};
    management={shiftCoordinators:{},employeeCoordinators:{}};
    analysisJourneyDays=[];analysisJourneyKey="";
  }

  global.loadOccurrencesControl=(force=false)=>load(Boolean(force));
  global.invalidateOccurrencesControl=()=>invalidate();
  global.OccurrencesControl={normalize,number,currentFilters,buildPrintDocument,printWindowHtml,invalidate,refresh:()=>load(true)};
})(window);