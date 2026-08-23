(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.ThermalSchedule=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const REST_AFTER_MINUTES=100;
  const REST_DURATION_MINUTES=20;
  const MAX_VARIATION_MINUTES=15;
  const VARIATION_BASE=MAX_VARIATION_MINUTES*2+1;
  const VARIATION_VALUES=Array.from({length:VARIATION_BASE},(_,index)=>index-MAX_VARIATION_MINUTES);
  const COMBINATION_COUNT=VARIATION_BASE*VARIATION_BASE*VARIATION_BASE;

  function clockToMinutes(value){
    const match=String(value||"").match(/^(\d{1,2}):(\d{2})$/);
    if(!match)return null;
    const hour=Number(match[1]);
    const minute=Number(match[2]);
    if(hour>23||minute>59)return null;
    return hour*60+minute;
  }

  function parseShiftSchedule(description){
    const normalizedDescription=String(description||"").replace(/(^|[^\d])(\d{1,2})PRE/gi,"$1$2:00PRE");
    const clocks=normalizedDescription.match(/(?:[01]?\d|2[0-3]):[0-5]\d/g)||[];
    if(clocks.length<4)return null;
    const values=clocks.slice(0,4).map(clockToMinutes);
    if(values.some(value=>value===null))return null;

    const [startRaw,breakStartRaw,breakEndRaw,endRaw]=values;
    const start=startRaw;
    let breakStart=breakStartRaw;
    while(breakStart<=start)breakStart+=1440;
    let breakEnd=breakEndRaw;
    while(breakEnd<=breakStart)breakEnd+=1440;
    let end=endRaw;
    while(end<=breakEnd)end+=1440;
    if(end-start>1440)return null;
    return {start,breakStart,breakEnd,end};
  }

  function baseThermalRests(description){
    const schedule=parseShiftSchedule(description);
    if(!schedule)return [];
    const periods=[
      {start:schedule.start,end:schedule.breakStart},
      {start:schedule.breakEnd,end:schedule.end}
    ];
    const rests=[];
    for(const period of periods){
      let workCursor=period.start;
      while(workCursor+REST_AFTER_MINUTES+REST_DURATION_MINUTES<=period.end&&rests.length<3){
        const start=workCursor+REST_AFTER_MINUTES;
        const end=start+REST_DURATION_MINUTES;
        rests.push({start,end,periodStart:period.start,periodEnd:period.end});
        workCursor=end;
      }
      if(rests.length===3)break;
    }
    return rests;
  }

  function tupleForIndex(index){
    let value=((index%COMBINATION_COUNT)+COMBINATION_COUNT)%COMBINATION_COUNT;
    const tuple=[];
    for(let position=0;position<3;position++){
      tuple.push(VARIATION_VALUES[value%VARIATION_BASE]);
      value=Math.floor(value/VARIATION_BASE);
    }
    return tuple;
  }

  function applyVariation(baseRests,offsets){
    return baseRests.map((rest,index)=>{
      const minimum=Math.max(-MAX_VARIATION_MINUTES,rest.periodStart-rest.start);
      const maximum=Math.min(MAX_VARIATION_MINUTES,rest.periodEnd-rest.end);
      const requested=Number(offsets[index]||0);
      const offset=Math.max(minimum,Math.min(maximum,requested));
      return {start:rest.start+offset,end:rest.end+offset,offset};
    });
  }

  function formatMinutes(value){
    const normalized=((value%1440)+1440)%1440;
    return `${String(Math.floor(normalized/60)).padStart(2,"0")}:${String(normalized%60).padStart(2,"0")}`;
  }

  function scheduleKey(rests){
    return rests.map(rest=>`${formatMinutes(rest.start)}-${formatMinutes(rest.end)}`).join("|");
  }

  function buildMonthPlan(employees,monthDays){
    const ordered=(Array.isArray(employees)?employees:[])
      .slice()
      .sort((a,b)=>String(a.id||a.registration||"").localeCompare(String(b.id||b.registration||"")));
    const plan=new Map();

    for(const day of monthDays||[]){
      const used=new Set();
      const cycleDay=(Number(day.day)-1)%31;
      ordered.forEach((employee,employeeIndex)=>{
        const base=baseThermalRests(employee.shift_description);
        if(base.length<3)return;
        let selected=null;
        for(let attempt=0;attempt<COMBINATION_COUNT;attempt++){
          const tupleIndex=employeeIndex+cycleDay*149+attempt;
          const candidate=applyVariation(base,tupleForIndex(tupleIndex));
          const key=scheduleKey(candidate);
          if(!used.has(key)){
            used.add(key);
            selected=candidate;
            break;
          }
        }
        if(selected)plan.set(`${employee.id}|${day.iso}`,selected);
      });
    }
    return plan;
  }

  return {
    REST_AFTER_MINUTES,
    REST_DURATION_MINUTES,
    MAX_VARIATION_MINUTES,
    parseShiftSchedule,
    baseThermalRests,
    buildMonthPlan,
    formatMinutes
  };
});
