function hasEffectivePermission(rule=""){
  const alternatives=String(rule||"").split("|").map(item=>item.trim()).filter(Boolean);
  if(!alternatives.length)return true;
  if(alternatives.includes("master"))return currentUser?.isMasterAdmin===true;
  if(alternatives.length===1&&alternatives[0]==="occurrences.view")return currentUser?.role==="ADMIN"&&(currentUser?.isMasterAdmin===true||currentUser?.permissions?.["occurrences.view"]===true);
  if(currentUser?.role==="ADMIN")return true;
  if(alternatives.includes("admin"))return false;
  return alternatives.some(permission=>currentUser?.permissions?.[permission]===true);
}

function applyHelpScope(){
  document.querySelectorAll("[data-help-permission]").forEach(element=>{
    const allowed=hasEffectivePermission(element.dataset.helpPermission);
    element.dataset.helpAllowed=allowed?"true":"false";
    element.hidden=!allowed;
  });
  const scope=$("manual-profile-scope");
  if(scope){
    scope.textContent=currentUser?.isMasterAdmin===true
      ?"Manual completo do Administrador Master."
      :currentUser?.role==="ADMIN"
      ?"Manual adaptado ao perfil Administrador. Funções exclusivas do Master permanecem protegidas."
      :`Manual adaptado ao perfil ${currentUser?.profileName||"do usuário"}.`;
  }
}

function prepareManual(){
  applyHelpScope();
  const search=$("manual-search");
  if(search && !search.dataset.ready){
    search.dataset.ready="true";
    search.addEventListener("input",filterManualChapters);
  }
}

function normalizeManualText(value=""){
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
}

function filterManualChapters(){
  const term=normalizeManualText($("manual-search")?.value);
  let visible=0;
  document.querySelectorAll(".manual-chapter").forEach(chapter=>{
    const allowed=chapter.dataset.helpAllowed!=="false";
    const searchable=normalizeManualText(`${chapter.dataset.manualKeywords||""} ${chapter.textContent||""}`);
    const matches=allowed&&(!term||searchable.includes(term));
    chapter.hidden=!matches;
    if(matches){
      visible+=1;
      if(term)chapter.open=true;
    }
  });
  if($("manual-no-results"))$("manual-no-results").hidden=visible!==0;
}

