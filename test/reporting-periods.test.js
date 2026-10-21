const test=require('node:test');
const assert=require('node:assert/strict');
const {periodRange}=require('../src/lib/reporting-periods');

test('recortes mensais preservam fechamento 19 a 18 e virada do ano',()=>{
  assert.deepEqual(periodRange('2026-01'),{label:'2026-01',start:'2025-12-19',end:'2026-01-18'});
  assert.deepEqual(periodRange('2026-10','month','closing'),{label:'2026-10',start:'2026-09-19',end:'2026-10-18'});
});

test('meses calendário respeitam ano bissexto e quantidade de dias',()=>{
  assert.deepEqual(periodRange('2024-02','month','calendar'),{label:'2024-02',start:'2024-02-01',end:'2024-02-29'});
  assert.equal(periodRange('2026-02','month','calendar').end,'2026-02-28');
  assert.equal(periodRange('2026-12','month','calendar').end,'2026-12-31');
});

test('recortes anuais preservam fechamento e calendário',()=>{
  assert.deepEqual(periodRange('2026','year'),{label:'2026',start:'2025-12-19',end:'2026-12-18'});
  assert.deepEqual(periodRange('2026','year','calendar'),{label:'2026',start:'2026-01-01',end:'2026-12-31'});
});

test('semana ISO vai de segunda a domingo e pode atravessar o ano civil',()=>{
  assert.deepEqual(periodRange('2026-W01','week'),{label:'2026-W01',start:'2025-12-29',end:'2026-01-04'});
  assert.deepEqual(periodRange('2021-W01','week'),{label:'2021-W01',start:'2021-01-04',end:'2021-01-10'});
  assert.deepEqual(periodRange('2020-W53','week'),{label:'2020-W53',start:'2020-12-28',end:'2021-01-03'});
  assert.deepEqual(periodRange('2026-W53','week'),{label:'2026-W53',start:'2026-12-28',end:'2027-01-03'});
});

test('semanal usa o mesmo recorte ISO independentemente da base mensal',()=>{
  assert.deepEqual(periodRange('2026-W43','week','closing'),periodRange('2026-W43','week','calendar'));
});

test('limites de ano do gerencial não limitam os dias de borda da semana',()=>{
  assert.deepEqual(periodRange('2000-W01','week'),{label:'2000-W01',start:'2000-01-03',end:'2000-01-09'});
  assert.equal(periodRange('2100','year','calendar').end,'2100-12-31');
  for(const value of ['1999','2101'])assert.throws(()=>periodRange(value,'year'),/2000 a 2100/);
  for(const value of ['1999-W52','2101-W01'])assert.throws(()=>periodRange(value,'week'),/2000 a 2100/);
});

test('rejeita semana 53 inexistente, semana zero, 54 e formatos incompletos',()=>{
  for(const value of ['2021-W53','2025-W53','2026-W00','2026-W54','2026-W1','2026-43','foo','']){
    assert.throws(()=>periodRange(value,'week'),value);
  }
});

test('rejeita modos, bases e meses inválidos sem normalizar períodos incorretos',()=>{
  for(const value of ['2026-00','2026-13','2026-2','2026-01-01','foo'])assert.throws(()=>periodRange(value));
  assert.throws(()=>periodRange('2026-10','day'),/Tipo de comparação/);
  assert.throws(()=>periodRange('2026-10','month','free'),/Tipo de comparação/);
});
