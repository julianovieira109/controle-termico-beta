const test=require('node:test');
const assert=require('node:assert/strict');
const RestAudit=require('../public/js/rest-audit.js');
const hasIssue=(audit,code)=>audit.issues.some(issue=>issue.code===code);

test('auditoria usa a regra adotada 100/20, sem teto diário fixo',()=>{
  assert.equal(RestAudit.RULE_WORK_MINUTES,100);
  assert.equal(RestAudit.RULE_REST_MINUTES,20);
  const audit=RestAudit.auditDay('08:00-12:00-13:00-19:00',[],'08:00-12:00-13:00-17:00');
  assert.equal(audit.overtimeMinutes,120);
  assert.equal(audit.dailyLimit,null);
  assert.equal(audit.requiredRestCount,5);
});

test('auditoria aprova horários suficientes e preserva seus valores sem recalcular',()=>{
  const rests=[{start:580,end:600},{start:680,end:700},{start:880,end:900},{start:980,end:1000}];
  const audit=RestAudit.auditDay('08:00-12:00-13:00-17:00',rests,'08:00-12:00-13:00-17:00');
  assert.equal(audit.valid,true);
  assert.deepEqual(audit.items.map(({start,end})=>({start,end})),rests);
  assert.ok(audit.items.every(item=>item.status==='Conforme'));
  assert.equal(audit.periods.length,2);
  assert.equal(RestAudit.formatMinutes(audit.meal.start),'12:00');
  assert.equal(RestAudit.formatMinutes(audit.meal.end),'13:00');
  assert.equal(audit.maxContinuousMinutes,100);
  assert.equal(audit.segments.filter(s=>s.beforeRestIndex===null).length,2);
});

test('primeiro trecho acima de 100 minutos não recebe selo Conforme',()=>{
  const audit=RestAudit.auditDay('08:00-12:00',[{start:660,end:680}]);
  assert.equal(audit.valid,false);
  assert.ok(hasIssue(audit,'CONTINUOUS_WORK_EXCEEDED'));
  assert.equal(audit.maxContinuousMinutes,180);
  assert.equal(audit.items[0].continuousBefore,180);
  assert.equal(audit.items[0].status,'Revisar');
});

test('último trecho de 153 minutos é verificado após o repouso',()=>{
  const audit=RestAudit.auditDay('08:00-12:00',[{start:547,end:567}]);
  assert.equal(audit.valid,false);
  assert.ok(audit.issues.some(issue=>issue.code==='CONTINUOUS_WORK_EXCEEDED'&&issue.duration===153&&issue.beforeRestIndex===null));
  assert.equal(audit.items[0].status,'Revisar');
});

test('a refeição reinicia a contagem e nenhum repouso pode atravessá-la',()=>{
  const audit=RestAudit.auditDay('08:00-09:40-10:40-12:20',[]);
  assert.equal(audit.valid,true);
  assert.equal(audit.requiredRestCount,0);
  assert.equal(audit.maxContinuousMinutes,100);
  const crossed=RestAudit.auditDay('08:00-12:00-13:00-17:00',[{start:710,end:790}]);
  assert.equal(crossed.valid,false);
  assert.ok(hasIssue(crossed,'REST_OUTSIDE_WORK'));
});

test('trechos antes, entre e após os repousos precisam respeitar 100 minutos',()=>{
  const audit=RestAudit.auditDay('08:00-14:00',[{start:570,end:590},{start:710,end:730}]);
  assert.equal(audit.valid,false);
  assert.ok(audit.issues.some(issue=>issue.code==='CONTINUOUS_WORK_EXCEEDED'&&issue.duration===120&&issue.beforeRestIndex===2));
});

test('sobreposição e ordem invertida são sinalizadas sem ordenar a entrada silenciosamente',()=>{
  const overlap=RestAudit.auditDay('08:00-12:00',[{start:560,end:580},{start:570,end:590}]);
  assert.equal(overlap.valid,false);
  assert.ok(hasIssue(overlap,'REST_OVERLAP'));
  const reverse=RestAudit.auditDay('08:00-12:00',[{start:680,end:700},{start:580,end:600}]);
  assert.equal(reverse.valid,false);
  assert.ok(hasIssue(reverse,'REST_ORDER'));
  assert.deepEqual(reverse.items.map(item=>item.start),[680,580]);
});

test('cada pausa precisa ter exatamente 20 minutos',()=>{
  for(const duration of [0,19,21,25]){
    const audit=RestAudit.auditDay('08:00-10:00',[{start:530,end:530+duration}]);
    assert.equal(audit.valid,false);
    assert.equal(audit.items[0].status,'Revisar');
    assert.ok(hasIssue(audit,duration===0?'INVALID_REST':'INVALID_REST_DURATION'));
  }
  assert.equal(RestAudit.auditDay('08:00-10:00',[{start:530,end:550}]).valid,true);
});

test('ponto noturno usa minutos normalizados, preservando a data-base do ponto',()=>{
  const audit=RestAudit.auditDay('22:00-02:00',[{start:1420,end:1440},{start:1520,end:1540}]);
  assert.equal(audit.valid,true);
  assert.equal(audit.items[0].endLabel,'00:00');
  assert.equal(audit.items[1].startLabel,'01:20');
  assert.equal(audit.maxContinuousMinutes,100);
});

