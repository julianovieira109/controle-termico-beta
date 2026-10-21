const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ThermalSchedule=require('../public/js/thermal-schedule');
const BlankCopyStatus=require('../public/js/blank-copy-status');
const validator=require('../public/js/report-validator');
const source=fs.readFileSync(require.resolve('../public/js/calendar-reports.js'),'utf8');
const days=[{iso:'2026-10-01',day:1,br:'01/10/2026',weekDay:4,weekName:'qui'}];
const employee=description=>({id:'e',full_name:'Colaborador',registration:'123',status:'ATIVO',report_policy:'THERMAL_ONLY',shift_name:'Turno',branch_id:'b',company_id:'c',point_schedules:description?{'2026-10-01':description}:{},point_states:description?{'2026-10-01':'WORKED'}:{}});
function sheet(e,plan,mode='AUTOMATIC',blankCopy=false){
  const context={ThermalSchedule,BlankCopyStatus,thermalRestSettings:{mode,scopeMode:'ALL'},holidays:[],reportThermalDays:()=>days,reportHeader:()=>'<header>Ficha</header>',escapeHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),pointDataActive:false};
  vm.createContext(context);
  for(const name of ['thermalAutomaticAllowed','employmentDayStatus','dayStatus','buildThermalSheet']){
    const start=source.indexOf(`function ${name}(`);
    const next=source.slice(start+1).search(/\n(?:async )?function /);
    assert.ok(start>=0&&next>=0);
    vm.runInContext(source.slice(start,start+1+next),context);
  }
  return context.buildThermalSheet(e,'2026-10',plan,{blankCopy});
}
test('ficha mantém todas as pausas e usa continuação acima de quatro',()=>{
  const e=employee('08:00-12:00-13:00-22:00');
  const plan=ThermalSchedule.buildMonthPlan([e],days,{usePointData:true});
  const rests=plan.get('e|2026-10-01');
  assert.equal(rests.length,6);
  const html=sheet(e,plan);
  assert.equal((html.match(/<section /g)||[]).length,2);
  assert.match(html,/Repouso 5/);assert.match(html,/Repouso 6/);
  for(const rest of rests){assert.ok(html.includes(ThermalSchedule.formatMinutes(rest.start)));assert.ok(html.includes(ThermalSchedule.formatMinutes(rest.end)));}
  assert.match(html,/Saída calculada/);assert.match(html,/A realização dos repousos precisa de conferência e registro/);
});
test('ficha automática sem ponto não usa escala nem horários previstos',()=>{
  const e={...employee(),shift_description:'08:00-12:00-13:00-17:00'};
  const html=sheet(e,ThermalSchedule.buildMonthPlan([e],days,{usePointData:false}));
  assert.match(html,/PONTO NÃO IMPORTADO/);
  assert.doesNotMatch(html,/class="thermal-time-cell">\d\d:\d\d/);
  assert.equal(validator.validate({month:'2026-10',employees:[e],thermalConfig:{mode:'AUTOMATIC'},pointCompetenceBranches:['b']}).valid,false);
});
test('horários iguais salvos anteriormente bloqueiam validação e não recebem rótulo de jornada curta',()=>{
  const e=employee('08:00-08:00');
  const result=validator.validate({month:'2026-10',employees:[e],thermalConfig:{mode:'AUTOMATIC'},pointCompetenceBranches:['b']});
  assert.equal(result.valid,false);assert.ok(result.blockers.some(item=>item.code==='INVALID_POINT_SCHEDULE'));
  const html=sheet(e,new Map());assert.match(html,/REVISAR MARCAÇÕES DO PONTO/);assert.doesNotMatch(html,/SEM REPOUSO NECESSÁRIO/);
});
test('auditoria antes de gerar recusa plano cortado e aceita o plano completo',()=>{
  const e=employee('08:00-12:00-13:00-17:00');
  const plan=ThermalSchedule.buildMonthPlan([e],days,{usePointData:true});
  assert.equal(validator.validatePlan({employees:[e],monthDays:days,plan}).valid,true);
  const truncated=new Map([['e|2026-10-01',plan.get('e|2026-10-01').slice(0,3)]]);
  const invalid=validator.validatePlan({employees:[e],monthDays:days,plan:truncated});
  assert.equal(invalid.valid,false);assert.ok(invalid.blockers.some(item=>/153 minutos/.test(item.message)));
});
test('dias de revisão geram aviso sem receber repouso nem aprovação silenciosa',()=>{
  const e={...employee(),point_states:{'2026-10-01':'REVIEW'}};
  const result=validator.validate({month:'2026-10',employees:[e],thermalConfig:{mode:'AUTOMATIC'},pointCompetenceBranches:['b']});
  assert.equal(result.valid,true);assert.ok(result.warnings.some(item=>item.code==='POINT_DAYS_PENDING'));
  const html=sheet(e,new Map());assert.match(html,/REVISAR MARCAÇÕES DO PONTO/);assert.doesNotMatch(html,/class="thermal-time-cell">\d\d:\d\d/);
});
test('cópia em branco e modo manual não recebem pausas do planejamento',()=>{
  const e=employee('08:00-12:00-13:00-22:00'),plan=ThermalSchedule.buildMonthPlan([e],days,{usePointData:true});
  for(const html of [sheet(e,plan,'AUTOMATIC',true),sheet(e,plan,'MANUAL')]){
    assert.equal((html.match(/<section /g)||[]).length,1);
    assert.doesNotMatch(html,/class="thermal-time-cell">\d\d:\d\d/);
    assert.doesNotMatch(html,/Saída calculada/);
  }
});
test('jornada curta válida e ausência Senior ficam distinguidas de falha de cálculo',()=>{
  const e=employee('08:00-09:30'),plan=ThermalSchedule.buildMonthPlan([e],days,{usePointData:true});
  assert.match(sheet(e,plan),/SEM REPOUSO NECESSÁRIO NESTA JORNADA/);
  const absent={...e,point_schedules:{},point_states:{'2026-10-01':'FALTA'}};
  const result=validator.validate({month:'2026-10',employees:[absent],thermalConfig:{mode:'AUTOMATIC'},pointCompetenceBranches:['b']});
  assert.equal(result.valid,true);assert.match(sheet(absent,new Map()),/FALTA/);
});
test('intervalo curto preserva a leitura e bloqueia a ficha sem chamá-la de jornada curta',()=>{
  const e=employee('08:00-09:30-09:40-11:10');
  assert.equal(ThermalSchedule.parsePointPeriods(e.point_schedules[days[0].iso]).valid,true);
  const plan=ThermalSchedule.buildMonthPlan([e],days,{usePointData:true});
  assert.equal(plan.size,0);
  const result=validator.validate({month:'2026-10',employees:[e],thermalConfig:{mode:'AUTOMATIC'},pointCompetenceBranches:['b']});
  assert.equal(result.valid,false);
  const blocker=result.blockers.find(item=>item.code==='MEAL_BREAK_TOO_SHORT');
  assert.ok(blocker);assert.match(blocker.message,/01\/10\/2026/);
  assert.match(blocker.message,/180 minutos/);assert.match(blocker.message,/preservados/);
  assert.equal(validator.validatePlan({employees:[e],monthDays:days,plan}).valid,false);
  for(const supplied of [plan,new Map([['e|2026-10-01',[{start:500,end:520}]]])]){
    const html=sheet(e,supplied);
    assert.match(html,/REVISAR INTERVALO/);assert.doesNotMatch(html,/SEM REPOUSO NECESSÁRIO/);
    assert.doesNotMatch(html,/class="thermal-time-cell">\d\d:\d\d/);
  }
});
test('intervalo curto sem necessidade de reiniciar a contagem mantém a jornada válida',()=>{
  const e=employee('08:00-08:40-08:50-09:30');
  const plan=ThermalSchedule.buildMonthPlan([e],days,{usePointData:true});
  assert.deepEqual(plan.get('e|2026-10-01'),[]);
  assert.equal(validator.validate({month:'2026-10',employees:[e],thermalConfig:{mode:'AUTOMATIC'},pointCompetenceBranches:['b']}).valid,true);
  assert.equal(validator.validatePlan({employees:[e],monthDays:days,plan}).valid,true);
  assert.match(sheet(e,plan),/SEM REPOUSO NECESSÁRIO/);
});
