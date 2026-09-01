const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('conferência do repouso não fica entre as ações principais',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const pos=html.indexOf('id="report-generate"');
  assert.ok(pos>=0);
  const start=html.lastIndexOf('<div class="full actions">',pos);
  const end=html.indexOf('</div>',pos);
  const actions=html.slice(start,end);
  assert.doesNotMatch(actions,/report-simulator-open/);
  assert.match(actions,/report-generate/);
  assert.match(actions,/report-print/);
  assert.match(actions,/report-clear/);
});

test('conferência do repouso fica dentro da validação prévia',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const start=html.indexOf('id="report-validation-panel"');
  const end=html.indexOf('</section>',start);
  const validation=html.slice(start,end);
  assert.match(validation,/id="report-simulator-open"/);
  assert.match(validation,/Conferir cálculo do repouso/);
});
