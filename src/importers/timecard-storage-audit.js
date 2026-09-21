function number(value){
  const parsed=Number(value||0);
  return Number.isFinite(parsed)?parsed:0;
}

const TOTAL_FIELDS=[
  'workMinutes',
  'bhNegativeMinutes',
  'bhPositiveMinutes',
  'he100Minutes',
  'absenceMinutes',
  'nightAdditionalMinutes',
  'travelMinutes'
];

function buildExpectedStorageSnapshot(rows=[]){
  const snapshot={
    employees:0,
    days:0,
    minDate:null,
    maxDate:null,
    totals:Object.fromEntries(TOTAL_FIELDS.map(field=>[field,0]))
  };

  for(const row of rows){
    if(!row?.employeeId)continue;
    snapshot.employees++;
    for(const day of row.days||[]){
      snapshot.days++;
      const date=String(day?.date||'').slice(0,10)||null;
      if(date){
        if(!snapshot.minDate||date<snapshot.minDate)snapshot.minDate=date;
        if(!snapshot.maxDate||date>snapshot.maxDate)snapshot.maxDate=date;
      }
      for(const field of TOTAL_FIELDS)snapshot.totals[field]+=number(day?.[field]);
    }
  }
  return snapshot;
}

function normalizeStoredSnapshot(row={}){
  const dateValue=value=>value instanceof Date?value.toISOString().slice(0,10):String(value||'').slice(0,10)||null;
  return {
    employees:number(row.employees),
    days:number(row.days),
    minDate:dateValue(row.min_date),
    maxDate:dateValue(row.max_date),
    totals:{
      workMinutes:number(row.work_minutes),
      bhNegativeMinutes:number(row.bh_negative_minutes),
      bhPositiveMinutes:number(row.bh_positive_minutes),
      he100Minutes:number(row.he_100_minutes),
      absenceMinutes:number(row.absence_minutes),
      nightAdditionalMinutes:number(row.night_additional_minutes),
      travelMinutes:number(row.travel_minutes)
    }
  };
}

function compareStorageSnapshots(expected,stored){
  const differences=[];
  if(number(expected?.employees)!==number(stored?.employees))differences.push({field:'employees',expected:number(expected?.employees),stored:number(stored?.employees)});
  if(number(expected?.days)!==number(stored?.days))differences.push({field:'days',expected:number(expected?.days),stored:number(stored?.days)});
  if((expected?.minDate||null)!==(stored?.minDate||null))differences.push({field:'minDate',expected:expected?.minDate||null,stored:stored?.minDate||null});
  if((expected?.maxDate||null)!==(stored?.maxDate||null))differences.push({field:'maxDate',expected:expected?.maxDate||null,stored:stored?.maxDate||null});
  for(const field of TOTAL_FIELDS){
    if(number(expected?.totals?.[field])!==number(stored?.totals?.[field]))differences.push({field,expected:number(expected?.totals?.[field]),stored:number(stored?.totals?.[field])});
  }
  return {ok:differences.length===0,differences};
}

module.exports={TOTAL_FIELDS,buildExpectedStorageSnapshot,normalizeStoredSnapshot,compareStorageSnapshots};
