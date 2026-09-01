(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.RestAudit=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const RULE_WORK_MINUTES=100;
  const RULE_REST_MINUTES=20;

  function clockToMinutes(value){
    const match=String(value||"").match(/^(\d{1,2}):(\d{2})$/);
    if(!match)return null;
    const h=Number(match[1]),m=Number(match[2]);
    if(h>23||m>59)return null;
    return h*60+m;
  }

  function formatMinutes(value){
    const normalized=((Number(value)%1440)+1440)%1440;
    return `${String(Math.floor(normalized/60)).padStart(2,"0")}:${String(normalized%60).padStart(2,"0")}`;
  }

  function markingsFrom(description=""){
    return String(description||"").match(/(?:[01]?\d|2[0-3]):[0-5]\d/g)||[];
  }

  function normalizedPointPeriods(description=""){
    const markings=markingsFrom(description);
    if(markings.length!==2&&markings.length!==4)return {markings,periods:[]};
    const values=markings.map(clockToMinutes);
    if(values.some(v=>v===null))return {markings,periods:[]};
    const normalized=[values[0]];
    for(let i=1;i<values.length;i++){
      let value=values[i];
      while(value<normalized[i-1])value+=1440;
      normalized.push(value);
    }
    if(markings.length===2){
      return {markings,periods:[{start:normalized[0],end:normalized[1],kind:"work"}]};
    }
    return {
      markings,
      periods:[
        {start:normalized[0],end:normalized[1],kind:"work"},
        {start:normalized[2],end:normalized[3],kind:"work"}
      ],
      meal:{start:normalized[1],end:normalized[2]}
    };
  }

  function workedMinutes(periods=[]){
    return periods.reduce((sum,p)=>sum+Math.max(0,p.end-p.start),0);
  }

  function registeredWorkedMinutes(description=""){
    const parsed=normalizedPointPeriods(description);
    return workedMinutes(parsed.periods);
  }

  function auditDay(pointDescription="",rests=[],registeredDescription=""){
    const parsed=normalizedPointPeriods(pointDescription);
    const safeRests=(Array.isArray(rests)?rests:[])
      .filter(r=>Number.isFinite(Number(r.start))&&Number.isFinite(Number(r.end)))
      .map(r=>({...r,start:Number(r.start),end:Number(r.end)}))
      .sort((a,b)=>a.start-b.start);

    const actualWorked=workedMinutes(parsed.periods);
    const registeredWorked=registeredWorkedMinutes(registeredDescription);
    const overtimeMinutes=registeredWorked>0?Math.max(0,actualWorked-registeredWorked):0;
    const dailyLimit=Math.min(4,3+Math.floor(overtimeMinutes/RULE_WORK_MINUTES));

    const items=safeRests.map((rest,index)=>{
      const period=parsed.periods.find(p=>rest.start>=p.start&&rest.start<=p.end)||
        parsed.periods.find(p=>rest.end>=p.start&&rest.end<=p.end)||null;
      const priorInPeriod=safeRests
        .slice(0,index)
        .filter(r=>period&&r.start>=period.start&&r.end<=period.end)
        .pop();
      const workStart=priorInPeriod?priorInPeriod.end:(period?.start??rest.start);
      const continuousBefore=Math.max(0,rest.start-workStart);
      const duration=Math.max(0,rest.end-rest.start);
      const withinPeriod=!!period&&rest.start>=period.start&&rest.end<=period.end;
      const durationConform=duration===RULE_REST_MINUTES;
      return {
        index:index+1,
        start:rest.start,
        end:rest.end,
        startLabel:formatMinutes(rest.start),
        endLabel:formatMinutes(rest.end),
        duration,
        continuousBefore,
        periodStart:period?.start??null,
        periodEnd:period?.end??null,
        periodLabel:period?`${formatMinutes(period.start)} – ${formatMinutes(period.end)}`:"Não identificado",
        status:withinPeriod&&durationConform?"Conforme":"Revisar",
        withinPeriod,
        durationConform,
        explanation:withinPeriod
          ?`O repouso está dentro do período trabalhado ${formatMinutes(period.start)} – ${formatMinutes(period.end)}. A regra considera limite de ${RULE_WORK_MINUTES} minutos de trabalho contínuo e reinicia a contagem após cada repouso.`
          :"O repouso não pôde ser relacionado com segurança a um período trabalhado do cartão de ponto."
      };
    });

    return {
      ruleWorkMinutes:RULE_WORK_MINUTES,
      ruleRestMinutes:RULE_REST_MINUTES,
      markings:parsed.markings,
      meal:parsed.meal||null,
      periods:parsed.periods,
      actualWorked,
      registeredWorked,
      overtimeMinutes,
      dailyLimit,
      restCount:items.length,
      items
    };
  }

  return {
    RULE_WORK_MINUTES,
    RULE_REST_MINUTES,
    markingsFrom,
    normalizedPointPeriods,
    auditDay,
    formatMinutes
  };
});
