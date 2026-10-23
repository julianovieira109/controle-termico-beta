const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const script=fs.readFileSync('public/js/occurrences-control.js','utf8');
const window={};
vm.runInNewContext(script,{window,document:{getElementById:()=>null,addEventListener:()=>{}},URLSearchParams,Intl,Date});
const filter=window.OccurrencesControl.filterManagementEmployees;
const employees=[
  {id:'a',full_name:'José Gonçalves',registration:'00000123',shift_id:'s1',shift_name:'1º Turno',status:'ATIVO'},
  {id:'b',full_name:'Maria Souza',registration:'987',shift_id:'s2',shift_name:'Comercial',status:'DEMITIDO',active:false},
  {id:'c',full_name:'Ana Clara',registration:'456',shift_id:null,shift_name:null,status:'ATIVO'}
];
const ids=rows=>Array.from(rows,item=>item.id);

test('busca de equipe usa nome sem acentos e matrícula com ou sem zeros',()=>{
  assert.deepEqual(ids(filter(employees,'jose goncalves')),['a']);
  assert.deepEqual(ids(filter(employees,'123')),['a']);
  assert.deepEqual(ids(filter(employees,'00000123')),['a']);
  assert.deepEqual(ids(filter(employees,'00000987')),['b']);
});

test('busca por nome de turno combina com filtro explícito e opção sem turno',()=>{
  assert.deepEqual(ids(filter(employees,'comercial')),['b']);
  assert.deepEqual(ids(filter(employees,'turno','s1')),['a']);
  assert.deepEqual(ids(filter(employees,'maria','s1')),[]);
  assert.deepEqual(ids(filter(employees,'','__NO_SHIFT__')),['c']);
});

test('catálogo da equipe preserva histórico cadastral e não depende de dias de ponto',()=>{
  assert.deepEqual(ids(filter(employees)),['c','a','b']);
  assert.deepEqual(ids(filter(employees,'maria')),['b']);
  assert.deepEqual(ids(filter([],'maria')),[]);
  assert.deepEqual(ids(filter(null)),[]);
  assert.equal(Object.hasOwn(employees[0],'employee_id'),false);
  assert.equal(Object.hasOwn(employees[0],'work_date'),false);
});
