"use strict";

const express=require("express");
const fs=require("node:fs");
const path=require("node:path");
const pool=require("../db/pool");
const audit=require("../db/audit");
const {authenticate,applyScope,requirePermission}=require("../middleware/auth");
const {normalizeRegistration,normalizeSeniorEmployee,validatePayload}=require("../services/senior-sync");
const {buildMonitorSnapshot}=require("../services/senior-monitor");

const router=express.Router();

function forbidden(message){
  const error=new Error(message);
  error.status=403;
  return error;
}
function assertScope(req,companyId,branchId){
  if(req.scope?.isAdmin)return;
  const allowedCompany=String(req.scope?.companyId||"")===String(companyId||"");
  const allowedBranches=(req.scope?.branchIds||[]).map(String);
  if(!allowedCompany||!allowedBranches.includes(String(branchId||""))){
    throw forbidden("Empresa ou filial fora do escopo do seu perfil.");
  }
}
async function scopeInfo(companyId,branchId){
  const result=await pool.query(`
    SELECT c.id company_id,c.trade_name company_name,b.id branch_id,b.name branch_name
    FROM branches b
    JOIN companies c ON c.id=b.company_id
    WHERE c.id=$1 AND b.id=$2 AND c.active=TRUE AND b.active=TRUE
    LIMIT 1
  `,[companyId,branchId]);
  return result.rows[0]||null;
}
function normalizeEmployees(payload){
  return payload.employees.map(item=>{
    const details=item?.detail||item;
    const employee=normalizeSeniorEmployee(details);
    if(!employee.registration){
      const base=item?.colaborador||item?.employee||{};
      employee.registration=normalizeRegistration(base.numeroCadastro||base.registration);
      employee.name=employee.name||String(base.nome||base.name||"").trim();
    }
    return employee;
  }).filter(item=>item.registration);
}
async function matchEmployees(companyId,branchId,seniorEmployees){
  const registrations=[...new Set(seniorEmployees.map(item=>item.registration).filter(Boolean))];
  if(!registrations.length)return {matched:[],missing:seniorEmployees};
  const result=await pool.query(`
    SELECT id,registration,full_name,status
    FROM employees
    WHERE company_id=$1 AND branch_id=$2
      AND REGEXP_REPLACE(COALESCE(registration,''),'^0+','','g')=ANY($3::text[])
  `,[companyId,branchId,registrations]);
  const byRegistration=new Map(result.rows.map(row=>[normalizeRegistration(row.registration),row]));
  const matched=[],missing=[];
  for(const senior of seniorEmployees){
    const system=byRegistration.get(senior.registration);
    if(system)matched.push({senior,system});
    else missing.push(senior);
  }
  return {matched,missing};
}
function summarize(matched,missing,payload){
  const days=matched.flatMap(item=>item.senior.days||[]);
  return {
    calculationCode:payload.calculationCode,
    period:{start:payload.periodStart,end:payload.periodEnd},
    seniorCompanyNumber:payload.seniorCompanyNumber||null,
    employeesReceived:matched.length+missing.length,
    employeesMatched:matched.length,
    employeesMissing:missing.length,
    daysReceived:days.length,
    eligibleDays:days.filter(day=>day.eligibleForAutomaticRest).length,
    reviewDays:days.filter(day=>["REVIEW","NO_MARKINGS","FALTA"].includes(day.state)).length,
    missingEmployees:missing.map(item=>({registration:item.registration,name:item.name})).slice(0,100)
  };
}
function crc32(buffer){
  let crc=0^(-1);
  for(const byte of buffer){
    crc^=byte;
    for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xEDB88320:0);
  }
  return (crc^(-1))>>>0;
}
function zipStored(files){
  const local=[],central=[];
  let offset=0;
  for(const file of files){
    const name=Buffer.from(file.name.replace(/\\/g,"/"),"utf8");
    const data=Buffer.from(file.content,"utf8");
    const crc=crc32(data);
    const header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50,0);
    header.writeUInt16LE(20,4);
    header.writeUInt16LE(0x0800,6);
    header.writeUInt16LE(0,8);
    header.writeUInt16LE(0,10);
    header.writeUInt16LE(0,12);
    header.writeUInt32LE(crc,14);
    header.writeUInt32LE(data.length,18);
    header.writeUInt32LE(data.length,22);
    header.writeUInt16LE(name.length,26);
    header.writeUInt16LE(0,28);
    local.push(header,name,data);

    const c=Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50,0);
    c.writeUInt16LE(20,4);
    c.writeUInt16LE(20,6);
    c.writeUInt16LE(0x0800,8);
    c.writeUInt16LE(0,10);
    c.writeUInt16LE(0,12);
    c.writeUInt16LE(0,14);
    c.writeUInt32LE(crc,16);
    c.writeUInt32LE(data.length,20);
    c.writeUInt32LE(data.length,24);
    c.writeUInt16LE(name.length,28);
    c.writeUInt16LE(0,30);
    c.writeUInt16LE(0,32);
    c.writeUInt16LE(0,34);
    c.writeUInt16LE(0,36);
    c.writeUInt32LE(0,38);
    c.writeUInt32LE(offset,42);
    central.push(c,name);
    offset+=header.length+name.length+data.length;
  }
  const localBuffer=Buffer.concat(local);
  const centralBuffer=Buffer.concat(central);
  const end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(0,4);
  end.writeUInt16LE(0,6);
  end.writeUInt16LE(files.length,8);
  end.writeUInt16LE(files.length,10);
  end.writeUInt32LE(centralBuffer.length,12);
  end.writeUInt32LE(localBuffer.length,16);
  end.writeUInt16LE(0,20);
  return Buffer.concat([localBuffer,centralBuffer,end]);
}

