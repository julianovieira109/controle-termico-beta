const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {validateDescription,normalizeCode}=require('../public/js/shift-schedule');

test('novo turno aceita dois horários reais sem criar refeição',()=>{
  for(const source of ['14:00 - 18:00 APRENDIZsgAsx-E','08:00-12:00 - APRENDIZsgAsx']){
    const result=validateDescription(source);
    assert.equal(result.valid,true);
    assert.equal(result.markings.length,2);
    assert.equal(result.type,'CONTINUOUS');
    assert.equal(result.hasMealBreak,false);
    assert.equal(result.rawDescription,source);
    assert.equal(result.description,source);
    assert.equal(result.normalizedDescription,result.markings.join(' às '));
  }
});

test('quatro horários completos mantêm os intervalos e a virada noturna',()=>{
  for(const source of ['08:00-12:00-13:00-17:00','22:00-00:00-01:00-06:00','08:00PRE12:00PRE13:30PRE18:00']){
    const result=validateDescription(source);
    assert.equal(result.valid,true,source);
    assert.equal(result.type,'SPLIT');
    assert.equal(result.hasMealBreak,true);
    assert.equal(result.markings.length,4);
  }
});

test('PRE com minutos omitidos exige conferência sem inventar :00',()=>{
  for(const source of ['08:00-12PRE-13:PRE-17:00sgAs','08:0012PRE13:30PRE18:00sgAsb-E','08:00-12PRE-13:00-17:00']){
    const result=validateDescription(source);
    assert.equal(result.valid,false,source);
    assert.equal(result.description,source);
    assert.equal(result.normalizedDescription,null);
    assert.equal(result.schedule,null);
    assert.equal(result.code,'INCOMPLETE_TIME');
    assert.match(result.reason,/omite minutos/);
    assert.equal(result.rawDescription,source);
    assert.equal(result.sourceOnlyAllowed,true);
    assert.equal(result.type,'SOURCE_ONLY');
    assert.equal(result.hasMealBreak,null);
  }
});

test('horários incompletos, inválidos, duplicados e sequências longas não são truncados',()=>{
  for(const source of ['08:00-08:00','08:00-12:00-12:00-17:00','08:00-12:00-13:00-08:00','22:00-02:00-01:00-06:00','24:00-18:00','08:00-12:60','08:00-12:00-13:00','08:00-10:00-11:00-13:00-14:00-17:00','08:00-12:00-13','08:00:00-12:00']){
    assert.equal(validateDescription(source).valid,false,source);
  }
  const six=validateDescription('08:00-10:00-11:00-13:00-14:00-17:00');
  assert.equal(six.markings.length,6);
});

test('código Senior novo é numérico, preservando identidade sem zeros à esquerda',()=>{
  assert.equal(normalizeCode('0009'),'9');
  assert.equal(normalizeCode('5'),'5');
  for(const code of ['',null,'9x','-9','00009','9.5'])assert.equal(normalizeCode(code),null);
});

test('preservação de abreviaturas da Senior não autoriza relógios inválidos nem batidas extras',()=>{
  for(const source of ['08:00-12PRE-13:PRE-25:00','08:00-12PRE-13:PRE-17:00-18:00','08:00-08:00-13PRE-17:00','22:00-02PRE-01:PRE-06:00','08:00-12PRE-13:PRE-08:00','08:00-12:60-13PRE-17:00']){
    const result=validateDescription(source);
    assert.equal(result.valid,false,source);
    assert.equal(result.sourceOnlyAllowed,false,source);
  }
});

test('descrição maior que o campo do cadastro é sinalizada sem cortar o texto original',()=>{
  const source='08:00-12:00 '+ 'APRENDIZ '.repeat(25);
  const result=validateDescription(source);
  assert.equal(result.valid,false);
  assert.equal(result.code,'DESCRIPTION_TOO_LONG');
  assert.equal(result.description,source.trim());
  assert.equal(result.sourceOnlyAllowed,false);
});

test('o navegador e o servidor compartilham a mesma validação de turno',()=>{
  const context={};
  vm.runInNewContext(fs.readFileSync('public/js/shift-schedule.js','utf8'),context);
  for(const source of ['14:00 - 18:00 APRENDIZsgAsx-E','08:00-12PRE-13:PRE-17:00sgAs','22:00-00:00-01:00-06:00']){
    assert.equal(JSON.stringify(context.ShiftSchedule.validateDescription(source)),JSON.stringify(validateDescription(source)));
  }
});