const helpTopics=[
  {id:"coordinator_new",label:"Cadastrar coordenador interno, PJ ou externo",permission:"occurrences.view",view:"occurrences",chapter:"manual-reports",answer:"Abra Ocorrências → Gerenciar Equipes e escolha empresa e filial na própria janela. Cadastre o nome do coordenador e indique se é interno, PJ ou externo. O coordenador não precisa estar no quadro de colaboradores nem ter matrícula ou ponto importado. Se ele já for colaborador dessa filial, você pode usar esse cadastro. O acesso é do Master ou de administrador autorizado para Controle de Ocorrências. Cadastros e vínculos anteriores são preservados. Renomear mantém os vínculos; inativar preserva os existentes e impede novas atribuições. Um coordenador vinculado não pode ser excluído: transfira ou retire os vínculos primeiro."},
  {id:"coordinator_team",label:"Vincular equipe por turno, nome ou matrícula",permission:"occurrences.view",view:"occurrences",chapter:"manual-reports",answer:"Em Ocorrências → Gerenciar Equipes, selecione empresa e filial. Defina o coordenador padrão de cada turno ou procure colaboradores por nome ou matrícula, filtre por turno e selecione um ou vários para atribuir diretamente. O vínculo direto do colaborador tem prioridade sobre o responsável do turno. Para voltar ao padrão, retire o vínculo direto. Os colaboradores são carregados do cadastro da filial, mesmo sem ponto no mês. O vínculo é gerencial e vale para os períodos consultados; não muda o turno cadastrado nem os dados da Senior. Não é necessário reimportar PDFs. Se outra pessoa alterar a mesma configuração, recarregue a equipe antes de salvar novamente."},
  {id:"access",label:"Entrar, senha e menu",permission:"",view:"manual",chapter:"manual-access",answer:"Para entrar, informe o e-mail e a senha cadastrados. Use “Minha senha” para trocar a própria senha. Se esquecer, escolha “Esqueci minha senha”, solicite o código enviado por e-mail e crie uma nova senha. O WhatsApp e o Administrador Master continuam disponíveis como alternativas."},
  {id:"dashboard",label:"Entender o Painel",permission:"dashboard.view",view:"dashboard",chapter:"manual-dashboard",answer:"O Painel mostra os totais e alertas dentro do seu acesso. Se aparecer colaborador sem turno, abra a lista indicada e regularize antes de gerar fichas."},
  {id:"employee_new",label:"Cadastrar colaborador",permission:"employees.manage",view:"employees",chapter:"manual-employees",answer:"Abra Colaboradores, clique em “+ Novo colaborador”, selecione empresa e filial, preencha matrícula, nome, admissão, cargo, turno e situação, confira a regra de ficha e salve."},
  {id:"employee_find",label:"Pesquisar ou corrigir colaborador",permission:"employees.view",view:"employees",chapter:"manual-employees",answer:"Abra Colaboradores e pesquise pelo nome ou matrícula. Use as abas Ativos, Demitidos, Afastados/Inativos ou Todos. A edição somente aparecerá se o perfil tiver permissão para alterar cadastros."},
  {id:"import",label:"Importar PDF da Senior",permission:"imports.manage",view:"imports",importTab:"employees",chapter:"manual-import",answer:"Abra Importações → Colaboradores, selecione o arquivo e clique em “Ler e conferir PDF”. Confira registros montados, não reconhecidos e o checklist. Confirme somente quando os dados estiverem corretos."},
  {id:"shifts",label:"Atualizar turnos",permission:"imports.manage",view:"imports",importTab:"shifts",chapter:"manual-shifts",answer:"Para atualizar por PDF, abra Importações → Turnos, leia o arquivo e confira matrícula, código e horários. Para cadastro manual de turno, use Configurações quando essa área estiver liberada."},
  {id:"timecard",label:"Importar Cartão de Ponto e vários períodos",permission:"imports.manage",view:"imports",importTab:"point",chapter:"manual-import",answer:"Abra Importações → Cartão de Ponto, selecione empresa, filial e PDF original da Senior com texto selecionável (até 32 MB). A leitura preserva as datas do arquivo, inclusive vários períodos, intervalos parciais e páginas de continuação. Não exige fechamento de 19 a 18 nem mês completo: os cortes semanais, mensais e anuais são escolhidos nos relatórios gerenciais. Confira os intervalos, a conciliação e os avisos antes de confirmar. Cartões sobrepostos para a mesma matrícula e data no mesmo arquivo são bloqueados. Reimportar substitui os pontos dos períodos enviados sem duplicar os dias; datas fora desses períodos são preservadas."},
  {id:"cleanup",label:"Limpei pontos e os alertas continuam",permission:"master",view:"imports",importTab:"point",chapter:"manual-import",answer:"Limpar pontos de teste apaga somente os pontos, as importações de ponto e os acompanhamentos da empresa/filial selecionada no Beta. Empresas, filiais e colaboradores continuam cadastrados; por isso avisos de cadastro e de filiais sem ponto podem permanecer. Não use Zerar sistema para resolver esses avisos."},
  {id:"historical_dismissed",label:"Cadastrar demitidos do ponto histórico",permission:"imports.manage",view:"imports",importTab:"employees",chapter:"manual-import",answer:"Em Importações → Colaboradores, leia o relatório de Demitidos na empresa/filial correta. Habilite a opção de cadastrar não localizados como demitidos (histórico) e selecione somente os registros conferidos. Exige matrícula, nome completo e demissão válidos; a admissão fica sem data. Matrícula de outra unidade ou ambígua não é processada. Depois leia novamente o Cartão de Ponto. Reimportar atualiza a matrícula existente."},
  {id:"bh_import",label:"Importar Banco de Horas da Senior",permission:"imports.manage",view:"imports",importTab:"bh",chapter:"manual-import",answer:"Abra Importações → Banco de Horas. Selecione empresa/filial e envie Analítico HRBH008 ou Sintético HRBH009 (PDF até 32 MB). A leitura segue as datas impressas em cada bloco, sem exigir semana, mês ou fechamento. Um PDF pode conter intervalos separados do Analítico ou várias referências do Sintético. Confira Datas do registro, saldos, matrículas e filial antes de confirmar. Lacunas entre os blocos continuam sem informação. Datas inválidas, linhas não reconhecidas e blocos sobrepostos da mesma matrícula/banco no mesmo PDF bloqueiam a gravação. Repetições não duplicam; em arquivos diferentes, a confirmação mais recente substitui a cobertura sobreposta por banco/data. O BH não altera nem libera o ponto. Os BH já confirmados continuam válidos; para arquivos antes rejeitados por vários períodos, leia e confirme novamente após a atualização. Depois execute a comparação em Ocorrências, sem reimportar o ponto."},
  {id:"period_compare",label:"Comparar semanas, meses e anos com BH e Ocorrências",permission:"occurrences.view",view:"manual",chapter:"manual-import",answer:"Em Ocorrências → Comparar períodos, abra a comparação e escolha semanas, meses ou anos na seção Períodos; na seção Filtros, selecione empresa, filial ou colaborador. Clique em Comparar períodos para carregar o resultado. Fechar comparação recolhe a área e preserva a seleção. Requer autorização de Ocorrências e acesso ao painel. Semanas vão de segunda a domingo. Para meses e anos, o padrão é fechamento 19 a 18; há alternativa calendário. Esses cortes são somente gerenciais e não limitam a leitura dos PDFs. Créditos/débitos de origem A são cruzados por matrícula/data; fechamentos e outras origens ficam fora da comparação diária. Sem cobertura aparece Sem informação, sem assumir zero nos intervalos não enviados. Saldo exige Sintético na data final e não é somado entre períodos. Ocorrências seguem as categorias do Controle de Ocorrências; cada dia conta uma vez por categoria e pode ter várias categorias. O assistente explica diferenças com regras e fontes, sem atribuir causa sem evidência. O modo noturno mantém o contraste dos textos, filtros e tabelas; a impressão conserva fundo claro. O Master escolhe o tema em Configurações → Visual → Tema, sem precisar reimportar arquivos. Refaça a comparação após importar novos arquivos."},
  {id:"import_error",label:"Erro de leitura ou totais divergentes",permission:"imports.manage",view:"imports",importTab:"point",chapter:"manual-import",answer:"Um arquivo sem texto reconhecível precisa ser exportado novamente da Senior. Em arquivos grandes, aguarde a leitura. Se a resposta do servidor for interrompida, confira o histórico antes de repetir uma confirmação. Se os dias não fecharem com o rodapé, confira os valores e o formato dos totais no PDF original; o sistema não inventa horas para liberar a importação."},
  {id:"two_punches",label:"Duas marcações podem gerar repousos?",permission:"reports.view",view:"reports",chapter:"manual-reports",answer:"Sim, duas batidas reais distintas podem delimitar a jornada, mesmo em escala de quatro marcações. O planejamento usa pausas de 20 minutos e mantém cada trecho contínuo em até 100 minutos, inclusive após a última pausa; o intervalo de refeição de pelo menos 20 minutos separa os trechos, sem ser registrado como pausa térmica. Intervalos menores não reiniciam a contagem; se o trabalho acumulado exceder 100 minutos, a ficha automática exige revisão. Todas as pausas necessárias aparecem, com continuação da ficha acima de quatro. Batidas iguais, relógios inválidos, mais de uma virada ou jornada de 24 horas ou mais exigem revisão. Falta, Atestado e Jornada Incompleta explícitos da Senior continuam preservados. Para rever a classificação de pontos antigos, reimporte e confirme o cartão após conferir a origem; para recalcular jornadas válidas já salvas, basta gerar as fichas novamente."},
  {id:"thermal_law",label:"Qual regra legal o repouso usa?",permission:"reports.view",view:"reports",chapter:"manual-reports",answer:"O planejamento usa a referência do art. 253 da CLT para trabalho abrangido pela proteção ao frio: 100 minutos de trabalho contínuo e 20 minutos de repouso, computados como tempo de serviço. A quantidade acompanha a jornada, sem limite fixo de quatro pausas; a impressão cria continuação quando necessário. As pausas calculadas não alteram Trabalho ou BH da Senior. O DP e a Segurança do Trabalho precisam confirmar o enquadramento da atividade, as condições de exposição, normas específicas e instrumentos coletivos aplicáveis. O cartão sozinho não fornece essas informações. Cálculo conferido significa que o planejamento passou nas verificações; não comprova pausas realizadas nem certifica cumprimento legal. Veja a referência oficial e os detalhes no Manual → Relatórios e impressão."},
  {id:"thermal_safety",label:"Como conferir o repouso térmico calculado",permission:"reports.view",view:"reports",chapter:"manual-reports",answer:"Em Relatórios, selecione colaborador e mês. Na Validação prévia, use Conferir cálculo do repouso: a conferência verifica duração de 20 minutos, encaixe na jornada, ordem, sobreposições e todos os trechos de até 100 minutos, incluindo o final. A geração fica bloqueada se o plano falhar ou se o colaborador não tiver dados de ponto na competência. Uma refeição inferior a 20 minutos não reinicia a contagem dos 100; quando o trabalho acumulado excede esse limite, o sistema pede revisão e preserva as marcações originais. A escala prevista não substitui marcações ausentes. Dias pendentes e cobertura parcial recebem avisos; os dias sem jornada utilizável ficam sem horários. Os campos Saída calculada e Retorno calculado representam planejamento e não comprovam pausas realizadas. Confira e registre a realização. Após atualizar, use Ctrl+F5 e gere novamente as fichas; reavalie as antigas antes de usar. Configurações → Repouso automático é exclusivo do Master para modo, autorizações e fonte; o cálculo permanece fixo em 100/20, sem variação aleatória nem teto diário de três/quatro pausas."},
  {id:"occurrence_print",label:"Totais e período do relatório de Ocorrências",permission:"reports.view",view:"manual",chapter:"manual-reports",answer:"O resumo, o cabeçalho dos gráficos e a tabela impressa devem usar os mesmos filtros e categorias. Um dia pode conter várias ocorrências; o total não é uma contagem de dias únicos. Confira a cobertura do mês e o aviso de relatório parcial. Ajustes do ponto são feitos na Senior e retornam por nova importação."},
  {id:"reports",label:"Gerar e imprimir fichas",permission:"reports.view",view:"reports",chapter:"manual-reports",answer:"Abra Relatórios, selecione empresa, filial, colaborador ou todos, turno se desejar e mês. Clique em Gerar ficha. O Repouso Térmico automático exige dados do próprio colaborador no Cartão de Ponto confirmado da competência e passa por conferência completa antes de imprimir. As pausas não são cortadas para caber: acima de quatro, a ficha recebe continuação. Horários calculados são planejamento e precisam de conferência da realização. Alterar filtros, configurações ou iniciar nova geração invalida as fichas anteriores. A ficha de Refeição mantém a assinatura manual e apresenta DSR, faltas, férias, atestados, folgas e demais ausências identificadas no ponto."},
  {id:"missing_report",label:"Colaborador não aparece ou não gera ficha",permission:"reports.view",view:"reports",chapter:"manual-reports",answer:"Confira se o colaborador está Ativo, pertence à empresa e filial selecionadas e estava admitido no mês. Se ele aparece mas não gera ficha, confira turno e a regra do cargo/função. Regras Pendentes ou “Não gerar” bloqueiam a ficha."},
  {id:"calendar",label:"Feriados e folgas",permission:"calendar.manage",view:"settings",chapter:"manual-settings",answer:"Abra Configurações → Feriados e folgas. Escolha o ano, gere os feriados e cadastre ajustes ou folgas individuais. Essas informações serão refletidas nas fichas."},
  {id:"settings",label:"Configurar cargos e o sistema",permission:"settings.view",view:"settings",chapter:"manual-settings",answer:"Abra Configurações e escolha a área disponível no seu perfil. Cargos novos importados ficam Pendentes até que a regra de relatórios seja conferida."},
  {id:"companies",label:"Empresas e filiais",permission:"admin",view:"companies",chapter:"manual-companies",answer:"Abra Empresas para cadastrar ou editar a empresa e suas filiais. Confira CNPJ, código interno e vínculos antes de inativar qualquer registro."},
  {id:"users",label:"Usuários e perfis",permission:"admin",view:"users",chapter:"manual-users",answer:"Abra Usuários para cadastrar acessos e vincular filiais. Em Configurações → Perfis de usuário, libere somente as funções necessárias. O conteúdo de ajuda seguirá essas permissões."},
  {id:"backup_history",label:"Backup do ponto, BH e acompanhamentos",permission:"admin",view:"settings",chapter:"manual-settings",answer:"Em Configurações → Backup e dados, gere um novo backup após atualizar. Ele preserva dias e marcações do ponto, valores de BH, acompanhamentos de revisão e relatórios de BH. Arquivos antigos sem esses históricos não conseguem recuperá-los: reimporte os PDFs originais e refaça acompanhamentos ausentes. Restaurar é exclusivo do Master, substitui os dados atuais e exige baixar primeiro um backup de segurança. Depois da restauração, confira os históricos e execute os testes do sistema."},
  {id:"night_mode",label:"Modo noturno e leitura das telas",permission:"",view:"manual",chapter:"manual-safety",answer:"O modo noturno usa contraste próprio nos textos, números, filtros, tabelas, listas e avisos de todos os módulos. Sucesso, atenção e bloqueio mantêm cores distintas. O Master escolhe Claro, Escuro ou Sistema em Configurações → Visual → Tema; os demais perfis usam a aparência definida. Não é necessário reimportar arquivos e os dados não mudam. A impressão das fichas e relatórios conserva o fundo claro para papel."},
  {id:"safety",label:"Duplicidade, readmissão ou erro",permission:"",view:"manual",chapter:"manual-safety",answer:"Compare sempre as matrículas. Matrículas diferentes podem indicar readmissão; matrícula igual pode ser duplicidade. Não exclua histórico válido e não confirme importações incompletas."}
];

