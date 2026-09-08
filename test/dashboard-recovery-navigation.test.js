const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const core=fs.readFileSync('public/js/core.js','utf8');
const admin=fs.readFileSync('public/js/admin-access.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');

test('retornar ao Painel força nova leitura automática sem botão Atualizar',()=>{
  assert.match(core,/if\(view==="dashboard"\s*&&\s*typeof loadDashboard==="function"\)loadDashboard\(\)/);
});

test('Dashboard usa cache-buster e segunda tentativa em falha transitória',()=>{
  assert.match(admin,/\/api\/dashboard\/summary\?_=/);
  assert.match(admin,/setTimeout\(resolve,650\)/);
});

test('scripts críticos do Dashboard recebem nova versão de cache',()=>{
  assert.match(html,/\/js\/core\.js\?v=1\.0\.31-beta\.28/);
  assert.match(html,/\/js\/admin-access\.js\?v=1\.0\.31-beta\.28/);
});
