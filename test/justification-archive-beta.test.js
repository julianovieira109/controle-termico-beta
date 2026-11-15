const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const route=read("src/routes/justification-archive.js");
const server=read("src/server.js");
const db=read("src/db/migrate.js");
const backup=read("src/routes/system.js");
const ui=read("public/index.html");
const core=read("public/js/core.js");

test("API do acervo somente para Master e desligada por padrao",()=>{
 assert.match(route,/router\.use\(authenticate,requireMasterAdmin\)/);
 assert.match(route,/JUSTIFICATION_ARCHIVE_BETA!=="true"/);
 assert.match(route,/private, no-store/);
 assert.match(route,/SELECT b.id FROM branches/);
});
test("integridade e autenticacao em upload e download",()=>{
 assert.match(route,/fileSize:8\*1024\*1024/);
 assert.match(route,/function detectMime\(data\)/);
 assert.match(route,/createHash\("sha256"\)/);
 assert.match(route,/INSERT INTO justification_file_contents/);
 assert.match(route,/JOIN justification_file_contents/);
 assert.match(route,/sha256\)/);
 assert.match(route,/audit\(req,"DOWNLOAD"/);
 assert.doesNotMatch(route,/express\.static\([^)]*justification/i);
});
test("ativacao do modulo e migracao",()=>{
 assert.match(server,/\/api\/justification-archive/);
 assert.match(db,/20261113_acervo_justificativas\.sql/);
 assert.match(ui,/id="justification-archive"/);
 assert.match(ui,/data-view="justification-archive"/);
 assert.match(core,/isMasterAdmin!==true/);
 assert.match(core,/loadJustificationArchive/);
});
test("backup inclui bytes em base64 e restaura depois das referencias",()=>{
 const j=backup.indexOf('const RESTORE_ORDER=[');
 const d=backup.indexOf('"justification_file_contents"',j);
 const f=backup.indexOf('"justification_files"',j);
 const c=backup.indexOf('"justification_cases"',j);
 assert.ok(c>=0&&f>c&&d>f);
 assert.match(backup,/Buffer\.from\(row\.bytes\)\.toString\("base64"\)/);
 assert.match(backup,/Buffer\.from\(String\(row\[column\]\|\|""\),"base64"\)/);
 assert.match(backup,/Este backup não contém o acervo documental/);
 assert.match(backup,/29\*1024\*1024/);
});