let activeHelpTopic=null;
let activeHelpCategory=null;

const helpCategories=[
  {id:"overview",label:"Painel, acesso e segurança",topics:["access","dashboard","night_mode","safety"]},
  {id:"employees",label:"Colaboradores",topics:["employee_new","employee_find"]},
  {id:"teams",label:"Coordenadores e equipes",topics:["coordinator_new","coordinator_team"]},
  {id:"imports",label:"Importação Senior e turnos",topics:["timecard","import","shifts","cleanup","historical_dismissed","bh_import","period_compare","import_error"]},
  {id:"reports",label:"Relatórios e fichas",topics:["reports","thermal_safety","missing_report","two_punches","occurrence_print"]},
  {id:"settings",label:"Configurações e calendário",topics:["calendar","settings"]},
  {id:"admin",label:"Administração do sistema",topics:["companies","users","backup_history"]}
];

function allowedHelpTopics(){
  return helpTopics.filter(topic=>hasEffectivePermission(topic.permission));
}

function appendHelpMessage(text,type="bot"){
  const message=document.createElement("div");
  message.className=`help-message ${type}`;
  message.textContent=text;
  $("help-conversation").appendChild(message);
  $("help-conversation").scrollTop=$("help-conversation").scrollHeight;
}

function renderHelpStart(resetConversation=true){
  activeHelpTopic=null;
  activeHelpCategory=null;
  if(resetConversation){
    $("help-conversation").innerHTML="";
    appendHelpMessage(currentUser?.isMasterAdmin===true
      ?"Olá! Você está no suporte completo do Administrador Master. Em que posso ajudar?"
      :currentUser?.role==="ADMIN"
      ?"Olá! Preparei a ajuda para o perfil Administrador, respeitando as proteções do Master. Em que posso ajudar?"
      :`Olá! Preparei a ajuda de acordo com o perfil ${currentUser?.profileName||"do seu usuário"}. Em que posso ajudar?`);
  }
  const options=$("help-options");
  options.innerHTML="";
  const allowedIds=new Set(allowedHelpTopics().map(topic=>topic.id));
  helpCategories.filter(category=>category.topics.some(topicId=>allowedIds.has(topicId))).forEach(category=>{
    const button=document.createElement("button");
    button.type="button";
    button.className="help-option";
    button.textContent=category.label;
    button.onclick=()=>openHelpCategory(category.id,true);
    options.appendChild(button);
  });
  $("help-back").hidden=true;
  $("help-whatsapp").hidden=true;
}

