const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const service=require('../src/services/online-holidays.js');

test('fallback local preserva lista segura de feriados',()=>{
  const rows=service.nationalFallback(2026);
  assert.equal(rows.length,9);
  assert.ok(rows.some(row=>row.date==='2026-01-01'));
  assert.ok(rows.some(row=>row.date==='2026-12-25'));
});

test('normalização online aceita date/name',()=>{
  assert.deepEqual(
    service.normalizeOnlineHoliday({date:'2026-09-07',name:'Independência do Brasil',type:'NATIONAL'},'NATIONAL'),
    {date:'2026-09-07',name:'Independência do Brasil',type:'NATIONAL'}
  );
});

test('rota de geração usa serviço online e retorna origem',()=>{
  const route=fs.readFileSync(path.join(__dirname,'../src/routes/calendar.js'),'utf8');
  assert.match(route,/getNational/);
  assert.match(route,/getOptional/);
  assert.match(route,/getLocal/);
  assert.match(route,/source:onlineResult\.source/);
  assert.match(route,/provider:onlineResult\.provider/);
});

test('consulta de feriados usa somente automáticos',()=>{
  const route=fs.readFileSync(path.join(__dirname,'../src/routes/calendar.js'),'utf8');
  assert.match(route,/let where="WHERE h\.automatic=TRUE"/);
});

test('interface de feriados mantém somente seleção de ano e lista automática',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const start=html.indexOf('id="settings-calendar"');
  const end=html.indexOf('</section>',start);
  const block=html.slice(start,end);
  assert.match(block,/id="holiday-year"/);
  assert.match(block,/id="holiday-list"/);
  assert.doesNotMatch(block,/id="holiday-form"/);
  assert.doesNotMatch(block,/id="day-off-form"/);
  assert.doesNotMatch(block,/data-calendar-tab="days-off"/);
  assert.doesNotMatch(block,/id="holiday-generate"/);
});

test('troca do ano sincroniza automaticamente',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');
  assert.match(js,/\$\("holiday-year"\)\.onchange=generateAndLoadHolidays/);
  assert.match(js,/Atualizando os tipos selecionados para \$\{year\}/);
});
