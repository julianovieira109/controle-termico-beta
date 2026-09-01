const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const render=fs.readFileSync(path.join(root,"render.yaml"),"utf8");
const seed=fs.readFileSync(path.join(root,"src/db/seed.js"),"utf8");
const pkg=require(path.join(root,"package.json"));

test("deploy Render não executa seed automaticamente",()=>{
  assert.match(render,/buildCommand: npm ci && npm run migrate/);
  assert.doesNotMatch(render,/buildCommand:.*npm run seed/);
});
test("setup padrão não executa seed",()=>{
  assert.equal(pkg.scripts.setup,"npm run migrate");
});
test("seed exige autorização manual explícita",()=>{
  assert.match(seed,/ALLOW_SEED/);
  assert.match(seed,/Seed bloqueado por segurança/);
});
test("seed em produção possui dupla proteção",()=>{
  assert.match(seed,/ALLOW_PRODUCTION_SEED/);
  assert.match(seed,/Seed bloqueado em produção/);
});
test("dados demo em produção possuem autorização separada",()=>{
  assert.match(seed,/ALLOW_PRODUCTION_DEMO_DATA/);
});
test("auditoria de inicialização está disponível",()=>{
  assert.equal(pkg.scripts["audit:startup"],"node tools/audit-startup.js");
  assert.ok(fs.existsSync(path.join(root,"STARTUP-SAFETY.md")));
});
