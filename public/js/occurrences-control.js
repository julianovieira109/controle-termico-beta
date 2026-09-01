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
      ?rows.map(row=>`
        <tr>
          <td class="occurrence-employee"><strong>${esc(row.full_name)}</strong><small>${esc(row.registration||"Sem matrícula")} · ${esc(row.company_name||"-")} / ${esc(row.branch_name||"-")}</small></td>
          <td>${number(row,"days_off")}</td><td>${number(row,"absences")}</td><td>${number(row,"bank_hours")}</td>
          <td>${number(row,"medical")}</td><td>${number(row,"vacations")}</td><td>${number(row,"dsr")}</td>
          <td>${number(row,"licenses")}</td><td>${number(row,"leaves")}</td><td>${number(row,"compensated")}</td>
          <td>${number(row,"courses")}</td><td>${number(row,"bereavement")}</td><td>${number(row,"review_days")}</td>
        </tr>`).join("")
      :'<tr><td colspan="13">Nenhum registro encontrado para o filtro selecionado.</td></tr>';

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
              <th>Colaborador</th><th>Folgas</th><th>Faltas</th><th>BH</th><th>Atestados</th>
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

    holder.replaceChildren(header,summary,charts,detail);
    holder.setAttribute("aria-hidden","false");
    return true;
  }

  function printWindowHtml(){
    if(!buildPrintDocument())return "";
    const holder=$("occurrences-print-document");
    const content=holder?.innerHTML||"";
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Relatório de Controle de Ocorrências</title>
<style>
@page{size:A4 landscape;margin:8mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#1f2f3d;font-family:Arial,sans-serif}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:7pt;font-weight:800;color:#154c79}
.occurrences-print-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10mm;margin:0 0 4mm;padding:0 0 3mm;border-bottom:1.5px solid #263746}
.occurrences-print-header h2{margin:1mm 0;font-size:15pt}.occurrences-print-header p{margin:0;color:#5f6d77;font-size:8pt}
.occurrences-print-meta{display:grid;gap:1mm;min-width:48mm;text-align:right;font-size:8pt}.occurrences-print-meta strong{font-size:9pt}
.occurrences-summary{display:grid;grid-template-columns:repeat(6,1fr);gap:2mm;margin:0 0 4mm}
.occurrences-summary article{min-height:15mm;padding:2.2mm;border:1px solid #cbd5dc;border-left:1.2mm solid #154c79;border-radius:2mm;background:#fff;break-inside:avoid}
.occurrences-summary article.review-card{border-left-color:#b42318}.occurrences-summary span{display:block;color:#5f6d77;font-size:6.2pt}.occurrences-summary strong{display:block;margin-top:1mm;font-size:15pt}.occurrences-summary small{display:block;margin-top:.5mm;color:#6f7d87;font-size:5.8pt}
.occurrences-charts{padding:3mm;margin:0 0 4mm;border:1px solid #cbd5dc;border-radius:2mm;break-inside:avoid}
.occurrences-charts-head{display:flex;align-items:flex-end;justify-content:space-between;gap:4mm;margin-bottom:2.5mm}.occurrences-charts-head h3{margin:1mm 0;font-size:10pt}.occurrences-charts-head p{margin:0;font-size:6pt;color:#65717d}
.occurrences-kpi-line{display:flex;gap:2mm}.occurrences-kpi-line span{display:flex;align-items:center;gap:1.5mm;padding:1.3mm 2mm;border:1px solid #d2dbe1;border-radius:2mm;color:#65717d;font-size:6pt}.occurrences-kpi-line strong{font-size:9pt;color:#1f2f3d}
.occurrences-charts-grid{display:grid;grid-template-columns:1.5fr .75fr;gap:3mm}.occurrences-chart-card{padding:2.5mm;border:1px solid #d5dde2;border-radius:2mm;background:#fff}.occurrences-chart-title{margin-bottom:2mm}.occurrences-chart-title strong,.occurrences-chart-title span{display:block}.occurrences-chart-title strong{font-size:7pt}.occurrences-chart-title span{font-size:5.5pt;color:#687681}
.occurrences-bar-chart{display:grid;gap:1mm}.occurrences-bar-row{display:grid;grid-template-columns:30mm 1fr;gap:2mm;align-items:center}.occurrences-bar-label{display:flex;justify-content:space-between;gap:1mm;color:#5f6d77;font-size:5.5pt}.occurrences-bar-track{height:1.6mm;border-radius:999px;background:#e1e7eb;overflow:hidden}.occurrences-bar-track i{display:block;height:100%;background:#154c79;border-radius:inherit}
.occurrences-donut-wrap{display:grid;grid-template-columns:30mm 1fr;gap:3mm;align-items:center;min-height:33mm}.occurrences-donut{display:grid;place-items:center;width:29mm;height:29mm;border-radius:50%;position:relative}.occurrences-donut:after{content:"";position:absolute;inset:6mm;border-radius:50%;background:#fff}.occurrences-donut>div{position:relative;z-index:1;text-align:center}.occurrences-donut strong{font-size:10pt}.occurrences-donut span,.occurrences-donut-legend span{font-size:5.5pt;color:#65717d}.occurrences-donut-legend{display:grid;gap:1.2mm}.occurrences-donut-legend span{display:grid;grid-template-columns:2mm 1fr auto;gap:1.5mm;align-items:center}.occurrences-donut-legend i{width:2mm;height:2mm;border-radius:50%}
.panel{border:1px solid #cbd5dc;border-radius:2mm;background:#fff}.panel-head{padding:2.5mm 3mm}.panel-head h3{margin:1mm 0;font-size:10pt}.panel-head p{margin:0;font-size:6pt;color:#65717d}
.table-wrap{overflow:visible}.occurrences-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:5.7pt}.occurrences-table thead{display:table-header-group}.occurrences-table tr{break-inside:avoid}.occurrences-table th,.occurrences-table td{border:1px solid #cdd6dc;padding:1.15mm .65mm;text-align:center}.occurrences-table th{background:#edf2f5;font-size:5.2pt}.occurrences-table th:first-child,.occurrences-table td:first-child{width:28%;text-align:left}.occurrence-employee strong,.occurrence-employee small{display:block}.occurrence-employee strong{font-size:5.8pt}.occurrence-employee small{font-size:4.8pt;color:#66747e}.occurrences-footer{display:flex;justify-content:space-between;padding:2mm 3mm;color:#65717d;font-size:6pt}
@media print{.occurrences-print-header,.occurrences-summary,.occurrences-charts{break-inside:avoid}}
</style>
</head>
<body>${content}
<script>
window.addEventListener("load",function(){
  setTimeout(function(){window.print();},250);
});
window.addEventListener("afterprint",function(){window.close();});
<\/script>
</body>
</html>`;
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
  global.OccurrencesControl={normalize,number,currentFilters,buildPrintDocument,printWindowHtml};
})(window);