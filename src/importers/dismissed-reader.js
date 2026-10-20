function normalizeDismissedCause(row){
  const normalized={...row};
  const misplaced=String(normalized.fullName||"").trim();
  if(!String(normalized.causeCode||"").trim()&&/^\d{2}$/.test(misplaced)){
    normalized.causeCode=misplaced;
    normalized.fullName="";
  }
  return normalized;
}

function canCreateHistoricalDismissed(row){
  const item=normalizeDismissedCause(row);
  const name=String(item.fullName||"").trim();
  const date=String(item.terminationDate||"");
  return /^\d{1,50}$/.test(String(item.registration||"")) && /[1-9]/.test(item.registration) &&
    name.length>=5 && /^[\p{L} .’' -]+$/u.test(name) && name.split(/\s+/).length>=2 &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0,10)===date;
}

function reconcileDismissedWithEmployee(row,employee){
  const normalized=normalizeDismissedCause(row);
  if(!employee){
    return {...normalized,systemMatch:false,canCreateHistorical:canCreateHistoricalDismissed(normalized),selected:false,result:"NAO_LOCALIZADO"};
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
    canCreateHistorical:false,
    selected:true,
    result:"LOCALIZAR"
  };
}

module.exports={normalizeDismissedCause,reconcileDismissedWithEmployee,canCreateHistoricalDismissed};
