const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const route=read("src/routes/justification-archive.js"),scope=read("src/middleware/archive-scope.js");
const server=read("src/server.js"),db=read("src/db/migrate.js"),backup=read("src/routes/system.js");
const ui=read("public/index.html"),core=read("public/js/core.js");
test("consulta de documentos exige login, escopo DB e flag beta",()=>{
 assert.match(route,/router\.use\(authenticate\)/);
 assert.match(route,/requireScope\(\)/);
 assert.match(route,/requireScope\("manage"\)/);
 assert.match(scope,/JUSTIFICATION_ARCHIVE_BETA/);
 assert.match(scope,/private, no-store/);
 assert.match(scope,/user_branches/);
 assert.match(scope,/profile_permissions/);
 assert.match(scope,/branchIds:list\.map/);
});
test("upload e download exigem escopo e hash",()=>{
 assert.match(route,/fileSize:8\*1024\*1024/);
 assert.match(route,/function mimeOf\(bytes\)/);
 assert.match(route,/createHash\("sha256"\)/);
 assert.match(route,/INSERT INTO justification_file_contents/);
 assert.match(route,/await readCase\(req\.archiveScope/);
 assert.match(route,/audit\(req,"DOWNLOAD"/);
 assert.doesNotMatch(route,/express\.static\([^)]*justification/i);
});
test("interface e perfil exibem apenas unidades autorizadas",()=>{
 assert.match(server,/\/api\/justification-archive/);
 assert.match(db,/20261113_acervo_justificativas\.sql/);
 assert.match(ui,/id="justification-archive"/);
 assert.match(ui,/data-special-permission="documents.view"/);
 assert.match(ui,/data-profile-permission="documents.view"/);
 assert.match(ui,/data-profile-permission="documents.manage"/);
 assert.doesNotMatch(ui,/id="archive-company"|id="archive-branch"/);
 assert.match(core,/hasDocumentAccess/);
 assert.match(core,/loadJustificationArchive/);
});
test("backup inclui bytes e preserva restauracao",()=>{
 const j=backup.indexOf('const RESTORE_ORDER=['),d=backup.indexOf('"justification_file_contents"',j);
 const f=backup.indexOf('"justification_files"',j),c=backup.indexOf('"justification_cases"',j);
 assert.ok(c>=0&&f>c&&d>f);
 assert.match(backup,/Buffer\.from\(row\.bytes\)\.toString\("base64"\)/);
 assert.match(backup,/Buffer\.from\(String\(row\[column\]\|\|""\),"base64"\)/);
});
