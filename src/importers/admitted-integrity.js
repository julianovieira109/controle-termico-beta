const crypto=require('node:crypto');
const fields=['registration','fullName','admissionDate','jobCode','jobTitle','pointCard','branchCode','identitySource'];
const maxAge=2*60*60*1000;

function digest(row,scope,issuedAt){
  const payload=[1,issuedAt,String(scope.companyId),String(scope.branchId),String(scope.userId),...fields.map(key=>String(row[key]??''))];
  return crypto.createHmac('sha256',process.env.JWT_SECRET).update(JSON.stringify(payload)).digest('hex');
}

function signAdmission(row,scope,now=Date.now()){
  return {...row,admissionProof:{version:1,issuedAt:now,signature:digest(row,scope,now)}};
}

function verifyAdmission(row,scope,now=Date.now()){
  const proof=row?.admissionProof;
  if(proof?.version!==1||!Number.isSafeInteger(proof.issuedAt)||proof.issuedAt>now+60000||now-proof.issuedAt>maxAge)return false;
  if(!/^[0-9a-f]{64}$/.test(String(proof.signature||'')))return false;
  return crypto.timingSafeEqual(Buffer.from(proof.signature,'hex'),Buffer.from(digest(row,scope,proof.issuedAt),'hex'));
}

// A blank source must not erase a legitimate existing card. Clear only the
// reproducible artifact of the old admission reader: branch prefixed to name,
// shifted identity, admission-import origin and job code copied into the card.
function admissionPointCard(existing,item){
  const supplied=String(item?.pointCard||'').trim();
  if(supplied)return supplied;
  const current=String(existing?.point_card||'').trim();
  const source=String(existing?.source||'');
  const branch=String(item?.branchCode||'');
  const legacy=/^SENIOR_(?:TIMECARD_ADMITIDOS|PDF_ADMITIDOS)$/.test(source)
    &&item?.identitySource==='PDF_COORDINATES'&&/^\d{4}$/.test(branch)
    &&String(existing?.full_name||'').startsWith(branch+' ')
    &&String(existing?.full_name||'').trim()!==String(item?.fullName||'').trim()
    &&/^\d{1,6}$/.test(String(item?.jobCode||''))
    &&current===String(Number(item.jobCode)).padStart(4,'0');
  return legacy?null:current||null;
}

function admissionChanges(existing,item,roleId){
  const after={full_name:item.fullName,admission_date:item.admissionDate,
    job_title:item.jobTitle,job_role_id:roleId,point_card:admissionPointCard(existing,item)};
  const normalize=(key,value)=>key==='admission_date'&&value
    ?(value instanceof Date?value.toISOString():String(value)).slice(0,10):value??null;
  return Object.fromEntries(Object.entries(after).flatMap(([key,value])=>{
    const from=normalize(key,existing[key]),to=normalize(key,value);
    return from===to?[]:[[key,{from,to}]];
  }));
}

module.exports={signAdmission,verifyAdmission,admissionPointCard,admissionChanges};
