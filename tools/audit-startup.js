const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const required=['src/server.js','src/routes/imports.js','src/importers/timecard-reader.js','src/importers/senior-column-layout.js','src/importers/timecard-audit.js','public/index.html','package.json'];
for(const file of required){if(!fs.existsSync(file)){console.error(`Arquivo obrigatório ausente: ${file}`);process.exit(1);}}
const js=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(entry.name.endsWith('.js'))js.push(full);}}
for(const dir of ['src','public/js','test','tools'])if(fs.existsSync(dir))walk(dir);
for(const file of js){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0){console.error(`Sintaxe inválida: ${file}\n${result.stderr||result.stdout}`);process.exit(result.status||1);}
}
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
if(!/^1\.0\.31-beta\.\d+$/.test(pkg.version)){console.error(`Versão inesperada: ${pkg.version}`);process.exit(1);}
console.log(`OK: inicialização auditada. ${js.length} arquivos JavaScript passaram no node --check. Versão ${pkg.version}.`);
