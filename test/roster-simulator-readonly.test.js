const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('simuladores 5x2 não possuem ações de gravação',()=>{
  for(const file of [
    'client/escala/components/planning-guide.tsx',
    'client/escala/components/journey-planner.tsx',
    'client/escala/components/operational-generator.tsx'
  ]){
    const source=read(file);
    assert.doesNotMatch(source,/save\s*\(/,file);
    assert.doesNotMatch(source,/Salvar rascunho|Lançar em Escalas e folgas|Aplicar no planejamento/,file);
  }
});

test('servidor bloqueia ações legadas do simulador 5x2',()=>{
  const source=read('src/routes/roster-planning.js');
  assert.match(source,/módulo de escala 5x2 é somente simulador/);
  assert.match(source,/Simulador simples 5x2:/);
  assert.match(source,/Rascunho de sugestão 5x2:/);
});

test('jornadas simuladas não fazem parte dos campos persistentes do planejamento',()=>{
  const source=read('src/services/roster-planning.js');
  const line=source.match(/const planningFields=\[[^\n]+/)[0];
  assert.doesNotMatch(line,/journeys/);
  assert.match(source,/Jornadas da escala 5x2 são somente simulação/);
});
