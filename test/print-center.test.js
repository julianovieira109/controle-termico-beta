const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../public/css/enhancements.css'),'utf8');

test('impressão principal imprime tudo e Central fica como opção personalizada',()=>{
  assert.match(html,/id="report-print"[^>]*>Imprimir tudo</);
  assert.match(html,/id="report-print-custom"[^>]*>Impressão personalizada</);
  assert.match(html,/id="report-print-center"/);
  assert.match(js,/\$\("report-print"\)\.onclick=printAllReports/);
  assert.match(js,/\$\("report-print-custom"\)\)\$\("report-print-custom"\)\.onclick=openPrintCenter/);
});

test('imprimir tudo mantém validação e não abre a Central',()=>{
  const start=js.indexOf('function printAllReports');
  const end=js.indexOf('\n}\n',start)+3;
  const block=js.slice(start,end);
  assert.match(block,/validateReportPrint\(\)/);
  assert.match(block,/window\.print\(\)/);
  assert.doesNotMatch(block,/openPrintCenter/);
});

test('central permite filtrar os três tipos de ficha',()=>{
  assert.match(html,/id="print-center-type-thermal"/);
  assert.match(html,/id="print-center-type-blank"/);
  assert.match(html,/id="print-center-type-meal"/);
  assert.match(js,/selectedTypes\.add\("thermal"\)/);
  assert.match(js,/selectedTypes\.add\("thermal-blank"\)/);
  assert.match(js,/selectedTypes\.add\("meal"\)/);
});

test('fichas recebem metadados de tipo e colaborador',()=>{
  assert.match(js,/data-report-type="\$\{reportType\}"/);
  assert.match(js,/data-report-type="meal"/);
  assert.match(js,/data-employee-id="\$\{escapeHtml\(employee\.id\)\}"/);
});

test('central permite selecionar um colaborador específico',()=>{
  assert.match(html,/id="print-center-employee"/);
  assert.match(js,/populatePrintCenterEmployees/);
  assert.match(js,/employeeId:\$\("print-center-employee"\)/);
});

test('impressão preserva ordem atual das fichas e apenas oculta não selecionadas',()=>{
  assert.match(js,/classList\.toggle\("print-center-excluded"/);
  assert.match(css,/body\.print-center-active #report-output \.print-center-excluded/);
  assert.doesNotMatch(js,/sort\([^)]*reportType/);
});

test('central mantém bloqueio de impressão sem validação concluída',()=>{
  const start=js.indexOf('function openPrintCenter()');
  const block=js.slice(start,start+1800);
  assert.match(block,/lastReportValidation/);
  assert.match(block,/Gere novamente as fichas para validar antes de imprimir/);
});

test('afterprint remove filtros temporários',()=>{
  assert.match(js,/window\.addEventListener\("afterprint"/);
  assert.match(js,/clearPrintFiltering\(\)/);
});
