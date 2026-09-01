(function(){
  const $=id=>document.getElementById(id);
  let selectedEmployeeId=null;

  function canUseHistory(){
    return typeof currentUser!=="undefined" &&
      currentUser?.role==="ADMIN" &&
      currentUser?.isMasterAdmin===true;
  }

  function safe(value){
    const div=document.createElement("div");
    div.textContent=value===undefined||value===null?"":String(value);
    return div.innerHTML;
  }

  function historyLabel(key,entry={}){
    const labels={
      company_id:"Empresa",branch_id:"Filial",full_name:"Nome",registration:"Matrícula",
      admission_date:"Admissão",shift_id:"Turno",job_role_id:"Cargo",status:"Situação",
      report_policy_override:"Exceção de relatórios",use_shift_days_off:"Regra da folga semanal",
      weekly_days_off:"Dias de folga"
    };
    return entry.label||labels[key]||key;
  }

  function historyValue(value,key=""){
    if(value===null||value===undefined||value==="")return "Não informado";
    if(key==="use_shift_days_off")return value===true?"Folga padrão do turno":"Folga personalizada";
    if(key==="weekly_days_off"&&Array.isArray(value)){
      const names=["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
      return value.map(day=>names[Number(day)]||day).join(", ")||"Nenhuma";
    }
    if(typeof value==="boolean")return value?"Sim":"Não";
    if(typeof value==="object")return JSON.stringify(value);
    return String(value);
  }

  async function loadEmployeeHistory(id){
    if(!canUseHistory())return;
    selectedEmployeeId=id;
    const title=$("employee-history-title");
    const subtitle=$("employee-history-subtitle");
    const summary=$("employee-history-summary");
    const list=$("employee-history-list");
    if(!title||!subtitle||!summary||!list)return;

    title.textContent="Carregando...";
    subtitle.textContent="Consultando registros de auditoria.";
    summary.innerHTML="";
    list.innerHTML='<div class="employee-history-empty">Carregando histórico...</div>';

    try{
      const data=await api(`/api/employees/${id}/history`);
      const employee=data.employee||{};
      const history=Array.isArray(data.history)?data.history:[];

      title.textContent=employee.fullName||"Colaborador";
      subtitle.textContent=`Matrícula ${employee.registration||"não informada"}`;
      summary.innerHTML=`
        <article><span>Empresa</span><strong>${safe(employee.companyName||"-")}</strong></article>
        <article><span>Filial atual</span><strong>${safe(employee.branchName||"-")}</strong></article>
        <article><span>Registros</span><strong>${history.length}</strong></article>`;

      list.innerHTML=history.length?history.map(item=>{
        const changes=item.details?.changes||{};
        const entries=Object.entries(changes);
        const actionLabel=item.action==="CREATE"?"Cadastro criado":item.action==="UPDATE"?"Cadastro alterado":item.action==="DELETE"?"Cadastro excluído":item.action;
        const changeHtml=entries.length
          ?`<div class="employee-history-changes">${entries.map(([key,change])=>`
            <div>
              <strong>${safe(historyLabel(key,change))}</strong>
              <span>${safe(historyValue(change.from,key))}</span>
              <b aria-hidden="true">→</b>
              <span>${safe(historyValue(change.to,key))}</span>
            </div>`).join("")}</div>`
          :`<p>${item.action==="CREATE"?"Registro inicial do colaborador.":"Registro de auditoria preservado pelo sistema."}</p>`;

        return `<article class="employee-history-entry">
          <div class="employee-history-entry-head">
            <div><strong>${safe(actionLabel)}</strong><span>${safe(item.actor_name||"Sistema")}</span></div>
            <time>${new Date(item.created_at).toLocaleString("pt-BR")}</time>
          </div>
          ${changeHtml}
        </article>`;
      }).join(""):'<div class="employee-history-empty">Ainda não existem alterações registradas para este colaborador.</div>';
    }catch(error){
      title.textContent="Não foi possível carregar";
      subtitle.textContent=error.message||"Erro ao consultar histórico.";
      list.innerHTML='<div class="employee-history-empty">Falha na consulta.</div>';
    }
  }

  async function searchEmployees(){
    if(!canUseHistory())return;
    const input=$("employee-history-search");
    const result=$("employee-history-employee-list");
    const count=$("employee-history-result-count");
    if(!input||!result||!count)return;
    const term=input.value.trim();

    result.innerHTML='<div class="employee-history-empty">Pesquisando...</div>';
    try{
      const query=new URLSearchParams({status:"ALL"});
      if(term)query.set("search",term);
      const rows=await api(`/api/employees?${query.toString()}`);
      const limited=(Array.isArray(rows)?rows:[]).slice(0,100);
      count.textContent=`${limited.length} encontrado${limited.length===1?"":"s"}`;
      result.innerHTML=limited.length?limited.map(employee=>`
        <button type="button" class="employee-history-person ${String(employee.id)===String(selectedEmployeeId)?"active":""}" data-history-employee="${safe(employee.id)}">
          <strong>${safe(employee.full_name)}</strong>
          <span>Matrícula ${safe(employee.registration||"não informada")}</span>
          <small>${safe(employee.company_name||"-")} · ${safe(employee.branch_name||"-")}</small>
        </button>`).join("")
        :'<div class="employee-history-empty">Nenhum colaborador encontrado.</div>';
    }catch(error){
      count.textContent="0 encontrados";
      result.innerHTML=`<div class="employee-history-empty">${safe(error.message||"Não foi possível pesquisar.")}</div>`;
    }
  }

  function initialize(){
    const panel=$("settings-employee-history");
    const tab=document.querySelector('[data-settings-tab="employee-history"]');
    if(!panel||!tab)return;

    if(!canUseHistory()){
      tab.hidden=true;
      tab.style.display="none";
      panel.hidden=true;
      panel.style.display="none";
      return;
    }

    tab.hidden=false;
    tab.style.display="";
    panel.style.display="";

    $("employee-history-search-button")?.addEventListener("click",searchEmployees);
    $("employee-history-search")?.addEventListener("keydown",event=>{
      if(event.key==="Enter"){
        event.preventDefault();
        searchEmployees();
      }
    });
    $("employee-history-employee-list")?.addEventListener("click",event=>{
      const button=event.target.closest("[data-history-employee]");
      if(!button)return;
      document.querySelectorAll("[data-history-employee]").forEach(el=>el.classList.remove("active"));
      button.classList.add("active");
      loadEmployeeHistory(button.dataset.historyEmployee);
    });
    tab.addEventListener("click",()=>{
      if(!$("employee-history-employee-list")?.querySelector("[data-history-employee]")){
        searchEmployees();
      }
    });
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initialize);
  else initialize();
})();
