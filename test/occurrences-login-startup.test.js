const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('DOMContentLoaded na tela de login não consulta dados protegidos de Ocorrências',async()=>{
  let ready;const calls=[];
  const context={
    document:{getElementById:()=>null,querySelectorAll:()=>[],addEventListener:(name,callback)=>{if(name==='DOMContentLoaded')ready=callback;}},
    api:async path=>{calls.push(path);throw new Error('Sem sessão');},
    Date,Intl,URLSearchParams,console,setTimeout,clearTimeout
  };
  context.window={addEventListener(){}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/js/occurrences-control.js','utf8'),context);
  assert.equal(typeof ready,'function');
  ready();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[],'login não inicia consultas administrativas');
  assert.equal(typeof context.window.loadOccurrencesControl,'function','carregamento pela navegação continua disponível');
});
