function formatShiftOptionLabel(shift){
  if(!shift)return "";

  const name=String(shift.name||"Turno").trim();
  const description=String(shift.description||"").trim();
  const seniorCode=String(shift.senior_code||"").trim();

  const parts=[];
  if(seniorCode)parts.push(`Cód. ${seniorCode}`);
  parts.push(name);
  if(description)parts.push(description);

  return parts.join(" — ");
}

async function loadCatalogs(){
  catalogs.shifts=await api("/api/catalogs/shifts");
  catalogs.job_roles=await api("/api/catalogs/job_roles");
}


async function setEmployeeModule(tab="register",options={}){
  const valid=new Set(["register","import","shift"]);
  const target=valid.has(tab)?tab:"register";

  document.querySelectorAll(".employee-tab").forEach(btn=>{
    const active=btn.dataset.employeeTab===target;
    btn.classList.toggle("active",active);
    btn.setAttribute("aria-selected",active?"true":"false");
    if(active)btn.setAttribute("aria-current","page");
    else btn.removeAttribute("aria-current");
  });

  $("employee-register-area").hidden=target!=="register";
  $("employee-import-area").hidden=target!=="import";
  $("shift-import-panel").hidden=target!=="shift";

  if(target==="import"){
    await preparePdfImport();
  }

  if(target==="shift"){
    fillShiftImportCompanies();
  }

  if(options.scroll!==false){
    document.querySelector(".employee-tabs")?.scrollIntoView({
      behavior:options.instant?"auto":"smooth",
      block:"start"
    });
  }
}

window.setEmployeeModule=setEmployeeModule;

document.querySelectorAll(".employee-tab").forEach(btn=>{
  btn.onclick=async()=>{
    await setEmployeeModule(btn.dataset.employeeTab);
  };
});

async function preparePdfImport(){
  if(!companies.length)await loadCompanies();
  if(!branches.length)await loadBranches();

  $("pdf-import-company").innerHTML=companies
    .filter(c=>c.active)
    .map(c=>`<option value="${c.id}">${c.trade_name}</option>`).join("");
  fillPdfImportBranches();
  await loadPdfImportHistory();
}

function fillPdfImportBranches(){
  const companyId=$("pdf-import-company").value;
  const allowed=currentUser.role==="ADMIN"
    ? branches.filter(b=>b.company_id===companyId&&b.active)
    : branches.filter(b=>(currentUser.branchIds||[]).includes(b.id)&&b.active);

  $("pdf-import-branch").innerHTML=allowed
    .map(b=>`<option value="${b.id}">${b.name}</option>`).join("");
}
$("pdf-import-company").onchange=fillPdfImportBranches;


function looksLikeSeniorShiftPdf(file){
  const name=String(file?.name||"");
  return /(?:^|[\s_\-])(escala|turno|turnos)(?:[\s_\-]|\d|\.|$)/i.test(name)
    || /^escala\s*\d+/i.test(name);
}

async function previewShiftPdfFromGenericImport(file,companyId,branchId,button){
  const form=new FormData();
  form.append("file",file);
  form.append("companyId",companyId);
  form.append("branchId",branchId);

  setButtonLoading(button,true,"Lendo escala");

  try{
    const response=await fetch("/api/imports/shift-preview",{
      method:"POST",
      headers:{Authorization:`Bearer ${token}`},
      body:form
    });

    const raw=await response.text();
    let data={};
    try{ data=raw?JSON.parse(raw):{}; }catch{ data={error:"Resposta inválida do servidor.",detail:raw.slice(0,500)}; }

    if(!response.ok){
      const detail=[data.error,data.detail].filter(Boolean).join(" — ");
      throw new Error(detail||"Não foi possível analisar o PDF de turnos.");
    }

    // Abre automaticamente o módulo correto e reutiliza a prévia de turnos.
    await setEmployeeModule("shift",{scroll:false});
    fillShiftImportCompanies();
    $("shift-import-company").value=companyId;
    fillShiftImportBranches();
    $("shift-import-branch").value=branchId;

    renderShiftImportPreview(data);
    $("pdf-import-preview-panel").hidden=true;
    $("pdf-import-detection").hidden=false;
    $("pdf-import-detection").innerHTML=`
      <b>Arquivo reconhecido automaticamente como Escala/Turnos.</b>
      <p>${data.total||0} colaborador(es) identificado(s). Continue no módulo <b>Atualizar turnos dos colaboradores</b>.</p>
    `;

    toast(`Escala reconhecida: ${data.total||0} colaborador(es) para conferência.`,"success");
    $("shift-import-panel").scrollIntoView({behavior:"smooth",block:"start"});
    return true;
  }finally{
    setButtonLoading(button,false);
  }
}