function openHelpCategory(categoryId,addMessage=false){
  const allowedById=new Map(allowedHelpTopics().map(topic=>[topic.id,topic]));
  const category=helpCategories.find(item=>item.id===categoryId);
  if(!category)return;
  const topics=category.topics.map(topicId=>allowedById.get(topicId)).filter(Boolean);
  if(!topics.length)return;
  activeHelpCategory=category;
  activeHelpTopic=null;
  if(addMessage){
    appendHelpMessage(category.label,"user");
    appendHelpMessage("Certo. Qual é a sua dúvida nesse assunto?");
  }
  const options=$("help-options");
  options.innerHTML="";
  topics.forEach(topic=>{
    const button=document.createElement("button");
    button.type="button";
    button.className="help-option";
    button.textContent=topic.label;
    button.onclick=()=>openHelpTopic(topic.id);
    options.appendChild(button);
  });
  $("help-back").hidden=false;
  $("help-whatsapp").hidden=true;
}

function openHelpTopic(topicId){
  const topic=allowedHelpTopics().find(item=>item.id===topicId);
  if(!topic)return;
  activeHelpTopic=topic;
  appendHelpMessage(topic.label,"user");
  appendHelpMessage(topic.answer);
  const options=$("help-options");
  options.innerHTML="";
  const actions=[
    ["Ir para essa tela",async()=>{navigate(topic.view);if(topic.importTab&&typeof window.setImportModule==="function")await window.setImportModule(topic.importTab);}],
    ["Ver no Manual",()=>{navigate("manual");setTimeout(()=>$(topic.chapter)?.scrollIntoView({behavior:"smooth",block:"start"}),50);}],
    ["Minha dúvida foi resolvida",()=>{appendHelpMessage("Que bom! Se precisar, escolha outro assunto.");renderHelpStart(false);}],
    ["Ainda preciso de ajuda",()=>showHelpContact(topic)]
  ];
  actions.forEach(([label,handler])=>{
    const button=document.createElement("button");
    button.type="button";
    button.className="help-option";
    button.textContent=label;
    button.onclick=handler;
    options.appendChild(button);
  });
  $("help-back").hidden=false;
}