async function writeSeniorPayload({client,userId,companyId,branchId,payload,matched,missing,source="SENIOR_API_READ_ONLY",monitor=false,monitorSummary=null}){
  const fileName=monitor?`Senior Monitor - cálculo ${payload.calculationCode}`:`Senior API - cálculo ${payload.calculationCode}`;
  const details={
    source,
    readOnly:true,
    monitor:Boolean(monitor),
    calculationCode:payload.calculationCode,
    seniorCompanyNumber:payload.seniorCompanyNumber||null,
    period:{start:payload.periodStart,end:payload.periodEnd},
    periods:[{start:payload.periodStart,end:payload.periodEnd}],
    employeesReceived:matched.length+missing.length,
    employeesMatched:matched.length,
    employeesMissing:missing.length,
    ...(monitorSummary?{monitorSummary}:null)
  };
  const imported=await client.query(`
    INSERT INTO employee_imports(
      user_id,company_id,branch_id,import_type,file_name,total_found,total_created,total_updated,total_not_found,details
    ) VALUES($1,$2,$3,'PONTO_SENIOR',$4,$5,0,$6,$7,$8::jsonb)
    RETURNING id,created_at
  `,[userId,companyId,branchId,fileName,matched.length+missing.length,matched.length,missing.length,JSON.stringify(details)]);
  const importId=imported.rows[0].id;
  const employeeIds=matched.map(item=>item.system.id);

  const deleted=await client.query(`
    DELETE FROM employee_point_days
    WHERE employee_id=ANY($1::uuid[]) AND company_id=$2 AND branch_id=$3
      AND work_date BETWEEN $4::date AND $5::date
    RETURNING id
  `,[employeeIds,companyId,branchId,payload.periodStart,payload.periodEnd]);

  let savedDays=0,eligibleDays=0,reviewDays=0;
  for(const {senior,system} of matched){
    for(const day of senior.days){
      if(day.date<payload.periodStart||day.date>payload.periodEnd)continue;
      await client.query(`
        INSERT INTO employee_point_days(
          employee_id,import_id,company_id,branch_id,work_date,schedule_code,markings,point_state,occurrence,
          eligible_for_automatic_rest,source_file,work_minutes,bh_negative_minutes,bh_positive_minutes,he_100_minutes,
          absence_minutes,night_additional_minutes,travel_minutes,bh_source,bh_validated,imported_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
        ON CONFLICT(employee_id,work_date) DO UPDATE SET
          import_id=EXCLUDED.import_id,company_id=EXCLUDED.company_id,branch_id=EXCLUDED.branch_id,
          schedule_code=EXCLUDED.schedule_code,markings=EXCLUDED.markings,point_state=EXCLUDED.point_state,
          occurrence=EXCLUDED.occurrence,eligible_for_automatic_rest=EXCLUDED.eligible_for_automatic_rest,
          source_file=EXCLUDED.source_file,work_minutes=EXCLUDED.work_minutes,bh_negative_minutes=EXCLUDED.bh_negative_minutes,
          bh_positive_minutes=EXCLUDED.bh_positive_minutes,he_100_minutes=EXCLUDED.he_100_minutes,
          absence_minutes=EXCLUDED.absence_minutes,night_additional_minutes=EXCLUDED.night_additional_minutes,
          travel_minutes=EXCLUDED.travel_minutes,bh_source=EXCLUDED.bh_source,bh_validated=EXCLUDED.bh_validated,imported_at=NOW()
      `,[
        system.id,importId,companyId,branchId,day.date,day.scheduleCode,JSON.stringify(day.markings),day.state,day.occurrence,
        day.eligibleForAutomaticRest,fileName,day.workMinutes,day.bhNegativeMinutes,day.bhPositiveMinutes,day.he100Minutes,
        day.absenceMinutes,day.nightAdditionalMinutes,day.travelMinutes,day.bhSource,day.bhValidated
      ]);
      savedDays++;
      if(day.eligibleForAutomaticRest)eligibleDays++;
      if(["REVIEW","NO_MARKINGS","FALTA"].includes(day.state))reviewDays++;
    }
  }
  const postWrite={
    source,savedDays,eligibleDays,reviewDays,replacedDays:deleted.rowCount||0,
    missingEmployees:missing.map(item=>({registration:item.registration,name:item.name}))
  };
  await client.query(`UPDATE employee_imports SET details=details||$2::jsonb WHERE id=$1`,[importId,JSON.stringify({postWriteAudit:postWrite})]);
  return {importId,createdAt:imported.rows[0].created_at,savedDays,eligibleDays,reviewDays,replacedDays:deleted.rowCount||0};
}

