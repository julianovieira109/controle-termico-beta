function normalizeDismissedCause(row){
  const normalized={...row};
  const misplaced=String(normalized.fullName||"").trim();
  if(!String(normalized.causeCode||"").trim()&&/^\d{2}$/.test(misplaced)){
    normalized.causeCode=misplaced;
    normalized.fullName="";
  }
  return normalized;
}

function reconcileDismissedWithEmployee(row,employee){
  const normalized=normalizeDismissedCause(row);
  if(!employee){
    return {...normalized,systemMatch:false,selected:false,result:"NAO_LOCALIZADO"};
  }
  const fullName=String(employee.full_name||"").trim();
  const jobTitle=String(employee.effective_job_title||employee.job_title||"").trim();
  return {
    ...normalized,
    fullName:fullName||normalized.fullName,
    currentName:fullName||normalized.fullName,
    jobTitle:jobTitle||normalized.jobTitle,
    currentJobTitle:jobTitle||normalized.jobTitle,
    systemMatch:true,
    selected:true,
    result:"LOCALIZAR"
  };
}

module.exports={normalizeDismissedCause,reconcileDismissedWithEmployee};
