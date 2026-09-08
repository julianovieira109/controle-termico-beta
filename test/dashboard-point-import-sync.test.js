const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const source=fs.readFileSync(path.join(__dirname,"../public/js/calendar-reports.js"),"utf8");

test("importacao do Cartao Senior atualiza o Dashboard imediatamente apos confirmar",()=>{
  assert.match(source,/await Promise\.all\(\[\s*loadPointImportHistory\(\),\s*typeof loadDashboard===\"function\" \? loadDashboard\(\) : Promise\.resolve\(\)/);
});

test("sincronizacao do Dashboard acontece antes da regeneracao das fichas",()=>{
  const sync=source.indexOf('typeof loadDashboard==="function" ? loadDashboard() : Promise.resolve()');
  const reports=source.indexOf('const refresh=await refreshReportsAfterPointImport(data);');
  assert.ok(sync>=0);
  assert.ok(reports>sync);
});
