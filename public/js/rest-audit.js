(function(root,factory){
  const thermal=typeof module==="object"&&module.exports?require("./thermal-schedule.js"):root.ThermalSchedule;
  const api=factory(thermal);
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.RestAudit=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(ThermalSchedule){
  const RULE_WORK_MINUTES=100;
  const RULE_REST_MINUTES=20;

  function formatMinutes(value){
    if(!Number.isSafeInteger(value))return "Horário inválido";
    const normalized=((value%1440)+1440)%1440;
    return `${String(Math.floor(normalized/60)).padStart(2,"0")}:${String(normalized%60).padStart(2,"0")}`;
  }

  function normalizedPointPeriods(description=""){
    return ThermalSchedule.parsePointPeriods(description);
  }

  function markingsFrom(description=""){
    return normalizedPointPeriods(description).markings;
  }

  function workedMinutes(periods=[]){
    return periods.reduce((sum,p)=>sum+p.end-p.start,0);
  }

  function requiredRests(period){
    return Math.max(0,Math.ceil((period.end-period.start-RULE_WORK_MINUTES)/(RULE_WORK_MINUTES+RULE_REST_MINUTES)));
  }

  // Validate the received timetable directly. Do not regenerate it or compare it
  // with the generator's output: a second implementation must catch omissions.
  function auditDay(pointDescription="",rests=[],registeredDescription=""){
    const parsed=normalizedPointPeriods(pointDescription);
    const registered=normalizedPointPeriods(registeredDescription);
    const periods=parsed.valid?parsed.periods:[];
    const actualWorked=parsed.valid?workedMinutes(periods):null;
    const registeredWorked=registered.valid?workedMinutes(registered.periods):0;
    const overtimeMinutes=actualWorked!==null&&registeredWorked>0?Math.max(0,actualWorked-registeredWorked):0;
    const issues=[];
    const addIssue=(code,message,details={})=>issues.push({code,message,...details});
    if(!parsed.valid)addIssue("INVALID_POINT",parsed.reason||"As marcações do ponto não delimitam uma jornada válida.");
    if(!Array.isArray(rests))addIssue("INVALID_RESTS","A lista de repousos recebida é inválida.");
    const received=Array.isArray(rests)?Array.from(rests):[rests];
    const items=received.map((rest,index)=>{
      const start=Number.isSafeInteger(rest?.start)?rest.start:null;
      const end=Number.isSafeInteger(rest?.end)?rest.end:null;
      const validRange=start!==null&&end!==null&&end>start;
      const duration=validRange?end-start:null;
      const periodIndex=validRange?periods.findIndex(p=>start>=p.start&&end<=p.end):-1;
      const period=periods[periodIndex];
      const withinPeriod=periodIndex>=0;
      const durationConform=duration===RULE_REST_MINUTES;
      if(!validRange)addIssue("INVALID_REST",`Repouso ${index+1}: os horários precisam ser minutos inteiros, com retorno após a saída.`,{restIndex:index+1});
      else{
        if(!durationConform)addIssue("INVALID_REST_DURATION",`Repouso ${index+1}: duração de ${duration} minutos; a regra adotada exige ${RULE_REST_MINUTES}.`,{restIndex:index+1,duration});
        if(!withinPeriod)addIssue("REST_OUTSIDE_WORK",`Repouso ${index+1}: os horários não estão inteiramente dentro de um trecho válido do ponto.`,{restIndex:index+1});
      }
      return {
        index:index+1,start,end,startLabel:formatMinutes(start),endLabel:formatMinutes(end),duration,
        continuousBefore:null,periodStart:period?.start??null,periodEnd:period?.end??null,
        periodLabel:period?`${formatMinutes(period.start)} – ${formatMinutes(period.end)}`:"Não identificado",
        validRange,withinPeriod,durationConform,periodIndex,status:"Revisar",explanation:""
      };
    });

    // Preserve the input order and report inversions instead of silently sorting
    // them away. A sorted copy is used only to measure the actual covered gaps.
    let previousStart=null;
    for(const item of items){
      if(!item.validRange)continue;
      if(previousStart!==null&&item.start<previousStart)addIssue("REST_ORDER",`Repouso ${item.index}: a lista não está em ordem cronológica.`,{restIndex:item.index});
      previousStart=item.start;
    }
    const ordered=items.filter(item=>item.validRange).slice().sort((a,b)=>a.start-b.start||a.end-b.end);
    let previousEnd=null;
    for(const item of ordered){
      if(previousEnd!==null&&item.start<previousEnd)addIssue("REST_OVERLAP",`Repouso ${item.index}: há sobreposição com outro repouso.`,{restIndex:item.index});
      previousEnd=previousEnd===null?item.end:Math.max(previousEnd,item.end);
    }

    const segments=[];
    let missingRestCount=0;
    for(const [periodIndex,period] of periods.entries()){
      const inside=ordered.filter(item=>item.periodIndex===periodIndex);
      const needed=requiredRests(period);
      const present=inside.filter(item=>item.durationConform).length;
      if(present<needed){
        missingRestCount+=needed-present;
        addIssue("MISSING_RESTS",`Trecho ${formatMinutes(period.start)} – ${formatMinutes(period.end)}: são necessários pelo menos ${needed} repouso(s) de ${RULE_REST_MINUTES} minutos; foram recebidos ${present}.`,{periodIndex,required:needed,received:present});
      }
      let cursor=period.start;
      const addSegment=(start,end,beforeRestIndex=null)=>{
        const duration=Math.max(0,end-start);
        const segment={start,end,duration,periodIndex,beforeRestIndex,position:beforeRestIndex===null?"after":"before",conform:duration<=RULE_WORK_MINUTES};
        segments.push(segment);
        if(!segment.conform)addIssue("CONTINUOUS_WORK_EXCEEDED",`Trecho contínuo ${formatMinutes(start)} – ${formatMinutes(end)}: ${duration} minutos, acima do limite de ${RULE_WORK_MINUTES}.`,{periodIndex,start,end,duration,beforeRestIndex});
      };
      for(const item of inside){
        item.continuousBefore=Math.max(0,item.start-cursor);
        if(item.start>=cursor)addSegment(cursor,item.start,item.index);
        cursor=Math.max(cursor,item.end);
      }
      addSegment(cursor,period.end);
    }

    const valid=issues.length===0;
    for(const item of items){
      item.status=valid?"Conforme":"Revisar";
      item.explanation=valid
        ?`Repouso calculado de ${RULE_REST_MINUTES} minutos dentro de ${item.periodLabel}. Todos os trechos contínuos do dia, inclusive após o último repouso, respeitam o limite de ${RULE_WORK_MINUTES} minutos. A auditoria do cálculo não comprova a realização do repouso.`
        :"O dia precisa de revisão. Confira os avisos da auditoria antes de utilizar estes horários; um repouso isolado não valida os demais trechos da jornada.";
    }
    return {
      ruleWorkMinutes:RULE_WORK_MINUTES,ruleRestMinutes:RULE_REST_MINUTES,
      markings:parsed.markings,meal:parsed.valid?parsed.meal||null:null,periods,
      actualWorked,registeredWorked,overtimeMinutes,dailyLimit:null,
      restCount:items.length,items,valid,status:valid?"Conforme":"Revisar",issues,segments,
      maxContinuousMinutes:parsed.valid?Math.max(0,...segments.map(s=>s.duration)):null,
      requiredRestCount:parsed.valid?periods.reduce((sum,p)=>sum+requiredRests(p),0):null,
      missingRestCount:parsed.valid?missingRestCount:null
    };
  }

  return {RULE_WORK_MINUTES,RULE_REST_MINUTES,markingsFrom,normalizedPointPeriods,auditDay,formatMinutes};
});
