const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ThermalSchedule=require('../public/js/thermal-schedule');
const ReportValidator=require('../public/js/report-validator');

const source=fs.readFileSync(require.resolve('../public/js/calendar-reports.js'),'utf8');
const month=new Date().toISOString().slice(0,7);
const workDate=`${month}-01`;

function functionCode(name){
  const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
  const end=source.indexOf('\n}',start)+2;
  assert.ok(start>=0&&end>start,`Função disponível: ${name}`);
  return source.slice(start,end);
}

function element(values={}){
  const classes=new Set();
  return {
    innerHTML:'',textContent:'',hidden:false,value:'',checked:false,
    classList:{add(...items){items.forEach(item=>classes.add(item));},remove(...items){items.forEach(item=>classes.delete(item));}},
    querySelector(){return this.innerHTML.includes('class="report-sheet"')?{}:null;},
    ...values
  };
}

function harness(){
  const employee={
    id:'e1',full_name:'Colaborador',registration:'123',status:'ATIVO',report_policy:'THERMAL_ONLY',
    shift_name:'Turno',shift_description:'08:00-12:00-13:00-17:00',branch_id:'b1',company_id:'c1',
    point_schedules:{[workDate]:'08:00-12:00-13:00-17:00'},point_states:{[workDate]:'WORKED'}
  };
  const elements=Object.fromEntries([
    'report-output','report-month','report-company','report-all-employees','report-employee-select',
    'report-generation-summary','report-generate','report-print-center','report-thermal-mode-note',
    'report-validation-panel','report-validation-toggle','report-validation-badge',
    'report-validation-subtitle','report-validation-counts','report-validation-details'
  ].map(id=>[id,element()]));
  elements['report-output'].innerHTML='<section class="report-sheet">Ficha anterior</section>';
  elements['report-month'].value=month;
  elements['report-employee-select'].value=employee.id;
  const alerts=[];
  const calls=[];
  const config={mode:'AUTOMATIC',scopeMode:'ALL',fontSizePt:7.2};
  const context={
    $:id=>elements[id],companies:[{}],branches:[{}],catalogs:{shifts:[{}]},
    thermalSettingsLoaded:true,thermalRestSettings:config,reportEmployees:[employee],
    pointDataActive:true,pointCompetenceBranches:new Set(['b1']),pointCompetenceInfo:{month,imports:[{branch_id:'b1'}]},
    lastReportValidation:{month,valid:true,generated:true,summary:'Validação anterior: 0 bloqueios'},
    ThermalSchedule,ReportValidator,setTimeout,
    document:{documentElement:{style:{setProperty(){}}}},
    escapeHtml:value=>String(value??''),formatApiDate:value=>value,
    alert:message=>alerts.push(message),confirm:()=>true,
    refreshReportFilters(){},showReportSkippedDetails(){},loadReportHolidaysForMonth:async()=>{},
    api:async path=>{
      calls.push(path);
      if(path==='/api/settings/thermal-rest')return config;
      if(path==='/api/reports/employees')return [employee];
      if(path.startsWith('/api/reports/point-days?'))return [{employee_id:employee.id,work_date:workDate,point_state:'WORKED',eligible_for_automatic_rest:true,markings:['08:00','12:00','13:00','17:00']}];
      if(path.startsWith('/api/reports/point-competence?'))return {month,imports:[{branch_id:'b1'}]};
      throw new Error(`Consulta inesperada: ${path}`);
    }
  };
  context.window=context;
  vm.createContext(context);
  for(const name of [
    'thermalAutomaticAllowed','reportMonthDays','reportMonthLabel','reportPlanningDays','monthsCoveredByPeriod',
    'reportEmployeeSelected','employeeCanGenerateReports','reportPolicyAllows','prepareReports',
    'refreshReportsAfterPointImport','applyPointDataToEmployees','invalidateReportValidation',
    'setReportValidationVisibility','renderReportValidation','validateReportBeforeGeneration',
    'closePrintCenter','validateReportPrint'
  ])vm.runInContext(functionCode(name),context);
  const generateStart=source.indexOf('$("report-generate").onclick=async()=>{');
  const generateEnd=source.indexOf('\nlet reportPrintInProgress=',generateStart);
  assert.ok(generateStart>=0&&generateEnd>generateStart);
  vm.runInContext(source.slice(generateStart,generateEnd),context);
  return {context,elements,employee,alerts,calls};
}

test('reabrir Relatórios remove a ficha anterior e bloqueia impressão até gerar novamente',async()=>{
  const {context,elements}=harness();
  assert.equal(context.validateReportPrint(),true);
  await context.prepareReports();
  assert.equal(elements['report-output'].innerHTML,'');
  assert.equal(context.lastReportValidation,null);
  assert.equal(context.validateReportPrint(),false);
  assert.equal(elements['report-print-center'].hidden,true);
  assert.equal(elements['report-validation-panel'].hidden,true);
  assert.equal(elements['report-validation-toggle'].hidden,true);
});

