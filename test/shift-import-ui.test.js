const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ShiftSchedule=require('../public/js/shift-schedule');
const source=fs.readFileSync(require.resolve('../public/js/settings-system.js'),'utf8');
const core=fs.readFileSync(require.resolve('../public/js/core.js'),'utf8');

function functionCode(text,name){
  const start=text.indexOf(`function ${name}(`);
  const end=name==='renderShiftImportPreview'
    ?text.indexOf('\nif($("open-shift-import"))',start)
    :text.indexOf('\n}',start)+2;
  assert.ok(start>=0&&end>start,`Função disponível: ${name}`);
  return text.slice(start,end);
}

function preview(overrides={}){
  return {
    companyId:'company',branchId:'branch',fileName:'Escala.pdf',total:1,
    diagnostics:{unresolvedCount:0,unresolvedRegistrations:[]},
    unknownCodes:[],
    newShiftProposals:[{code:'0009',displayCode:'0009',suggestedName:'Aprendiz',description:'14:00-18:00',canCreate:true}],
    rows:[{registration:'123',employeeId:'employee',shiftCode:'0009',result:'CODIGO_NAO_CONFIGURADO',nameMatches:true,pdfName:'Colaborador'}],
    ...overrides
  };
}

function harness(data=preview(),{role='ADMIN',confirmed=true}={}){
  const elements=new Map();
  function element(id){
    if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',hidden:false,checked:false,disabled:false,value:'',focus(){this.focused=true;}});
    return elements.get(id);
  }
  element('shift-import-company').value=data.companyId;
  element('shift-import-branch').value=data.branchId;
  const fields=data.newShiftProposals.map((proposal,index)=>({
    name:{value:proposal.suggestedName||'',dataset:{newShiftName:String(index)}},
    description:{value:proposal.description||'',dataset:{newShiftDescription:String(index)},focus(){this.focused=true;}},
    select:{checked:false,dataset:{newShiftSelect:String(index)}}
  }));
  const rowChecks=data.rows.map((_row,index)=>({checked:false,dataset:{shiftImportIndex:String(index)}}));
  const notices=[],requests=[],confirmations=[];
  const context={
    $:element,ShiftSchedule,currentUser:{role},shiftImportPreview:data,unknownSeniorCodes:[],
    document:{
      querySelector(selector){
        const match=selector.match(/^\[data-(new-shift-name|new-shift-description|new-shift-select|shift-import-index)="(\d+)"\]$/);
        if(!match)return null;
        const index=Number(match[2]);
        if(match[1]==='shift-import-index')return rowChecks[index];
        return fields[index]?.[{'new-shift-name':'name','new-shift-description':'description','new-shift-select':'select'}[match[1]]];
      },
      querySelectorAll(selector){
        if(selector==='.shift-import-check')return rowChecks;
        if(selector==='[data-new-shift-description]')return fields.map(field=>field.description);
        return [];
      }
    },
    toast:(message,type)=>notices.push({message,type}),
    confirmAction:async(message,title)=>{confirmations.push({message,title});return confirmed;},
    api:async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});return {message:'Concluído'};},
    setButtonLoading(){},refreshImportRelatedViews:async()=>{},
    clearShiftImport(){context.cleared=true;},renderUnknownSeniorCodes(){},
    intelligentReaderCard:i=>i?`<div>${i.score} ${i.level} ${i.suggestedAction} ${(i.signals||[]).join(' ')}</div>`:''
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(functionCode(core,'escapeHtml'),context);
  for(const name of ['shiftImportCode','shiftImportProposalIssue','shiftImportIntelligenceCard','renderShiftImportPreview']){
    vm.runInContext(functionCode(source,name),context);
  }
  const start=source.indexOf('if($("shift-import-confirm")){');
  const end=source.indexOf('\nfunction renderUnknownSeniorCodes(',start);
  assert.ok(start>=0&&end>start);
  vm.runInContext(source.slice(start,end),context);
  return {context,elements,element,fields,rowChecks,notices,requests,confirmations,
    render(){context.renderShiftImportPreview(data);},
    confirm(){return element('shift-import-confirm').onclick();}
  };
}

