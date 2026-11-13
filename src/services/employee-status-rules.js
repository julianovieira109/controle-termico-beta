const STATUSES=new Set(["ATIVO","DEMITIDO","AFASTADO","INATIVO"]);

function today(){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const get=type=>parts.find(part=>part.type===type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function validDate(value){
  return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>=1900&&
    !Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}

function normalizeProposal(input){
  const search=String(input.search||"").trim();
  const status=String(input.status||"").toUpperCase();
  if(search.length<2||search.length>180)throw new Error("Informe o nome ou a matrícula do colaborador (2 a 180 caracteres).");
  if(!STATUSES.has(status))throw new Error("Selecione uma situação válida.");
  const terminationDate=status==="DEMITIDO"?input.terminationDate:null;
  if(status==="DEMITIDO"&&!validDate(terminationDate))throw new Error("Informe uma data de demissão válida.");
  return {search,status,terminationDate};
}

function employeeVersion(employee){
  return JSON.stringify([employee.id,employee.company_id,employee.branch_id,employee.status,
    employee.termination_date?new Date(employee.termination_date).toISOString().slice(0,10):null,
    new Date(employee.updated_at).toISOString()]);
}

function validateEmploymentDate(employee,proposal){
  if(proposal.terminationDate&&employee.admission_date&&proposal.terminationDate<new Date(employee.admission_date).toISOString().slice(0,10)){
    throw new Error("A demissão não pode ser anterior à admissão.");
  }
}

module.exports={today,validDate,normalizeProposal,employeeVersion,validateEmploymentDate};
