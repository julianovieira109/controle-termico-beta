const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const limits={
  "public/index.html":180*1024,
  "public/css/enhancements.css":110*1024,
  "public/js/calendar-reports.js":90*1024,
  "public/js/settings-system.js":110*1024,
  "src/routes/imports.js":150*1024
};
let failed=false;
for(const [rel,limit] of Object.entries(limits)){
  const file=path.join(root,rel);
  const size=fs.statSync(file).size;
  const ok=size<=limit;
  console.log(`${ok?"OK":"LIMITE"} ${rel}: ${(size/1024).toFixed(1)} KB / ${(limit/1024).toFixed(0)} KB`);
  if(!ok)failed=true;
}
if(failed)process.exitCode=1;