async function loadMonitorByToken(token){
  if(!/^[0-9a-f-]{36}$/i.test(String(token||"")))return null;
  const result=await pool.query(`
    SELECT id,user_id,company_id,branch_id,active,token_id,schedule_hours,last_summary
    FROM senior_monitor_configs
    WHERE token_id=$1::uuid AND active=TRUE
    LIMIT 1
  `,[token]);
  return result.rows[0]||null;
}

router.post("/monitor/ingest",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const token=String(req.headers["x-senior-monitor-token"]||"").trim();
    const config=await loadMonitorByToken(token);
    if(!config)return res.status(401).json({error:"Monitor Senior não autorizado ou desativado."});

    if(req.body?.error){
      const errorMessage=String(req.body.error||"Falha na leitura da Senior.").slice(0,2000);
      await pool.query(`
        UPDATE senior_monitor_configs
        SET last_run_at=NOW(),last_status='ERROR',last_error=$2,updated_at=NOW()
        WHERE id=$1
      `,[config.id,errorMessage]);
      return res.status(202).json({success:false,status:"ERROR"});
    }

    const payload=validatePayload(req.body?.payload||{});
    const employees=normalizeEmployees(payload);
    const {matched,missing}=await matchEmployees(config.company_id,config.branch_id,employees);
    if(!matched.length)throw Object.assign(new Error("Nenhuma matrícula da leitura automática foi localizada na filial configurada."),{status:409});

    const monitorSummary=buildMonitorSnapshot(matched.map(item=>item.senior),config.last_summary||{});
    await client.query("BEGIN");
    const write=await writeSeniorPayload({
      client,userId:config.user_id,companyId:config.company_id,branchId:config.branch_id,
      payload,matched,missing,source:"SENIOR_API_READ_ONLY",monitor:true,monitorSummary
    });
    await client.query(`
      UPDATE senior_monitor_configs
      SET last_run_at=NOW(),last_success_at=NOW(),last_status='OK',last_error=NULL,last_summary=$2::jsonb,updated_at=NOW()
      WHERE id=$1
    `,[config.id,JSON.stringify(monitorSummary)]);
    await client.query("COMMIT");

    await audit({user:{sub:config.user_id},ip:req.ip},"AUTO_SYNC_SENIOR_API","employee_point_days",write.importId,{
      companyId:config.company_id,branchId:config.branch_id,calculationCode:payload.calculationCode,
      employees:matched.length,missing:missing.length,savedDays:write.savedDays,
      newIssues:monitorSummary.newIssueCount,changedDays:monitorSummary.changedDayCount,readOnlySource:true
    });

    res.json({
      success:true,status:"OK",employees:matched.length,missing:missing.length,
      savedDays:write.savedDays,newIssues:monitorSummary.newIssueCount,
      changedDays:monitorSummary.changedDayCount,currentIssues:monitorSummary.currentIssueCount
    });
  }catch(error){
    try{await client.query("ROLLBACK");}catch{}
    const token=String(req.headers["x-senior-monitor-token"]||"").trim();
    try{
      const config=await loadMonitorByToken(token);
      if(config)await pool.query(`
        UPDATE senior_monitor_configs
        SET last_run_at=NOW(),last_status='ERROR',last_error=$2,updated_at=NOW()
        WHERE id=$1
      `,[config.id,String(error.message||"Erro no monitor.").slice(0,2000)]);
    }catch{}
    if(error.status)return res.status(error.status).json({error:error.message});
    next(error);
  }finally{
    client.release();
  }
});