for(const description of ['14:00-18:00','08:00-12:00','22:00-02:00','08:00-12:00-13:00-17:00','08:00-10:00-10:15-12:00']){
  test(`confirma cadastro de turno com horários completos: ${description}`,async()=>{
    const data=preview();
    data.newShiftProposals[0].description=description;
    const h=harness(data);
    h.fields[0].select.checked=true;
    await h.confirm();
    assert.equal(h.confirmations.length,1);
    assert.equal(h.requests.length,1);
    assert.equal(h.requests[0].path,'/api/imports/shift-confirm');
    assert.equal(h.requests[0].body.newShifts[0].description,ShiftSchedule.validateDescription(description).description);
    assert.equal(h.requests[0].body.newShifts[0].code,'9');
    assert.equal(h.requests[0].body.rows[0].selected,true);
  });
}

test('turno novo exige seleção explícita e confirmação do diálogo',async()=>{
  const untouched=harness();
  await untouched.confirm();
  assert.equal(untouched.confirmations.length,0);
  assert.equal(untouched.requests.length,0);
  const cancelled=harness(preview(),{confirmed:false});
  cancelled.fields[0].select.checked=true;
  await cancelled.confirm();
  assert.equal(cancelled.confirmations.length,1);
  assert.equal(cancelled.requests.length,0);
});

for(const description of ['08:00-12:00-13:00','08:00-12:00-13:00-17:00-18:00','08:00-08:00','08:00-12:00-12:00-17:00','25:00-18:00','22:00-02:00-01:00-03:00']){
  test(`não envia proposta com marcações ambíguas ou inválidas: ${description}`,async()=>{
    const data=preview();
    data.newShiftProposals[0].description=description;
    const h=harness(data);
    h.fields[0].select.checked=true;
    await h.confirm();
    assert.equal(h.requests.length,0);
    assert.equal(h.confirmations.length,0);
    assert.ok(h.notices.some(notice=>notice.type==='warning'));
    assert.equal(h.fields[0].description.focused,true);
  });
}

for(const rawDescription of ['08:0012PRE13:30PRE18:00 SEG A SEX','08:00-12PRE-13:PRE-17:00']){
  test(`PRE reconhecido cadastra descrição original sem completar minutos: ${rawDescription}`,async()=>{
    const data=preview();
    Object.assign(data.newShiftProposals[0],{code:'0001',canCreate:true,description:rawDescription,rawDescription,preserveSource:true,scheduleNeedsReview:true});
    data.rows[0].shiftCode='0001';
    const h=harness(data);
    h.render();
    assert.match(h.element('shift-new-proposals').innerHTML,/Cadastrar com a descrição original da Senior/);
    assert.match(h.element('shift-new-proposals').innerHTML,/Horários abreviados não serão completados automaticamente/);
    h.fields[0].select.checked=true;
    await h.confirm();
    assert.equal(h.requests.length,1);
    const proposal=h.requests[0].body.newShifts[0];
    assert.equal(proposal.description,rawDescription);
    assert.equal(proposal.rawDescription,rawDescription);
    assert.equal(proposal.preserveSource,true);
    assert.equal(proposal.scheduleNeedsReview,true);
    assert.equal(h.requests[0].body.rows[0].selected,true);
  });
}

