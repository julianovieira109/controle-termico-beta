const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/occurrences-control.js','utf8');
const build=source.slice(source.indexOf('  function buildPrintDocument('),source.indexOf('  function printWindowHtml('));

class Element{
  constructor(text='',id=null){this.textContent=text;this.id=id;this.innerHTML='';this.nodes=new Map();this.classList={add(){}};}
  querySelector(key){return this.nodes.get(key)||null;}
  querySelectorAll(){return [...this.nodes.values()].filter(node=>node.id);}
  cloneNode(){const clone=new Element(this.textContent,this.id);for(const [key,value] of this.nodes)clone.nodes.set(key,value.cloneNode());return clone;}
  removeAttribute(name){if(name==='id')this.id=null;}
  replaceChildren(...children){this.children=children;}
  setAttribute(){}
}
function render(categories,empty=false){
  const originalCharts=new Element();
  const definitions={absences:{label:'Faltas',short:'Faltas'},'bh-positive':{label:'BH positivo',short:'BH+'},'bh-negative':{label:'BH negativo',short:'BH-'},intervals:{label:'Intervalos',short:'Intervalos'}};
  for(const [key,text] of [['#occurrences-kpi-employees','94'],['#occurrences-kpi-total','1227'],['.occurrences-charts-head h3','Título'],['.occurrences-charts-head p','Descrição'],['.occurrences-bar-chart','']]){
    originalCharts.nodes.set(key,new Element(text,key.startsWith('#')?key.slice(1):null));
  }
  const holder=new Element();
  const rows=empty?[]:Array.from({length:88},(_,i)=>({employee_id:String(i),full_name:`Pessoa ${i}`,absences:i===0?53:0,bh_positive_minutes:1}));
  const days=Object.entries({absences:53,'bh-positive':609,'bh-negative':457,intervals:231}).flatMap(([category,n])=>Array.from({length:n},()=>({employee_id:'0',category})));
  days.push({employee_id:'outside-scope',category:'absences'});
  const context={
    document:{querySelector:selector=>selector.endsWith('.occurrences-charts')?originalCharts:new Element(),createElement:()=>new Element(),createTextNode:text=>text},
    $:()=>holder,updatePrintHeader(){},dashboardRows:()=>rows,
    journeyDayMatchesPrintCategory:(day,category)=>day.category===category,
    printCategoryDefs:definitions,allPrintCategories:()=>new Set(Object.keys(definitions)),
    number:(row,key)=>Number(row[key]||0),esc:value=>String(value),formatDuration:value=>String(value),
    currentFilters:()=>({month:'2026-10'}),lastData:{imports:[]},importPeriod:()=>null,
    printCoverage:()=>({complete:false,days:13,totalDays:31}),monthLabel:value=>value,selectedText:()=>'',
    buildJourneyPrintAppendix:()=>null
  };
  vm.createContext(context);vm.runInContext(build,context);
  assert.equal(context.buildPrintDocument(days,new Set(categories)),true);
  return {holder,originalCharts};
}

test('impressão recalcula 88 colaboradores e 1350 ocorrências em vez dos totais gerais da tela',()=>{
  const {holder,originalCharts}=render(['absences','bh-positive','bh-negative','intervals']);
  const [,context,,,charts,detail]=holder.children;
  assert.match(context.innerHTML,/88 colaboradores com ocorrência/);
  assert.match(context.innerHTML,/1350 ocorrências registradas/);
  assert.equal(charts.querySelector('#occurrences-kpi-employees').textContent,'88');
  assert.equal(charts.querySelector('#occurrences-kpi-total').textContent,'1350');
  assert.match(detail.innerHTML,/88 colaboradores no relatório/);
  assert.equal(originalCharts.querySelector('#occurrences-kpi-employees').textContent,'94');
  assert.equal(originalCharts.querySelector('#occurrences-kpi-total').textContent,'1227');
  assert.equal(charts.querySelectorAll('[id]').length,0);
});

test('selecionar só faltas mantém totais impressos consistentes e exclui dias fora do escopo',()=>{
  const {holder}=render(['absences']);
  const [,context,,,charts]=holder.children;
  assert.match(context.innerHTML,/1 colaboradores com ocorrência/);
  assert.match(context.innerHTML,/53 ocorrências registradas/);
  assert.equal(charts.querySelector('#occurrences-kpi-employees').textContent,'1');
  assert.equal(charts.querySelector('#occurrences-kpi-total').textContent,'53');
});

test('escopo sem colaboradores imprime zero sem reutilizar indicadores anteriores',()=>{
  const {holder}=render(['absences'],true);
  const charts=holder.children[4];
  assert.equal(charts.querySelector('#occurrences-kpi-employees').textContent,'0');
  assert.equal(charts.querySelector('#occurrences-kpi-total').textContent,'0');
});
