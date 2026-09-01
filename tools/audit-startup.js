const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");

const render=fs.readFileSync(path.join(root,"render.yaml"),"utf8");
const pkg=require(path.join(root,"package.json"));
const seed=fs.readFileSync(path.join(root,"src/db/seed.js"),"utf8");

const checks=[
  ["Render não executa seed no deploy",!/buildCommand:.*npm run seed/.test(render)],
  ["Setup padrão não executa seed",!String(pkg.scripts?.setup||"").includes("seed")],
  ["Seed exige ALLOW_SEED",seed.includes("ALLOW_SEED")],
  ["Seed de produção exige autorização extra",seed.includes("ALLOW_PRODUCTION_SEED")],
  ["Dados demo em produção exigem autorização específica",seed.includes("ALLOW_PRODUCTION_DEMO_DATA")]
];

let failed=false;
for(const [label,ok] of checks){
  console.log(`${ok?"OK":"FALHA"} - ${label}`);
  if(!ok)failed=true;
}
if(failed)process.exitCode=1;
