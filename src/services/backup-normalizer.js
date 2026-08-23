function cloneRows(value){
  return Array.isArray(value)?value.map(row=>({...row})):[];
}

function countReferences(rows,column){
  const counts=new Map();
  for(const row of rows){
    const id=row?.[column];
    if(id)counts.set(id,(counts.get(id)||0)+1);
  }
  return counts;
}

function mergeCatalogRow(target,source){
  for(const [column,value] of Object.entries(source)){
    if(column==="id"||column==="company_id"||column==="name")continue;
    if((target[column]===null||target[column]===undefined||target[column]==="")&&value!==null&&value!==undefined&&value!==""){
      target[column]=value;
    }
  }
  if(source.active===true)target.active=true;
}

function consolidateCatalog(rows,referenceCounts){
  const groups=new Map();
  for(const row of rows){
    const key=`${row.company_id||""}\u0000${row.name||""}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }

  const result=[];
  const idMap=new Map();
  let removed=0;

  for(const group of groups.values()){
    let canonical=group[0];
    for(const candidate of group.slice(1)){
      if((referenceCounts.get(candidate.id)||0)>(referenceCounts.get(canonical.id)||0)){
        canonical=candidate;
      }
    }

    const merged={...canonical};
    for(const row of group){
      idMap.set(row.id,canonical.id);
      if(row!==canonical)mergeCatalogRow(merged,row);
    }
    result.push(merged);
    removed+=group.length-1;
  }

  return {rows:result,idMap,removed};
}

function remap(rows,column,idMap){
  for(const row of rows){
    const mapped=idMap.get(row[column]);
    if(mapped)row[column]=mapped;
  }
}

function deduplicateBy(rows,keyForRow){
  const found=new Map();
  let removed=0;
  for(const row of rows){
    const key=keyForRow(row);
    if(!found.has(key)){
      found.set(key,row);
      continue;
    }
    removed+=1;
    const current=found.get(key);
    const currentDate=Date.parse(current.updated_at||current.created_at||0)||0;
    const candidateDate=Date.parse(row.updated_at||row.created_at||0)||0;
    if(candidateDate>currentDate)found.set(key,row);
  }
  return {rows:[...found.values()],removed};
}

function normalizeBackupData(input){
  const data={};
  for(const [table,rows] of Object.entries(input||{}))data[table]=cloneRows(rows);

  const employees=data.employees||[];
  const policies=data.job_role_branch_report_policies||[];
  const stats={shifts:0,job_roles:0,departments:0,job_role_branch_report_policies:0};

  const shiftResult=consolidateCatalog(
    data.shifts||[],
    countReferences(employees,"shift_id")
  );
  data.shifts=shiftResult.rows;
  stats.shifts=shiftResult.removed;
  remap(employees,"shift_id",shiftResult.idMap);

  const roleReferences=countReferences(employees,"job_role_id");
  for(const [id,count] of countReferences(policies,"job_role_id")){
    roleReferences.set(id,(roleReferences.get(id)||0)+count);
  }
  const roleResult=consolidateCatalog(data.job_roles||[],roleReferences);
  data.job_roles=roleResult.rows;
  stats.job_roles=roleResult.removed;
  remap(employees,"job_role_id",roleResult.idMap);
  remap(policies,"job_role_id",roleResult.idMap);

  const departmentResult=consolidateCatalog(
    data.departments||[],
    countReferences(employees,"department_id")
  );
  data.departments=departmentResult.rows;
  stats.departments=departmentResult.removed;
  remap(employees,"department_id",departmentResult.idMap);

  const policyResult=deduplicateBy(
    policies,
    row=>`${row.job_role_id||""}\u0000${row.branch_id||""}`
  );
  data.job_role_branch_report_policies=policyResult.rows;
  stats.job_role_branch_report_policies=policyResult.removed;
  data.employees=employees;

  return {data,stats};
}

module.exports={normalizeBackupData};