test('nova geração com falha ao consultar ponto não preserva ficha ou validação anterior',async()=>{
  const {context,elements,employee,alerts}=harness();
  const api=context.api;
  context.api=async path=>{
    if(path.startsWith('/api/reports/point-days?'))throw new Error('Conexão interrompida');
    return api(path);
  };
  assert.equal(context.validateReportPrint(),true);
  await elements['report-generate'].onclick();
  assert.equal(elements['report-output'].innerHTML,'');
  assert.equal(context.lastReportValidation,null);
  assert.equal(context.validateReportPrint(),false);
  assert.deepEqual(Object.keys(employee.point_schedules),[]);
  assert.deepEqual(Object.keys(employee.point_states),[]);
  assert.equal(context.pointCompetenceBranches.size,0);
  assert.ok(alerts.some(message=>message.includes('Não foi possível consultar o ponto importado: Conexão interrompida')));
});

for(const [valid,generated] of [[true,true],[true,false],[false,true],[false,false]]){
  test(`reimportação aguarda a geração e verifica valid=${valid}, generated=${generated}`,async()=>{
    const {context,elements}=harness();
    let startGeneration;
    const started=new Promise(resolve=>{startGeneration=resolve;});
    let finishGeneration;
    const finished=new Promise(resolve=>{finishGeneration=resolve;});
    let generations=0;
    elements['report-generate'].onclick=async()=>{
      generations++;
      assert.equal(elements['report-output'].innerHTML,'');
      assert.equal(context.lastReportValidation,null);
      startGeneration();
      await finished;
      context.lastReportValidation={month,valid,generated};
    };
    let settled=false;
    const pending=context.refreshReportsAfterPointImport({period:{start:workDate,end:`${month}-28`}}).then(result=>{settled=true;return result;});
    await Promise.race([started,pending.then(()=>{throw new Error('A reimportação terminou sem iniciar a geração da ficha anterior');})]);
    assert.equal(generations,1,'A existência da ficha deve ser detectada antes de invalidá-la');
    assert.equal(settled,false,'O resultado da importação aguarda o término da geração');
    finishGeneration();
    const result=await pending;
    assert.equal(result.regenerated,valid&&generated);
    assert.equal(result.importedMonth,month);
  });
}

test('reimportação sem ficha anterior não inicia geração nem anuncia regeneração',async()=>{
  const {context,elements}=harness();
  elements['report-output'].innerHTML='';
  let generations=0;
  elements['report-generate'].onclick=async()=>{generations++;};
  const result=await context.refreshReportsAfterPointImport({period:{start:workDate,end:`${month}-28`}});
  assert.equal(generations,0);
  assert.equal(result.regenerated,false);
  assert.equal(context.lastReportValidation,null);
});

test('bloqueio da auditoria atualiza o resumo compacto e mantém a ficha e impressão bloqueadas',async()=>{
  const {context,elements}=harness();
  context.ThermalSchedule={
    ...ThermalSchedule,
    buildMonthPlan(employees,days,config){
      const plan=ThermalSchedule.buildMonthPlan(employees,days,config);
      const key=`e1|${workDate}`;
      plan.set(key,plan.get(key).slice(0,3));
      return plan;
    }
  };
  await elements['report-generate'].onclick();
  assert.equal(context.lastReportValidation.valid,false);
  assert.equal(context.lastReportValidation.generated,false);
  assert.equal(elements['report-output'].innerHTML,'');
  assert.equal(context.validateReportPrint(),false);
  assert.equal(elements['report-validation-panel'].hidden,true);
  assert.equal(elements['report-validation-toggle'].hidden,false);
  assert.equal(elements['report-validation-badge'].textContent,'Bloqueado');
  assert.ok(elements['report-validation-toggle'].textContent.includes('1 bloqueios'));
  assert.ok(elements['report-validation-details'].innerHTML.includes('153 minutos'));
  assert.ok(elements['report-generation-summary'].textContent.includes('conferência do cálculo bloqueou'));
});
test('intervalo curto recebido do ponto bloqueia nova geração e não libera impressão anterior',async()=>{
  const {context,elements,employee}=harness();
  const api=context.api;
  context.api=async path=>path.startsWith('/api/reports/point-days?')
    ?[{employee_id:employee.id,work_date:workDate,point_state:'WORKED',eligible_for_automatic_rest:true,markings:['08:00','09:30','09:40','11:10']}]
    :api(path);
  await elements['report-generate'].onclick();
  assert.equal(context.lastReportValidation.valid,false);
  assert.equal(context.lastReportValidation.generated,false);
  assert.equal(elements['report-output'].innerHTML,'');
  assert.equal(context.validateReportPrint(),false);
  assert.equal(elements['report-validation-badge'].textContent,'Bloqueado');
  assert.match(elements['report-validation-details'].innerHTML,/intervalo registrado de 10/);
  assert.equal(employee.point_schedules[workDate],'08:00-09:30-09:40-11:10');
});
