const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const core=fs.readFileSync('public/js/core.js','utf8');
const admin=fs.readFileSync('public/js/admin-access.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');

test('retornar ao Painel força nova leitura automática sem botão Atualizar',()=>{
  assert.match(core,/if\(view==="dashboard"\s*&&\s*typeof window\.loadDashboard==="function"\)/);
  assert.match(core,/window\.loadDashboard\(\)\.catch/);
});

test('Dashboard usa cache-buster e segunda tentativa em falha transitória',()=>{
  assert.match(admin,/\/api\/dashboard\/summary\?_=/);
  assert.match(admin,/attempt<2/);
  assert.match(admin,/setTimeout\(resolve,500\)/);
});

test('scripts críticos do Dashboard possuem versão de cache e arquivo existente',()=>{
  for(const name of ['core','admin-access']){
    const match=html.match(new RegExp(`/js/${name}\\.js\\?v=(1\\.0\\.31-beta\\.\\d+)`));
    assert.ok(match,`${name} precisa de versão de cache`);
    assert.ok(fs.existsSync(`public/js/${name}.js`));
  }
});
