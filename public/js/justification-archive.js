(function(){
"use strict";
const byId=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let currentCase="",currentCompany="",currentBranch="",loaded=false;
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
async function saveCase(event){
 event.preventDefault();if(!currentCompany||!currentBranch){showError(new Error("Selecione empresa e filial."));return;}
 const fields={companyId:currentCompany,branchId:currentBranch,employeeName:byId("archive-name").value,registration:byId("archive-registration").value,jobTitle:byId("archive-job-title").value,department:byId("archive-department").value,absenceDate:byId("archive-date").value,reason:byId("archive-reason").value,details:byId("archive-details-field").value,managerEmail:byId("archive-manager").value};
 try{const created=await archiveApi("/cases",{method:"POST",body:JSON.stringify(fields)});byId("archive-new-case").reset();await loadCases();await openCase(created.id);}catch(error){showError(error);}
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
function bind(){
 byId("archive-company")?.addEventListener("change",()=>{refreshBranch();loadCases();});
 byId("archive-branch")?.addEventListener("change",loadCases);
 byId("archive-search")?.addEventListener("input",()=>{clearTimeout(bind.searchTimer);bind.searchTimer=setTimeout(loadCases,250);});
 byId("archive-refresh")?.addEventListener("click",loadCases);
 byId("archive-new-case")?.addEventListener("submit",saveCase);
 byId("archive-file-form")?.addEventListener("submit",uploadFile);
 byId("archive-case-status")?.addEventListener("change",async event=>{if(!currentCase)return;try{await archiveApi("/cases/"+currentCase+"/status",{method:"PATCH",body:JSON.stringify({status:event.target.value})});await loadCases();}catch(error){showError(error);}});
 document.addEventListener("click",event=>{const item=event.target.closest(".archive-open");if(item)openCase(item.dataset.id);const dl=event.target.closest(".archive-download");if(dl)downloadFile(dl.dataset.id,dl.dataset.name);});
}
bind();window.loadJustificationArchive=initialize;
})();
