(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.ThermalSchedule=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const REST_AFTER_MINUTES=100;
  const REST_DURATION_MINUTES=20;
  const MAX_REST_DURATION_MINUTES=25;
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

  function baseThermalRests(description,config={}){
    const workMinutes=Number(config.workMinutes)||REST_AFTER_MINUTES;
    const restMinutes=Number(config.restMinutes)||REST_DURATION_MINUTES;
    const fitTolerance=config.allowBoundaryVariation===true?Math.max(0,Math.min(30,Number(config.variationMinutes)||0)):0;
    const restCount=Math.max(1,Math.min(3,Number(config.restCount)||3));
    const schedule=parseShiftSchedule(description);
    if(!schedule)return [];
    const periods=[
      {start:schedule.start,end:schedule.breakStart},
      {start:schedule.breakEnd,end:schedule.end}
    ];
    const rests=[];
    if(config.carryAcrossBreak===true){
      let workedSinceRest=0;
      for(const period of periods){
        let cursor=period.start;
        while(cursor<period.end&&rests.length<restCount){
          const needed=Math.max(0,workMinutes-workedSinceRest);
          const start=cursor+needed;
          if(start+restMinutes-fitTolerance>period.end){
            workedSinceRest=Math.min(workMinutes,workedSinceRest+Math.max(0,period.end-cursor));
            break;
          }
          const end=start+restMinutes;
          rests.push({start,end,periodStart:period.start,periodEnd:period.end});
          cursor=end;
          workedSinceRest=0;
        }
        if(rests.length===restCount)break;
      }
      return rests;
    }
    for(const period of periods){
      let workCursor=period.start;
      while(workCursor+workMinutes+restMinutes-fitTolerance<=period.end&&rests.length<restCount){
        const start=workCursor+workMinutes;
        const end=start+restMinutes;
        rests.push({start,end,periodStart:period.start,periodEnd:period.end});
        workCursor=end;
      }
      if(rests.length===restCount)break;
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

  function applyVariation(baseRests,offsets,variationMinutes=MAX_VARIATION_MINUTES,durations=[]){
    return baseRests.map((rest,index)=>{
      const duration=durations[index]??(rest.end-rest.start);
      const maximumVariation=Math.max(0,Math.min(30,Number(variationMinutes)||0));
      const minimum=Math.max(-maximumVariation,rest.periodStart-rest.start);
      const maximum=Math.min(maximumVariation,rest.periodEnd-rest.start-duration);
      const requested=Number(offsets[index]||0);
      const offset=Math.max(minimum,Math.min(maximum,requested));
      return {start:rest.start+offset,end:rest.start+offset+duration,offset,duration};
    });
  }

  function distributedDurations(restCount,employeeIndex,daySerial,attempt,config={}){
    const minimum=Math.max(5,Math.min(60,Number(config.restMinutes)||REST_DURATION_MINUTES));
    const maximum=Math.max(minimum,Math.min(60,Number(config.maxRestMinutes)||MAX_REST_DURATION_MINUTES));
    const size=maximum-minimum+1;
    return Array.from({length:restCount},(_,index)=>{
      const digit=Math.floor(attempt/(size**index))%size;
      const raw=daySerial+employeeIndex*(index*2+1)+index*2+digit;
      return minimum+(((raw%size)+size)%size);
    });
  }

  function distributedOffsets(baseRests,employeeIndex,cycleDay,attempt,variationMinutes,durations=[]){
    const variation=Math.max(0,Math.min(30,Number(variationMinutes)||0));
    const daySteps=[1,7,13];
    const employeeSteps=[5,11,17];
    let attemptValue=Math.max(0,Math.floor(Number(attempt)||0));
    return baseRests.map((rest,index)=>{
      const minimum=Math.max(-variation,rest.periodStart-rest.start);
      const duration=durations[index]??(rest.end-rest.start);
      const maximum=Math.min(variation,rest.periodEnd-rest.start-duration);
      const size=maximum-minimum+1;
      if(size<=1)return minimum;
      const digit=attemptValue%size;
      attemptValue=Math.floor(attemptValue/size);
      const raw=cycleDay*daySteps[index%3]+employeeIndex*employeeSteps[index%3]+digit;
      return minimum+(((raw%size)+size)%size);
    });
  }

  function formatMinutes(value){
    const normalized=((value%1440)+1440)%1440;
    return `${String(Math.floor(normalized/60)).padStart(2,"0")}:${String(normalized%60).padStart(2,"0")}`;
  }

  function isThirdShift(employee={}){
    return /3\s*[º°o]?\s*turno/i.test(String(employee.shift_name||""))||
      String(employee.shift_senior_code||"").replace(/^0+/,"")==="56";
  }

  function pointReportDate(value,employee={}){
    const source=String(value||"").slice(0,10);
    if(!isThirdShift(employee))return source;
    const date=new Date(`${source}T00:00:00Z`);
    if(Number.isNaN(date.getTime()))return source;
    date.setUTCDate(date.getUTCDate()+1);
    return date.toISOString().slice(0,10);
  }

  function scheduleKey(rests){
    return rests.map(rest=>`${formatMinutes(rest.start)}-${formatMinutes(rest.end)}`).join("|");
  }

  function workedSpanMinutes(schedule){
    if(!schedule)return 0;
    return Math.max(0,schedule.breakStart-schedule.start)+Math.max(0,schedule.end-schedule.breakEnd);
  }

  function dynamicPointRests(description,config={},employeeIndex=0,daySerial=0,attempt=0){
    const schedule=parseShiftSchedule(description);
    if(!schedule)return [];
    // Regra legal adotada: 20 minutos de repouso somente depois de
    // 100 minutos completos de trabalho contínuo. A saída real do ponto
    // delimita o período, inclusive quando o colaborador sai antecipadamente.
    const workInterval=100;
    const duration=20;
    const periods=[
      {start:schedule.start,end:schedule.breakStart},
      {start:schedule.breakEnd,end:schedule.end}
    ];
    const rests=[];
    periods.forEach((period,periodIndex)=>{
      let cursor=period.start;
      let restIndex=0;
      while(cursor+workInterval+duration<=period.end&&restIndex<24){
        const start=cursor+workInterval;
        const end=start+duration;
        rests.push({start,end,periodStart:period.start,periodEnd:period.end,interval:workInterval,duration});
        cursor=end;
        restIndex++;
      }
    });
    return rests;
  }

  function buildMonthPlan(employees,monthDays,config={}){
    const ordered=(Array.isArray(employees)?employees:[])
      .slice()
      .sort((a,b)=>String(a.id||a.registration||"").localeCompare(String(b.id||b.registration||"")));
    const plan=new Map();
    const recentRests=new Map();
    const employeeSchedules=new Map();

    for(const day of monthDays||[]){
      const used=new Set();
      const cycleDays=Math.max(1,Math.min(31,Number(config.cycleDays)||31));
      const cycleDay=(Number(day.day)-1)%cycleDays;
      const parsedDay=Date.parse(`${day.iso}T00:00:00Z`);
      const daySerial=Number.isFinite(parsedDay)?Math.floor(parsedDay/86400000):cycleDay;
      ordered.forEach((employee,employeeIndex)=>{
        if(config.usePointData===true){
          const description=employee.point_schedules?.[day.iso];
          if(!description)return;
          const pointSchedule=parseShiftSchedule(description);
          const registeredSchedule=parseShiftSchedule(employee.shift_description);
          const overtimeMinutes=Math.max(0,workedSpanMinutes(pointSchedule)-workedSpanMinutes(registeredSchedule));
          const maximumRests=3+Math.floor(overtimeMinutes/100);
          const selected=dynamicPointRests(description,config,employeeIndex,daySerial,0).slice(0,maximumRests);
          if(selected)plan.set(`${employee.id}|${day.iso}`,selected);
          return;
        }
        const restCount=Math.max(1,Math.min(3,Number(config.restCount)||3));
        const pointDescription=employee.point_schedules?.[day.iso];
        const description=config.usePointData?pointDescription:employee.shift_description;
        const base=baseThermalRests(description,{...config,allowBoundaryVariation:config.usePointData===true,carryAcrossBreak:config.usePointData===true});
        if(base.length<restCount)return;
        let selected=null;
        for(let attempt=0;attempt<COMBINATION_COUNT;attempt++){
          const durations=distributedDurations(base.length,employeeIndex,daySerial,attempt,config);
          const offsets=distributedOffsets(
            base,
            employeeIndex,
            cycleDay,
            attempt,
            config.variationMinutes??MAX_VARIATION_MINUTES,
            durations
          );
          const candidate=applyVariation(base,offsets,config.variationMinutes??MAX_VARIATION_MINUTES,durations);
          if(candidate.some((rest,index)=>rest.start<base[index].periodStart||rest.end>base[index].periodEnd))continue;
          const history=recentRests.get(String(employee.id))||[];
          if(history.some(previous=>candidate.some((rest,index)=>{
            const prior=previous[index];
            return prior&&(
              rest.start===prior.start||
              rest.end===prior.end||
              rest.duration===prior.duration
            );
          })))continue;
          const key=scheduleKey(candidate);
          const schedules=employeeSchedules.get(String(employee.id))||new Set();
          if(!used.has(key)&&!schedules.has(key)){
            used.add(key);
            schedules.add(key);
            employeeSchedules.set(String(employee.id),schedules);
            selected=candidate;
            const updatedHistory=[...history,candidate];
            if(updatedHistory.length>3)updatedHistory.shift();
            recentRests.set(String(employee.id),updatedHistory);
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
    MAX_REST_DURATION_MINUTES,
    MAX_VARIATION_MINUTES,
    parseShiftSchedule,
    baseThermalRests,
    dynamicPointRests,
    buildMonthPlan,
    isThirdShift,
    pointReportDate,
    formatMinutes
  };
});
