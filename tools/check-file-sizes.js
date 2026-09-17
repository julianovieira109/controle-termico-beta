const fs=require('node:fs');
const path=require('node:path');
const roots=['src','public','test','tools'];
const limit=600*1024;
const files=[];
function walk(dir){
  if(!fs.existsSync(dir))return;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())walk(full);
    else if(/\.(js|css|html|json)$/.test(entry.name))files.push({file:full,size:fs.statSync(full).size});
  }
}
for(const root of roots)walk(root);
const oversized=files.filter(item=>item.size>limit).sort((a,b)=>b.size-a.size);
const largest=[...files].sort((a,b)=>b.size-a.size).slice(0,10);
console.log('Maiores arquivos:');
for(const item of largest)console.log(`${String(Math.round(item.size/1024)).padStart(4)} KB  ${item.file}`);
if(oversized.length){
  console.error(`\nFalha: ${oversized.length} arquivo(s) ultrapassam ${Math.round(limit/1024)} KB.`);
  process.exit(1);
}
console.log(`\nOK: ${files.length} arquivo(s) verificados; nenhum ultrapassa ${Math.round(limit/1024)} KB.`);
