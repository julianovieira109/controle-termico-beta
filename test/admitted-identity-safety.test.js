const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {parseAdmittedText,pageAdmissions}=require('../src/importers/admitted-reader');

function item(x,y,text){return {x,y,R:[{T:encodeURIComponent(text)}]};}
function page(data,{total=null,omitHeader=null}={}){
  const texts=[item(1,1,'Relação de Admitidos')];
  const headers=[['Cadastro',1.155],['Nome',4.17],['Admissão',15.15],['Cargo',18.525],['Cartão Ponto',28.44],['Filial',32.685]];
  texts.push(...headers.filter(([label])=>label!==omitHeader).map(([label,x])=>item(x,2,label)));
  data.forEach((row,index)=>{
    const y=4+index;
    // A ordem interna dos objetos imita o Universal Printer: a matrícula e o
    // código do cargo vêm depois do nome/cargo na serialização do PDF.
    texts.push(item(4.17,y,row.name),item(15.15,y,row.date||'09/10/2026'),item(20.325,y,' -'),item(20.895,y,row.role||'CARREGADOR'),item(1.155,y,row.registration),item(18.435,y,row.jobCode||'000086'));
    if(row.card)texts.push(item(28.5,y,row.card));
    if(row.branch!==false)texts.push(item(32.52,y,row.branch||'0002'));
  });
  if(total!==null)texts.push(item(1,20,`Total Total Empresa ${String(total).padStart(5,'0')}`));
  texts.push(item(1,22,'FPRE004.COL - 29/10/2026 - 22:59:46'));
  return {Texts:texts};
}
function readerWithPages(pages){
  const filename=path.resolve('src/importers/admitted-reader.js'),mod=new Module(filename,module);
  mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  mod.require=function(name){
    if(name==='./senior-pdf-text')return {readSeniorPdfPages:async(_buffer,callback)=>{for(const value of pages)await callback(value);}};
    return Module.prototype.require.call(this,name);
  };
  mod._compile(fs.readFileSync(filename,'utf8'),filename);
  return mod.exports;
}
const first={registration:'000000111',name:'TESTE PRIMEIRO',date:'09/10/2026'};
const second={registration:'000000222',name:'TESTE SEGUNDO',date:'21/10/2026',jobCode:'000074',role:'AUX. DE EXPEDICAO'};

test('coordenadas mantêm matrícula/nome/data/cargo na mesma linha apesar da ordem dos objetos',async()=>{
  const result=await readerWithPages([page([first,second],{total:2})]).readAdmittedPdf(Buffer.from('adapter'));
  assert.equal(result.recognized,true);
  assert.equal(result.diagnostics.complete,true);
  assert.equal(result.diagnostics.sourceRows,2);
  assert.equal(result.diagnostics.expectedTotal,2);
  assert.deepEqual(result.rows.map(row=>[row.registration,row.fullName,row.admissionDate,row.jobCode,row.jobTitle]),[
    ['000000111','TESTE PRIMEIRO','2026-10-09','000086','CARREGADOR'],
    ['000000222','TESTE SEGUNDO','2026-10-21','000074','AUX. DE EXPEDICAO']
  ]);
  assert.ok(result.rows.every(row=>row.identitySource==='PDF_COORDINATES'));
});

test('0002 na coluna Filial não vira nome nem cartão de ponto ausente',()=>{
  const result=pageAdmissions(page([first]),1);
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].fullName,'TESTE PRIMEIRO');
  assert.equal(result.rows[0].pointCard,'');
  assert.equal(result.rows[0].branchCode,'0002');
  const withCard=pageAdmissions(page([{...first,card:'7777'}]),1);
  assert.equal(withCard.rows[0].pointCard,'7777');
  assert.equal(withCard.rows[0].branchCode,'0002');
});

test('quatorze linhas mantêm a própria identidade e o último registro com objetos fora de ordem',async()=>{
  const input=Array.from({length:14},(_,index)=>({registration:'000000'+String(101+index),name:'PESSOA TESTE '+String.fromCharCode(65+index)}));
  const original=page(input,{total:14});original.Texts.reverse();
  const result=await readerWithPages([original]).readAdmittedPdf(Buffer.from('adapter'));
  assert.equal(result.diagnostics.complete,true);assert.equal(result.rows.length,14);
  assert.deepEqual(result.rows.map(row=>[row.registration,row.fullName]),input.map(row=>[row.registration,row.name]));
  assert.ok(result.rows.every(row=>row.pointCard===''&&row.branchCode==='0002'&&row.jobCode==='000086'));
});

test('páginas com as mesmas posições Y não misturam registros entre si',async()=>{
  const result=await readerWithPages([page([first]),page([second],{total:2})]).readAdmittedPdf(Buffer.from('adapter'));
  assert.equal(result.diagnostics.complete,true);
  assert.deepEqual(result.rows.map(row=>[row.registration,row.fullName,row.sourcePage]),[['000000111','TESTE PRIMEIRO',1],['000000222','TESTE SEGUNDO',2]]);
});