router.use(authenticate,applyScope,requirePermission("imports.manage"));

router.get("/monitor-config",async(req,res,next)=>{
  try{
    const companyId=String(req.query.companyId||"").trim();
    const branchId=String(req.query.branchId||"").trim();
    if(!companyId||!branchId)return res.status(400).json({error:"Informe empresa e filial."});
    assertScope(req,companyId,branchId);
    const result=await pool.query(`
      SELECT active,schedule_hours,last_run_at,last_success_at,last_status,last_error,last_summary,updated_at
      FROM senior_monitor_configs
      WHERE user_id=$1 AND company_id=$2 AND branch_id=$3
      LIMIT 1
    `,[req.user.sub,companyId,branchId]);
    res.json({configured:Boolean(result.rows[0]),config:result.rows[0]||{
      active:false,schedule_hours:[0,2,4,6,8,10,12,14,16,18,20,22],last_summary:{}
    }});
  }catch(error){next(error);}
});

router.post("/monitor-config",async(req,res,next)=>{
  try{
    const companyId=String(req.body?.companyId||"").trim();
    const branchId=String(req.body?.branchId||"").trim();
    const active=req.body?.active===true;
    if(!companyId||!branchId)return res.status(400).json({error:"Selecione empresa e filial."});
    assertScope(req,companyId,branchId);
    const scope=await scopeInfo(companyId,branchId);
    if(!scope)return res.status(404).json({error:"Empresa ou filial não localizada."});
    const hours=[0,2,4,6,8,10,12,14,16,18,20,22];

    const result=await pool.query(`
      INSERT INTO senior_monitor_configs(user_id,company_id,branch_id,active,token_id,schedule_hours,updated_at)
      VALUES($1,$2,$3,$4,gen_random_uuid(),$5::smallint[],NOW())
      ON CONFLICT(user_id,company_id,branch_id) DO UPDATE SET
        active=EXCLUDED.active,
        token_id=gen_random_uuid(),
        schedule_hours=EXCLUDED.schedule_hours,
        last_error=NULL,
        updated_at=NOW()
      RETURNING active,token_id,schedule_hours,last_run_at,last_success_at,last_status,last_error,last_summary
    `,[req.user.sub,companyId,branchId,active,hours]);
    await audit(req,active?"ENABLE_SENIOR_MONITOR":"DISABLE_SENIOR_MONITOR","senior_monitor_configs",null,{
      companyId,branchId,scheduleHours:hours,readOnlySenior:true
    });
    res.json({
      success:true,
      active:result.rows[0].active,
      monitorToken:active?result.rows[0].token_id:null,
      scheduleHours:result.rows[0].schedule_hours,
      companyId,branchId,
      message:active?"Monitor Senior 24h ativado a cada 2 horas.":"Monitor Senior desativado."
    });
  }catch(error){next(error);}
});

