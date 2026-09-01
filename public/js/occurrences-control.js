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
  let loadedMonth="";

  function esc(value){
    return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function currentMonth(){
    return $("occurrences-month")?.value||new Date().toISOString().slice(0,7);
  }
  function normalize(value){
    return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  }
  function number(row,key){return Number(row?.[key]||0);}
  function setLoading(){
    for(const [, ,id] of config)if($(id))$(id).textContent="—";
    if($("occurrences-import-status"))$("occurrences-import-status").textContent="Consultando competência...";
    if($("occurrences-table-body"))$("occurrences-table-body").innerHTML='<tr><td colspan="13" class="muted">Carregando ocorrências...</td></tr>';
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
        <td class="occurrence-employee"><strong>${esc(row.full_name)}</strong><small>${esc(row.registration||"Sem matrícula")} · ${esc(row.branch_name||"-")}</small></td>
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
  async function load(force=false){
    const month=currentMonth();
    if(!month)return;
    if(!force && loadedMonth===month && rows.length){renderTable();return;}
    setLoading();
    try{
      const data=await api(`/api/dashboard/occurrences?month=${encodeURIComponent(month)}`);
      loadedMonth=month;
      rows=Array.isArray(data.employees)?data.employees:[];
      activeKey="";
      renderSummary(data.summary||{});
      renderFilter();
      renderTable();
      const imports=Array.isArray(data.imports)?data.imports:[];
      const status=$("occurrences-import-status");
      if(status){
        if(imports.length){
          const branches=[...new Set(imports.map(item=>item.branch_name).filter(Boolean))];
          status.textContent=`Confirmado · ${imports.length} filial${imports.length===1?"":"is"}${branches.length?` · ${branches.join(", ")}`:""}`;
          status.closest(".occurrences-source-status")?.classList.remove("is-missing");
        }else{
          status.textContent="Nenhum Cartão de Ponto confirmado nesta competência";
          status.closest(".occurrences-source-status")?.classList.add("is-missing");
        }
      }
    }catch(error){
      rows=[];
      renderSummary({});
      renderTable();
      if($("occurrences-import-status"))$("occurrences-import-status").textContent=error.message||"Não foi possível carregar as ocorrências.";
    }
  }

  function init(){
    const month=$("occurrences-month");
    if(month && !month.value)month.value=new Date().toISOString().slice(0,7);
    month?.addEventListener("change",()=>{loadedMonth="";load(true);});
    $("occurrences-search")?.addEventListener("input",renderTable);
    $("occurrences-clear-filter")?.addEventListener("click",()=>{
      activeKey="";
      if($("occurrences-search"))$("occurrences-search").value="";
      document.querySelectorAll("#occurrences-summary article").forEach(card=>card.classList.remove("active-filter"));
      renderFilter();renderTable();
    });
    document.querySelectorAll("#occurrences-summary article[data-key]").forEach(card=>card.addEventListener("click",()=>selectKey(card.dataset.key)));
  }

  document.addEventListener("DOMContentLoaded",init);
  global.loadOccurrencesControl=()=>load(false);
  global.OccurrencesControl={normalize,number};
})(window);