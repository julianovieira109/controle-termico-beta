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

  function coordinatorOptions(emptyLabel){
    return `<option value="">${esc(emptyLabel)}</option>`+[...rows].sort((a,b)=>String(a.full_name).localeCompare(String(b.full_name),"pt-BR")).map(r=>`<option value="${esc(r.employee_id)}" data-name="${esc(r.full_name)}">${esc(r.full_name)}</option>`).join("");
  }
  function fillManagementSelectors(){
    if($("occurrences-manage-employee"))$("occurrences-manage-employee").innerHTML='<option value="">Selecione o colaborador</option>'+[...rows].sort((a,b)=>String(a.full_name).localeCompare(String(b.full_name),"pt-BR")).map(r=>`<option value="${esc(r.employee_id)}">${esc(r.full_name)}</option>`).join("");
    if($("occurrences-manage-employee-coordinator"))$("occurrences-manage-employee-coordinator").innerHTML=coordinatorOptions("Usar coordenador do turno");
    renderTeamManagement();
  }
  function teamShiftRows(){
    const map=new Map();
    rows.filter(r=>r.shift_id).forEach(r=>{
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
    if(planned!=null&&actual!==planned)return {level:'yellow',label:`Intervalo fora do padrão (${actual} min / previsto ${planned} min)`,actual,planned};
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
      const irregular=analyses.filter(item=>item.level==='yellow'&&item.label.startsWith('Intervalo')).length;
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
      if($("occurrences-import-status"))$("occurrences-import-status").textContent=error.message||"Não foi possível carregar as ocorrências.";
    }
  }

  function buildPrintDocument(){
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

    const tableRows=rows.length
      ?rows.map((row,index)=>`
        <tr>
          <td class="occurrence-rank">${index+1}</td>
          <td class="occurrence-employee"><strong>${esc(row.full_name)}</strong><small>${esc(row.company_name||"-")} / ${esc(row.branch_name||"-")}</small></td>
          <td class="occurrence-registration">${esc(row.registration||"-")}</td>
          <td>${number(row,"days_off")}</td><td>${number(row,"absences")}</td><td>${number(row,"bank_hours")}</td>
          <td>${number(row,"medical")}</td><td>${number(row,"vacations")}</td><td>${number(row,"dsr")}</td>
          <td>${number(row,"licenses")}</td><td>${number(row,"leaves")}</td><td>${number(row,"compensated")}</td>
          <td>${number(row,"courses")}</td><td>${number(row,"bereavement")}</td><td>${number(row,"review_days")}</td>
        </tr>`).join("")
      :'<tr><td colspan="15">Nenhum registro encontrado para o filtro selecionado.</td></tr>';

    const detail=document.createElement("section");
    detail.className="panel occurrences-detail-panel";
    detail.innerHTML=`
      <div class="panel-head occurrences-detail-head">
        <div>
          <span class="eyebrow">Detalhamento</span>
          <h3>Ocorrências por colaborador</h3>
          <p class="hint">Relatório completo da empresa, filial e competência selecionadas.</p>
        </div>
      </div>
      <div class="table-wrap occurrences-table-wrap">
        <table class="occurrences-table">
          <thead>
            <tr>
              <th>#</th><th>Colaborador</th><th>Matrícula</th><th>Folgas</th><th>Faltas</th><th>BH</th><th>Atestados</th>
              <th>Férias</th><th>DSR</th><th>Licenças</th><th>Afast.</th><th>Comp.</th>
              <th>Curso</th><th>Óbito</th><th>Revisão</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      <div class="occurrences-footer">
        <span>${rows.length} colaborador${rows.length===1?"":"es"} no relatório</span>
        <small>Fonte: Cartão de Ponto Senior importado no Controle Térmico.</small>
      </div>`;

    const f=currentFilters();
    const period=importPeriod(Array.isArray(lastData.imports)?lastData.imports:[]);
    const totalOccurrences=config.reduce((sum,[key])=>sum+Number(lastData.summary?.[key]||0),0);
    const context=document.createElement("section");
    context.className="occurrences-print-context";
    context.innerHTML=`
      <div><span>Competência</span><strong>${esc(monthLabel(f.month))}</strong><small>${period?`${formatDate(period.start)} a ${formatDate(period.end)}`:"Período da competência"}</small></div>
      <div><span>Empresa</span><strong>${esc(selectedText("occurrences-company","Todas as empresas"))}</strong><small>Escopo do relatório</small></div>
      <div><span>Filial</span><strong>${esc(selectedText("occurrences-branch","Todas as filiais"))}</strong><small>Unidade selecionada</small></div>
      <div><span>Totais gerais</span><strong>${rows.length} colaboradores</strong><small>${totalOccurrences} ocorrências registradas</small></div>`;

    holder.replaceChildren(header,context,summary,charts,detail);
    holder.setAttribute("aria-hidden","false");
    return true;
  }

  function printWindowHtml(){
    if(!buildPrintDocument())return "";
    const content=$("occurrences-print-document")?.innerHTML||"";
    return global.OccurrencesPrintTemplate?.document(content)||"";
  }

  function printReport(){
    const html=printWindowHtml();
    if(!html){
      if(typeof toast==="function")toast("Não foi possível preparar o relatório para impressão.","error");
      return;
    }
    const printWindow=window.open("","_blank","width=1200,height=850");
    if(!printWindow){
      if(typeof toast==="function")toast("O navegador bloqueou a janela de impressão. Permita pop-ups para este sistema.","error");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    clearPrintMode();
  }
  function clearPrintMode(){
    document.body.classList.remove("occurrences-print-active");
    const holder=$("occurrences-print-document");
    if(holder){
      holder.replaceChildren();
      holder.setAttribute("aria-hidden","true");
    }
  }

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
    ["occurrences-shift","occurrences-coordinator","occurrences-employee"].forEach(id=>$(id)?.addEventListener("change",()=>{renderStatusSummary();renderExecutiveInsights();renderTable();}));
    $("occurrences-status")?.addEventListener("change",()=>{renderStatusSummary();renderTable();});
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
  }

  global.loadOccurrencesControl=(force=false)=>load(Boolean(force));
  global.invalidateOccurrencesControl=()=>invalidate();
  global.OccurrencesControl={normalize,number,currentFilters,buildPrintDocument,printWindowHtml,invalidate,refresh:()=>load(true)};
})(window);