function text(value){ return String(value??"").trim(); }
function upper(value){ return text(value).toUpperCase(); }

function automaticScopeAllows(employee,config={}){
  const scope=upper(config.scopeMode||"ALL");
  if(scope!=="SELECTED")return true;
  const branches=new Set((Array.isArray(config.authorizedBranchIds)?config.authorizedBranchIds:[]).map(String));
  const companies=new Set((Array.isArray(config.authorizedCompanyIds)?config.authorizedCompanyIds:[]).map(String));
  if(branches.size)return branches.has(String(employee?.branch_id||""));
  return companies.has(String(employee?.company_id||""));
}

function classify({employees=[],imports=[],pointRows=[],thermalConfig={}}={}){
  const importedBranches=new Set(imports.map(row=>String(row.branch_id)));
  const employeesWithPoint=new Set(pointRows.map(row=>String(row.employee_id)));

  const missingShift=[];
  const missingRegistration=[];
  const pendingPolicy=[];
  const missingPointRows=[];
  const branchMap=new Map();

  for(const employee of employees){
    const branchId=String(employee.branch_id||"");
    const base={
      id:employee.id,
      name:employee.full_name||"Colaborador sem nome",
      registration:employee.registration||"",
      companyName:employee.company_name||"-",
      branchName:employee.branch_name||"-"
    };

    if(!text(employee.shift_name))missingShift.push(base);
    if(!text(employee.registration))missingRegistration.push(base);

    const policy=upper(employee.report_policy||"PENDING");
    if(policy==="PENDING")pendingPolicy.push(base);

    const thermalPolicy=policy==="BOTH"||policy==="THERMAL_ONLY";
    const automaticMode=upper(thermalConfig.mode||"AUTOMATIC")!=="MANUAL";
    const needsPoint=thermalPolicy&&automaticMode&&automaticScopeAllows(employee,thermalConfig);

    if(needsPoint&&!branchMap.has(branchId)){
      branchMap.set(branchId,{
        branchId,
        companyName:employee.company_name||"-",
        branchName:employee.branch_name||"-"
      });
    }

    if(needsPoint&&text(employee.shift_name)&&importedBranches.has(branchId)&&!employeesWithPoint.has(String(employee.id))){
      missingPointRows.push(base);
    }
  }

  const missingPointImport=[...branchMap.values()]
    .filter(branch=>!importedBranches.has(branch.branchId));

  const critical=missingShift.length+missingPointImport.length;
  const warnings=missingRegistration.length+pendingPolicy.length+missingPointRows.length;

  return {
    summary:{critical,warnings,total:critical+warnings},
    groups:{
      missingShift,
      missingRegistration,
      pendingPolicy,
      missingPointImport,
      missingPointRows
    }
  };
}

module.exports={classify,automaticScopeAllows};
