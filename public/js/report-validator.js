(function(root,factory){
  const api=factory(
    typeof module==='object'&&module.exports?require('./thermal-schedule.js'):root.ThermalSchedule,
    ()=>typeof module==='object'&&module.exports?require('./rest-audit.js'):root.RestAudit
  );
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ReportValidator=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(ThermalSchedule,getRestAudit){
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
    const missingPointByBranch=new Map();
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(text(month))){
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
        // A política PENDING/NONE já é detalhada em "Colaboradores sem ficha".
        // Não repetir o mesmo colaborador na validação prévia.
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
          const branchId=String(employee.branch_id||'');
          const current=missingPointByBranch.get(branchId)||{
            branchId,
            branchName:text(employee.branch_name)||'Filial não identificada',
            employees:0
          };
          current.employees+=1;
          missingPointByBranch.set(branchId,current);
          continue;
        }
        const schedules=employee.point_schedules&&typeof employee.point_schedules==='object'?employee.point_schedules:{};
        const states=employee.point_states&&typeof employee.point_states==='object'?employee.point_states:{};
        const inMonth=date=>String(date).startsWith(`${month}-`);
        const dates=[...new Set([...Object.keys(schedules),...Object.keys(states)].filter(inMonth))];
        if(dates.length===0){
          blockers.push(issue('blocker','NO_POINT_ROWS',`${name}: não há dias de ponto deste colaborador na competência. A escala prevista não pode preencher a ficha automática. Importe e confirme o cartão correspondente.`,employee));
          continue;
        }
        if(!ThermalSchedule?.parsePointPeriods){
          blockers.push(issue('blocker','THERMAL_MODULE_MISSING','O módulo de cálculo não foi carregado. Atualize a página antes de gerar fichas.',employee));
          continue;
        }
        const invalid=Object.entries(schedules).filter(([date,description])=>inMonth(date)&&!ThermalSchedule.parsePointPeriods(description).valid);
        if(invalid.length){
          blockers.push(issue('blocker','INVALID_POINT_SCHEDULE',`${name}: ${invalid.length} dia(s) com marcações inválidas ou ambíguas (${invalid.map(([date])=>date.split('-').reverse().join('/')).join(', ')}). Confira a Senior e reimporte o ponto; nenhum horário será inventado.`,employee));
          continue;
        }
        const pending=dates.filter(date=>['REVIEW','NO_MARKINGS'].includes(upper(states[date]))||(upper(states[date])==='WORKED'&&!schedules[date]));
        if(pending.length){
          warnings.push(issue('warning','POINT_DAYS_PENDING',`${name}: ${pending.length} dia(s) sem jornada utilizável ou aguardando revisão. Esses dias serão sinalizados na ficha, sem repousos automáticos.`,employee));
        }
        if(/^\d{4}-(0[1-9]|1[0-2])$/.test(text(month))){
          const [year,monthNumber]=month.split('-').map(Number);
          const total=new Date(Date.UTC(year,monthNumber,0)).getUTCDate();
          const admission=text(employee.admission_date).slice(0,10),termination=text(employee.termination_date).slice(0,10);
          const expected=Array.from({length:total},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`).filter(date=>(!admission||date>=admission)&&(!termination||date<=termination));
          if(expected.some(date=>!dates.includes(date)))warnings.push(issue('warning','POINT_PARTIAL_COVERAGE',`${name}: há datas da competência sem ponto importado. A ficha indicará os dias sem informação e não completará a jornada pela escala.`,employee));
        }
      }
      ok.push({employeeId:employee.id??null,employeeName:name});
    }
    for(const missing of missingPointByBranch.values()){
      const total=missing.employees;
      const suffix=total===1?'1 colaborador afetado':`${total} colaboradores afetados`;
      blockers.push(issue(
        'blocker',
        'POINT_COMPETENCE_MISSING',
        `Cartão de Ponto não encontrado — ${missing.branchName}: não há Cartão de Ponto Senior confirmado para esta filial nesta competência (${suffix}). Importe o cartão correspondente antes de gerar as fichas automáticas.`
      ));
    }
    return {
      valid:blockers.length===0,
      blockers,warnings,ok,
      counts:{employees:employees.length,blockers:blockers.length,warnings:warnings.length,ok:ok.length}
    };
  }
  function validatePlan({employees=[],monthDays=[],plan=new Map()}={}){
    const blockers=[];
    const audit=getRestAudit();
    if(!audit?.auditDay){
      blockers.push(issue('blocker','THERMAL_AUDIT_MISSING','A conferência do cálculo não foi carregada. Atualize a página antes de gerar fichas.'));
      return {valid:false,blockers};
    }
    for(const employee of employees){
      for(const day of monthDays){
        const description=employee.point_schedules?.[day.iso];
        const state=employee.point_states?.[day.iso];
        if(!description||(state&&state!=='WORKED'))continue;
        const result=audit.auditDay(description,plan.get(`${employee.id}|${day.iso}`)||[],employee.shift_description||'');
        if(!result.valid){
          const reason=result.issues?.map(item=>item.message).join(' ')||'O cálculo não passou pela conferência completa.';
          blockers.push(issue('blocker','THERMAL_PLAN_INVALID',`${text(employee.full_name)||'Colaborador'} — ${day.iso.split('-').reverse().join('/')}: ${reason}`,employee));
        }
      }
    }
    return {valid:blockers.length===0,blockers};
  }
  return {validate,validatePlan,active,policyAllows,automaticAllowed};
});
