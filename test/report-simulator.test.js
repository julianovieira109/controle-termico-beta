const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('relatórios possuem botão e painel do simulador',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  assert.match(html,/id="report-simulator-open"/);
  assert.match(html,/id="report-simulator-panel"/);
  assert.match(html,/id="report-simulator-day"/);
  assert.match(html,/id="report-simulator-timeline"/);
});

test('simulador usa o mesmo plano térmico oficial da geração',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');
  assert.match(js,/ThermalSchedule\.buildMonthPlan\(\[employee\],monthDays/);
  assert.match(js,/employee\.point_schedules/);
  assert.match(js,/renderReportSimulator/);
});

test('simulador não altera nem substitui geração da ficha',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  assert.match(js,/\$\("report-generate"\)\.onclick=async/);
  assert.match(html,/Esta visualização não altera a ficha/);
});
