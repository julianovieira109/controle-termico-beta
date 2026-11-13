const test=require("node:test");
const assert=require("node:assert/strict");
const C=require("../public/js/system-command-parser");
test("reconhece variações de tarefas sem IA externa",()=>{
  for(const [intent,examples] of Object.entries({
    create:["Preciso cadastrar um novo colaborador","adicione uma funcionária","adcionar novo colaboador"],
    dismiss:["O João saiu","Demita João em 13/11/2026","o colaborador foi demitdo","Maria pediu demissão hoje"],
    thermal:["Imprimir repouso térmico","preciso do relatório termico","ficha de repouso"],
    bh:["BH do João","qual o banco de horas de Maria?","saldo de horas"],
    intervals:["relação de intervalos","mostrar intrajornada"],
    critical:["quem está mais crítico?","ranking de intervalos críticos"],
    status:["afastar colaborador","reativar funcionária","alterar situação para inativo"],
    lookup:["consultar cadastro","buscar colaborador"],
    meal:["imprimir ficha de refeição"],imports:["importar cartão de ponto"],shifts:["cadastro de turnos"],calendar:["cadastrar feriado"]
  }))for(const example of examples)assert.equal(C.interpret(example).intent,intent,example);
});
test("não executa pedidos negativos, alheios ao sistema ou com múltiplas tarefas",()=>{
  assert.equal(C.interpret("Não demita João").negated,true);
  assert.equal(C.interpret("qual é a capital do Brasil?").intent,"unknown");
  assert.equal(C.interpret("cadastrar colaborador e imprimir repouso").intent,"unknown");
  assert.deepEqual(C.interpret("cancelar"),{intent:"cancel"});assert.equal(C.interpret("ajuda").intent,"help");
});
test("extrai somente dados identificáveis, preservando matrícula e acentos do nome",()=>{
  const dismiss=C.interpret("Demita matrícula 000011447 em 13/11/2026");
  assert.equal(dismiss.search,"000011447");assert.equal(dismiss.date,"2026-11-13");assert.equal(dismiss.status,"DEMITIDO");
  assert.equal(C.interpret("O João saiu").search,"João");
  const bh=C.interpret("BH do João novembro de 2026");assert.equal(bh.search,"João");assert.equal(bh.month,"2026-11");
  assert.equal(C.interpret("BH de um colaborador").search,null);
});
test("competências, datas e hoje usam formatos e calendário válidos",()=>{
  for(const value of ["11/2026","2026-11","novembro de 2026"])assert.equal(C.month(value),"2026-11");
  for(const value of ["13/2026","novembro","2026-00","11/2101","31/11/2026"])assert.equal(C.month(value),null,value);
  assert.equal(C.date("31/02/2026"),null);assert.equal(C.date("29/02/2028"),"2028-02-29");
  assert.equal(C.date("ontem","2026-03-01"),"2026-02-28");
  assert.equal(C.localDate(new Date("2026-11-14T01:00:00Z")),"2026-11-13");
});
test("opções não confundem matrículas com índices nem selecionam homônimos",()=>{
  const rows=[{value:"old",label:"JOÃO · matrícula 0001",registration:"0001"},{value:"new",label:"JOÃO · matrícula 0002",registration:"0002"}];
  assert.equal(C.matchingOptions("João",rows).length,2);
  assert.equal(C.matchingOptions("0002",rows)[0].value,"new");
  assert.equal(C.matchingOptions("#1",rows)[0].value,"old");
});
test("sugestões seguem as permissões e a restrição do Controle de Ocorrências",()=>{
  const user={role:"RH",permissions:{"employees.view":true}};
  assert.equal(C.permitted(C.tasks.find(t=>t.id==="lookup"),user),true);
  assert.equal(C.permitted(C.tasks.find(t=>t.id==="dismiss"),user),false);
  assert.equal(C.permitted(C.tasks.find(t=>t.id==="bh"),{role:"RH",permissions:{"dashboard.view":true,"occurrences.view":true}}),false);
  assert.equal(C.permitted(C.tasks.find(t=>t.id==="bh"),{role:"ADMIN",isMasterAdmin:true}),true);
});
