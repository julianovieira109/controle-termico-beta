const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=name=>fs.readFileSync(path.join(__dirname,"..",name),"utf8");
const route=read("src/routes/justification-archive.js"),scope=read("src/middleware/archive-scope.js");
const frontend=read("public/js/justification-archive.js"),page=read("public/index.html");
test("colaboradores sao filtrados por filiais autorizadas, sem CPF",()=>{
 assert.match(route,/router\.get\("\/employees"/);
 assert.match(route,/e\.branch_id=ANY\(\$1::uuid\[\]\)/);
 assert.match(route,/LEFT JOIN job_roles/);
 assert.match(route,/LEFT JOIN departments/);
 assert.match(route,/LIMIT 500/);
 assert.match(scope,/JOIN branches b ON b\.id=ub\.branch_id AND b\.company_id=owner\.company_id/);
 assert.doesNotMatch(route,/SELECT e\.\*,.*\/employees/);
});
test("servidor determina empresa e filial pelo empregado selecionado",()=>{
 assert.match(route,/const employeeId=nullable\(b\.employeeId,80\)/);
 assert.match(route,/allowedUnit\(scope,e\.company_id,e\.branch_id\)/);
 assert.match(route,/companyId=e\.company_id;branchId=e\.branch_id/);
 assert.match(route,/employeeName=e\.full_name/);
 assert.match(route,/registration=nullable\(e\.registration,40\)\|\|registration/);
 assert.match(route,/INSERT INTO justification_cases\(company_id,branch_id,employee_id/);
});
test("lista sem seletores manuais e com filtro",()=>{
 assert.match(page,/id="archive-employee-search"/);
 assert.match(page,/id="archive-employee-select"/);
 assert.match(frontend,/archiveApi\("\/scope"\)/);
 assert.match(frontend,/archiveApi\("\/employees"\)/);
 assert.match(frontend,/select\.replaceChildren\(\)/);
 assert.match(frontend,/function chooseEmployee\(employee,/);
 assert.match(frontend,/employeeId:byId\("archive-employee-id"\)/);
 assert.match(frontend,/normalizeEmployeeLookup\(e\.full_name\)\.includes\(term\)/);
});