function showHelpContact(topic=activeHelpTopic){
  appendHelpMessage("Se a orientação não resolveu, escolha um dos canais de suporte disponíveis. Revise a mensagem antes de enviar.");
  if(visualSettings?.supportHours)appendHelpMessage(`Horário informado: ${visualSettings.supportHours}.`);
  $("help-options").innerHTML="";
  const whatsapp=String(visualSettings?.supportWhatsapp||"").replace(/\D/g,"");
  const email=String(visualSettings?.supportEmail||"").trim();
  $("help-whatsapp").hidden=!whatsapp;
  $("help-email").hidden=!email;
  if(!whatsapp&&!email){
    appendHelpMessage("O Administrador ainda não cadastrou WhatsApp ou e-mail de suporte. Consulte o responsável pelo sistema.");
  }
  $("help-back").hidden=false;
}

async function loadSupportUserContext(){
  if(!currentUser||!token)return;
  const identity=await api("/api/auth/me");
  currentUser={
    ...currentUser,
    companyName:identity?.company_name||null,
    branchNames:Array.isArray(identity?.branch_names)?identity.branch_names.filter(Boolean):[]
  };
  sessionStorage.setItem("user",JSON.stringify(currentUser));
}

function supportAccessIdentity(){
  const isAdmin=currentUser?.role==="ADMIN";
  const companyFromCache=companies.find(company=>String(company.id)===String(currentUser?.companyId));
  const company=currentUser?.companyName||companyFromCache?.trade_name||companyFromCache?.legal_name||
    (isAdmin?"Acesso administrativo geral":"Não identificada");
  const cachedBranches=Array.isArray(currentUser?.branchNames)?currentUser.branchNames.filter(Boolean):[];
  const branchIds=new Set((currentUser?.branchIds||[]).map(String));
  const branchesFromCache=branches
    .filter(branch=>branchIds.has(String(branch.id)))
    .map(branch=>branch.name)
    .filter(Boolean);
  const branchNames=cachedBranches.length?cachedBranches:branchesFromCache;
  return {
    company,
    branches:isAdmin?"Todas as filiais":(branchNames.join(", ")||"Não identificada")
  };
}