$("pdf-import-form").onsubmit=async e=>{
  e.preventDefault();

  const button=e.submitter||e.target.querySelector('button[type="submit"]');

  try{
    const file=$("pdf-import-file").files[0];
    if(!file){
      toast("Selecione o arquivo PDF.","warning");
      return;
    }

    const companyId=$("pdf-import-company").value;
    const branchId=$("pdf-import-branch").value;

    if(looksLikeSeniorShiftPdf(file)){
      if(!companyId||!branchId){
        toast("Selecione a empresa e a filial.","warning");
        return;
      }

      try{
        await previewShiftPdfFromGenericImport(file,companyId,branchId,button);
      }catch(error){
        $("pdf-import-detection").hidden=false;
        $("pdf-import-detection").innerHTML=`
          <b>O arquivo foi identificado como Escala/Turnos, mas não pôde ser lido.</b>
          <p>${error.message}</p>
        `;
        toast(error.message,"error");
      }
      return;
    }

    setButtonLoading(button,true,"Lendo PDF");

    const form=new FormData();
    form.append("file",file);
    form.append("type",$("pdf-import-type").value);
    form.append("companyId",$("pdf-import-company").value);
    form.append("branchId",$("pdf-import-branch").value);

    const response=await fetch("/api/imports/preview",{
      method:"POST",
      headers:{Authorization:`Bearer ${token}`},
      body:form
    });

    const raw=await response.text();
    let data={};

    try{
      data=raw?JSON.parse(raw):{};
    }catch{
      data={
        error:"O servidor devolveu uma resposta inválida.",
        detail:raw.trim().startsWith("<")
          ?"A rota de importação não está atualizada no Render."
          : raw.slice(0,500)
      };
    }

    if(!response.ok){
      $("pdf-import-detection").hidden=false;
      $("pdf-import-detection").innerHTML=`
        <b>${data.error||"Não foi possível ler o PDF."}</b>
        <p>${data.detail||""}</p>
        ${(data.readerAttempts||[]).length?`
          <details open>
            <summary>Diagnóstico dos leitores</summary>
            <ul class="reader-attempt-list">
              ${data.readerAttempts.map(item=>`
                <li><b>${item.reader}</b>: ${item.success?"sucesso":item.error}</li>
              `).join("")}
            </ul>
          </details>`:""}
        ${data.extractedTextSample?`
          <details open>
            <summary>Ver amostra do texto extraído</summary>
            <pre class="extracted-text-sample">${data.extractedTextSample}</pre>
          </details>`:""}
      `;
      toast(data.detail?`${data.error} ${data.detail}`:data.error,"error");
      return;
    }

    pdfImportPreview=data;
    renderPdfImportPreview();
    toast(`${data.total} colaborador(es) reconhecido(s) no PDF.`,"success");
  }catch(error){
    $("pdf-import-detection").hidden=false;
    $("pdf-import-detection").innerHTML=`
      <b>Falha ao acessar o importador.</b>
      <p>${error.message}</p>
    `;
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
};


function intelligentReaderCard(intelligence){
  if(!intelligence)return "";

  const levelClass=String(intelligence.level||"BAIXA")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase();

  const signals=Array.isArray(intelligence.signals)?intelligence.signals:[];

  return `
    <div class="senior-intelligence-card ${levelClass}">
      <div class="senior-intelligence-head">
        <div>
          <span class="senior-intelligence-kicker">LEITOR INTELIGENTE SENIOR</span>
          <strong>Confiança ${intelligence.score??0}% — ${intelligence.level||"BAIXA"}</strong>
        </div>
        <span class="senior-confidence-badge">${intelligence.score??0}%</span>
      </div>
      <p>${intelligence.suggestedAction||"Confira os dados antes de continuar."}</p>
      ${signals.length?`
        <details>
          <summary>Por que o sistema chegou a essa confiança?</summary>
          <ul>${signals.map(signal=>`<li>${signal}</li>`).join("")}</ul>
        </details>
      `:""}
    </div>
  `;
}

function escapeChecklistHtml(value){
  return String(value??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function checklistStatusLabel(status){
  return ({
    CONFERIDO:"Conferido",
    CADASTRAR:"Não existe no sistema",
    CADASTRADO:"Cadastrado",
    ATUALIZAR:"Dados divergentes",
    ATUALIZADO:"Atualizado",
    SEM_TURNO:"Sem turno",
    POSSIVEL_READMISSAO:"Possível readmissão",
    OUTRA_UNIDADE:"Outra empresa/filial",
    NAO_APARECE_NA_SENIOR:"Não aparece na Senior",
    ERRO:"Erro no processamento",
    CARGO_BLOQUEADO:"Cargo bloqueado"
  })[status]||String(status||"Revisar").replaceAll("_"," ");
}

function renderPdfComparisonChecklist(checklist,{afterImport=false}={}){
  const panel=$("pdf-checklist-panel");
  if(!panel)return;

  if(!checklist?.items?.length){
    panel.hidden=true;
    return;
  }

  pdfComparisonChecklist=checklist;
  panel.hidden=false;
  $("pdf-checklist-description").textContent=afterImport
    ? "Resultado atualizado após a importação. Itens exclusivos do sistema continuam aguardando revisão."
    : "Comparação antes da importação por matrícula, nome, cargo, situação e turno.";

  const items=checklist.items||[];
  const count=status=>items.filter(item=>item.status===status).length;
  const pending=items.filter(item=>[
    "CADASTRAR","ATUALIZAR","SEM_TURNO","POSSIVEL_READMISSAO",
    "OUTRA_UNIDADE","NAO_APARECE_NA_SENIOR","ERRO"
  ].includes(item.status)).length;

  $("pdf-checklist-summary").innerHTML=`
    <article><span>Lista Senior</span><strong>${checklist.seniorTotal||items.filter(item=>item.origin==="SENIOR").length}</strong></article>
    <article><span>Ativos no sistema</span><strong>${checklist.systemActiveTotal??"—"}</strong></article>
    <article><span>Conferidos</span><strong>${count("CONFERIDO")}</strong></article>
    <article><span>Cadastrados</span><strong>${count("CADASTRADO")}</strong></article>
    <article><span>Atualizados</span><strong>${count("ATUALIZADO")}</strong></article>
    <article><span>Sem turno</span><strong>${items.filter(item=>item.withoutShift).length}</strong></article>
    <article><span>Pendentes/revisar</span><strong>${pending}</strong></article>
  `;

  $("pdf-checklist-body").innerHTML=items.map(item=>`
    <tr class="checklist-row ${item.status}">
      <td>${item.origin==="SENIOR"?"Lista Senior":"Sistema"}</td>
      <td>${escapeChecklistHtml(item.registration||"-")}</td>
      <td><b>${escapeChecklistHtml(item.fullName||"-")}</b>${
        item.systemName&&item.systemName!==item.fullName
          ?`<small>No sistema: ${escapeChecklistHtml(item.systemName)}</small>`:""
      }</td>
      <td>${escapeChecklistHtml(item.jobTitle||"-")}${
        item.systemJobTitle&&item.systemJobTitle!==item.jobTitle
          ?`<small>No sistema: ${escapeChecklistHtml(item.systemJobTitle)}</small>`:""
      }</td>
      <td>${escapeChecklistHtml(item.shiftName||"Não definido")}</td>
      <td><span class="checklist-status ${item.status}">${checklistStatusLabel(item.status)}</span></td>
      <td>${escapeChecklistHtml(item.details||"-")}</td>
    </tr>
  `).join("");
}

function applyImportResultsToChecklist(results=[]){
  if(!pdfComparisonChecklist?.items?.length)return;
  const byRegistration=new Map(
    (results||[]).filter(result=>result.registration)
      .map(result=>[String(result.registration),result])
  );

  pdfComparisonChecklist.items=pdfComparisonChecklist.items.map(item=>{
    if(item.origin!=="SENIOR")return item;
    const result=byRegistration.get(String(item.registration));
    if(!result)return item;

    const mapped=(result.result==="CADASTRADO"||result.result==="CADASTRADO_POSSIVEL_READMISSAO")
      ?"CADASTRADO"
      : result.result==="ATUALIZADO"
        ?"ATUALIZADO"
        : result.result==="CONFERIDO"
          ?"CONFERIDO"
        : result.result;

    return {
      ...item,
      status:mapped,
      details:mapped==="CADASTRADO"
        ?"Cadastrado no sistema durante esta importação."
        : mapped==="ATUALIZADO"
          ?`Cadastro atualizado durante esta importação${result.corrections?.length?`: ${result.corrections.join(", ")}`:""}.`
          : mapped==="CONFERIDO"
            ?"Cadastro conferido pela matrícula; nenhuma correção foi necessária."
          : item.details
    };
  });

  renderPdfComparisonChecklist(pdfComparisonChecklist,{afterImport:true});
}

function printPdfComparisonChecklist(){
  if(!pdfComparisonChecklist?.items?.length)return toast("Nenhuma checklist disponível.","warning");
  const summary=$("pdf-checklist-summary")?.innerHTML||"";
  const body=$("pdf-checklist-body")?.innerHTML||"";
  const printWindow=window.open("","_blank","width=1100,height=800");
  if(!printWindow)return toast("O navegador bloqueou a janela de impressão.","warning");

  printWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Checklist Sistema x Lista Senior</title><style>
    body{font-family:Arial,sans-serif;color:#1f2933;padding:24px}h1{font-size:22px;margin:0 0 4px}p{margin:0 0 18px;color:#52606d}
    .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}.summary article{border:1px solid #ccd5df;border-radius:8px;padding:10px}.summary span,.summary strong{display:block}.summary span{font-size:11px;color:#52606d}.summary strong{font-size:19px;margin-top:3px}
    table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left;vertical-align:top}th{background:#eef2f6}small{display:block;margin-top:2px}.checklist-status{font-weight:bold}
    @page{size:A4 landscape;margin:10mm}
  </style></head><body><h1>Checklist Sistema × Lista Senior</h1><p>Gerado em ${new Date().toLocaleString("pt-BR")}. Documento de conferência, sem alterações automáticas.</p><div class="summary">${summary}</div><table><thead><tr><th>Origem</th><th>Matrícula</th><th>Colaborador</th><th>Cargo</th><th>Turno</th><th>Resultado</th><th>Detalhes</th></tr></thead><tbody>${body}</tbody></table></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(()=>printWindow.print(),250);
}

if($("pdf-checklist-print"))$("pdf-checklist-print").onclick=printPdfComparisonChecklist;

function renderPdfImportPreview(){
  const p=pdfImportPreview;
  $("pdf-import-detection").hidden=false;
  const d=p.diagnostics||{};
  $("pdf-import-detection").innerHTML=`
    <b>Arquivo reconhecido:</b> ${
      p.type==="ADMITIDOS" ? "Relação de Admitidos" :
      p.type==="DEMITIDOS" ? "Relação de Demitidos" :
      "Relação de Colaboradores"
    }<br>
    <b>Tipo detectado:</b> ${p.detectedType||p.type}<br>
    <b>Leitor utilizado:</b> ${
      p.readerUsed?.includes("xref-repair")
        ? `PDF reparado automaticamente (${p.readerUsed})`
        : p.readerUsed==="pdf2json"
          ? "Leitor alternativo (pdf2json)"
          : "Leitor principal (pdf-parse)"
    }<br>
    <b>Empresa detectada:</b> ${p.detectedCompany||"Não identificada"}<br>
    <b>Filial detectada:</b> ${p.detectedBranch||"Não identificada"}<br>
    <b>Operação identificada:</b> ${p.detectedOperationalBranch||"Não identificada"}<br>
    <b>Filial selecionada:</b> ${p.selectedBranchName||"Não identificada"}
    ${intelligentReaderCard(p.intelligence)}
    <div class="pdf-diagnostic-grid">
      <article><span>Matrículas únicas</span><strong>${d.uniqueRegistrationCount??d.registrationCount??p.total}</strong></article>
      <article><span>Datas</span><strong>${d.dateCount??p.total}</strong></article>
      <article><span>Cartões</span><strong>${p.type==="ADMITIDOS"?(d.pointCardCount??p.total):"—"}</strong></article>
      <article><span>Registros montados</span><strong>${d.parsedCount??p.total}</strong></article>
      <article><span>Não reconhecidos</span><strong>${d.unresolvedCount??0}</strong></article>
    </div>
    ${d.unresolvedCount?`<div class="import-warning"><b>Atenção:</b> ${d.unresolvedCount} matrícula(s) do texto não foram montadas. Não confirme antes de revisar: ${escapeHtml((d.unresolvedRegistrations||[]).join(", "))}.</div>`:""}
  `;

  $("pdf-import-preview-panel").hidden=false;
  pdfComparisonChecklist=p.comparisonChecklist||null;
  renderPdfComparisonChecklist(pdfComparisonChecklist);
  if(p.type==="COLABORADORES"&&p.total){
    toast(`${p.total} colaboradores foram reconstruídos a partir do texto do PDF.`,"success");
  }
  $("pdf-import-summary").textContent=`${p.total} colaborador(es) encontrados em ${p.fileName}.${p.possibleReadmissions?` ${p.possibleReadmissions} possível(is) readmissão(ões) identificada(s) — será criada nova matrícula sem alterar o vínculo antigo.`:""}`;

  if(p.type==="ADMITIDOS"||p.type==="COLABORADORES"){
    $("pdf-import-head").innerHTML=`<tr><th><input type="checkbox" id="pdf-import-select-all" checked></th><th>Matrícula</th>${p.type==="COLABORADORES"?"<th>Tipo</th>":""}<th>Nome</th><th>Admissão</th><th>Cargo</th>${p.type==="ADMITIDOS"?"<th>Cartão</th>":""}<th>Resultado</th><th>Turno</th></tr>`;
    $("pdf-import-body").innerHTML=p.rows.map((r,i)=>`<tr>
      <td><input class="import-check" type="checkbox" data-import-index="${i}" ${p.intelligence?.requiresReview ? "" : "checked"}></td>
      <td>${escapeHtml(r.registration)}</td>
      ${p.type==="COLABORADORES"?`<td>${escapeHtml(r.employeeType||"-")}</td>`:""}
      <td>${escapeHtml(r.fullName)}</td>
      <td>${formatApiDate(r.admissionDate)}</td>
      <td>${escapeHtml(r.jobTitle)}</td>
      ${p.type==="ADMITIDOS"?`<td>${escapeHtml(r.pointCard||"-")}</td>`:""}
      <td><span class="import-result ${escapeHtml(r.result)}">${
        r.result==="CONFERIR"
          ?"PRONTO PARA IMPORTAR"
          : r.result==="POSSIVEL_READMISSAO"
            ?`POSSÍVEL READMISSÃO — NOVA MATRÍCULA${r.previousRegistration?` (anterior: ${escapeHtml(r.previousRegistration)})`:""}`
          : escapeHtml(r.result)
      }</span></td>
      <td>${r.hasShift?"Mantém o cadastrado":'<span class="shift-missing">Definir depois</span>'}</td>
    </tr>`).join("");
  }else{
    $("pdf-import-head").innerHTML=`<tr><th><input type="checkbox" id="pdf-import-select-all" checked></th><th>Matrícula</th><th>Colaborador localizado</th><th>Demissão</th><th>Causa</th><th>Cargo cadastrado</th><th>Resultado</th></tr>`;
    $("pdf-import-body").innerHTML=p.rows.map((r,i)=>`<tr>
      <td><input class="import-check" type="checkbox" data-import-index="${i}" ${
        r.result==="NAO_LOCALIZADO" || p.intelligence?.requiresReview ? "" : "checked"
      }></td>
      <td>${escapeHtml(r.registration)}</td>
      <td>${escapeHtml(r.currentName||r.fullName||"Não localizado")}</td>
      <td>${formatApiDate(r.terminationDate)}</td>
      <td>${escapeHtml(r.causeCode)}</td>
      <td>${escapeHtml(r.currentJobTitle||r.jobTitle||r.rawDescription||"-")}</td>
      <td><span class="import-result ${escapeHtml(r.result)}">${escapeHtml(r.result.replaceAll("_"," "))}</span></td>
    </tr>`).join("");
  }


  const missing=p.missingFromReport||[];
  $("pdf-missing-panel").hidden=!(p.type==="COLABORADORES"&&missing.length);
  $("pdf-missing-body").innerHTML=missing.length
    ? missing.map(row=>`<tr>
        <td>${escapeHtml(row.registration||"-")}</td>
        <td>${escapeHtml(row.fullName)}</td>
        <td>${escapeHtml(row.status)}</td>
      </tr>`).join("")
    : "";

  $("pdf-import-select-all").onchange=()=>{
    document.querySelectorAll("#pdf-import-body .import-check").forEach(x=>{
      const index=Number(x.dataset.importIndex);
      const row=pdfImportPreview?.rows?.[index];
      x.checked=$("pdf-import-select-all").checked && Boolean(row);
    });
  };
}

$("pdf-import-confirm").onclick=async()=>{
  if(!pdfImportPreview)return;

  if(
    String($("pdf-import-company").value)!==String(pdfImportPreview.previewCompanyId||"") ||
    String($("pdf-import-branch").value)!==String(pdfImportPreview.previewBranchId||"")
  ){
    toast("Empresa ou filial foi alterada após a leitura. Leia o PDF novamente antes de confirmar.","warning");
    return;
  }

  const isDismissed=pdfImportPreview.type==="DEMITIDOS";
  const confirmed=await confirmAction(
    isDismissed
      ? "Todos os colaboradores selecionados serão marcados como DEMITIDOS, sairão da aba Ativos e ficarão disponíveis na aba Demitidos. O histórico será preservado. Deseja continuar?"
      : "Os colaboradores selecionados serão cadastrados ou atualizados pela MATRÍCULA. Se existir o mesmo nome com outra matrícula, será criado um novo vínculo e o cadastro antigo será preservado. Deseja continuar?",
    isDismissed?"Processar demitidos":"Confirmar importação"
  );
  if(!confirmed)return;

  try{
    const rows=pdfImportPreview.rows.map((row,index)=>({
      ...row,
      selected:Boolean(document.querySelector(`[data-import-index="${index}"]`)?.checked)
    }));

    const result=await api("/api/imports/confirm",{
      method:"POST",
      body:JSON.stringify({
        type:pdfImportPreview.type,
        fileName:pdfImportPreview.fileName,
        companyId:$("pdf-import-company").value,
        branchId:$("pdf-import-branch").value,
        detectedCompany:pdfImportPreview.detectedCompany,
        detectedBranch:pdfImportPreview.detectedBranch,
        detectedOperationalBranch:pdfImportPreview.detectedOperationalBranch,
        previewCompanyId:pdfImportPreview.previewCompanyId,
        previewBranchId:pdfImportPreview.previewBranchId,
        readerUsed:pdfImportPreview.readerUsed,
        intelligence:pdfImportPreview.intelligence,
        rows
      })
    });

    $("pdf-import-detection").innerHTML=`
      <div class="import-success">
        ${pdfImportPreview.type==="DEMITIDOS"
          ? `Processamento concluído: ${result.demitted||0} colaborador(es) movido(s) para a aba DEMITIDOS e ${result.notFound} não processado(s).`
          : `Importação concluída: ${result.created} cadastrado(s), ${result.updated} corrigido(s), ${result.unchanged||0} conferido(s) sem alteração e ${result.notFound} não processado(s)${result.readmissions?`, ${result.readmissions} possível(is) readmissão(ões) criada(s) com nova matrícula e histórico anterior preservado`:""}${result.failed?` e ${result.failed} com erro(s)`:''}.`
        }
      </div>`;
    $("pdf-import-preview-panel").hidden=true;
    applyImportResultsToChecklist(result.results||[]);
    pdfImportPreview=null;
    $("pdf-import-file").value="";
    await loadPdfImportHistory();
    await loadEmployees();
    await loadDashboard();
  }catch(error){
    const message=error?.detail
      ? `${error.message}\n\nDetalhe: ${error.detail}${error.code?`\nCódigo: ${error.code}`:""}`
      : error.message;
    alert(message);
  }
};

$("pdf-import-clear").onclick=()=>{
  $("pdf-import-form").reset();
  pdfImportPreview=null;
  pdfComparisonChecklist=null;
  $("pdf-import-preview-panel").hidden=true;
  $("pdf-checklist-panel").hidden=true;
  $("pdf-import-detection").hidden=true;
  $("pdf-missing-panel").hidden=true;
  fillPdfImportBranches();
};

async function loadPdfImportHistory(){
  const rows=await api("/api/imports/history");
  $("pdf-import-history").innerHTML=rows.length
    ? rows.map(r=>`<tr>
      <td>${new Date(r.created_at).toLocaleString("pt-BR")}</td>
      <td>${escapeHtml(r.import_type)}</td>
      <td>${escapeHtml(r.file_name)}</td>
      <td>${escapeHtml(r.company_name||"-")}<br><small>${escapeHtml(r.branch_name||"-")}</small></td>
      <td>${r.import_type==="DEMITIDOS"
        ? `${r.total_updated} demitido(s)/inativado(s), ${r.total_not_found} não localizado(s)`
        : `${r.total_created} novo(s), ${r.total_updated} atualizado(s), ${r.total_not_found} não localizado(s)`
      }</td>
      <td>${escapeHtml(r.user_name||"-")}</td>
    </tr>`).join("")
    : `<tr><td colspan="6">Nenhuma importação realizada.</td></tr>`;
}

function fillEmployeeFilters(){
  const currentCompany=$("employee-company-filter").value;
  const currentBranch=$("employee-branch-filter").value;
  const currentShift=$("employee-shift-filter").value;

  $("employee-company-filter").innerHTML=`<option value="">Todas as empresas</option>`+
    companies.map(c=>`<option value="${c.id}">${escapeHtml(c.trade_name)}</option>`).join("");

  const allowedBranches=branches.filter(b=>!currentCompany||String(b.company_id)===String(currentCompany));
  $("employee-branch-filter").innerHTML=`<option value="">Todas as filiais</option>`+
    allowedBranches.map(b=>`<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");

  $("employee-shift-filter").innerHTML=`<option value="">Todos os turnos</option>`+
    catalogs.shifts .map(s=>`<option value="${s.id}">${escapeHtml(formatShiftOptionLabel(s))}</option>`).join("");

  if(currentCompany)$("employee-company-filter").value=currentCompany;
  if(currentBranch)$("employee-branch-filter").value=currentBranch;
  if(currentShift)$("employee-shift-filter").value=currentShift;
}

function fillEmployeeCompanyCatalogs(){
  const companyId=$("employee-company").value;
  const currentBranch=$("employee-branch").value;
  const currentShift=$("employee-shift").value;
  const currentRole=$("employee-job-role").value;

  $("employee-branch").innerHTML=`<option value="">Selecione</option>`+
    branches.filter(b=>String(b.company_id)===String(companyId)&&b.active!==false)
      .map(b=>`<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");

  $("employee-shift").innerHTML=`<option value="">Selecione</option>`+
    catalogs.shifts
      .filter(item=>String(item.company_id)===String(companyId)&&item.active!==false)
       .map(item=>`<option value="${item.id}">${escapeHtml(formatShiftOptionLabel(item))}</option>`).join("");

  $("employee-job-role").innerHTML=`<option value="">Selecione</option>`+
    catalogs.job_roles
      .filter(item=>String(item.company_id)===String(companyId)&&item.active!==false)
      .map(item=>`<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");

  if(currentBranch&&$("employee-branch").querySelector(`option[value="${currentBranch}"]`)){
    $("employee-branch").value=currentBranch;
  }
  if(currentShift&&$("employee-shift").querySelector(`option[value="${currentShift}"]`)){
    $("employee-shift").value=currentShift;
  }
  if(currentRole&&$("employee-job-role").querySelector(`option[value="${currentRole}"]`)){
    $("employee-job-role").value=currentRole;
  }
}

function fillEmployeeBranches(){
  fillEmployeeCompanyCatalogs();
}
$("employee-company").onchange=fillEmployeeCompanyCatalogs;

function sanitizeEmployeeSearch(){
  const input=$("employee-search");
  if(!input)return;

  const value=String(input.value||"").trim();

  // Alguns navegadores/gerenciadores de senha inserem automaticamente
  // o e-mail do usuário logado neste campo de pesquisa.
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value)){
    input.value="";
  }
}

$("employee-search").addEventListener("focus",sanitizeEmployeeSearch);
$("employee-search").addEventListener("pointerdown",sanitizeEmployeeSearch);

async function loadEmployees(){
  sanitizeEmployeeSearch();
  if(!companies.length)await loadCompanies();
  if(!branches.length)await loadBranches();
  await loadCatalogs();

  fillEmployeeCompanyCatalogs();

  fillEmployeeFilters();

  const terminationFrom=employeeStatusView==="DEMITIDO"?$("employee-termination-from").value:"";
  const terminationTo=employeeStatusView==="DEMITIDO"?$("employee-termination-to").value:"";
  if(terminationFrom&&terminationTo&&terminationFrom>terminationTo){
    toast("A data inicial não pode ser posterior à data final.","warning");
    return;
  }

  const query=new URLSearchParams({
    search:$("employee-search").value||"",
    missingShift:String(employeeStatusView==="ATIVO"&&$("employee-missing-shift-filter").checked),
    status:employeeStatusView
  });
  if(terminationFrom)query.set("terminationFrom",terminationFrom);
  if(terminationTo)query.set("terminationTo",terminationTo);
  employeeRows=await api(`/api/employees?${query.toString()}`);

  const companyId=$("employee-company-filter").value;
  const branchId=$("employee-branch-filter").value;
  const shiftId=$("employee-shift-filter").value;

  employeeRows=employeeRows.filter(row=>
    (!companyId||String(row.company_id)===String(companyId))&&
    (!branchId||String(row.branch_id)===String(branchId))&&
    (!shiftId||String(row.shift_id)===String(shiftId))
  );

  const canManageEmployees=currentUser?.role==="ADMIN"||currentUser?.permissions?.["employees.manage"]===true;
  const employeeStatusBadge=status=>{
    const normalized=String(status||"ATIVO").toUpperCase();
    const className=normalized==="ATIVO"?"employee-status-active":normalized==="DEMITIDO"?"employee-status-dismissed":normalized==="AFASTADO"?"employee-status-away":"employee-status-inactive";
    return `<span class="employee-status-badge ${className}">${escapeChecklistHtml(normalized)}</span>`;
  };

  $("employees-list").innerHTML=employeeRows.length
    ? employeeRows.map(e=>`<tr>
        <td>${canManageEmployees?`<input class="employee-check" type="checkbox" data-employee-id="${e.id}">`:""}</td>
        <td><b>${escapeChecklistHtml(e.full_name)}</b><br><small>${escapeChecklistHtml(e.registration||"-")}</small></td>
        <td>${escapeChecklistHtml(e.company_name)}<br><small>${escapeChecklistHtml(e.branch_name)}</small></td>
        <td>${escapeChecklistHtml(e.job_role_name||"-")}</td>
        <td>${e.shift_name?escapeHtml(e.shift_name):'<span class="shift-missing">Não definido</span>'}</td>
        <td><small>Admissão</small><br><b>${formatApiDate(e.admission_date)}</b>${String(e.status||"").toUpperCase()==="DEMITIDO"?`<br><small>Demissão</small><br><b class="dismissed-date">${formatApiDate(e.termination_date)}</b>`:""}</td>
        <td>${employeeStatusBadge(e.status)}</td>
        <td>
          ${canManageEmployees?`<button class="action-btn employee-edit-action" type="button" data-employee-edit="${escapeHtml(String(e.id))}">Editar</button>
          <button class="action-btn danger employee-delete-action" type="button" data-employee-delete="${escapeHtml(String(e.id))}">${String(e.status||"").toUpperCase()==="DEMITIDO"?"Excluir definitivamente":"Excluir"}</button>`:"—"}
        </td>
      </tr>`).join("")
    : `<tr><td colspan="8">Nenhum colaborador encontrado nesta situação.</td></tr>`;

  $("employee-select-all").checked=false;
  updateBulkSelection();
  await loadEmployeeStatusSummary();
}

async function loadEmployeeStatusSummary(){
  const query=new URLSearchParams();
  const companyId=$("employee-company-filter").value;
  const branchId=$("employee-branch-filter").value;
  if(companyId)query.set("companyId",companyId);
  if(branchId)query.set("branchId",branchId);
  const summary=await api(`/api/employees/status-summary${query.toString()?`?${query.toString()}`:""}`);
  $("employee-count-active").textContent=summary.active||0;
  $("employee-count-dismissed").textContent=summary.dismissed||0;
  $("employee-count-inactive").textContent=summary.inactive||0;
  $("employee-count-all").textContent=summary.total||0;
}

function selectEmployeeStatusView(view){
  employeeStatusView=view;
  const headings={
    ATIVO:["Colaboradores ativos","Somente vínculos ativos aparecem nesta lista e podem participar dos relatórios."],
    DEMITIDO:["Colaboradores demitidos","Consulte desligamentos por nome, matrícula, mês ou período e preserve o histórico."],
    INACTIVE_GROUP:["Afastados e inativos","Vínculos temporariamente afastados ou desativados administrativamente."],
    ALL:["Todos os colaboradores","Consulta completa de todas as situações cadastradas."]
  };
  $("employee-list-title").textContent=headings[view][0];
  $("employee-list-description").textContent=headings[view][1];
  document.querySelectorAll("[data-employee-status-view]").forEach(button=>{
    const selected=button.dataset.employeeStatusView===view;
    button.classList.toggle("active",selected);
    button.setAttribute("aria-selected",String(selected));
  });
  $("dismissed-period-filters").hidden=view!=="DEMITIDO";
  $("employee-missing-shift-filter-label").hidden=view!=="ATIVO";
  if(view!=="ATIVO")$("employee-missing-shift-filter").checked=false;
  loadEmployees();
}

document.querySelectorAll("[data-employee-status-view]").forEach(button=>{
  button.onclick=()=>selectEmployeeStatusView(button.dataset.employeeStatusView);
});

$("employee-dismissed-month").onchange=()=>{
  const value=$("employee-dismissed-month").value;
  if(value){
    const [year,month]=value.split("-").map(Number);
    const lastDay=new Date(year,month,0).getDate();
    $("employee-termination-from").value=`${value}-01`;
    $("employee-termination-to").value=`${value}-${String(lastDay).padStart(2,"0")}`;
  }else{
    $("employee-termination-from").value="";
    $("employee-termination-to").value="";
  }
  loadEmployees();
};
$("employee-termination-from").onchange=()=>loadEmployees();
$("employee-termination-to").onchange=()=>loadEmployees();
$("employee-clear-period").onclick=()=>{
  $("employee-dismissed-month").value="";
  $("employee-termination-from").value="";
  $("employee-termination-to").value="";
  loadEmployees();
};



function openEmployeeModal(title){
  $("employee-modal-title").textContent=title;
  $("employee-modal").hidden=false;
  document.body.classList.add("modal-open");
  setTimeout(()=>$("employee-name").focus(),50);
}

function closeEmployeeModal(){
  $("employee-modal").hidden=true;
  document.body.classList.remove("modal-open");
}

const employeeWeekdayNames=["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];

function selectedEmployeeShift(){
  return catalogs.shifts.find(shift=>String(shift.id)===String($("employee-shift").value))||null;
}

function fillEmployeeWeeklyDaysOff(days=[]){
  const selected=new Set(Array.isArray(days)?days.map(Number):[]);
  document.querySelectorAll("[data-weekday]").forEach(input=>{
    input.checked=selected.has(Number(input.dataset.weekday));
  });
}

function updateEmployeeDaysOffMode(){
  const usesShift=$("employee-days-off-mode").value==="SHIFT";
  const shift=selectedEmployeeShift();
  const activeShift=shift&&shift.active!==false;
  const inheritedDays=usesShift&&activeShift&&Array.isArray(shift?.weekly_days_off)
    ? shift.weekly_days_off
    : [];

  if(usesShift)fillEmployeeWeeklyDaysOff(inheritedDays);
  document.querySelectorAll("[data-weekday]").forEach(input=>{input.disabled=usesShift;});

  const days=usesShift
    ? inheritedDays
    : Array.from(document.querySelectorAll("[data-weekday]:checked")).map(input=>Number(input.dataset.weekday));
  const labels=days.map(Number).filter(day=>day>=0&&day<=6).map(day=>employeeWeekdayNames[day]);
  const hint=$("employee-days-off-hint");

  hint.classList.toggle("days-off-warning",Boolean(usesShift&&shift&&shift.active===false));
  if(usesShift&&shift&&shift.active===false){
    hint.textContent=`Atenção: ${shift.name} está inativo e não fornece folga automática. Selecione um turno ativo antes de gerar novas fichas.`;
  }else if(usesShift){
    hint.textContent=`${shift?`Folga padrão de ${shift.name}`:"Selecione um turno"}: ${labels.join(", ")||"nenhuma"}. A ficha acompanha futuras alterações do turno.`;
  }else{
    hint.textContent="Esta folga vale somente para este colaborador e não muda quando o turno for alterado.";
  }
}

document.querySelectorAll("[data-close-employee-modal]").forEach(element=>{
  element.onclick=()=>{
    resetEmployeeForm();
    closeEmployeeModal();
  };
});

$("employee-new-button").onclick=async()=>{
  try{
    if(!companies.length)await loadCompanies();
    if(!branches.length)await loadBranches();
    if(!catalogs.shifts.length||!catalogs.job_roles.length)await loadCatalogs();

    fillCompanySelects();
    fillEmployeeCompanyCatalogs();
    resetEmployeeForm();

    // Usuário não-ADM possui uma única empresa de escopo:
    // pré-seleciona automaticamente quando aplicável.
    if(currentUser?.role!=="ADMIN"&&companies.length===1){
      $("employee-company").value=companies[0].id;
      fillEmployeeCompanyCatalogs();
    }

    openEmployeeModal("Novo colaborador");
  }catch(error){
    console.error("[EMPLOYEE_NEW_OPTIONS]",error);
    toast(error.message||"Não foi possível carregar empresa e filial.","error");
  }
};


function resetEmployeeForm(){
  $("employee-form").reset();
  $("employee-id").value="";
  $("employee-status").value="ATIVO";
  $("employee-report-policy").value="";
  $("employee-days-off-mode").value="SHIFT";
  updateEmployeeDaysOffMode();
  $("employee-save-button").textContent="Salvar colaborador";
  $("employee-history-open").hidden=true;
  $("employee-form-feedback").textContent="";
}

$("employee-cancel").onclick=()=>{resetEmployeeForm();closeEmployeeModal();};

function ensureEmployeeLegacyOption(selectId,id,label,inactive=false){
  if(!id)return;
  const select=$(selectId);
  if(!select||select.querySelector(`option[value="${id}"]`))return;
  const option=document.createElement("option");
  option.value=id;
  option.textContent=`${label||"Cadastro atual"}${inactive?" — inativo":""}`;
  option.dataset.legacy="true";
  select.appendChild(option);
}

window.editEmployee=async id=>{
  try{
    // A lista já possui os dados do colaborador. Usá-la primeiro evita
    // depender de uma segunda requisição apenas para abrir o formulário.
    let employee=employeeRows.find(item=>String(item.id)===String(id))||null;

    if(!companies.length)await loadCompanies();
    if(!branches.length)await loadBranches();
    if(!catalogs.shifts.length||!catalogs.job_roles.length)await loadCatalogs();

    // Importante: a edição também precisa popular o select de empresas.
    // Na V1.0.0 isso acontecia no cadastro novo, mas não neste fluxo.
    fillCompanySelects();

    // Busca os detalhes mais recentes quando possível, sem impedir a edição
    // caso a listagem já tenha os dados necessários.
    try{
      const fresh=await api(`/api/employees/${id}`);
      if(fresh)employee={...(employee||{}),...fresh};
    }catch(detailError){
      console.warn("[EMPLOYEE_EDIT_DETAIL_FALLBACK]",detailError);
    }

    if(!employee)throw new Error("Colaborador não encontrado na lista atual.");

    resetEmployeeForm();
    $("employee-id").value=employee.id;
    $("employee-company").value=employee.company_id||"";
    fillEmployeeCompanyCatalogs();

    ensureEmployeeLegacyOption("employee-branch",employee.branch_id,employee.branch_name,false);
    ensureEmployeeLegacyOption("employee-shift",employee.shift_id,employee.shift_name,employee.shift_active===false);
    ensureEmployeeLegacyOption("employee-job-role",employee.job_role_id,employee.job_role_name,employee.job_role_active===false);

    $("employee-branch").value=employee.branch_id||"";
    $("employee-name").value=employee.full_name||"";
    $("employee-registration").value=employee.registration||"";
    $("employee-admission").value=employee.admission_date?String(employee.admission_date).slice(0,10):"";
    $("employee-shift").value=employee.shift_id||"";
    $("employee-job-role").value=employee.job_role_id||"";
    $("employee-report-policy").value=employee.report_policy_override||"";
    $("employee-status").value=employee.status||"ATIVO";

    $("employee-days-off-mode").value=employee.use_shift_days_off===false?"CUSTOM":"SHIFT";
    if(employee.use_shift_days_off===false)fillEmployeeWeeklyDaysOff(employee.weekly_days_off||[]);
    updateEmployeeDaysOffMode();

    $("employee-save-button").textContent="Salvar alterações";
    $("employee-history-open").hidden=false;
    openEmployeeModal("Editar colaborador");
  }catch(error){
    console.error("[EMPLOYEE_EDIT_LOAD]",error);
    toast(error.message||"Não foi possível abrir o colaborador para edição.","error");
  }
};

function employeeHistoryLabel(key,entry={}){
  const labels={
    company_id:"Empresa",branch_id:"Filial",full_name:"Nome",registration:"Matrícula",
    admission_date:"Admissão",shift_id:"Turno",job_role_id:"Cargo",status:"Situação",
    report_policy_override:"Exceção de relatórios",use_shift_days_off:"Regra da folga semanal",
    weekly_days_off:"Dias de folga"
  };
  return entry.label||labels[key]||key;
}

function employeeHistoryValue(value,key=""){
  if(value===null||value===undefined||value==="")return "Não informado";
  if(key==="use_shift_days_off")return value===true?"Folga padrão do turno":"Folga personalizada";
  if(key==="weekly_days_off"&&Array.isArray(value)){
    return value.map(day=>employeeWeekdayNames[Number(day)]||day).join(", ")||"Nenhuma";
  }
  if(typeof value==="boolean")return value?"Sim":"Não";
  if(typeof value==="object")return JSON.stringify(value);
  return String(value);
}

function closeEmployeeHistory(){
  $("employee-history-modal").hidden=true;
  if($("employee-modal").hidden)document.body.classList.remove("modal-open");
}

document.querySelectorAll("[data-close-employee-history]").forEach(element=>{
  element.onclick=closeEmployeeHistory;
});

async function openEmployeeHistory(){
  const id=$("employee-id").value;
  if(!id)return;
  $("employee-history-modal").hidden=false;
  document.body.classList.add("modal-open");
  $("employee-history-subtitle").textContent="Carregando histórico...";
  $("employee-history-summary").innerHTML="";
  $("employee-history-list").innerHTML='<div class="employee-history-empty">Consultando registros...</div>';

  try{
    const data=await api(`/api/employees/${id}/history`);
    const employee=data.employee||{};
    const history=Array.isArray(data.history)?data.history:[];
    $("employee-history-subtitle").textContent=`${employee.fullName||"Colaborador"} · matrícula ${employee.registration||"não informada"}`;
    $("employee-history-summary").innerHTML=`
      <article><span>Empresa</span><strong>${escapeChecklistHtml(employee.companyName||"-")}</strong></article>
      <article><span>Filial atual</span><strong>${escapeChecklistHtml(employee.branchName||"-")}</strong></article>
      <article><span>Registros</span><strong>${history.length}</strong></article>`;

    $("employee-history-list").innerHTML=history.length?history.map(item=>{
      const changes=item.details?.changes||{};
      const entries=Object.entries(changes);
      const actionLabel=item.action==="CREATE"?"Cadastro criado":item.action==="UPDATE"?"Cadastro alterado":item.action==="DELETE"?"Cadastro excluído":item.action;
      const changeHtml=entries.length
        ?`<div class="employee-history-changes">${entries.map(([key,change])=>`
          <div>
            <strong>${escapeChecklistHtml(employeeHistoryLabel(key,change))}</strong>
            <span>${escapeChecklistHtml(employeeHistoryValue(change.from,key))}</span>
            <b aria-hidden="true">→</b>
            <span>${escapeChecklistHtml(employeeHistoryValue(change.to,key))}</span>
          </div>`).join("")}</div>`
        :`<p>${item.action==="CREATE"?"Registro inicial do colaborador.":"Registro de auditoria preservado pelo sistema."}</p>`;
      return `<article class="employee-history-entry">
        <div class="employee-history-entry-head">
          <div><strong>${escapeChecklistHtml(actionLabel)}</strong><span>${escapeChecklistHtml(item.actor_name||"Sistema")}</span></div>
          <time>${new Date(item.created_at).toLocaleString("pt-BR")}</time>
        </div>
        ${changeHtml}
      </article>`;
    }).join(""):'<div class="employee-history-empty">Ainda não existem alterações registradas para este colaborador.</div>';
  }catch(error){
    $("employee-history-subtitle").textContent="Não foi possível carregar.";
    $("employee-history-list").innerHTML=`<div class="employee-history-empty">${escapeChecklistHtml(error.message||"Erro ao consultar histórico.")}</div>`;
  }
}

$("employee-history-open").onclick=openEmployeeHistory;

window.deleteEmployee=async id=>{
  const employee=employeeRows.find(x=>String(x.id)===String(id));
  if(!employee)return;

  const isDismissed=String(employee.status||"").toUpperCase()==="DEMITIDO";
  const identification=`${employee.full_name} — matrícula ${employee.registration||"não informada"}`;
  const confirmed=await confirmAction(
    isDismissed
      ? `Deseja excluir definitivamente o cadastro de ${identification}, demitido em ${formatApiDate(employee.termination_date)}? Esta ação não pode ser desfeita. Se houver histórico vinculado, o sistema bloqueará a exclusão.`
      : `Deseja excluir o cadastro de ${identification}? Esta ação remove o cadastro e não pode ser desfeita. Se houver histórico vinculado, o sistema bloqueará a exclusão.`,
    isDismissed?"Excluir demitido definitivamente":"Excluir colaborador"
  );
  if(!confirmed)return;

  try{
    await api(`/api/employees/${id}`,{method:"DELETE"});
    toast("Colaborador excluído com sucesso.","success");
    await loadEmployees();
    await loadDashboard();
  }catch(error){
    toast(error.message,"error");
  }
};

function selectedEmployeeIds(){
  return Array.from(document.querySelectorAll(".employee-check:checked"))
    .map(x=>x.dataset.employeeId);
}

function updateBulkSelection(){
  const count=selectedEmployeeIds().length;
  $("bulk-selected-count").textContent=count;
  $("bulk-shift-bar").hidden=count===0;
}

$("employees-list").onchange=e=>{
  if(e.target.classList.contains("employee-check"))updateBulkSelection();
};

$("employees-list").addEventListener("click",event=>{
  const editButton=event.target.closest("[data-employee-edit]");
  if(editButton){
    event.preventDefault();
    event.stopPropagation();
    window.editEmployee(editButton.dataset.employeeEdit);
    return;
  }

  const deleteButton=event.target.closest("[data-employee-delete]");
  if(deleteButton){
    event.preventDefault();
    event.stopPropagation();
    window.deleteEmployee(deleteButton.dataset.employeeDelete);
  }
});


$("employee-select-all").onchange=()=>{
  document.querySelectorAll(".employee-check").forEach(x=>x.checked=$("employee-select-all").checked);
  updateBulkSelection();
};

$("bulk-clear-selection").onclick=()=>{
  document.querySelectorAll(".employee-check").forEach(x=>x.checked=false);
  $("employee-select-all").checked=false;
  updateBulkSelection();
};

$("employee-search").oninput=()=>loadEmployees();
$("employee-missing-shift-filter").onchange=()=>loadEmployees();
$("employee-company-filter").onchange=()=>{
  $("employee-branch-filter").value="";
  loadEmployees();
};
$("employee-branch-filter").onchange=()=>loadEmployees();
$("employee-shift-filter").onchange=()=>loadEmployees();
$("employee-shift").onchange=updateEmployeeDaysOffMode;
$("employee-days-off-mode").onchange=updateEmployeeDaysOffMode;

$("employee-form").onsubmit=async e=>{
  e.preventDefault();

  const id=$("employee-id").value;
  const button=$("employee-save-button");
  const feedback=$("employee-form-feedback");

  try{
    setButtonLoading(button,true,"Salvando colaborador");
    feedback.textContent="Salvando...";

    const weeklyDaysOff=Array.from(document.querySelectorAll("[data-weekday]:checked"))
      .map(x=>Number(x.dataset.weekday));

    const body={
      companyId:$("employee-company").value,
      branchId:$("employee-branch").value,
      fullName:$("employee-name").value.trim(),
      registration:$("employee-registration").value.trim(),
      admissionDate:$("employee-admission").value||null,
      shiftId:$("employee-shift").value||null,
      jobRoleId:$("employee-job-role").value||null,
      reportPolicyOverride:$("employee-report-policy").value||null,
      status:$("employee-status").value,
      weeklyDaysOff,
      useShiftDaysOff:$("employee-days-off-mode").value==="SHIFT"
    };

    await api(id?`/api/employees/${id}`:"/api/employees",{
      method:id?"PUT":"POST",
      body:JSON.stringify(body)
    });

    toast(id?"Colaborador atualizado com sucesso.":"Colaborador cadastrado com sucesso.","success");
    resetEmployeeForm();
    closeEmployeeModal();
    await loadEmployees();
    await loadDashboard();
  }catch(error){
    feedback.textContent=error.message;
    toast(error.message,"error");
  }finally{
    setButtonLoading(button,false);
  }
};
