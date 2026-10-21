const test=require('node:test');
const assert=require('node:assert/strict');
const thermal=require('../public/js/thermal-schedule');

// This oracle checks actual geometry: every period is partitioned into work
// segments of at most 100 minutes and non-overlapping 20-minute rests. It does
// not reproduce the production formula for the number or placement of rests.
function checkCoverage(periods,rests){
  assert.ok(rests.every((r,index)=>index===0||rests[index-1].end<=r.start),'repousos sobrepostos');
  const assigned=new Set();
  for(const period of periods){
    let cursor=period.start;
    for(const [index,rest] of rests.entries()){
      if(rest.start<period.start||rest.end>period.end)continue;
      assert.equal(assigned.has(index),false,'repouso pertence a mais de um trecho');
      assigned.add(index);
      assert.equal(rest.end-rest.start,20,'duração diferente de 20 minutos');
      assert.ok(rest.start>=cursor,'sobreposição ou inversão do relógio');
      assert.ok(rest.start-cursor<=100,`trabalho contínuo antes do repouso: ${rest.start-cursor}`);
      cursor=rest.end;
    }
    assert.ok(period.end-cursor>=0,'repouso ultrapassa a saída');
    assert.ok(period.end-cursor<=100,`trabalho contínuo final: ${period.end-cursor}`);
  }
  assert.equal(assigned.size,rests.length,'repouso atravessa refeição ou saída');
}
function clock(value){
  const withinDay=value%1440;
  return `${String(Math.floor(withinDay/60)).padStart(2,'0')}:${String(withinDay%60).padStart(2,'0')}`;
}
function monthly(description,extra={}){
  const date='2026-10-01',employee={id:'e',shift_description:'08:00-12:00-13:00-17:00',point_schedules:{[date]:description},...extra};
  return thermal.buildMonthPlan([employee],[{iso:date,day:1}],{usePointData:true});
}

test('todos os intervalos de 1 a 1439 minutos respeitam repousos de 20 min e limite de 100 min até a saída',()=>{
  for(const start of [0,480,1379]){
    for(let span=1;span<1440;span++){
      const description=`${clock(start)} - ${clock(start+span)}`;
      const parsed=thermal.parsePointPeriods(description);
      assert.equal(parsed.valid,true,description);
      assert.deepEqual(parsed.periods,[{start,end:start+span,kind:'work'}]);
      const rests=thermal.dynamicPointRests(description);
      checkCoverage([{start,end:start+span}],rests);
      if(span<=100)assert.deepEqual(rests,[],'jornada curta não precisa de repouso');
    }
  }
});

test('só intervalo de ao menos 20 min reinicia ciclo em jornada longa, inclusive noturna',()=>{
  for(const first of [1,99,100,101,119,120,121,220,221,240,480]){
    for(const meal of [1,19,20,60,180]){
      for(const second of [1,99,100,101,119,120,121,220,221,240,480]){
        const start=1320,breakStart=start+first,breakEnd=breakStart+meal,end=breakEnd+second;
        const description=[start,breakStart,breakEnd,end].map(clock).join(' - ');
        const parsed=thermal.parsePointPeriods(description);
        assert.equal(parsed.valid,true,description);
        assert.deepEqual(parsed.meal,{start:breakStart,end:breakEnd});
        const periods=[{start,end:breakStart},{start:breakEnd,end}];
        const assessment=thermal.assessPointPlanning(description);
        if(meal<20&&first+second>100){
          assert.equal(assessment.valid,false,description);
          assert.equal(assessment.code,'MEAL_BREAK_TOO_SHORT');
          assert.equal(assessment.parsed.valid,true,'fonte permanece válida');
          assert.equal(thermal.requiredRestCount(description),null,'necessidade exige conferência');
          assert.deepEqual(thermal.dynamicPointRests(description),[]);
          assert.equal(monthly(description).size,0,'dia não recebe plano automático');
        }else{
          assert.equal(assessment.valid,true,description);
          checkCoverage(periods,thermal.dynamicPointRests(description));
          if(meal<20)assert.equal(thermal.requiredRestCount(description),0);
        }
      }
    }
  }
});

