(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ReportValidator=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function text(value){return String(value??'').trim();}
  function upper(value){return text(value).toUpperCase();}
  function active(employee){return upper(employee?.status)==='ATIVO';}
  function policyAllows(policy,type){
    const value=upper(policy||'PENDING');
    if(type==='thermal')return value==='BOTH'||value==='THERMAL_ONLY';
    if(type==='meal')return value==='BOTH'||value==='MEAL_ONLY';
    return value==='BOTH'||value==='THERMAL_ONLY'||value==='MEAL_ONLY';
  }
  function automaticAllowed(employee,config={}){
    if(!['AUTOMATIC','AUTOMATIC_AND_BLANK'].includes(upper(config.mode)))return false;
    if(upper(config.scopeMode)!=='SELECTED')return true;
    const companies=(config.authorizedCompanyIds||[]).map(String);
    const branches=(config.authorizedBranchIds||[]).map(String);
    if(branches.length)return branches.includes(String(employee?.branch_id||''));
    return companies.includes(String(employee?.company_id||''));
  }
  function issue(level,code,message,employee=null){
    return {level,code,message,employeeId:employee?.id??null,employeeName:text(employee?.full_name)||null};
  }
  function validate({month,employees=[],thermalConfig={},pointCompetenceBranches=[]}={}){
    const blockers=[]; const warnings=[]; const ok=[];
    const branchSet=new Set([...pointCompetenceBranches].map(String));
    if(!/^\d{4}-\d{2}$/.test(text(month))){
      blockers.push(issue('blocker','MONTH_REQUIRED','Selecione uma competência válida antes de gerar as fichas.'));
    }
    if(!Array.isArray(employees)||employees.length===0){
      blockers.push(issue('blocker','NO_EMPLOYEES','Nenhum colaborador foi selecionado para validação.'));
      return {valid:false,blockers,warnings,ok,counts:{employees:0,blockers:blockers.length,warnings:0,ok:0}};
    }
    for(const employee of employees){
      const name=text(employee.full_name)||'Colaborador sem nome';
      if(!active(employee)){
        warnings.push(issue('warning','INACTIVE',`${name}: situação não ativa; a ficha será ignorada.`,employee));
        continue;
      }
      if(!policyAllows(employee.report_policy)){
        warnings.push(issue('warning','POLICY_BLOCKED',`${name}: regra de relatórios pendente ou configurada para não gerar.`,employee));
        continue;
      }
      if(!text(employee.shift_name)){
        warnings.push(issue('warning','NO_SHIFT',`${name}: sem turno cadastrado; a ficha será ignorada.`,employee));
        continue;
      }
      if(!text(employee.registration)){
        warnings.push(issue('warning','NO_REGISTRATION',`${name}: matrícula não informada.`,employee));
      }
      const auto=policyAllows(employee.report_policy,'thermal')&&automaticAllowed(employee,thermalConfig);
      if(auto){
        if(!branchSet.has(String(employee.branch_id||''))){
          blockers.push(issue('blocker','POINT_COMPETENCE_MISSING',`${name}: não há Cartão de Ponto confirmado para a filial nesta competência.`,employee));
          continue;
        }
        const schedules=employee.point_schedules&&typeof employee.point_schedules==='object'?employee.point_schedules:{};
        const states=employee.point_states&&typeof employee.point_states==='object'?employee.point_states:{};
        if(Object.keys(schedules).length===0&&Object.keys(states).length===0){
          warnings.push(issue('warning','NO_POINT_ROWS',`${name}: a filial possui ponto importado, mas não foram localizados dias deste colaborador na competência.`,employee));
        }
      }
      ok.push({employeeId:employee.id??null,employeeName:name});
    }
    return {
      valid:blockers.length===0,
      blockers,warnings,ok,
      counts:{employees:employees.length,blockers:blockers.length,warnings:warnings.length,ok:ok.length}
    };
  }
  return {validate,active,policyAllows,automaticAllowed};
});