function supportSelectionPath(channel="WhatsApp"){
  return [
    activeHelpCategory?.label,
    activeHelpTopic?.label,
    "Ainda preciso de ajuda",
    channel==="E-mail"?"Enviar e-mail ao suporte":"Falar pelo WhatsApp"
  ].filter(Boolean);
}

function supportRequestDetails(channel="WhatsApp"){
  const profile=currentUser?.profileName||(currentUser?.role==="ADMIN"?"Administrador":currentUser?.role||"Usuário");
  const access=supportAccessIdentity();
  const selection=supportSelectionPath(channel);
  return {
    subject:`Ajuda no Controle Térmico — ${activeHelpTopic?.label||"Dúvida no sistema"}`,
    message:[
      `Olá${visualSettings?.supportName?`, ${visualSettings.supportName}`:""}! Meu nome é ${currentUser?.name||"Usuário"} e preciso de suporte no Controle Térmico.`,
      "",
      "Dados do acesso:",
      `Usuário: ${currentUser?.name||"Não identificado"}`,
      `Perfil: ${profile}`,
      `Empresa: ${access.company}`,
      `Filial: ${access.branches}`,
      "",
      "Opções selecionadas no Assistente:",
      ...selection.map((label,index)=>`${index+1}. ${label}`),
      "",
      `Assunto: ${activeHelpTopic?.label||"Dúvida no sistema"}`,
      `Versão: V1.0.26 Beta`,
      "",
      "Descreva aqui o que aconteceu: "
    ].join("\n")
  };
}

function prepareHelpAssistant(){
  if(!$("help-conversation").children.length)renderHelpStart(true);
}

const HELP_WIDGET_POSITION_KEY="controle_termico_help_position";
let helpDragState=null;

function helpWidgetCanDrag(){
  return window.innerWidth>650;
}

function clampHelpWidgetPosition(left,top){
  const widget=$("help");
  const margin=8;
  const width=widget?.offsetWidth||410;
  const height=widget?.offsetHeight||650;
  return {
    left:Math.min(Math.max(margin,left),Math.max(margin,window.innerWidth-width-margin)),
    top:Math.min(Math.max(margin,top),Math.max(margin,window.innerHeight-height-margin))
  };
}

function applyHelpWidgetPosition(position){
  const widget=$("help");
  if(!widget)return;
  if(!helpWidgetCanDrag()){
    widget.style.removeProperty("left");
    widget.style.removeProperty("top");
    widget.style.removeProperty("right");
    widget.style.removeProperty("bottom");
    return;
  }
  const left=Number(position?.left);
  const top=Number(position?.top);
  const next=clampHelpWidgetPosition(Number.isFinite(left)?left:20,Number.isFinite(top)?top:16);
  widget.style.left=`${next.left}px`;
  widget.style.top=`${next.top}px`;
  widget.style.right="auto";
  widget.style.bottom="auto";
}

function restoreHelpWidgetPosition(){
  if(!helpWidgetCanDrag())return applyHelpWidgetPosition(null);
  try{
    const saved=JSON.parse(localStorage.getItem(HELP_WIDGET_POSITION_KEY)||"null");
    if(Number.isFinite(saved?.left)&&Number.isFinite(saved?.top))applyHelpWidgetPosition(saved);
  }catch(error){}
}

function saveHelpWidgetPosition(){
  const widget=$("help");
  if(!widget||!helpWidgetCanDrag())return;
  const rect=widget.getBoundingClientRect();
  try{
    localStorage.setItem(HELP_WIDGET_POSITION_KEY,JSON.stringify({left:Math.round(rect.left),top:Math.round(rect.top)}));
  }catch(error){}
}

function openHelpWidget(){
  const widget=$("help");
  if(!widget)return;
  prepareHelpAssistant();
  widget.hidden=false;
  widget.classList.add("open");
  $("help-floating-launcher")?.classList.add("active");
  $("help-floating-launcher")?.setAttribute("aria-label","Fechar Assistente Virtual");
  restoreHelpWidgetPosition();
}

function closeHelpWidget(){
  const widget=$("help");
  if(!widget)return;
  widget.classList.remove("open");
  widget.hidden=true;
  $("help-floating-launcher")?.classList.remove("active");
  $("help-floating-launcher")?.setAttribute("aria-label","Abrir Assistente Virtual");
}

function toggleHelpWidget(){
  if($("help")?.hidden)openHelpWidget();
  else closeHelpWidget();
}

if($("help-floating-launcher"))$("help-floating-launcher").onclick=toggleHelpWidget;
if($("help-close"))$("help-close").onclick=closeHelpWidget;

