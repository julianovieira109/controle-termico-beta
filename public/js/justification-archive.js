(function(){
"use strict";
const byId=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let currentCase="",currentCompany="",currentBranch="",loaded=false,importPreview=null;
let employeeSearchTimer=null,employeeSearchSequence=0,selectedEmployee=null;
async function archiveApi(path,options={}){
 const headers={...(options.body instanceof FormData?{}:{"Content-Type":"application/json"}),...(token?{Authorization:"Bearer "+token}:{})};
 const response=await fetch("/api/justification-archive"+path,{...options,headers:{...headers,...options.headers},cache:"no-store"});
 if(!response.ok){const json=await response.json().catch(()=>({}));throw new Error(json.error||"Falha ao acessar o acervo.");}
 return response.json();
}
function showError(error){const el=byId("archive-feedback");if(el){el.textContent=error.message||String(error);el.hidden=false;} }
function clearError(){const el=byId("archive-feedback");if(el){el.hidden=true;el.textContent="";}}
function statusLabel(s){return ({PENDENTE:"Pendente",EM_CONFERENCIA:"Em conferência",CONFERIDO:"Conferido",DIVERGENTE:"Divergente",DESCONSIDERADO:"Desconsiderado"})[s]||s;}
async function initialize(){
 if(!currentUser||currentUser.isMasterAdmin!==true)return;
 clearError();
 try{
   if(!loaded){
     const {companies,branches}=await archiveApi("/units");
     const co=byId("archive-company"),br=byId("archive-branch");
     co.innerHTML='<option value="">Selecione a empresa</option>'+companies.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.trade_name)+'</option>').join("");
     br.dataset.branches=JSON.stringify(branches);
     loaded=true;
   }
   refreshBranch();
   await loadCases();
 }catch(error){showError(error);}
}
function refreshBranch(){
 const co=byId("archive-company"),br=byId("archive-branch");if(!br||!co)return;
 currentCompany=co.value;const branches=JSON.parse(br.dataset.branches||"[]");
 const matching=branches.filter(b=>b.company_id===currentCompany);
 br.innerHTML='<option value="">Selecione a filial</option>'+matching.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>').join("");
 currentBranch=br.value;
}
async function loadCases(){
 const body=byId("archive-table-body");if(!body)return;
 currentCompany=byId("archive-company").value;currentBranch=byId("archive-branch").value;
 if(!currentCompany||!currentBranch){body.innerHTML='<tr><td colspan="5">Selecione empresa e filial para consultar.</td></tr>';return;}
 clearError();body.innerHTML='<tr><td colspan="5">Consultando registros...</td></tr>';
 try{
 const params=new URLSearchParams({companyId:currentCompany,branchId:currentBranch,q:byId("archive-search").value,limit:"50"});
 const results=await archiveApi("/cases?"+params);
 byId("archive-total").textContent=results.total+" justificativa(s)";
 archiveApi("/imports/status?"+new URLSearchParams({companyId:currentCompany,branchId:currentBranch}))
  .then(v=>{const el=byId("archive-import-history-status");if(el&&currentCompany===byId("archive-company").value&&currentBranch===byId("archive-branch").value)el.textContent="Histórico Google Sheets nesta filial: "+v.cases.toLocaleString("pt-BR")+" justificativas; "+v.pending.toLocaleString("pt-BR")+" links pendentes; "+v.stored.toLocaleString("pt-BR")+" arquivos já armazenados. Registros sem nome: "+v.no_name.toLocaleString("pt-BR")+".";})
  .catch(()=>{const el=byId("archive-import-history-status");if(el)el.textContent="Não foi possível consultar o resumo do histórico.";});
 body.innerHTML=results.records.length?results.records.map(r=>'<tr><td>'+esc(r.employee_name)+(r.employee_registration?'<small> · '+esc(r.employee_registration)+'</small>':"")+'</td><td>'+esc(r.absence_date?String(r.absence_date).slice(0,10).split("-").reverse().join("/"):"—")+'</td><td>'+esc(r.reason)+'</td><td>'+esc(statusLabel(r.review_status))+'</td><td><button class="secondary archive-open" type="button" data-id="'+esc(r.id)+'">Consultar ('+r.stored_count+'/'+r.file_count+')</button></td></tr>').join(""):'<tr><td colspan="5">Nenhuma justificativa cadastrada.</td></tr>';
 }catch(error){body.innerHTML='<tr><td colspan="5">Não foi possível carregar os registros.</td></tr>';showError(error);}
}
async function openCase(id){
 currentCase=id;const details=byId("archive-details");details.hidden=false;
 try{
  const result=await archiveApi("/cases/"+id);
  const r=result.record;
  byId("archive-case-title").textContent=r.employee_name+" — "+r.reason;
  byId("archive-case-info").textContent="Data: "+(r.absence_date||"—")+" | Setor: "+(r.department||"—")+" | Responsável: "+(r.manager_email||"—");
  byId("archive-case-status").value=r.review_status;
  const ul=byId("archive-files");ul.innerHTML=result.files.length?result.files.map(f=>'<li>'+esc(f.original_name)+' — '+esc(f.storage_state)+(f.storage_state==="ARMAZENADO"?' <button class="secondary archive-download" type="button" data-id="'+esc(f.id)+'" data-name="'+esc(f.original_name)+'">Baixar</button>':"")+'</li>').join(""):'<li>Sem arquivos anexados.</li>';
 }catch(error){showError(error);}
}
function setEmployeeFieldsReadonly(isSelected,employee=null){
 for(const [id,hasValue] of [
   ["archive-name",true],
   ["archive-registration",!!employee?.registration],
   ["archive-job-title",!!employee?.job_title],
   ["archive-department",!!employee?.department]
 ]){
   const field=byId(id);if(field)field.readOnly=isSelected&&hasValue;
 }
}
function clearEmployeeSelection(clearSearch=true){
 selectedEmployee=null;
 employeeSearchSequence++;
 clearTimeout(employeeSearchTimer);
 byId("archive-employee-id").value="";
 if(clearSearch)byId("archive-employee-search").value="";
 byId("archive-employee-results").hidden=true;
 byId("archive-employee-results").innerHTML="";
 byId("archive-employee-clear").hidden=true;
 for(const id of ["archive-name","archive-registration","archive-job-title","archive-department"])byId(id).value="";
 setEmployeeFieldsReadonly(false);
 byId("archive-employee-feedback").textContent="Pesquise pelo nome ou matrícula. Caso não encontre, preencha os campos manualmente.";
}
// Preenche automaticamente somente quando a busca identifica uma única pessoa.
function normalizeEmployeeLookup(value){
 return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
   .trim().replace(/\s+/g," ").toLowerCase();
}
function findAutomaticEmployee(people,query){
 const key=normalizeEmployeeLookup(query);
 if(!key||people.length>=20)return null; // 20 resultados podem indicar lista truncada.
 const exact=people.filter(e=>normalizeEmployeeLookup(e.full_name)===key||
   normalizeEmployeeLookup(e.registration)===key);
 if(exact.length===1)return exact[0];
 if(exact.length>1)return null; // Nomes/matrículas repetidos exigem escolha manual.
 if(key.length>=4&&people.length===1)return people[0];
 return null;
}
function chooseEmployee(employee,{keepSearchText=false,automatic=false}={}){
 selectedEmployee=employee;
 byId("archive-employee-id").value=employee.id;
 if(!keepSearchText)byId("archive-employee-search").value=employee.full_name+(employee.registration?" — "+employee.registration:"");
 byId("archive-name").value=employee.full_name||"";
 byId("archive-registration").value=employee.registration||"";
 byId("archive-job-title").value=employee.job_title||"";
 byId("archive-department").value=employee.department||"";
 setEmployeeFieldsReadonly(true,employee);
 byId("archive-employee-results").hidden=true;
 byId("archive-employee-results").innerHTML="";
 byId("archive-employee-clear").hidden=false;
 const missing=[];
 if(!employee.registration)missing.push("matrícula");
 if(!employee.job_title)missing.push("função");
 if(!employee.department)missing.push("setor");
 byId("archive-employee-feedback").textContent=
   (automatic?"Preenchimento automático: ":"Selecionado: ")+employee.full_name+" ("+employee.status+")."+
   (missing.length?" Não consta no cadastro: "+missing.join(", ")+". Preencha manualmente apenas os campos ausentes.":" Dados preenchidos a partir do cadastro.");
}
async function searchEmployees(){
 const searchInput=byId("archive-employee-search"),results=byId("archive-employee-results");
 const companyId=byId("archive-company").value,branchId=byId("archive-branch").value;
 const q=searchInput.value.trim(),sequence=++employeeSearchSequence;
 results.hidden=true;results.innerHTML="";
 if(q.length<2){
   byId("archive-employee-feedback").textContent="Digite pelo menos 2 caracteres do nome ou matrícula.";
   return;
 }
 if(!companyId||!branchId){
   byId("archive-employee-feedback").textContent="Selecione empresa e filial antes de pesquisar.";
   return;
 }
 byId("archive-employee-feedback").textContent="Buscando colaboradores da filial...";
 try{
   const data=await archiveApi("/employees?"+new URLSearchParams({companyId,branchId,q}));
   if(sequence!==employeeSearchSequence||companyId!==byId("archive-company").value||branchId!==byId("archive-branch").value)return;
   const people=data.employees||[];
   if(!people.length){
     byId("archive-employee-feedback").textContent="Nenhum colaborador encontrado nesta filial. Confira o cadastro ou preencha manualmente.";
     return;
   }
   const autoEmployee=findAutomaticEmployee(people,q);
   if(autoEmployee){
     chooseEmployee(autoEmployee,{keepSearchText:true,automatic:true});
     return;
   }
   const fragment=document.createDocumentFragment();
   for(const e of people){
     const button=document.createElement("button");
     button.type="button";
     button.className="archive-employee-choice";
     button.setAttribute("role","option");
     button.textContent=e.full_name+(e.registration?" · Matrícula "+e.registration:"")+
       (e.job_title?" · "+e.job_title:"")+(e.status?" · "+e.status:"");
     button.addEventListener("click",()=>chooseEmployee(e));
     fragment.appendChild(button);
   }
   results.appendChild(fragment);results.hidden=false;
   byId("archive-employee-feedback").textContent=people.length+" resultado(s) nesta filial. Clique no colaborador correto para preencher a justificativa.";
 }catch(error){
   if(sequence!==employeeSearchSequence)return;
   byId("archive-employee-feedback").textContent="Não foi possível consultar o cadastro.";
   showError(error);
 }
}
function handleEmployeeSearchChange(){
 const wasSelected=!!selectedEmployee;
 if(wasSelected){
   clearEmployeeSelection(false);
 }
 clearTimeout(employeeSearchTimer);
 employeeSearchTimer=setTimeout(searchEmployees,250);
}
async function saveCase(event){
 event.preventDefault();if(!currentCompany||!currentBranch){showError(new Error("Selecione empresa e filial."));return;}
 const fields={companyId:currentCompany,branchId:currentBranch,employeeId:byId("archive-employee-id").value||null,employeeName:byId("archive-name").value,registration:byId("archive-registration").value,jobTitle:byId("archive-job-title").value,department:byId("archive-department").value,absenceDate:byId("archive-date").value,reason:byId("archive-reason").value,details:byId("archive-details-field").value,managerEmail:byId("archive-manager").value};
 try{const created=await archiveApi("/cases",{method:"POST",body:JSON.stringify(fields)});byId("archive-new-case").reset();clearEmployeeSelection();await loadCases();await openCase(created.id);}catch(error){showError(error);}
}
async function uploadFile(event){
 event.preventDefault();if(!currentCase){showError(new Error("Escolha uma justificativa."));return;}
 const file=byId("archive-file-input").files[0];if(!file){showError(new Error("Selecione um arquivo."));return;}
 if(file.size>8*1024*1024){showError(new Error("O documento deve ter no máximo 8 MB."));return;}
 const data=new FormData();data.append("file",file);
 try{await archiveApi("/cases/"+currentCase+"/files",{method:"POST",body:data});byId("archive-file-input").value="";await openCase(currentCase);}catch(error){showError(error);}
}
async function downloadFile(id,name){
 try{
  const response=await fetch("/api/justification-archive/files/"+encodeURIComponent(id)+"/download",{headers:{Authorization:"Bearer "+token},cache:"no-store"});
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||"Falha no download.");
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=name||"documento";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }catch(error){showError(error);}
}
function resetImportPreview(){
 importPreview=null;
 if(byId("archive-import-preview"))byId("archive-import-preview").hidden=true;
 if(byId("archive-import-ack"))byId("archive-import-ack").checked=false;
 if(byId("archive-import-confirm"))byId("archive-import-confirm").disabled=true;
}
function importMessage(message){if(byId("archive-import-message"))byId("archive-import-message").textContent=message;}
async function previewImport(event){
 event.preventDefault();resetImportPreview();clearError();
 const companyId=byId("archive-company").value,branchId=byId("archive-branch").value;
 const file=byId("archive-import-file")?.files?.[0];
 if(!companyId||!branchId){showError(new Error("Escolha empresa e filial antes de conferir o histórico."));return;}
 if(!file){showError(new Error("Selecione o CSV do histórico."));return;}
 if(file.size>5*1024*1024){showError(new Error("O CSV deve ter até 5 MB."));return;}
 const btn=byId("archive-import-check");btn.disabled=true;
 importMessage("Conferindo estrutura, datas, documentos e possíveis duplicidades...");
 try{
   const form=new FormData();
   form.append("file",file);
   form.append("companyId",companyId);
   form.append("branchId",branchId);
   const p=await archiveApi("/imports/preview",{method:"POST",body:form});
   importPreview={token:p.previewToken,companyId,branchId};
   const sum=p.summary;
   byId("archive-import-summary").innerHTML=[
     ["Respostas encontradas",sum.sourceRows],
     ["Prontas para importar",sum.ready],
     ["Novas",sum.newCases],
     ["Já importadas",sum.alreadyImported],
     ["Links de anexos",sum.linkCount],
     ["Sem nome",sum.missingNames],
     ["Inconsistências",sum.invalid],
     ["Campos com observação",sum.notesOnly]
   ].map(([key,value])=>'<div><small>'+esc(key)+'</small><strong>'+Number(value||0).toLocaleString("pt-BR")+'</strong></div>').join("");
   byId("archive-import-issues").textContent=p.issues?.length
     ?p.issues.slice(0,15).map(issue=>"Linha "+issue.row+": "+issue.reason).join(" | ")+(p.issues.length>15?" (exibindo até 15 inconsistências)":"")
     :"Nenhum registro inválido identificado.";
   byId("archive-import-preview").hidden=false;
   importMessage("Prévia pronta. Confira os números e a filial antes de confirmar.");
 }catch(error){importMessage("");showError(error);}
 finally{btn.disabled=false;}
}
async function confirmImport(){
 if(!importPreview||!byId("archive-import-ack").checked)return;
 if(byId("archive-company").value!==importPreview.companyId||byId("archive-branch").value!==importPreview.branchId){
   resetImportPreview();showError(new Error("A empresa ou filial mudou. Leia o CSV novamente."));return;
 }
 const btn=byId("archive-import-confirm");btn.disabled=true;clearError();
 importMessage("Gravando histórico na filial selecionada...");
 try{
   const result=await archiveApi("/imports/confirm",{method:"POST",body:JSON.stringify({
     previewToken:importPreview.token,companyId:importPreview.companyId,branchId:importPreview.branchId,confirmation:"IMPORTAR HISTORICO"
   })});
   resetImportPreview();
   byId("archive-import-file").value="";
   importMessage("Importação concluída: "+result.created.toLocaleString("pt-BR")+" novas justificativas, "+result.duplicates.toLocaleString("pt-BR")+" já existentes, "+result.linksPending.toLocaleString("pt-BR")+" anexos com links pendentes de transferência.");
   await loadCases();
 }catch(error){showError(error);importMessage("Importação não confirmada.");}
 finally{btn.disabled=!importPreview||!byId("archive-import-ack").checked;}
}
function bind(){
 byId("archive-company")?.addEventListener("change",()=>{clearEmployeeSelection();resetImportPreview();refreshBranch();loadCases();});
 byId("archive-branch")?.addEventListener("change",()=>{clearEmployeeSelection();resetImportPreview();loadCases();});
 byId("archive-search")?.addEventListener("input",()=>{clearTimeout(bind.searchTimer);bind.searchTimer=setTimeout(loadCases,250);});
 byId("archive-refresh")?.addEventListener("click",loadCases);
 byId("archive-employee-search")?.addEventListener("input",handleEmployeeSearchChange);
 byId("archive-employee-search")?.addEventListener("focus",event=>{if(selectedEmployee)event.target.select();});
 byId("archive-employee-search")?.addEventListener("keydown",event=>{
   if(event.key==="Escape"){byId("archive-employee-results").hidden=true;return;}
   if(event.key==="Enter"&&!byId("archive-employee-results").hidden){
     const choice=byId("archive-employee-results").querySelector(".archive-employee-choice");
     if(choice){event.preventDefault();choice.click();}
   }
 });
 byId("archive-employee-clear")?.addEventListener("click",()=>{
   clearEmployeeSelection();
   byId("archive-employee-search").focus();
 });
 byId("archive-new-case")?.addEventListener("submit",saveCase);
 byId("archive-file-form")?.addEventListener("submit",uploadFile);
 byId("archive-import-preview-form")?.addEventListener("submit",previewImport);
 byId("archive-import-file")?.addEventListener("change",resetImportPreview);
 byId("archive-import-ack")?.addEventListener("change",event=>{byId("archive-import-confirm").disabled=!importPreview||!event.target.checked;});
 byId("archive-import-confirm")?.addEventListener("click",confirmImport);
 byId("archive-case-status")?.addEventListener("change",async event=>{if(!currentCase)return;try{await archiveApi("/cases/"+currentCase+"/status",{method:"PATCH",body:JSON.stringify({status:event.target.value})});await loadCases();}catch(error){showError(error);}});
 document.addEventListener("click",event=>{const item=event.target.closest(".archive-open");if(item)openCase(item.dataset.id);const dl=event.target.closest(".archive-download");if(dl)downloadFile(dl.dataset.id,dl.dataset.name);});
}
bind();window.loadJustificationArchive=initialize;
})();
