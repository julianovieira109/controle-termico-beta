(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.ThermalSchedule=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const REST_AFTER_MINUTES=100;
  const REST_DURATION_MINUTES=20;
  // Retained export names for callers using older configuration objects.
  const MAX_REST_DURATION_MINUTES=REST_DURATION_MINUTES;
  const MAX_VARIATION_MINUTES=0;

  function clockToMinutes(value){
    const match=String(value||"").match(/^(\d{2}):(\d{2})$/);
    if(!match)return null;
    const hour=Number(match[1]),minute=Number(match[2]);
    return hour<24&&minute<60?hour*60+minute:null;
  }

  function parsePointPeriods(description){
    const source=String(description||"");
    // Capture every clock-like token, including invalid ones. Do not silently
    // discard an invalid clock or extra punches and calculate a partial day.
    const markings=(source.match(/[\d:]*:[\d:]*/g)||[]).filter(token=>/\d/.test(token));
    const invalid=reason=>({markings,periods:[],meal:null,valid:false,reason});
    if(markings.length!==2&&markings.length!==4){
      return invalid("O cálculo exige exatamente duas ou quatro marcações confirmadas.");
    }
    const values=markings.map(clockToMinutes);
    if(values.some(value=>value===null))return invalid("Há horário inválido nas marcações do ponto.");
    if(new Set(values).size!==values.length)return invalid("Marcações repetidas não definem uma jornada segura.");

    const normalized=[values[0]];
    let dayOffset=0,midnightCrossings=0;
    for(let index=1;index<values.length;index++){
      if(values[index]<values[index-1]){
        midnightCrossings++;
        dayOffset+=1440;
      }
      if(midnightCrossings>1)return invalid("A sequência das marcações possui mais de uma virada de dia.");
      normalized.push(values[index]+dayOffset);
    }
    if(normalized.at(-1)-normalized[0]>=1440){
      return invalid("A jornada precisa ter duração menor que 24 horas.");
    }
    const periods=[{start:normalized[0],end:normalized[1],kind:"work"}];
    let meal=null;
    if(normalized.length===4){
      meal={start:normalized[1],end:normalized[2]};
      periods.push({start:normalized[2],end:normalized[3],kind:"work"});
    }
    return {markings,periods,meal,valid:true,reason:null};
  }

  function normalizeShiftDescription(description){
    return String(description||"")
      .replace(/(^|[^\d])(\d{1,2})PRE/gi,"$1$2:00PRE")
      .replace(/(^|[^\d])(\d):([0-5]\d)(?!\d)/g,(_all,prefix,hour,minute)=>`${prefix}0${hour}:${minute}`);
  }

  function parseShiftPeriods(description){
    return parsePointPeriods(normalizeShiftDescription(description));
  }

  function parseShiftSchedule(description){
    const parsed=parseShiftPeriods(description);
    if(!parsed.valid||!parsed.meal)return null;
    return {
      start:parsed.periods[0].start,
      breakStart:parsed.meal.start,
      breakEnd:parsed.meal.end,
      end:parsed.periods[1].end
    };
  }

  function assessParsedPlanning(parsed){
    if(!parsed.valid)return {valid:false,code:"INVALID_MARKINGS",reason:parsed.reason,parsed};
    const workedMinutes=parsed.periods.reduce((sum,period)=>sum+period.end-period.start,0);
    const mealMinutes=parsed.meal?parsed.meal.end-parsed.meal.start:null;
    if(mealMinutes!==null&&mealMinutes<REST_DURATION_MINUTES&&workedMinutes>REST_AFTER_MINUTES){
      return {
        valid:false,
        code:"MEAL_BREAK_TOO_SHORT",
        reason:`O intervalo registrado de ${mealMinutes} minuto(s) não completa os ${REST_DURATION_MINUTES} minutos adotados para reiniciar o ciclo. Como há ${workedMinutes} minutos de trabalho nos dois trechos, confira a exposição e as pausas reais antes de gerar automaticamente. Os dados da Senior foram preservados.`,
        parsed
      };
    }
    return {valid:true,code:null,reason:null,parsed};
  }

  function assessPointPlanning(description){
    return assessParsedPlanning(parsePointPeriods(description));
  }

  function assessShiftPlanning(description){
    return assessParsedPlanning(parseShiftPeriods(description));
  }

  function restsForPeriods(periods){
    const rests=[];
    for(const period of periods){
      const elapsed=period.end-period.start;
      // n rests leave n+1 work segments. Choose the smallest n satisfying
      // elapsed - n*20 <= (n+1)*100, then distribute the remaining work.
      // The last segment is part of this bound, including partial/night shifts.
      const requiredRests=Math.max(0,Math.ceil((elapsed-REST_AFTER_MINUTES)/(REST_AFTER_MINUTES+REST_DURATION_MINUTES)));
      const workableMinutes=elapsed-requiredRests*REST_DURATION_MINUTES;
      const workSegments=requiredRests+1;
      const baseSegment=Math.floor(workableMinutes/workSegments);
      const extraSegmentMinutes=workableMinutes%workSegments;
      let cursor=period.start;
      for(let index=0;index<requiredRests;index++){
        const interval=baseSegment+(index<extraSegmentMinutes?1:0);
        const start=cursor+interval,end=start+REST_DURATION_MINUTES;
        rests.push({start,end,periodStart:period.start,periodEnd:period.end,interval,duration:REST_DURATION_MINUTES});
        cursor=end;
      }
    }
    return rests;
  }

  function dynamicPointRests(description){
    const assessment=assessPointPlanning(description);
    return assessment.valid?restsForPeriods(assessment.parsed.periods):[];
  }

  function baseThermalRests(description){
    // Shift preview only. Production plans require the day's actual punches.
    const assessment=assessShiftPlanning(description);
    return assessment.valid?restsForPeriods(assessment.parsed.periods):[];
  }

  function requiredRestCount(description){
    const assessment=assessPointPlanning(description);
    return assessment.valid?restsForPeriods(assessment.parsed.periods).length:null;
  }

  function requiredShiftRestCount(description){
    const assessment=assessShiftPlanning(description);
    return assessment.valid?restsForPeriods(assessment.parsed.periods).length:null;
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
    // The Senior date owns the shift, including work crossing midnight.
    void employee;
    return String(value||"").slice(0,10);
  }

  function buildMonthPlan(employees,monthDays,config={}){
    const plan=new Map();
    // A registered shift is a preview, never a replacement for missing point data.
    if(config.usePointData!==true)return plan;
    const ordered=(Array.isArray(employees)?employees:[])
      .slice()
      .sort((a,b)=>String(a.id||a.registration||"").localeCompare(String(b.id||b.registration||"")));
    for(const day of monthDays||[]){
      for(const employee of ordered){
        const description=employee.point_schedules?.[day.iso];
        const state=employee.point_states?.[day.iso];
        if(!description||(state&&state!=="WORKED"))continue;
        const assessment=assessPointPlanning(description);
        if(!assessment.valid)continue;
        plan.set(`${employee.id}|${day.iso}`,restsForPeriods(assessment.parsed.periods));
      }
    }
    return plan;
  }

  return {
    REST_AFTER_MINUTES,
    REST_DURATION_MINUTES,
    MAX_REST_DURATION_MINUTES,
    MAX_VARIATION_MINUTES,
    parsePointPeriods,
    parseShiftPeriods,
    parseShiftSchedule,
    assessPointPlanning,
    assessShiftPlanning,
    requiredRestCount,
    requiredShiftRestCount,
    baseThermalRests,
    dynamicPointRests,
    buildMonthPlan,
    isThirdShift,
    pointReportDate,
    formatMinutes
  };
});