test('batidas iguais, excesso de batidas e marcações inválidas bloqueiam a auditoria',()=>{
  for(const description of ['08:00-08:00','08:00-12:00-12:00-17:00','08:00-12:00-13:00-17:00-18:00','08:00-99:00','']){
    const audit=RestAudit.auditDay(description,[{start:580,end:600}]);
    assert.equal(audit.valid,false,description);
    assert.ok(hasIssue(audit,'INVALID_POINT'),description);
    assert.equal(audit.items[0].status,'Revisar');
    assert.equal(audit.requiredRestCount,null);
    assert.equal(audit.maxContinuousMinutes,null);
  }
});

test('repousos inválidos não desaparecem da auditoria',()=>{
  for(const rest of [null,{}, {start:null,end:600}, {start:'580',end:600}, {start:580,end:NaN}, {start:580.5,end:600.5}, {start:600,end:580}]){
    const audit=RestAudit.auditDay('08:00-09:00',[rest]);
    assert.equal(audit.valid,false);
    assert.equal(audit.items.length,1);
    assert.ok(hasIssue(audit,'INVALID_REST'));
  }
  const nonArray=RestAudit.auditDay('08:00-09:00',null);
  assert.equal(nonArray.valid,false);
  assert.ok(hasIssue(nonArray,'INVALID_RESTS'));
  const sparse=RestAudit.auditDay('08:00-09:00',new Array(1));
  assert.equal(sparse.items.length,1);
  assert.ok(hasIssue(sparse,'INVALID_REST'));
});

test('dia curto sem pausas é válido, dia longo sem pausas fica bloqueado',()=>{
  for(const description of ['08:00-09:30','08:00-09:40']){
    const audit=RestAudit.auditDay(description,[]);
    assert.equal(audit.valid,true);
    assert.equal(audit.requiredRestCount,0);
  }
  const audit=RestAudit.auditDay('08:00-09:41',[]);
  assert.equal(audit.valid,false);
  assert.ok(hasIssue(audit,'MISSING_RESTS'));
  assert.ok(hasIssue(audit,'CONTINUOUS_WORK_EXCEEDED'));
});

test('quantidade não é limitada a três ou quatro pausas e omissão de pausa é detectada',()=>{
  const description='08:00-12:00-13:00-19:00';
  const rests=[{start:547,end:567},{start:634,end:654},{start:855,end:875},{start:950,end:970},{start:1045,end:1065}];
  assert.equal(rests.length,5);
  const audit=RestAudit.auditDay(description,rests);
  assert.equal(audit.valid,true);
  assert.equal(audit.requiredRestCount,5);
  const truncated=RestAudit.auditDay(description,rests.slice(0,4));
  assert.equal(truncated.valid,false);
  assert.ok(hasIssue(truncated,'MISSING_RESTS'));
  assert.ok(truncated.items.every(item=>item.status==='Revisar'));
});

test('intervalo menor que 20 minutos não reinicia contagem em jornada acima de 100',()=>{
  const audit=RestAudit.auditDay('08:00-09:30-09:40-11:10',[]);
  assert.equal(audit.valid,false);
  assert.ok(hasIssue(audit,'MEAL_BREAK_TOO_SHORT'));
  assert.equal(hasIssue(audit,'INVALID_POINT'),false);
  assert.equal(audit.periods.length,2);
  assert.equal(audit.actualWorked,180);
  assert.equal(audit.requiredRestCount,null);
  assert.equal(audit.missingRestCount,null);
  assert.equal(audit.maxContinuousMinutes,180);
  assert.ok(audit.issues.some(issue=>issue.code==='CONTINUOUS_WORK_EXCEEDED'&&issue.acrossMeal&&issue.duration===180));
});

test('auditoria mantém todos os repousos em revisão quando a refeição curta exige conferência',()=>{
  const audit=RestAudit.auditDay('08:00-09:30-09:40-11:10',[{start:580,end:600}]);
  assert.equal(audit.valid,false);
  assert.ok(hasIssue(audit,'MEAL_BREAK_TOO_SHORT'));
  assert.equal(audit.items[0].status,'Revisar');
  assert.equal(audit.items[0].continuousBefore,90);
  assert.equal(audit.requiredRestCount,null);
});

test('intervalo curto em jornada de até 100 minutos não exige pausa nem reinício',()=>{
  for(const description of ['08:00-08:30-08:40-09:10','08:00-08:50-09:00-09:50']){
    const audit=RestAudit.auditDay(description,[]);
    assert.equal(audit.valid,true,description);
    assert.equal(audit.requiredRestCount,0);
    assert.equal(audit.maxContinuousMinutes,audit.actualWorked);
    assert.equal(hasIssue(audit,'MEAL_BREAK_TOO_SHORT'),false);
  }
});

test('intervalo de exatamente 20 minutos mantém a separação dos trechos',()=>{
  const audit=RestAudit.auditDay('08:00-09:30-09:50-11:20',[]);
  assert.equal(audit.valid,true);
  assert.equal(audit.requiredRestCount,0);
  assert.equal(audit.maxContinuousMinutes,90);
});

test('intervalo curto noturno é preservado e o trabalho acumulado não inclui os minutos de intervalo',()=>{
  const audit=RestAudit.auditDay('22:00-23:30-23:40-01:10',[]);
  assert.equal(audit.valid,false);
  assert.ok(hasIssue(audit,'MEAL_BREAK_TOO_SHORT'));
  assert.equal(audit.maxContinuousMinutes,180);
  assert.equal(audit.meal.end-audit.meal.start,10);
  assert.equal(audit.periods[1].end,1510);
});
