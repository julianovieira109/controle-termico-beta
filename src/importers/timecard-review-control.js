const REVIEW_CONTROL_STATUSES=Object.freeze({
  UNREVIEWED:'Não analisado',
  REVIEWED:'Conferido',
  PENDING_SENIOR_CORRECTION:'Aguardando correção na Senior',
  SENIOR_CORRECTED_WAITING_IMPORT:'Senior corrigida — aguardando nova importação',
  RESOLVED_BY_NEW_IMPORT:'Resolvido após nova leitura'
});

const USER_SELECTABLE_STATUSES=new Set([
  'UNREVIEWED',
  'REVIEWED',
  'PENDING_SENIOR_CORRECTION',
  'SENIOR_CORRECTED_WAITING_IMPORT'
]);

function normalizeReviewControlStatus(value,{allowResolved=false}={}){
  const key=String(value||'').trim().toUpperCase();
  if(USER_SELECTABLE_STATUSES.has(key))return key;
  if(allowResolved&&key==='RESOLVED_BY_NEW_IMPORT')return key;
  return null;
}

function reviewControlStatusLabel(value){
  return REVIEW_CONTROL_STATUSES[value]||REVIEW_CONTROL_STATUSES.UNREVIEWED;
}

function reviewControlKey(employeeId,workDate){
  return `${String(employeeId||'')}|${String(workDate||'').slice(0,10)}`;
}

function nextStatusWhenIssueSeen(previousStatus){
  const status=normalizeReviewControlStatus(previousStatus,{allowResolved:true})||'UNREVIEWED';
  if(status==='RESOLVED_BY_NEW_IMPORT')return 'UNREVIEWED';
  if(status==='SENIOR_CORRECTED_WAITING_IMPORT')return 'PENDING_SENIOR_CORRECTION';
  return status;
}

module.exports={
  REVIEW_CONTROL_STATUSES,
  USER_SELECTABLE_STATUSES,
  normalizeReviewControlStatus,
  reviewControlStatusLabel,
  reviewControlKey,
  nextStatusWhenIssueSeen
};
