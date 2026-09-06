const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const importsRoute=fs.readFileSync(path.join(__dirname,'..','src','routes','imports.js'),'utf8');
const calendarJs=fs.readFileSync(path.join(__dirname,'..','public','js','calendar-reports.js'),'utf8');
const indexHtml=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');

test('limpeza de ponto fica restrita ao Master e a ambiente Beta/teste',()=>{
  assert.match(importsRoute,/router\.post\("\/timecard-cleanup",requireMasterAdmin/);
  assert.match(importsRoute,/ALLOW_POINT_DATA_CLEANUP/);
  assert.match(importsRoute,/RENDER_SERVICE_NAME/);
  assert.match(importsRoute,/\(beta\|test\|staging\|homolog\)/i);
  assert.match(importsRoute,/bloqueada neste ambiente/);
});

test('limpeza exige confirmação textual explícita',()=>{
  assert.match(importsRoute,/LIMPAR PONTOS BETA/);
  assert.match(calendarJs,/prompt\(`/);
  assert.match(calendarJs,/confirmation\.trim\(\)\.toUpperCase\(\)!=="LIMPAR PONTOS BETA"/);
});

test('limpeza remove dias e histórico Senior apenas da empresa e filial escolhidas',()=>{
  const routeStart=importsRoute.indexOf('router.post("/timecard-cleanup"');
  const routeEnd=importsRoute.indexOf('router.post("/timecard-preview"',routeStart);
  const block=importsRoute.slice(routeStart,routeEnd);
  assert.match(block,/DELETE FROM employee_point_days[\s\S]*company_id=\$1 AND branch_id=\$2/);
  assert.match(block,/DELETE FROM employee_imports[\s\S]*import_type='PONTO_SENIOR'[\s\S]*company_id=\$1[\s\S]*branch_id=\$2/);
  assert.match(block,/CLEAR_BETA_TIMECARD_DATA/);
});

test('interface de limpeza é exclusiva do Master e invalida fichas abertas',()=>{
  assert.match(indexHtml,/master-only[^>]*id="point-cleanup-details"/);
  assert.match(indexHtml,/id="point-data-cleanup"/);
  assert.match(calendarJs,/pointCompetenceInfo=\{month:null,imports:\[\]\}/);
  assert.match(calendarJs,/pointDataActive=false/);
  assert.match(calendarJs,/importe um novo Cartão de Ponto Senior/i);
});
