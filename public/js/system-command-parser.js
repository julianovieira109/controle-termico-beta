(function(root,factory){
  const commands=factory();
  if(typeof module==="object"&&module.exports)module.exports=commands;
  else root.SystemCommands=commands;
})(typeof window==="object"?window:globalThis,function(){
  "use strict";
  const normalize=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
  const tasks=[
    {id:"create",label:"Cadastrar colaborador",example:"Adicionar um novo colaborador",permissions:["employees.view","employees.manage"]},
    {id:"dismiss",label:"Registrar demissão",example:"O colaborador foi demitido",permissions:["employees.view","employees.manage"]},
    {id:"status",label:"Alterar situação",example:"Afastar um colaborador",permissions:["employees.view","employees.manage"]},
    {id:"lookup",label:"Consultar cadastro",example:"Consultar um colaborador",permissions:["employees.view"]},
    {id:"thermal",label:"Relatório de repouso térmico",example:"Imprimir repouso térmico",permissions:["reports.view"]},
    {id:"meal",label:"Ficha de refeição",example:"Gerar ficha de refeição",permissions:["reports.view"]},
    {id:"bh",label:"Consultar banco de horas",example:"BH de um colaborador",permissions:["dashboard.view"],occurrences:true},
    {id:"intervals",label:"Relação de intervalos",example:"Mostrar relação de intervalos",permissions:["dashboard.view"],occurrences:true},
    {id:"critical",label:"Colaboradores críticos",example:"Quem está mais crítico?",permissions:["dashboard.view"],occurrences:true},
    {id:"imports",label:"Importar arquivos",example:"Importar cartão de ponto",permissions:["imports.manage"]},
    {id:"shifts",label:"Cargos e turnos",example:"Abrir cadastro de turnos",permissions:[],admin:true},
    {id:"calendar",label:"Feriados e folgas",example:"Cadastrar um feriado",permissions:["calendar.manage"]}
  ];
  function permitted(task,user){
    if(!user)return false;
    if(task.admin&&user.role!=="ADMIN")return false;
    if(task.occurrences&&!(user.role==="ADMIN"&&(user.isMasterAdmin||user.permissions?.["occurrences.view"]===true)))return false;
    return user.role==="ADMIN"||task.permissions.every(key=>user.permissions?.[key]===true);
  }
  function localDate(now=new Date()){
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
    return ["year","month","day"].map(type=>parts.find(part=>part.type===type).value).join("-");
  }
  function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>=1900&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
  function date(value,today=localDate()){
    const text=normalize(value);
    if(/\bhoje\b/.test(text))return today;
    if(/\bontem\b/.test(text))return new Date(Date.parse(today)-86400000).toISOString().slice(0,10);
    const br=text.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/);
    const iso=text.match(/\b\d{4}-\d{2}-\d{2}\b/);
    const result=br?`${br[3]}-${br[2].padStart(2,"0")}-${br[1].padStart(2,"0")}`:iso?.[0];
    return result&&validDate(result)?result:null;
  }
  function month(value,today=localDate()){
    const text=normalize(value);
    if(/\b(?:mes|competencia) atual\b/.test(text))return today.slice(0,7);
    let match=text.match(/\b(20\d{2}|2100)-(0[1-9]|1[0-2])\b/);
    if(match)return `${match[1]}-${match[2]}`;
    match=text.match(/(?:^|\s)(0?[1-9]|1[0-2])\/(20\d{2}|2100)(?=$|\s|[.,!?])/);
    if(match)return `${match[2]}-${match[1].padStart(2,"0")}`;
    const names=["janeiro","fevereiro","marco","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
    match=text.match(new RegExp(`\\b(${names.join("|")})(?: de)? (20\\d{2}|2100)\\b`));
    return match?`${match[2]}-${String(names.indexOf(match[1])+1).padStart(2,"0")}`:null;
  }
  function near(a,b){
    if(Math.abs(a.length-b.length)>1)return false;
    let i=0,j=0,diffs=0;
    while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++diffs>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}
    return diffs+(i<a.length||j<b.length?1:0)<=1;
  }
  const vocabulary=["demitido","demissao","colaborador","cadastrar","adicionar","intervalos","repouso","termico","relatorio","criticos","consultar","afastar","inativar","reativar"];
  function intentText(value){return normalize(value).split(/\s+/).map(word=>{
    if(word.length<6||vocabulary.includes(word))return word;
    const candidates=vocabulary.filter(term=>near(term,word));return candidates.length===1?candidates[0]:word;
  }).join(" ");}
  function interpret(value,today=localDate()){
    const raw=String(value||"").trim();const text=intentText(raw);
    if(/^(cancelar|cancela|pare|parar|nao|desistir|esquece)[.!]?$/.test(text))return {intent:"cancel"};
    if(/\bnao\b.*\b(demit|cadastr|adicion|salv|alter|exclu)/.test(text))return {intent:"unknown",negated:true};
    if(/^(ajuda|menu|sugestoes|o que (voce )?(faz|pode fazer))[?! .]*$/.test(text))return {intent:"help"};
    const found=[];
    if(/\b(?:demitir|demita|demitido|demitida|demissao|desligar|desligado|rescisao)\b/.test(text)||/\b(?:colaborador|funcionario)\b.*\bsaiu\b/.test(text)||/^(?:o|a) .+ saiu(?: hoje| ontem)?[.!]?$/.test(text))found.push("dismiss");
    if(/\b(?:afastar|afastado|afastada|inativar|inativo|inativa|reativar|ativo|ativa)\b/.test(text)&&!found.length)found.push("status");
    if(/\b(?:novo|nova|cadastrar|cadastre|adicionar|adicione|incluir|inclua|admitir|admissao)\b/.test(text)&&/\b(?:colaborador|colaboradora|funcionario|funcionaria|empregado|cadastro)\b/.test(text))found.push("create");
    if(/\b(?:repouso|termico|termica)\b/.test(text))found.push("thermal");
    if(/\b(?:critico|critica|criticos|criticas|prioritarios|prioritarias|prioridade|ranking)\b/.test(text))found.push("critical");
    if(/\b(?:intervalo|intervalos|intrajornada)\b/.test(text)&&!found.includes("critical"))found.push("intervals");
    if(/\bbh\b|banco de horas|saldo de horas/.test(text)&&!found.includes("critical"))found.push("bh");
    if(/\brefeicao\b/.test(text)&&!found.includes("intervals"))found.push("meal");
    if(/\bimportar|\bimportacao|\bimportacoes|\bcarregar pdf|\bler pdf/.test(text))found.push("imports");
    if(/\b(?:cadastrar|cadastro|abrir|editar)\b.*\b(?:turno|turnos|cargo|cargos)\b/.test(text))found.push("shifts");
    if(/\b(?:feriado|feriados|folga|folgas)\b/.test(text))found.push("calendar");
    if(!found.length&&/\b(?:consultar|consulte|buscar|busque|localizar|cadastro|dados)\b/.test(text)&&/\b(?:colaborador|funcionario|matricula|cadastro)\b/.test(text))found.push("lookup");
    const unique=[...new Set(found)];
    if(unique.length!==1)return {intent:"unknown",candidates:unique};
    const intent=unique[0];
    const registration=raw.match(/\bmatr[ií]cula\s*[:#]?\s*(\d+)\b/i)?.[1]||raw.match(/(?:^|\s)(\d{5,})(?=\s|$|[.,!?])/)?.[1];
    let search=registration||null;
    // Extração conservadora: nomes ambíguos continuam sendo perguntados no diálogo.
    if(!search){
      let match;
      if(intent==="dismiss")match=raw.match(/^(?:demitir|demita|desligar)\s+(?:o |a )?(.+?)(?:\s+(?:em|dia|hoje|ontem)\b|$)/i)||raw.match(/^(?:o |a )?(?:colaborador[a]?|funcion[aá]ri[oa])\s+(.+?)\s+(?:foi|pediu|saiu)/i)||raw.match(/^(?:o |a )?(.+?)\s+(?:foi demitid[oa]|pediu demiss[aã]o|saiu)(?:\s|$)/i);
      if(intent==="bh")match=raw.match(/(?:\bbh\b|banco de horas|saldo de horas)\s+(?:d[oa] |de )?(.+?)(?:\s+(?:em|compet[eê]ncia|mes|m[eê]s|janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|\d{1,2}\/\d{4}|20\d{2}-\d{2})\b|$)/i);
      if(match&&!/^(?:um|uma|o|a|colaborador|colaboradora|funcionario|funcionário|todos|todas)(?:\s|$)/i.test(match[1]))search=match[1].replace(/[.!?]$/,"").trim();
    }
    return {intent,search,date:date(raw,today),month:month(raw,today),status:intent==="dismiss"?"DEMITIDO":/\b(?:afastar|afastado|afastada)\b/.test(text)?"AFASTADO":/\b(?:inativar|inativo|inativa)\b/.test(text)?"INATIVO":/\b(?:reativar|ativo|ativa)\b/.test(text)?"ATIVO":null};
  }
  function matchingOptions(value,options){
    const text=normalize(value);
    const index=text.match(/^#?(\d+)$/);
    // Matrículas têm prioridade sobre a numeração das opções.
    const exact=options.filter(option=>normalize(option.label)===text||option.registration&&String(option.registration).replace(/^0+/,"")===text.replace(/^0+/,""));
    if(exact.length)return exact;
    if(index&&Number(index[1])>=1&&Number(index[1])<=options.length)return [options[Number(index[1])-1]];
    return options.filter(option=>normalize(option.label).includes(text));
  }
  return {normalize,tasks,permitted,localDate,validDate,date,month,interpret,matchingOptions};
});
