const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/js/core.js'),'utf8');

test('script principal pode ser compilado antes de inicializar o login',()=>{
  assert.doesNotThrow(()=>new vm.Script(source));
});

test('olho mostra e oculta senha sem alterar seu conteúdo',()=>{
  const input={type:'password',value:'senha-de-teste'};
  const openIcon={hidden:false},closedIcon={hidden:true};
  const button={dataset:{passwordEye:'#password'},attributes:{},
    querySelector:selector=>selector==='.eye-open'?openIcon:closedIcon,
    setAttribute(name,value){this.attributes[name]=value;}};
  const context={sessionStorage:{getItem:()=>null},document:{
    querySelectorAll:()=>[button],querySelector:()=>input,
  }};
  vm.runInNewContext(source.slice(0,source.indexOf('let employeeRows=')),context);
  button.onclick();
  assert.equal(input.type,'text');
  assert.equal(button.attributes['aria-label'],'Ocultar senha');
  assert.equal(openIcon.hidden,true);
  assert.equal(closedIcon.hidden,false);
  button.onclick();
  assert.equal(input.type,'password');
  assert.equal(button.attributes['aria-label'],'Mostrar senha');
  assert.equal(input.value,'senha-de-teste');
});