test('jornada 08–12/13–17 mantém 4 pausas e jornada até 20h mantém 5 sem descartar a última',()=>{
  for(const [description,periods,count] of [
    ['08:00-12:00-13:00-17:00',[{start:480,end:720},{start:780,end:1020}],4],
    ['08:00-12:00-13:00-20:00',[{start:480,end:720},{start:780,end:1200}],5]
  ]){
    const rests=monthly(description).get('e|2026-10-01');
    assert.equal(rests.length,count);
    checkCoverage(periods,rests);
  }
});

test('contagem inválida e marcações extras não são truncadas para caber no cálculo',()=>{
  for(const description of ['', '08:00','08:00-12:00-13:00','08:00-10:00-11:00-12:00-13:00','08:00-10:00-11:00-12:00-13:00-15:00']){
    const expected=description?description.split('-').length:0;
    const parsed=thermal.parsePointPeriods(description);
    assert.equal(parsed.markings.length,expected);
    assert.equal(parsed.valid,false);
    assert.ok(parsed.reason);
    assert.deepEqual(parsed.periods,[]);
    assert.deepEqual(thermal.dynamicPointRests(description),[]);
    assert.equal(monthly(description).size,0);
  }
});

test('horários inválidos, repetidos,24h e múltiplas viradas não geram plano fictício',()=>{
  for(const description of ['08:00-08:00','08:00-12:00-12:00-17:00','08:00-12:00-13:00-08:00','22:00-02:00-01:00-06:00','25:00-12:00','8:00-12:00','08:60-12:00','08:00:00-12:00','08:00-12:00-13:','08:00-12:00-13:00-0017:00']){
    const parsed=thermal.parsePointPeriods(description);
    assert.equal(parsed.valid,false,description);
    assert.ok(parsed.reason,description);
    assert.deepEqual(thermal.dynamicPointRests(description),[],description);
    assert.equal(monthly(description).size,0,description);
  }
});

test('jornada noturna preserva data oficial e limites normalizados depois da meia-noite',()=>{
  const description='22:00-02:00-03:00-06:00';
  const rests=monthly(description).get('e|2026-10-01');
  checkCoverage([{start:1320,end:1560},{start:1620,end:1800}],rests);
  assert.equal(thermal.pointReportDate('2026-10-01',{shift_name:'3º Turno'}),'2026-10-01');
});

test('geração não usa escala como substituto quando o ponto não está ativo',()=>{
  const e={id:'e',shift_description:'08:00-12:00-13:00-17:00',point_schedules:{'2026-10-01':'08:00-12:00-13:00-17:00'}};
  for(const config of [{},{usePointData:false}]){
    assert.equal(thermal.buildMonthPlan([e],[{iso:'2026-10-01',day:1}],config).size,0);
  }
  assert.equal(thermal.baseThermalRests(e.shift_description).length,4,'prévia separada continua disponível');
});

test('ausência ou revisão explícita impede usar marcações mesmo quando presentes',()=>{
  for(const state of ['REVIEW','FALTA','ATESTADO','NO_MARKINGS','FERIAS']){
    assert.equal(monthly('08:00-17:00',{point_states:{'2026-10-01':state}}).size,0,state);
  }
  assert.ok(monthly('08:00-17:00',{point_states:{'2026-10-01':'WORKED'}}).size);
});

test('o mesmo ponto produz pausas idênticas independentemente de cadastro, dia ou parâmetros legados',()=>{
  const description='08:00-12:00-13:00-20:00';
  const expected=thermal.dynamicPointRests(description);
  assert.deepEqual(thermal.baseThermalRests(description,{restMinutes:60,maxRestMinutes:60,variationMinutes:30,restCount:1}),expected);
  const e={id:'e',point_schedules:{'2026-10-01':description,'2026-10-02':description}};
  const plan=thermal.buildMonthPlan([e],[{iso:'2026-10-01',day:1},{iso:'2026-10-02',day:2}],{usePointData:true,restMinutes:60,restCount:1,variationMinutes:30});
  assert.deepEqual(plan.get('e|2026-10-01'),expected);
  assert.deepEqual(plan.get('e|2026-10-02'),expected);
  assert.deepEqual(thermal.dynamicPointRests(description,{},99,98765,123),expected);
});


