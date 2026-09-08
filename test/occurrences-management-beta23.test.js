const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const route=fs.readFileSync('src/routes/dashboard.js','utf8');
const ui=fs.readFileSync('public/js/occurrences-control.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');

test('Controle de Ocorrências expõe turno, coordenador e colaborador',()=>{
  assert.match(route,/s\.name shift_name/);
  assert.match(html,/id="occurrences-shift"/);
  assert.match(html,/id="occurrences-coordinator"/);
  assert.match(html,/id="occurrences-employee"/);
});

test('coordenador pode ser configurado por turno ou por colaborador sem nova tabela',()=>{
  assert.match(route,/occurrences-management/);
  assert.match(route,/shiftCoordinators/);
  assert.match(route,/employeeCoordinators/);
  assert.match(route,/setting_key='occurrences-management'/);
  assert.match(ui,/coordenador definido diretamente no colaborador|employeeCoordinators/);
});

test('jornada do colaborador é somente leitura dos pontos Senior',()=>{
  const start=route.indexOf('router.get("/occurrences/journey"');
  const end=route.indexOf('router.get("/occurrences/management"',start);
  const journey=route.slice(start,end);
  assert.match(journey,/SELECT p\.work_date,p\.schedule_code,p\.markings/);
  assert.doesNotMatch(journey,/DELETE\s+FROM\s+employee_point_days/i);
  assert.doesNotMatch(journey,/UPDATE\s+employee_point_days/i);
  assert.doesNotMatch(journey,/INSERT\s+INTO\s+employee_point_days/i);
  assert.match(html,/id="occurrences-journey-panel"/);
});

test('semaforo gerencial considera falta, BH, revisao, saida antecipada e ponto incompleto',()=>{
  assert.match(route,/const absences=Number\(row\.absences\|\|0\)/);
  assert.match(route,/const bankHours=Number\(row\.bank_hours\|\|0\)/);
  assert.match(route,/const reviews=Number\(row\.review_days\|\|0\)/);
  assert.match(route,/const earlyExits=Number\(row\.early_exits\|\|0\)/);
  assert.match(route,/const incompleteDays=Math\.max\(0,workedDays-completeWorkDays\)/);
  assert.match(route,/indicator_status=critical\.length\?'RED':attention\.length\?'YELLOW':'GREEN'/);
});
