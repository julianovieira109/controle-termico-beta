const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/js/employees-imports.js'),'utf8');
const core=fs.readFileSync(require.resolve('../public/js/core.js'),'utf8');
const calendar=fs.readFileSync(require.resolve('../public/js/calendar-reports.js'),'utf8');

function functionCode(text,name){
  const start=text.indexOf(`function ${name}(`);
  const end=name==='renderPdfImportPreview'
    ?text.indexOf('\n$("pdf-import-confirm").onclick',start)
    :name==='renderPdfComparisonChecklist'
      ?text.indexOf('\nfunction applyImportResultsToChecklist(',start)
      :text.indexOf('\n}',start)+2;
  assert.ok(start>=0&&end>start,`Função disponível: ${name}`);
  return text.slice(start,end);
}

function preview(overrides={}){
  return {
    type:'ADMITIDOS',detectedType:'ADMITIDOS',readerUsed:'pdf-parse',fileName:'Admitidos.pdf',
    previewCompanyId:'company',previewBranchId:'branch',total:1,canConfirm:true,
    diagnostics:{unresolvedCount:0,criticalAssociationIssueCount:0,criticalAssociationIssues:[]},
    rows:[{registration:'11687',fullName:'Nome na Senior',admissionDate:'2026-10-01',jobTitle:'Aprendiz',pointCard:'',result:'ATUALIZAR',employeeId:'employee',currentName:'Nome antigo',currentAdmissionDate:'2026-09-01',currentJobTitle:'Cargo antigo',currentShift:'Turno preservado',hasShift:true,corrections:['nome','admissão','cargo/função']}],
    ...overrides
  };
}

function harness(data=preview(),{confirmed=true}={}){
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',hidden:false,disabled:false,checked:false,value:'',files:[]});
    return elements.get(id);
  };
  element('pdf-import-company').value=data.previewCompanyId;
  element('pdf-import-branch').value=data.previewBranchId;
  const checks=data.rows.map((_row,index)=>({checked:true,disabled:false,dataset:{importIndex:String(index)}}));
  const notices=[],requests=[],confirmations=[],alerts=[];
  const context={
    $:element,pdfImportPreview:data,pdfComparisonChecklist:null,
    document:{
      querySelector(selector){const match=selector.match(/^\[data-import-index="(\d+)"\]$/);return match?checks[Number(match[1])]:null;},
      querySelectorAll(selector){return selector==='#pdf-import-body .import-check'?checks:[];}
    },
    toast:(message,type)=>notices.push({message,type}),alert:message=>alerts.push(message),
    confirmAction:async(message,title)=>{confirmations.push({message,title});return confirmed;},
    api:async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});return {created:0,updated:1,unchanged:0,notFound:0,results:[]};},
    applyImportResultsToChecklist(){},loadPdfImportHistory:async()=>{},refreshImportRelatedViews:async()=>{}
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(functionCode(core,'escapeHtml'),context);
  vm.runInContext(functionCode(calendar,'formatApiDate'),context);
  for(const name of ['intelligentReaderCard','escapeChecklistHtml','checklistStatusLabel','renderPdfComparisonChecklist','pdfImportMatchesRegistration','pdfImportResultCode','pdfImportResultLabel','pdfImportBlockingIssues','pdfImportIntelligenceCard','renderPdfImportPreview']){
    vm.runInContext(functionCode(source,name),context);
  }
  const start=source.indexOf('$("pdf-import-confirm").onclick=async()=>{');
  const end=source.indexOf('\n$("pdf-import-clear").onclick=',start);
  vm.runInContext(source.slice(start,end),context);
  return {context,element,checks,notices,requests,confirmations,alerts,
    render(){context.renderPdfImportPreview();},
    confirm(){return element('pdf-import-confirm').onclick();}
  };
}

test('admitidos mostram dados atuais por matrícula e preservam turno já cadastrado',async()=>{
  const data=preview(),h=harness(data);
  h.render();
  const body=h.element('pdf-import-body').innerHTML;
  for(const text of ['Atualizar cadastro pela matrícula','Nome na Senior','No cadastro atual: Nome antigo','01/10/2026','No cadastro atual: 01/09/2026','No cadastro atual: Cargo antigo','Mantém o cadastrado','Turno preservado','Campos a atualizar: nome, admissão, cargo/função'])assert.ok(body.includes(text),text);
  assert.doesNotMatch(body,/POSSÍVEL READMISSÃO/);
  assert.match(h.element('pdf-import-detection').innerHTML,/<span>Cartões<\/span><strong>0<\/strong>/);
  await h.confirm();
  assert.equal(h.requests.length,1);
  const sent=h.requests[0].body;
  assert.equal(sent.rows[0].registration,'11687');
  assert.equal(sent.rows[0].admissionDate,'2026-10-01');
  assert.equal(sent.rows[0].currentAdmissionDate,'2026-09-01');
  assert.equal(sent.rows[0].currentShift,'Turno preservado');
  assert.equal(sent.rows[0].hasShift,true);
  assert.equal(sent.rows[0].pointCard,'');
  assert.deepEqual(sent.parsingDiagnostics,data.diagnostics);
  assert.ok(h.confirmations[0].message.includes('preservando empresa, filial e turno'));
});