router.get("/status",async(req,res,next)=>{
  try{
    const companyId=String(req.query.companyId||"").trim();
    const branchId=String(req.query.branchId||"").trim();
    if(!companyId||!branchId)return res.status(400).json({error:"Informe empresa e filial."});
    assertScope(req,companyId,branchId);
    const scope=await scopeInfo(companyId,branchId);
    if(!scope)return res.status(404).json({error:"Empresa ou filial não localizada."});
    const result=await pool.query(`
      SELECT id,file_name,total_found,total_updated,total_not_found,details,created_at
      FROM employee_imports
      WHERE company_id=$1 AND branch_id=$2 AND import_type='PONTO_SENIOR'
        AND details->>'source'='SENIOR_API_READ_ONLY'
      ORDER BY created_at DESC
      LIMIT 10
    `,[companyId,branchId]);
    res.json({scope,history:result.rows});
  }catch(error){next(error);}
});

router.post("/preview",async(req,res,next)=>{
  try{
    const companyId=String(req.body?.companyId||"").trim();
    const branchId=String(req.body?.branchId||"").trim();
    if(!companyId||!branchId)return res.status(400).json({error:"Selecione empresa e filial."});
    assertScope(req,companyId,branchId);
    const scope=await scopeInfo(companyId,branchId);
    if(!scope)return res.status(404).json({error:"Empresa ou filial não localizada."});
    const payload=validatePayload(req.body?.payload||{});
    const employees=normalizeEmployees(payload);
    const {matched,missing}=await matchEmployees(companyId,branchId,employees);
    res.json({scope,summary:summarize(matched,missing,payload)});
  }catch(error){
    if(error.status)return res.status(error.status).json({error:error.message});
    next(error);
  }
});