test('prévia de escala aceita notação legada sem relaxar a leitura das marcações reais',()=>{
  for(const [legacy,normalized] of [['8:00-12:00-13:00-17:00','08:00-12:00-13:00-17:00'],['6PRE-10:00-11:00-15:00','06:00-10:00-11:00-15:00']]){
    assert.equal(thermal.parsePointPeriods(legacy).valid,false);
    assert.deepEqual(thermal.parseShiftPeriods(legacy),thermal.parsePointPeriods(normalized));
    assert.deepEqual(thermal.parseShiftSchedule(legacy),thermal.parseShiftSchedule(normalized));
    assert.deepEqual(thermal.baseThermalRests(legacy),thermal.dynamicPointRests(normalized));
    assert.deepEqual(thermal.dynamicPointRests(legacy),[]);
  }
});


test('intervalo de 1 ou 19 min não reinicia contador de dois trechos com 100 min cada',()=>{
  for(const gap of [1,19]){
    const description=[480,580,580+gap,680+gap].map(clock).join('-');
    const original=thermal.parsePointPeriods(description);
    assert.equal(original.valid,true);
    const assessment=thermal.assessPointPlanning(description);
    assert.equal(assessment.valid,false);
    assert.equal(assessment.code,'MEAL_BREAK_TOO_SHORT');
    assert.deepEqual(assessment.parsed,original,'dados e validade da fonte preservados');
    assert.match(assessment.reason,/exposição e as pausas reais/);
    assert.deepEqual(thermal.dynamicPointRests(description),[]);
    assert.deepEqual(thermal.baseThermalRests(description),[]);
    assert.equal(monthly(description).has('e|2026-10-01'),false);
  }
});

test('jornada total de até 100 min não precisa de reinício mesmo com intervalo curto',()=>{
  for(const total of [80,100]){
    const description=[480,520,521,521+total-40].map(clock).join('-');
    const assessment=thermal.assessPointPlanning(description);
    assert.equal(assessment.valid,true);
    assert.equal(assessment.code,null);
    assert.equal(thermal.requiredRestCount(description),0);
    assert.deepEqual(thermal.dynamicPointRests(description),[]);
    assert.deepEqual(monthly(description).get('e|2026-10-01'),[]);
  }
  const beyond=[480,520,521,582].map(clock).join('-');
  assert.equal(thermal.assessPointPlanning(beyond).code,'MEAL_BREAK_TOO_SHORT');
});

test('intervalo de exatamente 20 min permite reinício do ciclo de trabalho',()=>{
  const description='08:00-09:40-10:00-11:40';
  assert.equal(thermal.assessPointPlanning(description).valid,true);
  assert.equal(thermal.requiredRestCount(description),0);
  assert.deepEqual(monthly(description).get('e|2026-10-01'),[]);
});

test('planejamento distingue erro de marcação, conferência de intervalo e geração sem teto arbitrário',()=>{
  const invalid=thermal.assessPointPlanning('08:00-08:00');
  assert.equal(invalid.valid,false);
  assert.equal(invalid.code,'INVALID_MARKINGS');
  assert.equal(invalid.parsed.valid,false);
  assert.equal(thermal.requiredRestCount('08:00-08:00'),null);
  const short=thermal.assessShiftPlanning('8:00-9:40-9:41-11:21');
  assert.equal(short.valid,false);
  assert.equal(short.code,'MEAL_BREAK_TOO_SHORT');
  assert.equal(short.parsed.valid,true);
  assert.equal(thermal.requiredShiftRestCount('8:00-9:40-9:41-11:21'),null);
  const admissible='08:00-12:00-13:00-20:00';
  assert.equal(thermal.assessPointPlanning(admissible).valid,true);
  assert.equal(thermal.requiredRestCount(admissible),5);
  assert.equal(thermal.requiredShiftRestCount('8:00-12:00-13:00-20:00'),5);
  assert.equal(thermal.dynamicPointRests(admissible).length,5);
  assert.equal(monthly(admissible).get('e|2026-10-01').length,5);
});
