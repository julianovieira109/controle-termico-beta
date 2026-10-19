function timecardPeriods(rows=[]){
  const periods=new Map();
  for(const row of rows){
    if(row.period?.start&&row.period?.end)periods.set(`${row.period.start}|${row.period.end}`,row.period);
  }
  return [...periods.values()].sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
}
function timecardPeriod(rows=[]){
  const periods=timecardPeriods(rows);
  return periods.length?{start:periods[0].start,end:periods.map(p=>p.end).sort().at(-1)}:null;
}
function coversTimecardDate(rows,employeeId,date){
  return rows.some(row=>row.employeeId===employeeId&&row.period?.start<=date&&row.period?.end>=date);
}
function replacementRanges(rows=[]){
  const groups=new Map();
  for(const row of rows){
    if(!row.employeeId||!row.period?.start||!row.period?.end)continue;
    const key=`${row.period.start}|${row.period.end}`;
    if(!groups.has(key))groups.set(key,{period:row.period,employeeIds:new Set()});
    groups.get(key).employeeIds.add(row.employeeId);
  }
  return [...groups.values()].map(group=>({period:group.period,employeeIds:[...group.employeeIds]}));
}
module.exports={timecardPeriods,timecardPeriod,coversTimecardDate,replacementRanges};
