/* Assistente guiado local. Nenhum pedido é enviado a um provedor de IA. */
(()=>{
  "use strict";
  const C=window.SystemCommands,$=id=>document.getElementById(id);
  const dialog=$("workflow-assistant"),log=$("wf-log"),actions=$("wf-actions"),input=$("wf-input");
  if(!dialog||!C)return;
  const statuses={ATIVO:"Ativo",DEMITIDO:"Demitido",AFASTADO:"Afastado",INATIVO:"Inativo"};
  const ALL="__ALL__",NONE="__NONE__";
  let flow=null,step=null,busy=false,actor=null,revision=0;
  const has=(object,key)=>Object.hasOwn(object,key);
  const fmtDate=value=>value?String(value).slice(0,10).split("-").reverse().join("/"):"Não informada";
  const minutes=value=>value===null||value===undefined?"Sem informação":`${value<0?"-":""}${Math.floor(Math.abs(value)/60)}:${String(Math.abs(value)%60).padStart(2,"0")}`;
  function element(tag,text,parent){const node=document.createElement(tag);node.textContent=text;parent.append(node);return node;}
  function say(text,role="assistant"){
    const bubble=element("div","",log);bubble.className=`wf-message wf-${role}`;
    element("strong",role==="user"?"Você":"Assistente do sistema",bubble);element("p",text,bubble);log.scrollTop=log.scrollHeight;return bubble;
  }
  function reset(){revision++;flow=null;step=null;actions.replaceChildren();input.value="";input.placeholder="Descreva uma tarefa do sistema…";}
  function authorized(task){return C.permitted(task,currentUser);}
  async function run(callback){
    if(busy)return;busy=true;
    const userId=currentUser?.id;
    $("wf-loading").hidden=false;input.disabled=true;$("wf-send").disabled=true;
    try{await callback();}
    catch(error){if(actor===userId&&currentUser?.id===userId)say(error.message||"Não foi possível concluir o pedido.");}
    finally{busy=false;$("wf-loading").hidden=true;input.disabled=false;$("wf-send").disabled=false;if(dialog.open)input.focus();}
  }
  function action(label,callback,{primary=false}={}){
    const version=revision,node=element("button",label,actions);node.type="button";if(primary)node.className="primary";
    node.onclick=()=>{if(busy||version!==revision)return;run(callback);};return node;
  }
  function suggestions(){
    actions.replaceChildren();
    for(const task of C.tasks.filter(authorized))action(task.label,()=>begin({intent:task.id}));
  }
  function menu(message="Posso ajudar com as tarefas abaixo. Escreva o pedido com suas palavras ou escolha uma sugestão."){
    reset();say(message);suggestions();
  }
  function ask(key,prompt,accept,{choices=null,placeholder="Digite sua resposta…"}={}){
    actions.replaceChildren();step={key,prompt,accept,choices,visible:choices?.slice(0,12)};
    input.placeholder=placeholder;say(prompt);
    if(choices)showChoices(step.visible);
  }
  function showChoices(choices){
    actions.replaceChildren();const expected=step;
    choices.forEach((choice,index)=>action(`${index+1}. ${choice.label}`,async()=>{
      if(step!==expected)return;say(choice.label,"user");await expected.accept(choice.value,choice);
    }));
    if(step.choices.length>12)say(`Há ${step.choices.length} opções. Mostrei ${choices.length}; digite parte do nome ou a matrícula para filtrar.`);
  }
  function field(key,prompt,parse){
    ask(key,prompt,async text=>{
      const value=parse(text);if(value===undefined){say("Não consegui validar essa informação. Confira o formato solicitado ou escolha uma sugestão.");return;}
      flow.values[key]=value;step=null;await advance();
    });
  }
  function choice(key,prompt,options){
    if(!options.length)throw new Error("Não há opções cadastradas no seu acesso para esta etapa. Confira os cadastros no sistema.");
    ask(key,prompt,async value=>{flow.values[key]=value;step=null;await advance();},{choices:options});
  }
  function taskOptions(rows,labelKey="name"){return rows.map(row=>({value:row.id,label:row[labelKey]||row.name||row.trade_name}));}
  async function loadContext(){
    if(flow.context)return;
    const type=flow.intent;let context;
    if(["thermal","meal"].includes(type)){
      const employees=(await api("/api/reports/employees")).filter(employeeCanGenerateReports);
      context={employees,companies:[...new Map(employees.map(e=>[e.company_id,{id:e.company_id,trade_name:e.company_name}])).values()],branches:[...new Map(employees.map(e=>[e.branch_id,{id:e.branch_id,company_id:e.company_id,name:e.branch_name}])).values()]};
    }else if(["bh","intervals","critical"].includes(type))context=await api("/api/reconciliation/options");
    else context=await api("/api/employees/scope-options");
    flow.context=context;
  }
  function scopedEmployees(){
    const v=flow.values;
    return (flow.context.employees||[]).filter(e=>(v.companyId===ALL||e.company_id===v.companyId)&&(v.branchId===ALL||e.branch_id===v.branchId));
  }
  async function employeeSearch(search){
    search=String(search).trim().replace(/^(?:a )?matr[ií]cula(?: dele| dela)?(?: [ée])?\s*:?\s*/i,"");
    const v=flow.values;let employees;
    if(Array.isArray(flow.context.employees))employees=scopedEmployees();
    else{
      const query=new URLSearchParams({status:"ALL",search});
      if(v.companyId!==ALL)query.set("companyId",v.companyId);if(v.branchId!==ALL)query.set("branchId",v.branchId);
      employees=await api(`/api/employees?${query}`);
      if(!employees.length&&/[^\d\s]/.test(search)){
        query.delete("search");employees=await api(`/api/employees?${query}`);
      }
    }
    const text=C.normalize(search).replace(/^(?:o |a )?(?:colaborador[a]? |funcionario |funcionaria )/,"");
    const exact=employees.filter(e=>/^\d+$/.test(text)&&String(e.registration||"").replace(/^0+/,"")===text.replace(/^0+/,""));
    const matches=exact.length?exact:employees.filter(e=>C.normalize(e.full_name).includes(text)||String(e.registration||"").includes(text));
    if(!matches.length){say("Não localizei esse colaborador no escopo escolhido. Informe o nome ou a matrícula novamente.");delete v.search;return askEmployee();}
    const options=matches.map(e=>({value:e.id,registration:e.registration,label:`${e.full_name} · matrícula ${e.registration||"não informada"} · ${e.company_name||flow.context.companies.find(row=>row.id===e.company_id)?.trade_name||"empresa"} / ${e.branch_name||flow.context.branches.find(row=>row.id===e.branch_id)?.name||"filial"}${e.status?` · ${statuses[e.status]||e.status}`:""}`,employee:e}));
    if(matches.length===1){flow.employee=matches[0];v.employeeId=matches[0].id;say(`Localizei ${matches[0].full_name}, matrícula ${matches[0].registration||"não informada"}.`);return advance();}
    ask("employeeId","Há mais de um cadastro ou vínculo. Escolha a matrícula correta; não vou selecionar o primeiro automaticamente.",async(id,selected)=>{v.employeeId=id;flow.employee=selected.employee;await advance();},{choices:options});
  }
  function askEmployee(){
    const allAllowed=["thermal","meal","intervals"].includes(flow.intent);
    ask("employeeSearch",allAllowed?"Qual colaborador? Informe nome ou matrícula, ou responda “todos” para o escopo escolhido.":"Qual é o nome ou a matrícula do colaborador?",async text=>{
      if(allAllowed&&/^(todos|todas|todos os colaboradores)$/i.test(String(text).trim())){flow.values.employeeId=ALL;await advance();return;}
      if(String(text).trim().length<2){say("Informe ao menos dois caracteres ou a matrícula.");return;}
      await employeeSearch(String(text).trim());
    });
    if(allAllowed)action("Todos os colaboradores do escopo",async()=>{say("Todos os colaboradores do escopo","user");flow.values.employeeId=ALL;await advance();});
  }
  async function begin(command){
    const task=C.tasks.find(item=>item.id===command.intent);
    if(!task||!authorized(task)){menu(task?"Seu perfil não possui acesso a essa tarefa. Estas são as opções disponíveis:":"Não reconheci uma tarefa única do sistema. Escolha uma sugestão ou reformule o pedido.");return;}
    reset();flow={intent:task.id,values:{},context:null};
    if(command.search)flow.values.search=command.search;
    if(command.month)flow.values.month=command.month;
    if(command.date)flow.values.terminationDate=command.date;
    if(command.status)flow.values.status=command.status;
    if(task.id==="dismiss")flow.values.status="DEMITIDO";
    say(`Vamos ${task.label.toLowerCase()}.`);
    if(["imports","shifts","calendar"].includes(task.id))return openNativeTask(task.id);
    await loadContext();await advance();
  }
  async function openNativeTask(type){
    const imported=type==="imports";
    say(imported?"Vou abrir Importações. Escolha o arquivo original e confira a prévia antes de gravar; o assistente não substitui a leitura e a validação do documento.":"Vou abrir a área de configuração correspondente para você usar os controles completos do sistema.");
    actions.replaceChildren();step=null;
    action(imported?"Abrir Importações":type==="calendar"?"Abrir feriados e folgas":"Abrir cargos e turnos",async()=>{
      dialog.close();navigate(imported?"imports":"settings");
      if(!imported)document.querySelector(`[data-settings-tab="${type==="calendar"?"calendar":"shifts"}"]`)?.click();
    },{primary:true});
  }
  async function advance(){
    const v=flow.values,type=flow.intent;
    const query=["thermal","meal","bh","intervals","critical"].includes(type);
    if(query&&!v.month)return field("month","Qual é a competência? Pode informar 11/2026, 2026-11 ou novembro de 2026.",text=>C.month(text)||undefined);
    if(!has(v,"companyId")){
      const options=taskOptions(flow.context.companies,"trade_name");
      if(query)options.unshift({value:ALL,label:"Todas as empresas autorizadas"});
      return choice("companyId","Qual empresa deseja usar?",options);
    }
    if(!has(v,"branchId")){
      const branches=flow.context.branches.filter(b=>v.companyId===ALL||b.company_id===v.companyId);
      const options=taskOptions(branches);
      if(query)options.unshift({value:ALL,label:"Todas as filiais autorizadas no escopo"});
      return choice("branchId","Qual filial?",options);
    }
    if(type==="create")return advanceCreate();
    if(type!=="critical"&&!v.employeeId){
      if(v.search){const search=v.search;delete v.search;return employeeSearch(search);}
      return askEmployee();
    }
    if(type==="dismiss"||type==="status"){
      if(!v.status)return choice("status","Qual situação deve ficar no cadastro?",Object.entries(statuses).map(([value,label])=>({value,label})));
      if(v.status==="DEMITIDO"&&!v.terminationDate)return field("terminationDate","Qual foi a data de demissão? Informe dia/mês/ano, “hoje” ou “ontem”.",text=>C.date(text)||undefined);
      return reviewStatus();
    }
    if(type==="lookup")return showEmployee();
    if(type==="critical"&&!v.criticalKind)return choice("criticalKind","Deseja os críticos do semáforo gerencial ou os colaboradores com intervalos críticos?",[{value:"management",label:"Semáforo gerencial: faltas, BH e pendências"},{value:"intervals",label:"Intervalos críticos: diferença maior que 10 minutos"}]);
    if(type==="bh"&&!v.basis)return choice("basis","O BH deve usar o fechamento gerencial (dia 19 do mês anterior a 18) ou o mês calendário?",[{value:"closing",label:"Fechamento gerencial: 19 a 18"},{value:"calendar",label:"Mês calendário: primeiro ao último dia"}]);
    return reviewQuery();
  }
  async function advanceCreate(){
    const v=flow.values;
    if(!has(v,"fullName"))return field("fullName","Qual é o nome completo do novo colaborador?",text=>{
      const value=String(text).trim().replace(/^(?:(?:o )?nome(?: completo)?(?: dele| dela)?(?: [ée])?\s*:?\s+|(?:ele|ela) se chama\s+)/i,"");return value&&value.length<=180&&!/^(nao sei|nao tenho|nao informado|sem nome)$/.test(C.normalize(value))?value:undefined;
    });
    if(!has(v,"registration")){
      field("registration","Qual é a matrícula? Vou preservar os zeros à esquerda. Se não houver matrícula, escolha a opção abaixo.",text=>{
        if(/^(sem matricula|nao tem matricula|nao informada)$/.test(C.normalize(text)))return null;
        const value=String(text).trim().replace(/^(?:a )?matr[ií]cula(?: dele)?(?: [ée])?\s*:?\s*/i,"");return /^[\w.-]{1,50}$/.test(value)?value:undefined;
      });action("Sem matrícula informada",async()=>{v.registration=null;await advance();});return;
    }
    if(!has(v,"admissionDate")){
      field("admissionDate","Qual é a data de admissão? Informe dia/mês/ano ou escolha “Sem data informada”.",text=>/^(sem data|sem data informada|nao informada)$/.test(C.normalize(text))?null:C.date(text)||undefined);
      action("Sem data informada",async()=>{v.admissionDate=null;await advance();});return;
    }
    if(!flow.catalogs){const [roles,shifts]=await Promise.all([api("/api/catalogs/job_roles"),api("/api/catalogs/shifts")]);flow.catalogs={roles,shifts};}
    if(!has(v,"jobRoleId"))return choice("jobRoleId","Qual é o cargo? O sistema aplicará as regras de relatórios desse cargo.",[{value:NONE,label:"Sem cargo informado"},...taskOptions(flow.catalogs.roles.filter(row=>row.company_id===v.companyId&&row.active!==false))]);
    if(!has(v,"shiftId"))return choice("shiftId","Qual é o turno? A folga padrão será a do turno escolhido.",[{value:NONE,label:"Sem turno informado"},...taskOptions(flow.catalogs.shifts.filter(row=>row.company_id===v.companyId&&row.active!==false))]);
    actions.replaceChildren();step={key:"review",accept:confirmText};
    const fields=scopeSummary();
    fields.push(["Nome",v.fullName],["Matrícula",v.registration||"Não informada"],["Admissão",fmtDate(v.admissionDate)],["Cargo",flow.catalogs.roles.find(r=>r.id===v.jobRoleId)?.name||"Não informado"],["Turno",flow.catalogs.shifts.find(r=>r.id===v.shiftId)?.name||"Não informado"],["Situação","Ativo"],["Folgas","Padrão do turno"],["Relatórios","Herdar regra do cargo"]);
    review("Confira o novo cadastro",fields);
    if(v.jobRoleId===NONE||v.shiftId===NONE)say("Sem cargo ou turno, a geração de fichas pode ficar pendente. O sistema manterá as validações normais.");
    flow.confirm=async()=>{
      if(flow.sent)return;flow.sent=true;
      const body={companyId:v.companyId,branchId:v.branchId,fullName:v.fullName,registration:v.registration,admissionDate:v.admissionDate,
        jobRoleId:v.jobRoleId===NONE?null:v.jobRoleId,shiftId:v.shiftId===NONE?null:v.shiftId,status:"ATIVO",reportPolicyOverride:null,weeklyDaysOff:[],useShiftDaysOff:true};
      try{
        invalidateReportValidation();
        const result=await api("/api/employees",{method:"POST",body:JSON.stringify(body)});
        if(!result?.id)throw new Error("O servidor não retornou a confirmação do cadastro.");
        finish(`Cadastro confirmado: ${result.full_name}, matrícula ${result.registration||"não informada"}, situação ${statuses[result.status]||result.status}.`);
      }catch(error){
        actions.replaceChildren();step=null;say(`${error.message}\nConfira se a matrícula já foi cadastrada antes de repetir, pois uma falha de conexão pode ocorrer após o recebimento do pedido.`);
        action("Consultar a matrícula no sistema",async()=>{dialog.close();navigate("employees");$("employee-search").value=v.registration||v.fullName;await loadEmployees();});action("Revisar dados",async()=>{flow.sent=false;edit();});
      }
    };
    action("Confirmar cadastro",flow.confirm,{primary:true});action("Corrigir dados",edit);action("Cancelar",()=>menu("Cadastro cancelado. Nenhuma solicitação de gravação foi enviada."));
  }
  function scopeSummary(){
    const v=flow.values;return [["Empresa",v.companyId===ALL?"Todas as autorizadas":flow.context.companies.find(row=>row.id===v.companyId)?.trade_name||"Empresa selecionada"],["Filial",v.branchId===ALL?"Todas as autorizadas":flow.context.branches.find(row=>row.id===v.branchId)?.name||"Filial selecionada"]];
  }
  function review(title,fields){const bubble=say(title),list=document.createElement("dl");bubble.append(list);fields.forEach(([key,value])=>{element("dt",key,list);element("dd",value,list);});log.scrollTop=log.scrollHeight;}
  async function reviewStatus(){
    const v=flow.values;actions.replaceChildren();step=null;
    const prepared=await api("/api/workflow-assistant/prepare",{method:"POST",body:JSON.stringify({search:flow.employee.registration||flow.employee.full_name,employeeId:v.employeeId,status:v.status,terminationDate:v.terminationDate||null})});
    if(prepared.unchanged)return finish("O cadastro já está com a situação e a data solicitadas. Nenhuma alteração foi necessária.");
    if(!prepared.plan||!prepared.employee)throw new Error("O cadastro precisa de nova identificação antes de continuar.");
    review("Confira a alteração",[["Empresa",prepared.employee.company],["Filial",prepared.employee.branch],["Colaborador",prepared.employee.name],["Matrícula",prepared.employee.registration||"Não informada"],["Situação atual",statuses[prepared.employee.status]],["Nova situação",statuses[v.status]],["Data de demissão atual",fmtDate(prepared.employee.terminationDate)],["Nova data de demissão",fmtDate(prepared.after.terminationDate)]]);
    if(prepared.employee.terminationDate&&!prepared.after.terminationDate)say("A nova situação removerá a data de demissão atual.");
    step={key:"review",accept:confirmText};
    flow.confirm=async()=>{
      if(flow.sent)return;flow.sent=true;actions.replaceChildren();step=null;
      try{
        invalidateReportValidation();
        const result=await api("/api/workflow-assistant/confirm",{method:"POST",body:JSON.stringify({plan:prepared.plan})});
        finish(`Alteração confirmada: ${result.employee.name}, matrícula ${result.employee.registration||"não informada"}, situação ${statuses[result.employee.status]}${result.employee.terminationDate?`, demissão em ${fmtDate(result.employee.terminationDate)}`:""}.`);
      }catch(error){say(`${error.message}\nConfira o cadastro antes de tentar novamente.`);action("Conferir cadastro atualizado",async()=>{const fresh=await api(`/api/employees/${v.employeeId}`);flow.employee=fresh;flow.sent=false;showEmployee(true);});}
    };
    action("Confirmar alteração",flow.confirm,{primary:true});action("Corrigir dados",edit);action("Cancelar",()=>menu("Alteração cancelada. Nenhuma gravação foi enviada."));
  }
  function edit(){
    actions.replaceChildren();step=null;
    const keys=flow.intent==="create"?["companyId","branchId","fullName","registration","admissionDate","jobRoleId","shiftId"]:["companyId","branchId","employeeId","status","terminationDate"];
    const labels={companyId:"Empresa",branchId:"Filial",fullName:"Nome",registration:"Matrícula",admissionDate:"Admissão",jobRoleId:"Cargo",shiftId:"Turno",employeeId:"Colaborador / matrícula",status:"Situação",terminationDate:"Data de demissão"};
    say("Qual informação deseja corrigir?");
    for(const key of keys)action(labels[key],async()=>{
      delete flow.values[key];flow.sent=false;
      if(["companyId","branchId"].includes(key)){delete flow.values.employeeId;flow.employee=null;}
      if(key==="companyId"){delete flow.values.branchId;delete flow.values.jobRoleId;delete flow.values.shiftId;}
      await advance();
    });
  }
  async function confirmText(text){
    if(/^(sim|confirmar|confirmo|pode salvar|salvar|pode confirmar|pode cadastrar|pode alterar|confirmar cadastro|confirmar alteracao)$/i.test(C.normalize(text)))return flow.confirm?.();
    if(/^(corrigir|editar|voltar)/i.test(text))return edit();
    const updatedDate=C.date(text);
    if(updatedDate&&["dismiss","status"].includes(flow.intent)){flow.values.terminationDate=updatedDate;return reviewStatus();}
    say("Para gravar, clique no botão de confirmação ou responda “confirmar”. Para ajustar alguma informação, escolha “Corrigir dados”.");
  }
  function showEmployee(canRetry=false){
    const employee=flow.employee;
    review("Dados atuais do cadastro",[...scopeSummary(),["Colaborador",employee.full_name],["Matrícula",employee.registration||"Não informada"],["Situação",statuses[employee.status]||employee.status],["Admissão",fmtDate(employee.admission_date)],["Demissão",fmtDate(employee.termination_date)],["Cargo",employee.job_role_name||employee.job_title||"Não informado"],["Turno",employee.shift_name||"Não informado"]]);
    actions.replaceChildren();step=null;
    if(canRetry)action("Preparar nova conferência",reviewStatus);
    action("Abrir cadastro no sistema",async()=>{dialog.close();navigate("employees");await window.editEmployee(employee.id);});action("Novo pedido",()=>menu());
  }
  function reviewQuery(){
    actions.replaceChildren();step=null;const v=flow.values;
    const fields=[...scopeSummary(),["Competência",v.month.split("-").reverse().join("/")]];
    if(flow.intent!=="critical")fields.push(["Colaborador",v.employeeId===ALL?"Todos do escopo":`${flow.employee.full_name} · matrícula ${flow.employee.registration||"não informada"}`]);
    if(flow.intent==="bh")fields.push(["Período",v.basis==="closing"?"Fechamento: 19 do mês anterior a 18":"Mês calendário completo"]);
    if(flow.intent==="critical")fields.push(["Critério",v.criticalKind==="management"?"Semáforo gerencial (RED)":"Intervalos com diferença maior que 10 minutos"]);
    review("Confira os filtros",fields);
    const label=["thermal","meal"].includes(flow.intent)?"Gerar fichas":"Consultar agora";
    flow.confirm=executeQuery;step={key:"reviewQuery",accept:async text=>{if(/^(sim|consultar|gerar|confirmar|pode consultar|pode gerar)$/i.test(text.trim()))return executeQuery();say("Clique em Consultar agora/Gerar fichas para executar, ou cancele para iniciar outro pedido.");}};
    action(label,executeQuery,{primary:true});action("Alterar competência",async()=>{delete v.month;await advance();});action("Mudar empresa/filial",async()=>{delete v.companyId;delete v.branchId;delete v.employeeId;await advance();});action("Cancelar",()=>menu("Consulta cancelada."));
  }
  async function executeQuery(){
    const v=flow.values,type=flow.intent;actions.replaceChildren();step=null;
    if(["thermal","meal"].includes(type)){
      try{
        const result=await window.WorkflowReports.generate({month:v.month,companyId:v.companyId===ALL?null:v.companyId,branchId:v.branchId===ALL?null:v.branchId,employeeId:v.employeeId===ALL?null:v.employeeId,type:type==="thermal"?"thermal":"meal"});
        say(`${result.count} ficha(s) do tipo solicitado foram geradas e validadas para ${v.month.split("-").reverse().join("/")}. ${result.summary||""}`);
        flow.printReady=type;
        action("Abrir central de impressão",async()=>{dialog.close();window.WorkflowReports.openPrint(type==="thermal"?"thermal":"meal");},{primary:true});
        action("Ver fichas no sistema",async()=>dialog.close());action("Novo pedido",()=>menu());
      }catch(error){say(error.message);action("Ver validações no sistema",async()=>dialog.close());action("Conferir filtros novamente",reviewQuery);}
      return;
    }
    const query=new URLSearchParams({month:v.month});if(v.companyId!==ALL)query.set("companyId",v.companyId);if(v.branchId!==ALL)query.set("branchId",v.branchId);
    let report;
    if(type==="bh"){
      query.set("employeeId",v.employeeId);query.set("basis",v.basis);
      const result=await api(`/api/reconciliation/snapshot?${query}`),s=result.snapshot;
      const records=[["BH+ validado no ponto",minutes(s.pointPositive)],["BH− validado no ponto",minutes(s.pointNegative)],["Créditos no BH Analítico",minutes(s.bhPositive)],["Débitos no BH Analítico",minutes(s.bhNegative)],["Saldo na data final (Sintético)",minutes(s.balance)],["Dias de ponto",s.hasPoint?String(s.days):"Sem informação"],["Dias do ponto com BH não validado",String(s.unknownBhDays)],["Dias sem comparação com BH Analítico",String(s.missingBhDays)]];
      report={title:`Banco de horas · ${flow.employee.full_name} · ${flow.employee.registration||"sem matrícula"}`,headers:["Informação","Resultado"],rows:records,note:`Período: ${fmtDate(s.range.start)} a ${fmtDate(s.range.end)}. Sem informação não significa saldo zero. O saldo só é exibido quando existe BH Sintético na data final. Dias não validados e dias sem cobertura não comprovam divergência. Fontes BH: ${s.sources.length?s.sources.map(source=>source.file).join("; "):"nenhum arquivo confirmado para os valores exibidos"}.`};
    }else{
      const summary=await api(`/api/dashboard/occurrences?${query}`);
      if(type==="critical"&&v.criticalKind==="management"){
        const critical=summary.employees.filter(e=>e.indicator_status==="RED").sort((a,b)=>(b.indicator_reasons?.length||0)-(a.indicator_reasons?.length||0)||String(a.full_name).localeCompare(String(b.full_name),"pt-BR"));
        report={title:"Colaboradores críticos · semáforo gerencial",headers:["Colaborador","Matrícula","Filial","Motivos"],rows:critical.map(e=>[e.full_name,e.registration||"Não informada",e.branch_name,(e.indicator_reasons||[]).join("; ")]),note:"Classificação RED e motivos fornecidos pelo Controle de Ocorrências. Ordenação pela quantidade de motivos críticos, com empate por nome; não é uma nova pontuação de gravidade."};
      }else{
        const result=await api(`/api/dashboard/occurrences/journeys?${query}`);
        const selected=result.days.filter(day=>type==="critical"||v.employeeId===ALL||day.employee_id===v.employeeId).filter(day=>String(day.point_state).toUpperCase()==="WORKED");
        if(type==="critical"){
          const people=new Map();let pending=0;
          for(const day of selected){
            const analysis=window.OccurrencesControl.journeyDayAnalysis(day);
            if(analysis.actual===null||analysis.planned===null||(day.markings||[]).length<4){pending++;continue;}
            if(analysis.level!=="red"||analysis.intervalDiff===null||analysis.intervalDiff===undefined)continue;
            if(!people.has(day.employee_id))people.set(day.employee_id,{name:day.full_name,registration:day.registration,dates:[]});people.get(day.employee_id).dates.push(fmtDate(day.work_date));
          }
          report={title:"Colaboradores com intervalos críticos",headers:["Colaborador","Matrícula","Dias críticos","Datas"],rows:[...people.values()].sort((a,b)=>b.dates.length-a.dates.length||a.name.localeCompare(b.name,"pt-BR")).map(person=>[person.name,person.registration||"Não informada",person.dates.length,person.dates.join(", ")]),note:`Critério da análise de intervalos: diferença absoluta maior que 10 minutos entre realizado e previsto. Ordenação pela quantidade de dias críticos. ${pending} jornada(s) sem confirmação suficiente ficam pendentes, fora deste ranking.`};
        }else report={title:"Relação de intervalos do ponto",headers:["Colaborador","Matrícula","Data","Realizado","Previsto","Conferência"],rows:selected.map(day=>{
          const analysis=window.OccurrencesControl.journeyDayAnalysis(day);
          return [day.full_name,day.registration||"Não informada",fmtDate(day.work_date),analysis.actual===null?"Sem confirmação":`${analysis.actual} min`,analysis.planned===null?"Sem escala interpretável":`${analysis.planned} min`,analysis.planned===null?"Pendente: escala não interpretável":analysis.label];
        }),note:"Somente jornadas WORKED. A conferência usa as mesmas funções da análise de jornadas. Marcações incompletas e escalas não interpretáveis exigem revisão; não são apresentadas como intervalo normal confirmado."};
      }
      report.note+=` Cobertura importada: ${summary.imports?.length?summary.imports.map(item=>`${item.company_name} / ${item.branch_name}: ${fmtDate(item.period_start)} a ${fmtDate(item.period_end)}`).join("; "):"nenhum período informado para o filtro"}. Os resultados se limitam aos dados importados e podem representar um período parcial.`;
    }
    report.context=[...scopeSummary(),["Competência",v.month.split("-").reverse().join("/")]];
    flow.result=report;showResult(report);
  }
  function showResult(report){
    const bubble=say(report.title);const wrap=element("div","",bubble);wrap.className="wf-table-wrap";
    const table=element("table","",wrap),head=element("thead","",table),tr=element("tr","",head);report.headers.forEach(label=>element("th",label,tr));const body=element("tbody","",table);
    const count=element("p","",bubble);let page=0;
    function render(){body.replaceChildren();report.rows.slice(page*100,(page+1)*100).forEach(row=>{const tr=element("tr","",body);row.forEach(value=>element("td",String(value??"Sem informação"),tr));});count.textContent=report.rows.length?`Exibindo ${page*100+1} a ${Math.min((page+1)*100,report.rows.length)} de ${report.rows.length} registros.`:"Nenhum registro encontrado nos dados disponíveis para o filtro.";}
    render();element("p",report.note,bubble);actions.replaceChildren();
    if(report.rows.length>100){action("Página anterior",async()=>{page=Math.max(0,page-1);render();});action("Próxima página",async()=>{page=Math.min(Math.ceil(report.rows.length/100)-1,page+1);render();});}
    action("Imprimir relação completa",async()=>printResult(report),{primary:true});action("Conferir filtros",reviewQuery);action("Novo pedido",()=>menu());log.scrollTop=log.scrollHeight;
  }
  function printResult(report){
    const win=window.open("","_blank","width=1100,height=800");if(!win){say("O navegador bloqueou a janela de impressão. Permita pop-ups para este sistema e tente novamente.");return;}
    win.opener=null;const doc=win.document;doc.title=report.title;
    const style=doc.createElement("style");style.textContent="body{font:12px Arial;color:#111;margin:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:6px;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}h1{font-size:20px}p{white-space:pre-wrap}";doc.head.append(style);
    element("h1",report.title,doc.body);report.context.forEach(([key,value])=>element("p",`${key}: ${value}`,doc.body));element("p",report.note,doc.body);
    const table=element("table","",doc.body),head=element("thead","",table),header=element("tr","",head);report.headers.forEach(label=>element("th",label,header));const body=element("tbody","",table);report.rows.forEach(row=>{const tr=element("tr","",body);row.forEach(value=>element("td",String(value??"Sem informação"),tr));});
    win.focus();win.print();
  }
  function finish(message){reset();say(message);suggestions();window.dispatchEvent(new CustomEvent("controle:workflow-updated"));}
  async function submit(text){
    if(!text.trim())return;say(text,"user");input.value="";
    const command=C.interpret(text);
    if(step?.key==="switch"&&/^(nao|continuar)$/.test(C.normalize(text)))return advance();
    if(command.intent==="cancel")return menu("Pedido cancelado. Operações já confirmadas não são desfeitas.");
    if(command.negated)return menu("Não vou iniciar uma alteração com esse pedido negativo. Escolha outra tarefa, se desejar.");
    if(command.intent==="help")return menu();
    if(!step&&/^imprimir(?: relatorio| relacao)?$/.test(C.normalize(text))){
      if(flow?.result)return printResult(flow.result);
      if(flow?.printReady){dialog.close();return window.WorkflowReports.openPrint(flow.printReady==="thermal"?"thermal":"meal");}
    }
    if(step&&C.tasks.some(task=>task.id===command.intent)&&/^(?:(?:quero|preciso|gostaria de|pode) )?(?:cadastrar|cadastre|adicionar|adicione|demitir|demita|desligar|reativar|afastar|inativar|alterar|altere|mudar|mude|consultar|bh\b|banco de horas|saldo de horas|imprimir|gerar|relatorio|relacao de intervalos|quem esta)/.test(C.normalize(text))){
      const pendingTask=C.tasks.find(task=>task.id===command.intent);
      say(`Você está no meio de um pedido. Deseja trocar para “${pendingTask.label}”? Nenhuma alteração deste pedido foi gravada.`);actions.replaceChildren();
      step={key:"switch",accept:async reply=>{if(/^(sim|trocar|novo pedido)$/.test(C.normalize(reply)))return begin(command);if(/^(nao|continuar)$/.test(C.normalize(reply)))return advance();say("Escolha Trocar pedido ou Continuar pedido atual.");}};
      action("Trocar pedido",()=>begin(command));action("Continuar pedido atual",advance);return;
    }
    if(step){
      if(step.choices){
        let options;
        const prefix={companyId:"empresa",branchId:"filial",jobRoleId:"cargo",shiftId:"turno",status:"situacao"}[step.key];
        const answer=prefix?C.normalize(text).replace(new RegExp(`^(?:a |o )?${prefix}(?: e)?[: ]+`),""):text;
        if(/^#?\d+$/.test(answer.trim())&&!step.choices.some(item=>item.registration&&String(item.registration).replace(/^0+/,"")===answer.trim().replace(/^0+/,"")))options=C.matchingOptions(answer,step.visible);
        else options=C.matchingOptions(answer,step.choices);
        if(options.length===1)return step.accept(options[0].value,options[0]);
        if(options.length){step.visible=options.slice(0,12);say("Encontrei mais de uma opção. Escolha pelo botão ou informe uma identificação mais específica.");showChoices(step.visible);return;}
        say("Não encontrei essa opção. Confira o nome ou escolha um dos botões.");return;
      }
      return step.accept(text);
    }
    if(command.intent==="unknown"){
      if(command.candidates?.length){say("Seu pedido envolve mais de uma tarefa. Vamos fazer uma por vez:");actions.replaceChildren();for(const candidate of command.candidates){const task=C.tasks.find(item=>item.id===candidate);if(task&&authorized(task))action(task.label,()=>begin({intent:candidate}));}return;}
      return menu(command.negated?"Não vou iniciar uma alteração com esse pedido negativo. Escolha outra tarefa, se desejar.":"Ainda não reconheci esse pedido. Posso executar os comandos abaixo e perguntar o que estiver faltando.");
    }
    return begin(command);
  }
  function open(){
    if(!currentUser||!token)return;
    if(actor!==currentUser.id){log.replaceChildren();actor=currentUser.id;menu();}
    if(!dialog.open)dialog.showModal();input.focus();
  }
  $("workflow-assistant-open").onclick=open;
  $("wf-desktop").onclick=()=>{
    const blob=new Blob([`[InternetShortcut]\r\nURL=${location.origin}/?assistente=1\r\n`],{type:"application/internet-shortcut"});
    const url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download="Assistente Controle Termico Beta - Sistema.url";anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    say("Atalho baixado. Mova o arquivo .url para a Área de Trabalho do Windows. Ele abre o sistema e, após o login, este assistente.");
  };
  const fromShortcut=new URL(location.href).searchParams.get("assistente")==="1";
  if(fromShortcut){window.addEventListener("controle:app-ready",open,{once:true});if(!$("app").hidden)open();}
  $("wf-close").onclick=()=>dialog.close();$("wf-reset").onclick=()=>{if(!busy)menu();};
  window.addEventListener("controle:workflow-updated",()=>{
    invalidateReportValidation();window.invalidateOccurrencesControl?.();
    const active=document.querySelector(".view.active")?.id;
    if(active==="employees")loadEmployees().catch(error=>say(error.message));
    if(active==="dashboard"&&typeof window.loadDashboard==="function")window.loadDashboard().catch(error=>say(error.message));
  });
  $("wf-form").onsubmit=event=>{event.preventDefault();run(()=>submit(input.value));};
  new MutationObserver(()=>{if($("app").hidden){reset();log.replaceChildren();actor=null;if(dialog.open)dialog.close();}}).observe($("app"),{attributes:true,attributeFilter:["hidden"]});
})();
