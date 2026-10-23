const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Controle de Ocorrências possui visão executiva por equipe e turno',()=>{
  const html=read('public/index.html');
  assert.match(html,/Controle de Ocorrências/);
  assert.match(html,/Distribuição da Equipe/);
  assert.match(html,/Principais Ocorrências/);
  assert.match(html,/Situação por Turno/);
  assert.match(html,/Principais Pontos de Atenção/);
  assert.match(html,/Destaques Positivos/);
  assert.match(html,/Modo Apresentação/);
});

test('visão executiva é calculada com dados carregados de ocorrências',()=>{
  const js=read('public/js/occurrences-control.js');
  assert.match(js,/function renderExecutiveInsights\(\)/);
  assert.match(js,/dashboardRows\(\)/);
  assert.match(js,/occ-impact-bars/);
  assert.match(js,/occ-shift-grid/);
  assert.match(js,/occ-general-suggestion/);
});
