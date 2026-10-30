// A name is descriptive data; the registration remains the employment key.
function reconcileAdmittedPreview(rows,employees,detectCorrections){
  const byRegistration=new Map((employees||[]).map(employee=>[String(employee.registration||'').trim(),employee]));
  return rows.map(row=>{
    const existing=byRegistration.get(String(row.registration||'').trim());
    if(!existing)return {...row,employeeId:null,systemMatch:false,registrationExists:false};
    const corrections=detectCorrections(existing,row);
    return {
      ...row,
      employeeId:existing.id,
      systemMatch:true,
      registrationExists:true,
      matchBasis:'MATRICULA',
      currentName:existing.full_name||'',
      currentAdmissionDate:existing.admission_date||null,
      currentJobTitle:existing.effective_job_title||existing.job_title||'',
      currentShift:existing.current_shift||null,
      currentShiftId:existing.shift_id||null,
      hasShift:Boolean(existing.shift_id||existing.current_shift),
      corrections,
      result:corrections.length?'ATUALIZAR':'CONFERIDO',
      possibleReadmission:false,
      previousRegistration:null,
      previousStatus:null,
      previousTerminationDate:null
    };
  });
}

function admittedParsingIssues(diagnostics={}){
  const issues=[];
  if(Number(diagnostics.unresolvedCount||0)>0)issues.push('Há matrículas do PDF que não foram reconhecidas.');
  if(Number(diagnostics.criticalAssociationIssueCount||0)>0)issues.push('Há associações de matrícula e dados que precisam de conferência.');
  if(diagnostics.admissionParsing?.complete===false)issues.push('A leitura das linhas de admissão não foi concluída com segurança.');
  return issues;
}

module.exports={reconcileAdmittedPreview,admittedParsingIssues};
