const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Controle de Ocorrências prioriza painel gerencial enxuto',()=>{
  const html=read('public/index.html');
  assert.match(html,/id="occurrences-primary-kpis"/);
  assert.match(html,/Ver análise completa da competência/);
  assert.match(html,/Colaborador<\/th><th>Turno \/ Coordenador<\/th><th>Indicador<\/th><th>Faltas<\/th><th>BH<\/th><th>Revisão<\/th><th>Jornada/);
});

test('Jornada compara intervalo real com jornada prevista sem alterar ponto Senior',()=>{
  const js=read('public/js/occurrences-control.js');
  assert.match(js,/ThermalSchedule\?\.parseShiftSchedule/);
  assert.match(js,/Intervalo fora do padrão/);
  assert.match(js,/Verificar necessidade e autorização das horas adicionais\/BH/);
  assert.doesNotMatch(js,/UPDATE\s+employee_point_days|DELETE\s+FROM\s+employee_point_days/i);
});