test('PRE preservado continua permitindo correção manual explícita com horários completos',async()=>{
  const data=preview();
  Object.assign(data.newShiftProposals[0],{code:'0001',canCreate:true,description:'08:00-12PRE-13:PRE-17:00',rawDescription:'08:00-12PRE-13:PRE-17:00',reason:'Minutos omitidos no PDF: confira a fonte.'});
  data.rows[0].shiftCode='0001';
  const h=harness(data);
  h.render();
  assert.match(h.element('shift-new-proposals').innerHTML,/Horário no PDF/);
  assert.match(h.element('shift-new-proposals').innerHTML,/13:PRE/);
  assert.doesNotMatch(h.element('shift-new-proposals').innerHTML,/Informe manualmente os 4 horários/);
  h.fields[0].description.value='08:00-12:00-13:30-17:00';
  h.fields[0].select.checked=true;
  await h.confirm();
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].body.newShifts[0].description,'08:00-12:00-13:30-17:00');
  assert.equal(h.requests[0].body.newShifts[0].preserveSource,false);
  assert.equal(h.requests[0].body.newShifts[0].scheduleNeedsReview,false);
});

test('descrição PRE alterada não é aprovada como cópia literal da fonte',async()=>{
  const data=preview();
  Object.assign(data.newShiftProposals[0],{description:'08:00-12PRE-13:PRE-17:00',rawDescription:'08:00-12PRE-13:PRE-17:00'});
  const h=harness(data);
  h.fields[0].description.value='08:00-12PRE-14:PRE-17:00';
  h.fields[0].select.checked=true;
  await h.confirm();
  assert.equal(h.requests.length,0);
  assert.equal(h.confirmations.length,0);
  assert.equal(h.fields[0].description.focused,true);
});

test('perfil sem Administração não cadastra turno mesmo com seleção manipulada',async()=>{
  const h=harness(preview(),{role:'RH'});
  h.fields[0].select.checked=true;
  await h.confirm();
  assert.equal(h.requests.length,0);
  assert.equal(h.confirmations.length,0);
  assert.ok(h.notices.some(notice=>notice.message.includes('Somente o Administrador')));
});

test('códigos inválidos e propostas duplicadas exigem revisão',async()=>{
  for(const proposals of [
    [{code:'9" onfocus="alert(1)',description:'08:00-12:00',suggestedName:'Teste'}],
    [{code:'0009',description:'08:00-12:00',suggestedName:'A'},{code:'9',description:'14:00-18:00',suggestedName:'B'}]
  ]){
    const h=harness(preview({newShiftProposals:proposals}));
    h.fields[0].select.checked=true;
    await h.confirm();
    assert.equal(h.requests.length,0);
    assert.equal(h.confirmations.length,0);
    assert.ok(h.notices.some(notice=>/inválido|mais de uma proposta/.test(notice.message)));
  }
});

test('trocar empresa ou filial depois da leitura impede usar a prévia anterior',async()=>{
  const h=harness();
  h.fields[0].select.checked=true;
  h.element('shift-import-branch').value='other-branch';
  await h.confirm();
  assert.equal(h.requests.length,0);
  assert.ok(h.notices.some(notice=>notice.message.includes('Leia o PDF novamente')));
});

test('prévia escapa os valores externos de propostas, linhas e diagnóstico',()=>{
  const injection='\"><img src=x onerror=alert(1)>';
  const data=preview({
    intelligence:{score:injection,level:injection,suggestedAction:injection,signals:[injection]},
    diagnostics:{unresolvedCount:1,unresolvedRegistrations:[injection]},
    newShiftProposals:[{code:injection,displayCode:injection,suggestedName:injection,description:injection,rawDescription:injection,reason:injection}],
    rows:[{registration:injection,pdfName:injection,effectiveDate:injection,fullName:injection,rawShiftCode:injection,shiftCode:injection,targetShiftName:injection,currentShift:injection,result:injection}]
  });
  const h=harness(data);
  h.render();
  for(const id of ['shift-new-proposals','shift-import-body','shift-import-feedback','shift-import-summary']){
    assert.doesNotMatch(h.element(id).innerHTML,/<img|<script/i,id);
    assert.match(h.element(id).innerHTML,/&lt;img/,id);
  }
  assert.equal(h.element('shift-import-confirm').disabled,true);
  assert.match(h.element('shift-new-proposals').innerHTML,/data-new-shift-select="0" disabled/);
});
