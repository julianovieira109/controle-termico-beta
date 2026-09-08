const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');

test('Controle de Ocorrencias possui semaforo verde amarelo vermelho',()=>{
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'public/js/occurrences-control.js'),'utf8');
  const route=fs.readFileSync(path.join(root,'src/routes/dashboard.js'),'utf8');
  assert.match(html,/id="occurrences-status"/);
  assert.match(html,/id="occ-status-green"/);
  assert.match(html,/id="occ-status-yellow"/);
  assert.match(html,/id="occ-status-red"/);
  assert.match(js,/indicator_status==="RED"/);
  assert.match(route,/row\.indicator_status=critical\.length\?'RED':attention\.length\?'YELLOW':'GREEN'/);
});

test('Ocorrencias justificadas nao entram diretamente como agravantes do semaforo',()=>{
  const route=fs.readFileSync(path.join(root,'src/routes/dashboard.js'),'utf8');
  const classification=route.slice(route.indexOf('const critical=[]'),route.indexOf("row.green_eligible=row.indicator_status==='GREEN'"));
  for(const token of ['medical','vacations','licenses','leaves','courses','bereavement','dsr','days_off']){
    assert.doesNotMatch(classification,new RegExp(`if\\(${token}`));
  }
});
