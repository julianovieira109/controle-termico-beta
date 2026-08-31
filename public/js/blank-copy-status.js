(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BlankCopyStatus=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function isoDate(value){ return String(value||'').slice(0,10); }
  function status(employee,day){
    const weekDay=Number(day?.weekDay);
    const iso=isoDate(day?.iso);
    const weekly=Array.isArray(employee?.weekly_days_off)
      && employee.weekly_days_off.map(Number).includes(weekDay);
    const specific=Array.isArray(employee?.specific_days_off)
      && employee.specific_days_off.some(item=>isoDate(item?.date)===iso);
    return weekly||specific?'FOLGA / SEM JORNADA':'';
  }
  return {status};
});