const helpDragHandle=$("help-drag-handle");
if(helpDragHandle){
  helpDragHandle.addEventListener("pointerdown",event=>{
    if(!helpWidgetCanDrag()||event.button!==0||event.target.closest("button"))return;
    const widget=$("help");
    const rect=widget.getBoundingClientRect();
    helpDragState={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,left:rect.left,top:rect.top};
    widget.classList.add("dragging");
    widget.style.left=`${rect.left}px`;
    widget.style.top=`${rect.top}px`;
    widget.style.right="auto";
    widget.style.bottom="auto";
    helpDragHandle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  helpDragHandle.addEventListener("pointermove",event=>{
    if(!helpDragState||helpDragState.pointerId!==event.pointerId)return;
    const next=clampHelpWidgetPosition(
      helpDragState.left+event.clientX-helpDragState.startX,
      helpDragState.top+event.clientY-helpDragState.startY
    );
    $("help").style.left=`${next.left}px`;
    $("help").style.top=`${next.top}px`;
    event.preventDefault();
  });
  const finishHelpDrag=event=>{
    if(!helpDragState||helpDragState.pointerId!==event.pointerId)return;
    helpDragHandle.releasePointerCapture?.(event.pointerId);
    helpDragState=null;
    $("help")?.classList.remove("dragging");
    saveHelpWidgetPosition();
  };
  helpDragHandle.addEventListener("pointerup",finishHelpDrag);
  helpDragHandle.addEventListener("pointercancel",finishHelpDrag);
}

window.addEventListener("resize",()=>{
  if(!$("help")?.hidden){
    if(helpWidgetCanDrag())restoreHelpWidgetPosition();
    else applyHelpWidgetPosition(null);
  }
});

document.addEventListener("keydown",event=>{
  if(event.key==="Escape"&&!$("help")?.hidden)closeHelpWidget();
});

if($("help-restart"))$("help-restart").onclick=()=>renderHelpStart(true);
if($("help-back"))$("help-back").onclick=()=>{
  if(activeHelpTopic&&activeHelpCategory)openHelpCategory(activeHelpCategory.id,false);
  else renderHelpStart(false);
};
if($("help-whatsapp"))$("help-whatsapp").onclick=()=>{
  let whatsapp=String(visualSettings?.supportWhatsapp||"").replace(/\D/g,"");
  if(whatsapp.length===10||whatsapp.length===11)whatsapp=`55${whatsapp}`;
  if(!whatsapp){toast("WhatsApp de suporte não configurado.","warning");return;}
  const {message}=supportRequestDetails("WhatsApp");
  window.open(`https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`,"_blank","noopener,noreferrer");
};

if($("help-email"))$("help-email").onclick=()=>{
  const email=String(visualSettings?.supportEmail||"").trim().replace(/[\r\n?&#]/g,"");
  if(!email){toast("E-mail de suporte não configurado.","warning");return;}
  const {subject,message}=supportRequestDetails("E-mail");
  window.location.href=`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
};

if($("manual-expand-all")){
  $("manual-expand-all").onclick=()=>{
    const visibleChapters=Array.from(document.querySelectorAll(".manual-chapter:not([hidden])"));
    const shouldOpen=visibleChapters.some(chapter=>!chapter.open);
    visibleChapters.forEach(chapter=>chapter.open=shouldOpen);
    $("manual-expand-all").textContent=shouldOpen?"Fechar todos":"Abrir todos";
  };
}

function prepareManualForPrint(){
  document.querySelectorAll(".manual-chapter:not([hidden])").forEach(chapter=>chapter.open=true);
  document.body.classList.add("printing-manual");
}

function finishManualPrint(){
  document.body.classList.remove("printing-manual");
}

function escapeManualPrintHtml(value=""){
  return String(value)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

window.addEventListener("beforeprint",()=>{
  if($("manual")?.classList.contains("active"))prepareManualForPrint();
});
window.addEventListener("afterprint",finishManualPrint);

if($("manual-print")){
  $("manual-print").onclick=()=>{
    const printWindow=window.open("","_blank","width=1100,height=820");
    if(!printWindow){
      toast("O navegador bloqueou a janela de impressão. Permita pop-ups para este sistema.","error");
      return;
    }

    const source=$("manual-content").cloneNode(true);
    source.querySelector("#manual-no-results")?.remove();
    source.querySelectorAll(".manual-chapter[hidden]").forEach(chapter=>chapter.remove());
    source.querySelectorAll(".manual-chapter").forEach(chapter=>{
      chapter.open=true;
      chapter.removeAttribute("hidden");
    });

    const title=visualSettings?.systemName||"Controle Térmico";
    const printedAt=new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(new Date());
    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
      <html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Manual do Sistema — ${escapeManualPrintHtml(title)}</title>
      <style>
        @page{size:A4 portrait;margin:12mm}
        *{box-sizing:border-box}body{margin:0;background:#fff;color:#1f2937;font-family:Arial,sans-serif;font-size:12px;line-height:1.45}
        .print-actions{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 18px;background:#0e3554;color:#fff}
        .print-actions button{border:0;border-radius:8px;padding:9px 15px;background:#fff;color:#0e3554;font-weight:800;cursor:pointer}
        .print-cover{padding:24px;margin-bottom:12px;border-radius:14px;background:#0e3554;color:#fff}.print-cover h1{margin:0 0 6px;font-size:25px}.print-cover p{margin:0;color:#e6f1f8}
        .manual-content{display:block}.manual-no-results{display:none!important}.manual-chapter{display:block!important;margin:0 0 12px;border:1px solid #cfd8df;border-radius:11px;overflow:hidden;break-inside:auto;box-shadow:none}
        .manual-chapter summary{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#f4f8fb;border-bottom:1px solid #d9e0e7;list-style:none}.manual-chapter summary::-webkit-details-marker{display:none}.manual-chapter summary::after{display:none!important}
        .manual-chapter summary>span:last-child{display:grid;gap:2px}.manual-chapter summary strong{font-size:15px;color:#173a55}.manual-chapter summary small{color:#5f6b75}
        .manual-number{display:grid;place-items:center;min-width:30px;height:30px;border-radius:8px;background:#dcebf5;color:#154c79;font-weight:900}
        .manual-body{display:block!important;padding:13px 15px}.manual-body h4{margin:12px 0 4px;color:#0e3554}.manual-body p{margin:4px 0 8px}.manual-body li{margin-bottom:3px}
        .manual-note{margin-top:9px;padding:9px 11px;border-radius:7px;border-left:4px solid}.manual-note.info{background:#edf7ff;border-color:#1976a8}.manual-note.warning{background:#fff8e7;border-color:#d28b00}.manual-note.danger{background:#fff0f0;border-color:#bd2c2c}
        .manual-illustration,.manual-flow,.manual-mini-dashboard,.manual-permission-illustration,.manual-status-grid,.manual-import-types,.manual-settings-grid,.manual-record-card,.manual-shift-clock,.manual-report-preview,.manual-checklist{margin:0 0 10px;padding:11px;border:1px solid #d9e0e7;border-radius:8px;background:#f8fafc}
        .illustration-window{width:260px;max-width:100%;margin:auto;display:grid;gap:5px;padding:10px;background:#fff;border:1px solid #d9e0e7}.illustration-logo{display:grid;place-items:center;width:34px;height:34px;margin:auto;border-radius:8px;background:#0e3554;color:#fff;font-weight:900}.illustration-window i,.illustration-window b{padding:5px;border:1px solid #d9e0e7;font-style:normal}.illustration-window b{background:#154c79;color:#fff;text-align:center}
        .manual-flow,.manual-shift-clock{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap}.manual-flow span{padding:6px 9px;border:1px solid #bfcfd9;border-radius:6px;background:#fff;font-weight:800}.manual-flow i{font-style:normal}
        .manual-mini-dashboard,.manual-permission-illustration,.manual-status-grid,.manual-import-types,.manual-settings-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.manual-mini-dashboard span,.manual-permission-illustration span,.manual-status-grid span,.manual-import-types article,.manual-settings-grid article{display:grid;gap:2px;padding:7px;border:1px solid #d9e0e7;border-radius:6px;background:#fff}.manual-mini-dashboard b{font-size:18px}.manual-import-types span,.manual-settings-grid span{color:#5f6b75;font-size:10px}
        .manual-record-card{position:relative;display:grid}.manual-record-card span{color:#5f6b75}.manual-record-card em{position:absolute;right:10px;top:10px;color:#137333;font-weight:900;font-style:normal}.manual-shift-clock{background:#0e3554;color:#fff}.manual-shift-clock i{width:24px;height:2px;background:#79b6dd}
        .manual-report-preview{text-align:center}.manual-report-preview>*{display:block}.manual-report-preview i{height:14px;margin-top:4px;border:1px solid #aab3ba}.manual-checklist{display:grid;gap:3px;background:#edf8f1}.manual-checklist label{display:block}.manual-status-grid{grid-template-columns:repeat(4,1fr)}
        .print-footer{margin-top:14px;padding-top:8px;border-top:1px solid #d9e0e7;color:#6b7280;text-align:center;font-size:10px}
        @media print{.print-actions{display:none!important}.print-cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}.manual-chapter{break-inside:avoid}.manual-note,.manual-shift-clock{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style></head><body>
      <div class="print-actions"><strong>Pré-visualização do Manual</strong><button id="manual-print-action" type="button">Imprimir</button></div>
      <header class="print-cover"><h1>Manual do Sistema</h1><p>${escapeManualPrintHtml(title)} — instruções completas de utilização</p></header>
      ${source.outerHTML}
      <footer class="print-footer">Manual gerado em ${escapeManualPrintHtml(printedAt)}</footer>
      </body></html>`);
    printWindow.document.close();
  const manualPrintButton=printWindow.document.getElementById("manual-print-action");
  if(manualPrintButton)manualPrintButton.onclick=()=>printWindow.print();
    printWindow.focus();
    setTimeout(()=>printWindow.print(),350);
  };
}