test('continuação física do mesmo campo preserva nomes e cargos quebrados sem buscar outra matrícula',()=>{
  const fixture=page([{...first,name:'TESTE PRIMEIRO',role:'CONFERENTE DE CARGA'}]);
  fixture.Texts.push(item(4.17,4.4,'DA SILVA'),item(20.895,4.8,'E DESCARGA'));
  const result=pageAdmissions(fixture,1);
  assert.deepEqual(result.errors,[]);
  assert.equal(result.rows[0].fullName,'TESTE PRIMEIRO DA SILVA');
  assert.equal(result.rows[0].jobTitle,'CONFERENTE DE CARGA E DESCARGA');
});

test('linha sem matrícula própria, campos ausentes ou cabeçalho incompleto bloqueiam cobertura',async()=>{
  const withoutName=page([{...first,name:''},second],{total:2});
  const noOwnRegistration=page([first],{total:2});
  noOwnRegistration.Texts.push(item(4.17,5,'OUTRO COLABORADOR'),item(15.15,5,'21/10/2026'),item(18.435,5,'000086'),item(20.895,5,'CARREGADOR'));
  for(const fixture of [withoutName,noOwnRegistration,page([first],{omitHeader:'Nome'})]){
    const result=await readerWithPages([fixture]).readAdmittedPdf(Buffer.from('adapter'));
    assert.equal(result.diagnostics.complete,false);
    assert.ok(result.diagnostics.errors.length>0);
  }
});

test('total impresso divergente e matrícula duplicada não recebem leitura completa',async()=>{
  for(const fixture of [page([first,second],{total:3}),page([first,{...second,registration:first.registration}],{total:2})]){
    const result=await readerWithPages([fixture]).readAdmittedPdf(Buffer.from('adapter'));
    assert.equal(result.diagnostics.complete,false);
    assert.ok(result.diagnostics.errors.some(message=>/Total impresso|repetida/.test(message)));
  }
});

test('datas inexistentes, cartão inválido e prefixo numérico no nome exigem revisão da origem',async()=>{
  for(const row of [{...first,date:'31/02/2026'},{...first,card:'99999'},{...first,name:'0002 TESTE PRIMEIRO'}]){
    const result=await readerWithPages([page([row],{total:1})]).readAdmittedPdf(Buffer.from('adapter'));
    assert.equal(result.diagnostics.complete,false);
    assert.equal(result.rows.length,0);
  }
});

test('texto de linha preservada distingue código de filial e cartão vazio',()=>{
  const source='Relação de Admitidos\nCadastro Nome Admissão Cargo Cartão Ponto Filial\n000000111 TESTE PRIMEIRO 09/10/2026 000086 - CARREGADOR 0002\n000000222 TESTE SEGUNDO 21/10/2026 000074 - AUX. DE EXPEDICAO 0002\nTotal Total Empresa 00002';
  const rows=parseAdmittedText(source);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>[row.registration,row.fullName,row.pointCard,row.branchCode]),[['000000111','TESTE PRIMEIRO','','0002'],['000000222','TESTE SEGUNDO','','0002']]);
});

test('texto nome-primeiro do Universal Printer usa a matrícula da própria linha, não da anterior',()=>{
  const source='Relação de Admitidos\nCadastroNomeAdmissãoCargoCartão Ponto\nEMPRESA TESTE\nFilial\nTESTE PRIMEIRO09/10/2026 -CARREGADOR000000111000086  0002\nTESTE SEGUNDO21/10/2026 -AUX. DE EXPEDICAO000000222000074  0002\n00002TotalTotal Empresa';
  const rows=parseAdmittedText(source);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>[row.registration,row.fullName,row.admissionDate,row.pointCard,row.branchCode]),[['000000111','TESTE PRIMEIRO','2026-10-09','','0002'],['000000222','TESTE SEGUNDO','2026-10-21','','0002']]);
});

test('listas de colunas sem geometria e associações incompletas não são combinadas por índice',()=>{
  const columns='Relação de Admitidos\n000000111\n000000222\nTESTE PRIMEIRO\n09/10/2026\nTESTE SEGUNDO\n21/10/2026\n86\n74\n- CARREGADOR\n- AUX. DE EXPEDICAO\n0002\n0002';
  assert.deepEqual(parseAdmittedText(columns),[]);
  const incomplete='Relação de Admitidos\nCadastro Nome Admissão Cargo Cartão Ponto Filial\n000000111 TESTE PRIMEIRO 09/10/2026 000086 - CARREGADOR 0002\n000000222\nTotal Empresa 00002';
  assert.deepEqual(parseAdmittedText(incomplete),[]);
});
