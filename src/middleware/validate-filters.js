const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validMonth(value){
  return typeof value==="string" && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function validDate(value){
  if(typeof value!=="string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [year,month,day]=value.split("-").map(Number);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return month>=1&&month<=12&&day>=1&&day<=days[month-1];
}

function validateFilters(req,res,next){
  const fields={
    month:[validMonth,"Informe uma competência válida no formato AAAA-MM."],
    monthA:[validMonth,"Informe uma competência válida no formato AAAA-MM."],
    monthB:[validMonth,"Informe uma competência válida no formato AAAA-MM."],
    terminationFrom:[validDate,"Data inicial inválida."],
    terminationTo:[validDate,"Data final inválida."],
    year:[v=>typeof v==="string"&&/^(?!0000)\d{4}$/.test(v),"Informe um ano válido com quatro dígitos."],
    companyId:[v=>typeof v==="string"&&uuid.test(v),"Empresa inválida."],
    branchId:[v=>typeof v==="string"&&uuid.test(v),"Filial inválida."],
    employeeId:[v=>typeof v==="string"&&uuid.test(v),"Colaborador inválido."]
  };
  for(const [key,[valid,message]] of Object.entries(fields)){
    const value=req.query[key];
    if(value!==undefined&&value!==""&&!valid(value))return res.status(400).json({error:message});
  }
  if(req.query.terminationFrom&&req.query.terminationTo&&req.query.terminationFrom>req.query.terminationTo){
    return res.status(400).json({error:"A data inicial não pode ser posterior à data final."});
  }
  next();
}

function validateId(req,res,next,value){
  if(!uuid.test(value))return res.status(400).json({error:"Identificador inválido."});
  next();
}

module.exports={validateFilters,validateId,validDate,validMonth};
