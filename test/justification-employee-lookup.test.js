const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=name=>fs.readFileSync(path.join(__dirname,"..",name),"utf8");
const route=read("src/routes/justification-archive.js");
const frontend=read("public/js/justification-archive.js");
const page=read("public/index.html");
test("busca de colaborador somente na empresa e filial selecionadas, sem CPF",()=>{
 assert.match(route,/router\.get\("\/employees"/);
 assert.match(route,/router\.use\(authenticate,requireMasterAdmin\)/);
 assert.match(route,/await assertUnit\(companyId,branchId\)/);
 assert.match(route,/e\.company_id=\$1 AND e\.branch_id=\$2/);
 assert.match(route,/LIMIT 500/);
 assert.match(route,/LEFT JOIN job_roles/);
 assert.match(route,/LEFT JOIN departments/);
 assert.doesNotMatch(route,/SELECT e\.\*,.*\/employees/);
});
test("salva vinculo por id validado e campos canonicos do cadastro",()=>{
 assert.match(route,/const employeeId=nullable\(b\.employeeId,80\)/);
 assert.match(route,/WHERE e\.id=\$1 AND e\.company_id=\$2 AND e\.branch_id=\$3/);
 assert.match(route,/employeeName=e\.full_name/);
 assert.match(route,/registration=nullable\(e\.registration,40\)\|\|registration/);
 assert.match(route,/jobTitle=nullable\(e\.job_title,180\)\|\|jobTitle/);
 assert.match(route,/department=nullable\(e\.department,160\)\|\|department/);
 assert.match(route,/INSERT INTO justification_cases\(company_id,branch_id,employee_id/);
});
test("interface permite buscar, selecionar, preencher e trocar colaborador",()=>{
 assert.match(page,/id="archive-employee-search"/);
 assert.match(page,/id="archive-employee-results"/);
 assert.match(page,/id="archive-employee-id"/);
 assert.match(frontend,/function chooseEmployee\(employee,/);
 assert.match(frontend,/async function searchEmployees\(\)/);
 assert.match(frontend,/employeeId:byId\("archive-employee-id"\)/);
 assert.match(frontend,/clearEmployeeSelection\(\)/);
 assert.match(frontend,/setEmployeeFieldsReadonly\(true,/);
});
