const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const service=require('../src/services/online-holidays');

test('código municipal usa UF e cidade da filial',()=>{
  assert.equal(service.cityCode('GO','Aparecida de Goiânia'),'GO-aparecida-de-goiania');
});

test('fallback nacional e facultativo ficam separados',()=>{
  const national=service.nationalFallback(2026);
  const optional=service.optionalFallback(2026);
  assert.equal(national.length,9);
  assert.ok(optional.some(x=>/Carnaval/i.test(x.name)));
  assert.ok(optional.some(x=>/Corpus Christi/i.test(x.name)));
  assert.ok(!national.some(x=>/Carnaval|Corpus/i.test(x.name)));
});

test('configuração padrão deixa apenas nacionais ligados',()=>{
  const route=fs.readFileSync(path.join(__dirname,'../src/routes/calendar.js'),'utf8');
  assert.match(route,/NATIONAL:true/);
  assert.match(route,/STATE:false/);
  assert.match(route,/MUNICIPAL:false/);
  assert.match(route,/OPTIONAL:false/);
});

test('interface permite selecionar os quatro tipos',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  for(const id of ['holiday-type-national','holiday-type-state','holiday-type-municipal','holiday-type-optional']){
    assert.match(html,new RegExp(`id="${id}"`));
  }
  assert.match(html,/Salvar tipos de feriados/);
});

test('feriados estaduais e municipais usam localização da filial',()=>{
  const route=fs.readFileSync(path.join(__dirname,'../src/routes/calendar.js'),'utf8');
  assert.match(route,/getLocal\(year,"STATE",\{state:branch\.state,city:branch\.city\}\)/);
  assert.match(route,/getLocal\(year,"MUNICIPAL",\{state:branch\.state,city:branch\.city\}\)/);
});

test('relatórios seguem sincronizando a competência antes de gerar',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');
  const start=js.indexOf('$("report-generate").onclick=async()=>');
  const block=js.slice(start,start+2200);
  assert.ok(block.indexOf('await loadReportHolidaysForMonth(month)')>=0);
  assert.ok(block.indexOf('await loadReportHolidaysForMonth(month)')<block.indexOf('await applyPointDataToEmployees(month)'));
});
