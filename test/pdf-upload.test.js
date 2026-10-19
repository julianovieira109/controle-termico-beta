const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {once}=require('node:events');
const {createPdfUpload}=require('../src/middleware/pdf-upload');

async function withServer(run){
  const app=express();
  for(const [path,limit] of [['/timecard',32],['/employees',8]]){
    app.post(path,createPdfUpload(limit).single('file'),(req,res)=>res.json({bytes:req.file.size}));
  }
  app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{await run(`http://127.0.0.1:${server.address().port}`);}finally{await new Promise(resolve=>server.close(resolve));}
}
function form(size,type='application/pdf'){
  const data=new FormData();data.append('file',new Blob([Buffer.alloc(size)],{type}),'test.pdf');return data;
}
test('Cartão de Ponto aceita PDF de 22 MiB acima do limite antigo',async()=>{
  await withServer(async base=>{
    const response=await fetch(base+'/timecard',{method:'POST',body:form(22*1024*1024)});
    assert.equal(response.status,200);assert.equal((await response.json()).bytes,22*1024*1024);
  });
});
test('PDF maior que 32 MiB retorna 413 e mensagem clara',async()=>{
  await withServer(async base=>{
    const response=await fetch(base+'/timecard',{method:'POST',body:form(32*1024*1024+1)});
    assert.equal(response.status,413);const result=await response.json();
    assert.equal(result.code,'LIMIT_FILE_SIZE');assert.equal(result.limitMb,32);assert.match(result.error,/32 MB/);
  });
});
test('outros importadores mantêm limite de 8 MiB',async()=>{
  await withServer(async base=>{
    const response=await fetch(base+'/employees',{method:'POST',body:form(8*1024*1024+1)});
    assert.equal(response.status,413);assert.equal((await response.json()).limitMb,8);
  });
});
test('arquivo que não é PDF retorna 400',async()=>{
  await withServer(async base=>{
    const response=await fetch(base+'/timecard',{method:'POST',body:form(10,'text/plain')});
    assert.equal(response.status,400);assert.match((await response.json()).error,/Envie um arquivo PDF/);
  });
});

test('todos os envios do Cartão de Ponto usam o limite maior',()=>{
  const fs=require('node:fs');
  const source=fs.readFileSync('src/routes/imports.js','utf8');
  for(const route of ['timecard-preview','timecard-confirm','timecard-resolve-new-hires']){
    assert.ok(source.includes(`router.post("/${route}",timecardUpload.single("file")`));
  }
});

test('PDF sem texto extraível informa como obter um arquivo compatível',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events');
  const source=fs.readFileSync('src/routes/imports.js','utf8');
  const fn=source.slice(source.indexOf('function extractSeniorWithPdf2Json('),source.indexOf('function extractWithPdf2Json('));
  class Parser extends EventEmitter{parseBuffer(){this.emit('pdfParser_dataReady',{});}}
  const context={PDFParser:Parser,pdf2JsonDataToSeniorText:()=>({text:'\n\f\n',safePages:0})};
  vm.createContext(context);vm.runInContext(fn,context);
  await assert.rejects(context.extractSeniorWithPdf2Json(Buffer.alloc(0)),error=>{
    assert.match(error.message,/Não foi encontrado texto extraível/);
    assert.match(error.message,/PDF original diretamente da Senior/);
    return true;
  });
});
