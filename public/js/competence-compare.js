(function(){
  const $=id=>document.getElementById(id);
  const fields=[
    ["imports","Importações de ponto"],
    ["employees","Colaboradores no ponto"],
    ["days","Dias importados"],
    ["eligibleDays","Dias aptos ao repouso"],
    ["reviewDays","Dias para revisar"],
    ["absenceDays","Faltas"],
    ["vacationDays","Férias"],
    ["medicalDays","Atestados"]
  ];

  function monthBefore(month){
    const [y,m]=String(month).split("-").map(Number);
    const d=new Date(y,m-2,1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  }
  function label(month){
    const [y,m]=String(month).split("-").map(Number);
    if(!y||!m)return "-";
    return new Intl.DateTimeFormat("pt-BR",{month:"short",year:"numeric"}).format(new Date(y,m-1,1)).replace(".","");
  }
  function delta(a,b){
    const n=Number(b||0)-Number(a||0);
    return {n,text:n===0?"Sem alteração":`${n>0?"+":""}${n}`,className:n>0?"up":n<0?"down":"same"};
  }
  function render(data){
    const a=data.a||{},b=data.b||{};
    $("competence-compare-summary").innerHTML=fields.map(([key,name])=>{
      const d=delta(a[key],b[key]);
      return `<article>
        <span>${name}</span>
        <div><b>${Number(a[key]||0)}</b><i>→</i><b>${Number(b[key]||0)}</b></div>
        <small class="${d.className}">${d.text}</small>
      </article>`;
    }).join("");

    const alerts=[];
    if(!a.imports)alerts.push(`${label(a.month)} não possui importação de Cartão de Ponto confirmada.`);
    if(!b.imports)alerts.push(`${label(b.month)} não possui importação de Cartão de Ponto confirmada.`);
    const review=delta(a.reviewDays,b.reviewDays);
    if(review.n>0)alerts.push(`Os dias para revisão aumentaram em ${review.n}.`);
    const employees=delta(a.employees,b.employees);
    if(employees.n<0)alerts.push(`Há ${Math.abs(employees.n)} colaborador(es) a menos localizado(s) no ponto.`);
    const eligible=delta(a.eligibleDays,b.eligibleDays);
    if(eligible.n<0)alerts.push(`Os dias aptos ao repouso reduziram em ${Math.abs(eligible.n)}.`);
    $("competence-compare-alerts").innerHTML=alerts.length
      ?`<strong>Pontos de atenção</strong>${alerts.map(x=>`<p>• ${x}</p>`).join("")}`
      :`<strong>Comparação sem alertas críticos.</strong><p>Os principais indicadores não apresentaram redução que exija atenção imediata.</p>`;
  }

  async function run(){
    const a=$("competence-compare-a").value,b=$("competence-compare-b").value;
    const status=$("competence-compare-status");
    if(!a||!b)return status.textContent="Selecione as duas competências.";
    if(a===b)return status.textContent="Selecione competências diferentes.";
    status.className="feedback";
    status.textContent="Comparando competências...";
    try{
      const data=await api(`/api/dashboard/competence-compare?monthA=${encodeURIComponent(a)}&monthB=${encodeURIComponent(b)}`);
      render(data);
      status.className="feedback success";
      status.textContent=`Comparação concluída: ${label(a)} → ${label(b)}.`;
    }catch(error){
      status.className="feedback error";
      status.textContent=error.message||"Não foi possível comparar as competências.";
    }
  }

  function init(){
    const current=$("report-month")?.value||new Date().toISOString().slice(0,7);
    if($("competence-compare-b"))$("competence-compare-b").value=current;
    if($("competence-compare-a"))$("competence-compare-a").value=monthBefore(current);
    if($("competence-compare-toggle"))$("competence-compare-toggle").onclick=()=>{
      const body=$("competence-compare-body");
      body.hidden=!body.hidden;
      if(!body.hidden){
        const reportMonth=$("report-month")?.value;
        if(reportMonth){
          $("competence-compare-b").value=reportMonth;
          $("competence-compare-a").value=monthBefore(reportMonth);
        }
      }
    };
    if($("competence-compare-run"))$("competence-compare-run").onclick=run;
  }
  document.addEventListener("DOMContentLoaded",init);
})();