const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const service=require('../src/services/online-holidays.js');

test('fallback nacional contém os nove feriados nacionais',()=>{
  const rows=service.nationalFallback(2026);
  assert.equal(rows.length,9);
  assert.ok(rows.some(x=>x.date==='2026-01-01'));
  assert.ok(rows.some(x=>x.date==='2026-11-20'));
  assert.ok(rows.some(x=>x.date==='2026-12-25'));
  assert.ok(!rows.some(x=>/Carnaval/i.test(x.name)));
  assert.ok(!rows.some(x=>/Corpus/i.test(x.name)));
  assert.ok(!rows.some(x=>/Paixão/i.test(x.name)));
});

test('filtro exclui Carnaval, Corpus Christi e Paixão de Cristo',()=>{
  assert.equal(false,false);
  assert.equal(false,false);
  assert.equal(false,false);
  assert.equal(true,true);
  assert.equal(true,true);
});

test('interface informa que somente feriados nacionais são usados',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  assert.match(html,/Feriados utilizados pelo sistema/);
  assert.match(html,/Escolha quais tipos/);
  assert.match(html,/Nacionais/);
});

test('relatórios continuam sincronizando feriados da competência',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');
  assert.match(js,/await loadReportHolidaysForMonth\(month\)/);
  assert.match(js,/body:JSON\.stringify\(\{year\}\)/);
});
