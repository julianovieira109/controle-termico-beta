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

  function esc(value){
    return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function normalize(value){
    return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  }
  function number(row,key){return Number(row?.[key]||0);}
  function currentFilters(){
    return {
      month:$("occurrences-month")?.value||new Date().toISOString().slice(0,7),
      companyId:$("occurrences-company")?.value||"",
      branchId:$("occurrences-branch")?.value||""
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
    if($("occurrences-table-body"))$("occurrences-table-body").innerHTML='<tr><td colspan="13" class="muted">Carregando ocorrências...</td></tr>';
    if($("occurrences-bar-chart"))$("occurrences-bar-chart").innerHTML='<div class="occurrences-chart-loading">Carregando indicadores...</div>';
  }
  function renderSummary(summary={}){
    for(const [key,,id] of config)if($(id))$(id).textContent=Number(summary[key]||0);
  }
  function visibleRows(){
    const query=normalize($("occurrences-search")?.value);
    return rows.filter(row=>{
      if(activeKey && number(row,activeKey)<=0)return false;
      if(!query)return true;
      return normalize(`${row.full_name} ${row.registration||""} ${row.company_name||""} ${row.branch_name||""}`).includes(query);
    });
  }
  function renderTable(){
    const visible=visibleRows();
    if($("occurrences-visible-count"))$("occurrences-visible-count").textContent=`${visible.length} colaborador${visible.length===1?"":"es"} exibido${visible.length===1?"":"s"}`;
    const tbody=$("occurrences-table-body");
    if(!tbody)return;
    if(!visible.length){
      tbody.innerHTML='<tr><td colspan="13" class="muted">Nenhum colaborador encontrado para o filtro atual.</td></tr>';
      return;
    }
    tbody.innerHTML=visible.map(row=>`
      <tr>
        <td class="occurrence-employee"><strong>${esc(row.full_name)}</strong><small>${esc(row.registration||"Sem matrícula")} · ${esc(row.company_name||"-")} / ${esc(row.branch_name||"-")}</small></td>
        <td>${number(row,"days_off")}</td><td>${number(row,"absences")}</td><td>${number(row,"bank_hours")}</td>
        <td>${number(row,"medical")}</td><td>${number(row,"vacations")}</td><td>${number(row,"dsr")}</td>
        <td>${number(row,"licenses")}</td><td>${number(row,"leaves")}</td><td>${number(row,"compensated")}</td>
        <td>${number(row,"courses")}</td><td>${number(row,"bereavement")}</td>
        <td class="${number(row,"review_days")>0?"occurrence-review":""}">${number(row,"review_days")}</td>
      </tr>`).join("");
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

  function renderImportStatus(imports=[]){
    const status=$("occurrences-import-status");
    if(!status)return;
    if(imports.length){
      const branchNames=[...new Set(imports.map(item=>item.branch_name).filter(Boolean))];
      status.textContent=`Confirmado · ${imports.length} filial${imports.length===1?"":"is"}${branchNames.length&&branchNames.length<=4?` · ${branchNames.join(", ")}`:""}`;
      status.closest(".occurrences-source-status")?.classList.remove("is-missing");
    }else{
      status.textContent="Nenhum Cartão de Ponto confirmado neste filtro";
      status.closest(".occurrences-source-status")?.classList.add("is-missing");
    }
  }

  function updatePrintHeader(){
    const f=currentFilters();
    if($("occurrences-print-reference"))$("occurrences-print-reference").textContent=`Competência: ${monthLabel(f.month)}`;
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
      const data=await api(`/api/dashboard/occurrences?${query.toString()}`);
      loadedKey=key;
      lastData=data;
      rows=Array.isArray(data.employees)?data.employees:[];
      activeKey="";
      renderSummary(data.summary||{});
      renderCharts(data.summary||{});
      renderFilter();
      renderTable();
      renderImportStatus(Array.isArray(data.imports)?data.imports:[]);
      updatePrintHeader();
    }catch(error){
      rows=[];
      lastData={summary:{},imports:[]};
      renderSummary({});
      renderCharts({});
      renderTable();
      if($("occurrences-import-status"))$("occurrences-import-status").textContent=error.message||"Não foi possível carregar as ocorrências.";
    }
  }

  function printReport(){
    updatePrintHeader();
    document.body.classList.add("occurrences-print-active");
    window.print();
  }
  function clearPrintMode(){document.body.classList.remove("occurrences-print-active");}

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
    $("occurrences-clear-filter")?.addEventListener("click",()=>{
      activeKey="";
      if($("occurrences-search"))$("occurrences-search").value="";
      document.querySelectorAll("#occurrences-summary article").forEach(card=>card.classList.remove("active-filter"));
      renderFilter();
      renderTable();
    });
    $("occurrences-print")?.addEventListener("click",printReport);
    window.addEventListener("afterprint",clearPrintMode);
    document.querySelectorAll("#occurrences-summary article[data-key]").forEach(card=>card.addEventListener("click",()=>selectKey(card.dataset.key)));
    loadScopeOptions().then(()=>load(true)).catch(error=>{
      if($("occurrences-import-status"))$("occurrences-import-status").textContent=error.message||"Não foi possível carregar empresas e filiais.";
    });
  }

  document.addEventListener("DOMContentLoaded",init);
  global.loadOccurrencesControl=()=>load(false);
  global.OccurrencesControl={normalize,number,currentFilters};
})(window);