test('mesma matrícula não vira readmissão porque o nome aparece em outro vínculo',()=>{
  const data=preview({possibleReadmissions:1});
  Object.assign(data.rows[0],{result:'POSSIVEL_READMISSAO',possibleReadmission:true,previousRegistration:'11734'});
  const h=harness(data);
  h.render();
  assert.match(h.element('pdf-import-body').innerHTML,/Atualizar cadastro pela matrícula/);
  assert.doesNotMatch(h.element('pdf-import-body').innerHTML,/POSSÍVEL READMISSÃO|NOVA MATRÍCULA/);
  assert.doesNotMatch(h.element('pdf-import-summary').textContent,/readmissão/);
});

test('cadastro igual é conferido e matrículas novas conservam os avisos de revisão',()=>{
  const row=preview().rows[0];
  const h=harness(preview({rows:[
    {...row,result:'CONFERIDO',corrections:[]},
    {registration:'11734',fullName:'Nome novo',result:'CONFERIR',hasShift:false},
    {registration:'11757',fullName:'Outra matrícula',result:'POSSIVEL_READMISSAO',previousRegistration:'99',hasShift:false},
    {registration:'11739',fullName:'Novo vínculo',result:'NOVO',hasShift:false}
  ],total:4}));
  h.render();
  const body=h.element('pdf-import-body').innerHTML;
  assert.match(body,/Cadastro conferido/);
  assert.match(body,/PRONTO PARA IMPORTAR/);
  assert.match(body,/POSSÍVEL READMISSÃO — NOVA MATRÍCULA \(anterior: 99\)/);
  assert.match(body,/NOVO/);
  assert.match(body,/Definir depois/);
  assert.match(h.element('pdf-import-summary').textContent,/1 possível/);
});

for(const blocked of [
  {canConfirm:false},
  {diagnostics:{unresolvedCount:1,unresolvedRegistrations:['11739']}},
  {diagnostics:{criticalAssociationIssueCount:1,criticalAssociationIssues:['Associação incompleta entre matrícula e nome.']}},
  {diagnostics:{criticalAssociationIssues:['Associação ambígua entre matrícula e admissão.']}}
]){
  test(`bloqueio de leitura impede confirmação mesmo por chamada direta: ${JSON.stringify(blocked)}`,async()=>{
    const h=harness(preview(blocked));
    h.render();
    assert.equal(h.element('pdf-import-confirm').disabled,true);
    assert.match(h.element('pdf-import-detection').innerHTML,/Confirmação bloqueada/);
    await h.confirm();
    assert.equal(h.requests.length,0);
    assert.equal(h.confirmations.length,0);
    assert.ok(h.notices.some(notice=>notice.type==='warning'));
  });
}

test('pendência crítica também bloqueia outros relatórios sem ampliar bloqueio só por contagem de colaboradores',async()=>{
  const blocked=harness(preview({type:'COLABORADORES',diagnostics:{criticalAssociationIssueCount:1}}));
  await blocked.confirm();
  assert.equal(blocked.requests.length,0);
  const existingFlow=harness(preview({type:'COLABORADORES',diagnostics:{unresolvedCount:1,unresolvedRegistrations:['missing']}}));
  existingFlow.render();
  assert.equal(existingFlow.element('pdf-import-confirm').disabled,false);
});

test('prévia com quatorze matrículas não muda as chaves nem os nomes ao confirmar',async()=>{
  const registrations=['11687','11734','11757','11739',...Array.from({length:10},(_,index)=>String(11800+index))];
  const rows=registrations.map((registration,index)=>({...preview().rows[0],registration,employeeId:`employee-${index}`,fullName:`Nome Senior ${index}`,currentName:`Nome antigo ${(index+1)%14}`}));
  const h=harness(preview({rows,total:14,diagnostics:{uniqueRegistrationCount:14,parsedCount:14,dateCount:14,pointCardCount:0,unresolvedCount:0}}));
  h.render();
  assert.equal((h.element('pdf-import-body').innerHTML.match(/data-import-index=/g)||[]).length,14);
  await h.confirm();
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].body.rows.length,14);
  for(const [index,row] of h.requests[0].body.rows.entries()){
    assert.equal(row.registration,registrations[index]);
    assert.equal(row.fullName,`Nome Senior ${index}`);
    assert.equal(row.employeeId,`employee-${index}`);
    assert.equal(row.currentShift,'Turno preservado');
  }
});

test('prévia escapa metadados do PDF, valores atuais e resultados antes de inserir HTML',()=>{
  const injection='\"><img src=x onerror=alert(1)>';
  const data=preview({
    detectedType:injection,readerUsed:'xref-repair'+injection,detectedCompany:injection,detectedBranch:injection,detectedOperationalBranch:injection,selectedBranchName:injection,
    intelligence:{level:injection,score:injection,suggestedAction:injection,signals:[injection]},
    diagnostics:{unresolvedCount:1,unresolvedRegistrations:[injection],criticalAssociationIssueCount:1,criticalAssociationIssues:[injection],parsedCount:injection},
    comparisonChecklist:{seniorTotal:injection,systemActiveTotal:injection,items:[{origin:'SENIOR',registration:injection,fullName:injection,status:injection,details:injection}]}
  });
  Object.assign(data.rows[0],{registration:injection,fullName:injection,currentName:injection,jobTitle:injection,currentJobTitle:injection,currentShift:injection,corrections:[injection],pointCard:injection,result:injection});
  const h=harness(data);
  h.render();
  for(const id of ['pdf-import-detection','pdf-import-body','pdf-checklist-body','pdf-checklist-summary']){
    assert.doesNotMatch(h.element(id).innerHTML,/<img|<script/i,id);
    assert.match(h.element(id).innerHTML,/&lt;img/,id);
  }
});