router.post("/commit",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const companyId=String(req.body?.companyId||"").trim();
    const branchId=String(req.body?.branchId||"").trim();
    if(!companyId||!branchId)return res.status(400).json({error:"Selecione empresa e filial."});
    assertScope(req,companyId,branchId);
    const scope=await scopeInfo(companyId,branchId);
    if(!scope)return res.status(404).json({error:"Empresa ou filial não localizada."});

    const payload=validatePayload(req.body?.payload||{});
    const employees=normalizeEmployees(payload);
    const {matched,missing}=await matchEmployees(companyId,branchId,employees);
    if(!matched.length)return res.status(409).json({error:"Nenhuma matrícula recebida da Senior foi localizada nesta empresa/filial."});

    await client.query("BEGIN");
    const fileName=`Senior API - cálculo ${payload.calculationCode}`;
    const details={
      source:"SENIOR_API_READ_ONLY",
      readOnly:true,
      calculationCode:payload.calculationCode,
      seniorCompanyNumber:payload.seniorCompanyNumber||null,
      period:{start:payload.periodStart,end:payload.periodEnd},
      periods:[{start:payload.periodStart,end:payload.periodEnd}],
      employeesReceived:employees.length,
      employeesMatched:matched.length,
      employeesMissing:missing.length
    };
    const imported=await client.query(`
      INSERT INTO employee_imports(
        user_id,company_id,branch_id,import_type,file_name,total_found,total_created,total_updated,total_not_found,details
      ) VALUES($1,$2,$3,'PONTO_SENIOR',$4,$5,0,$6,$7,$8::jsonb)
      RETURNING id,created_at
    `,[req.user.sub,companyId,branchId,fileName,employees.length,matched.length,missing.length,JSON.stringify(details)]);
    const importId=imported.rows[0].id;
    const employeeIds=matched.map(item=>item.system.id);

    const deleted=await client.query(`
      DELETE FROM employee_point_days
      WHERE employee_id=ANY($1::uuid[]) AND company_id=$2 AND branch_id=$3
        AND work_date BETWEEN $4::date AND $5::date
      RETURNING id
    `,[employeeIds,companyId,branchId,payload.periodStart,payload.periodEnd]);

    let savedDays=0,eligibleDays=0,reviewDays=0;
    for(const {senior,system} of matched){
      for(const day of senior.days){
        if(day.date<payload.periodStart||day.date>payload.periodEnd)continue;
        await client.query(`
          INSERT INTO employee_point_days(
            employee_id,import_id,company_id,branch_id,work_date,schedule_code,markings,point_state,occurrence,
            eligible_for_automatic_rest,source_file,work_minutes,bh_negative_minutes,bh_positive_minutes,he_100_minutes,
            absence_minutes,night_additional_minutes,travel_minutes,bh_source,bh_validated,imported_at
          ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
          ON CONFLICT(employee_id,work_date) DO UPDATE SET
            import_id=EXCLUDED.import_id,company_id=EXCLUDED.company_id,branch_id=EXCLUDED.branch_id,
            schedule_code=EXCLUDED.schedule_code,markings=EXCLUDED.markings,point_state=EXCLUDED.point_state,
            occurrence=EXCLUDED.occurrence,eligible_for_automatic_rest=EXCLUDED.eligible_for_automatic_rest,
            source_file=EXCLUDED.source_file,work_minutes=EXCLUDED.work_minutes,bh_negative_minutes=EXCLUDED.bh_negative_minutes,
            bh_positive_minutes=EXCLUDED.bh_positive_minutes,he_100_minutes=EXCLUDED.he_100_minutes,
            absence_minutes=EXCLUDED.absence_minutes,night_additional_minutes=EXCLUDED.night_additional_minutes,
            travel_minutes=EXCLUDED.travel_minutes,bh_source=EXCLUDED.bh_source,bh_validated=EXCLUDED.bh_validated,imported_at=NOW()
        `,[
          system.id,importId,companyId,branchId,day.date,day.scheduleCode,JSON.stringify(day.markings),day.state,day.occurrence,
          day.eligibleForAutomaticRest,fileName,day.workMinutes,day.bhNegativeMinutes,day.bhPositiveMinutes,day.he100Minutes,
          day.absenceMinutes,day.nightAdditionalMinutes,day.travelMinutes,day.bhSource,day.bhValidated
        ]);
        savedDays++;
        if(day.eligibleForAutomaticRest)eligibleDays++;
        if(["REVIEW","NO_MARKINGS","FALTA"].includes(day.state))reviewDays++;
      }
    }

    const postWrite={
      source:"SENIOR_API_READ_ONLY",
      savedDays,eligibleDays,reviewDays,
      replacedDays:deleted.rowCount||0,
      missingEmployees:missing.map(item=>({registration:item.registration,name:item.name}))
    };
    await client.query(`UPDATE employee_imports SET details=details||$2::jsonb WHERE id=$1`,[importId,JSON.stringify({postWriteAudit:postWrite})]);
    await client.query("COMMIT");

    await audit(req,"SYNC_SENIOR_API","employee_point_days",importId,{
      companyId,branchId,calculationCode:payload.calculationCode,
      period:{start:payload.periodStart,end:payload.periodEnd},
      employees:matched.length,missing:missing.length,savedDays,eligibleDays,reviewDays,
      readOnlySource:true
    });

    res.json({
      success:true,importId,createdAt:imported.rows[0].created_at,
      companyName:scope.company_name,branchName:scope.branch_name,
      employees:matched.length,missing:missing.length,savedDays,eligibleDays,reviewDays,
      replacedDays:deleted.rowCount||0,
      message:`Sincronização concluída: ${matched.length} colaborador(es) e ${savedDays} dia(s) gravados a partir da Senior.`
    });
  }catch(error){
    try{await client.query("ROLLBACK");}catch{}
    if(error.status)return res.status(error.status).json({error:error.message});
    next(error);
  }finally{
    client.release();
  }
});

router.get("/connector.zip",(req,res,next)=>{
  try{
    const root=path.join(__dirname,"..","senior-connector");
    const names=["manifest.json","background.js","bridge.js","README.txt"];
    const files=names.map(name=>({name,content:fs.readFileSync(path.join(root,name),"utf8")}));
    const archive=zipStored(files);
    res.set("Content-Type","application/zip");
    res.set("Content-Disposition",'attachment; filename="Controle-Termico-Conector-Senior-Beta109.zip"');
    res.set("Cache-Control","no-store");
    res.send(archive);
  }catch(error){next(error);}
});

module.exports=router;
