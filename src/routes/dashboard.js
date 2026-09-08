const express=require("express");
const pool=require("../db/pool");
const {authenticate,applyScope,requirePermission,requireOccurrencesAccess}=require("../middleware/auth");
const DashboardAlerts=require("../lib/dashboard-alerts");
const audit=require("../db/audit");
const router=express.Router();
router.use(authenticate,applyScope,requirePermission("dashboard.view"));

function parseBhMinutes(occurrence){
  const text=String(occurrence||"").split(" | ")[0].trim();
  if(!/(^|[^A-Z])BH([^A-Z]|$)/i.test(text))return 0;
  const times=[...text.matchAll(/(?:^|\s)((?:[01]\d|2[0-3]):[0-5]\d)(?=\s|$)/g)].map(m=>m[1]);
  if(!times.length)return 0;
  // Nas linhas do Senior, quando há jornada trabalhada, o primeiro total após
  // a ocorrência representa o total trabalhado. O saldo de BH vem na coluna
  // seguinte. Totais posteriores podem ser adicionais/noturnos e não devem
  // ser somados como Banco de Horas. Em "Folga BH" há somente o próprio
  // saldo, portanto usamos o único horário disponível.
  const bhTime=times.length===1?times[0]:times[1];
  const [h,m]=bhTime.split(":").map(Number);
  const minutes=h*60+m;
  return /BH\s*\(-\)/i.test(text)?-minutes:minutes;
}

function formatBhMinutes(minutes){
  const value=Math.round(Number(minutes)||0);
  const sign=value>0?"+":value<0?"-":"";
  const abs=Math.abs(value);
  return `${sign}${String(Math.floor(abs/60)).padStart(2,"0")}:${String(abs%60).padStart(2,"0")}`;
}

router.get("/summary",async(req,res,next)=>{
  try{
    if(req.scope.isAdmin){
      const [employees,companies,branches,users,missingShift]=await Promise.all([
        pool.query("SELECT COUNT(*)::int total FROM employees WHERE status='ATIVO'"),
        pool.query("SELECT COUNT(*)::int total FROM companies WHERE active=TRUE"),
        pool.query("SELECT COUNT(*)::int total FROM branches WHERE active=TRUE"),
        pool.query("SELECT COUNT(*)::int total FROM users WHERE active=TRUE"),
        pool.query("SELECT COUNT(*)::int total FROM employees WHERE status='ATIVO' AND shift_id IS NULL")
      ]);
      return res.json({
        employees:employees.rows[0].total,
        companies:companies.rows[0].total,
        branches:branches.rows[0].total,
        users:users.rows[0].total,
        missingShift:missingShift.rows[0].total
      });
    }
    const params=[req.scope.companyId,req.scope.branchIds];
    const [employees,branches,missingShift]=await Promise.all([
      pool.query("SELECT COUNT(*)::int total FROM employees WHERE status='ATIVO' AND company_id=$1 AND branch_id=ANY($2::uuid[])",params),
      pool.query("SELECT COUNT(*)::int total FROM branches WHERE active=TRUE AND company_id=$1 AND id=ANY($2::uuid[])",params),
      pool.query("SELECT COUNT(*)::int total FROM employees WHERE status='ATIVO' AND shift_id IS NULL AND company_id=$1 AND branch_id=ANY($2::uuid[])",params)
    ]);
    res.json({
      employees:employees.rows[0].total,
      companies:req.scope.companyId?1:0,
      branches:branches.rows[0].total,
      users:1,
      missingShift:missingShift.rows[0].total
    });
  }catch(error){next(error);}
});

router.get("/alerts",async(req,res,next)=>{
  try{
    const month=String(req.query.month||"");
    if(!/^\d{4}-\d{2}$/.test(month)){
      return res.status(400).json({error:"Informe o mês no formato AAAA-MM."});
    }

    const employeeParams=[];
    let employeeScope="";
    if(!req.scope.isAdmin){
      employeeParams.push(req.scope.companyId,req.scope.branchIds);
      employeeScope=" AND e.company_id=$1 AND e.branch_id=ANY($2::uuid[])";
    }

    const {rows:employees}=await pool.query(`
      SELECT
        e.id,e.company_id,e.branch_id,e.full_name,e.registration,
        c.trade_name company_name,b.name branch_name,
        s.name shift_name,
        COALESCE(e.report_policy_override,jbp.report_policy,j.report_policy,'PENDING') report_policy
      FROM employees e
      JOIN companies c ON c.id=e.company_id
      JOIN branches b ON b.id=e.branch_id
      LEFT JOIN shifts s ON s.id=e.shift_id AND s.active=TRUE
      LEFT JOIN job_roles j ON j.id=e.job_role_id
      LEFT JOIN job_role_branch_report_policies jbp
        ON jbp.job_role_id=e.job_role_id AND jbp.branch_id=e.branch_id
      WHERE UPPER(TRIM(COALESCE(e.status,'')))='ATIVO'
        ${employeeScope}
      ORDER BY c.trade_name,b.name,e.full_name
    `,employeeParams);

    const importParams=[month];
    let importScope="";
    if(!req.scope.isAdmin){
      importParams.push(req.scope.companyId,req.scope.branchIds);
      importScope=" AND i.company_id=$2 AND i.branch_id=ANY($3::uuid[])";
    }
    const {rows:imports}=await pool.query(`
      SELECT DISTINCT i.company_id,i.branch_id
      FROM employee_imports i
      WHERE i.import_type='PONTO_SENIOR'
        AND COALESCE(i.details->'period'->>'start','') ~ '^\\d{4}-\\d{2}-\\d{2}$'
        AND COALESCE(i.details->'period'->>'end','') ~ '^\\d{4}-\\d{2}-\\d{2}$'
        AND LEFT(i.details->'period'->>'end',7)=$1
        ${importScope}
    `,importParams);

    const pointParams=[`${month}-01`];
    let pointScope="";
    if(!req.scope.isAdmin){
      pointParams.push(req.scope.companyId,req.scope.branchIds);
      pointScope=" AND p.company_id=$2 AND p.branch_id=ANY($3::uuid[])";
    }
    const {rows:pointRows}=await pool.query(`
      SELECT DISTINCT p.employee_id
      FROM employee_point_days p
      WHERE p.work_date>=($1::date - INTERVAL '1 day')
        AND p.work_date<($1::date + INTERVAL '1 month')
        ${pointScope}
    `,pointParams);

    const {rows:thermalRows}=await pool.query(`
      SELECT setting_value
      FROM system_settings
      WHERE setting_key='thermal-rest' AND company_id IS NULL AND branch_id IS NULL
      ORDER BY updated_at DESC,id DESC
      LIMIT 1
    `);
    const thermalConfig=thermalRows[0]?.setting_value||{};
    const alerts=DashboardAlerts.classify({
      employees,
      imports,
      pointRows,
      thermalConfig
    });
    res.json({month,...alerts});
  }catch(error){next(error);}
});

router.get("/operations",async(req,res,next)=>{
  try{
    const month=String(req.query.month||"");
    if(!/^\d{4}-\d{2}$/.test(month)){
      return res.status(400).json({error:"Informe o mês no formato AAAA-MM."});
    }

    const params=[month];
    let scope="";
    if(!req.scope.isAdmin){
      params.push(req.scope.companyId,req.scope.branchIds);
      scope=" AND i.company_id=$2 AND i.branch_id=ANY($3::uuid[])";
    }

    const {rows:imports}=await pool.query(`
      SELECT i.id,i.file_name,i.total_found,i.total_updated,i.total_not_found,
             i.details,i.created_at,c.trade_name company_name,b.name branch_name
      FROM employee_imports i
      LEFT JOIN companies c ON c.id=i.company_id
      LEFT JOIN branches b ON b.id=i.branch_id
      WHERE i.import_type='PONTO_SENIOR'
        AND COALESCE(i.details->'period'->>'start','') ~ '^\\d{4}-\\d{2}-\\d{2}$'
        AND COALESCE(i.details->'period'->>'end','') ~ '^\\d{4}-\\d{2}-\\d{2}$'
        AND LEFT(i.details->'period'->>'end',7)=$1
        ${scope}
      ORDER BY i.created_at DESC
    `,params);

    const pointParams=[`${month}-01`];
    let pointScope="";
    if(!req.scope.isAdmin){
      pointParams.push(req.scope.companyId,req.scope.branchIds);
      pointScope=" AND p.company_id=$2 AND p.branch_id=ANY($3::uuid[])";
    }
    const {rows:pointSummary}=await pool.query(`
      SELECT
        COUNT(DISTINCT p.employee_id)::int employees_with_point,
        COUNT(*)::int point_days,
        COUNT(*) FILTER(WHERE p.eligible_for_automatic_rest=TRUE)::int eligible_days,
        COUNT(*) FILTER(WHERE p.point_state='REVIEW')::int review_days
      FROM employee_point_days p
      WHERE p.work_date>=($1::date - INTERVAL '1 day')
        AND p.work_date<($1::date + INTERVAL '1 month')
        ${pointScope}
    `,pointParams);

    const latest=imports[0]||null;
    res.json({
      month,
      point:{
        imports:imports.length,
        employees:pointSummary[0]?.employees_with_point||0,
        days:pointSummary[0]?.point_days||0,
        eligibleDays:pointSummary[0]?.eligible_days||0,
        reviewDays:pointSummary[0]?.review_days||0,
        lastImport:latest?{
          fileName:latest.file_name,
          createdAt:latest.created_at,
          companyName:latest.company_name||"-",
          branchName:latest.branch_name||"-",
          found:latest.total_found||0,
          located:latest.total_updated||0,
          notFound:latest.total_not_found||0
        }:null
      }
    });
  }catch(error){next(error);}
});

router.get("/competence-compare",async(req,res,next)=>{
  try{
    const months=[String(req.query.monthA||""),String(req.query.monthB||"")];
    if(months.some(month=>!/^\d{4}-\d{2}$/.test(month))){
      return res.status(400).json({error:"Informe as duas competências no formato AAAA-MM."});
    }

    async function snapshot(month){
      const importParams=[month];
      let importScope="";
      if(!req.scope.isAdmin){
        importParams.push(req.scope.companyId,req.scope.branchIds);
        importScope=" AND i.company_id=$2 AND i.branch_id=ANY($3::uuid[])";
      }
      const {rows:imports}=await pool.query(`
        SELECT DISTINCT i.company_id,i.branch_id
        FROM employee_imports i
        WHERE i.import_type='PONTO_SENIOR'
          AND LEFT(COALESCE(i.details->'period'->>'end',''),7)=$1
          ${importScope}
      `,importParams);

      const pointParams=[`${month}-01`];
      let pointScope="";
      if(!req.scope.isAdmin){
        pointParams.push(req.scope.companyId,req.scope.branchIds);
        pointScope=" AND p.company_id=$2 AND p.branch_id=ANY($3::uuid[])";
      }
      const {rows:summary}=await pool.query(`
        SELECT
          COUNT(DISTINCT p.employee_id)::int employees,
          COUNT(*)::int days,
          COUNT(*) FILTER(WHERE p.eligible_for_automatic_rest=TRUE)::int eligible_days,
          COUNT(*) FILTER(WHERE p.point_state='REVIEW')::int review_days,
          COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('FALTA','ABSENT'))::int absence_days,
          COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('FERIAS','FÉRIAS','VACATION'))::int vacation_days,
          COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('ATESTADO','MEDICAL'))::int medical_days
        FROM employee_point_days p
        WHERE p.work_date>=($1::date - INTERVAL '1 day')
          AND p.work_date<($1::date + INTERVAL '1 month')
          ${pointScope}
      `,pointParams);

      const {rows:states}=await pool.query(`
        SELECT UPPER(COALESCE(p.point_state,'OUTRO')) state,COUNT(*)::int total
        FROM employee_point_days p
        WHERE p.work_date>=($1::date - INTERVAL '1 day')
          AND p.work_date<($1::date + INTERVAL '1 month')
          ${pointScope}
        GROUP BY UPPER(COALESCE(p.point_state,'OUTRO'))
        ORDER BY total DESC
      `,pointParams);

      return {
        month,
        imports:imports.length,
        employees:summary[0]?.employees||0,
        days:summary[0]?.days||0,
        eligibleDays:summary[0]?.eligible_days||0,
        reviewDays:summary[0]?.review_days||0,
        absenceDays:summary[0]?.absence_days||0,
        vacationDays:summary[0]?.vacation_days||0,
        medicalDays:summary[0]?.medical_days||0,
        states
      };
    }

    const [a,b]=await Promise.all(months.map(snapshot));
    res.json({a,b});
  }catch(error){next(error);}
});

router.get("/occurrences",requireOccurrencesAccess,async(req,res,next)=>{
  try{
    const month=String(req.query.month||"");
    const companyId=String(req.query.companyId||"").trim();
    const branchId=String(req.query.branchId||"").trim();
    if(!/^\d{4}-\d{2}$/.test(month))return res.status(400).json({error:"Informe a competência no formato AAAA-MM."});

    const params=[`${month}-01`];
    const filters=[];
    if(!req.scope.isAdmin){
      params.push(req.scope.companyId); filters.push(`p.company_id=$${params.length}`);
      params.push(req.scope.branchIds); filters.push(`p.branch_id=ANY($${params.length}::uuid[])`);
    }
    if(companyId){params.push(companyId);filters.push(`p.company_id=$${params.length}::uuid`);}
    if(branchId){params.push(branchId);filters.push(`p.branch_id=$${params.length}::uuid`);}
    const pointFilter=filters.length?` AND ${filters.join(" AND ")}`:"";

    const {rows}=await pool.query(`
      SELECT
        e.id employee_id,e.full_name,e.registration,e.shift_id,
        c.id company_id,c.trade_name company_name,b.id branch_id,b.name branch_name,
        s.name shift_name,s.senior_code shift_senior_code,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,''))='FOLGA')::int days_off,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('FALTA','ABSENT'))::int absences,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.occurrence,'')) ~ '(^|[^A-Z])BH([^A-Z]|$)')::int bank_hours,
        COALESCE(jsonb_agg(p.occurrence) FILTER(WHERE UPPER(COALESCE(p.occurrence,'')) ~ '(^|[^A-Z])BH([^A-Z]|$)'), '[]'::jsonb) bh_occurrences,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('ATESTADO','MEDICAL'))::int medical,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('FERIAS','FÉRIAS','VACATION'))::int vacations,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,''))='DSR')::int dsr,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('LICENCA','LICENÇA','LICENSE'))::int licenses,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('AFASTAMENTO','LEAVE'))::int leaves,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,''))='COMPENSADO')::int compensated,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,''))='CURSO')::int courses,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('OBITO','ÓBITO'))::int bereavement,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,'')) IN ('REVIEW','NO_MARKINGS'))::int review_days,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.occurrence,'')) ~ 'SA[ÍI]DA[[:space:]]+ANTECIPADA')::int early_exits,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,''))='WORKED')::int worked_days,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,''))='WORKED' AND jsonb_array_length(COALESCE(p.markings,'[]'::jsonb)) IN (2,4))::int complete_work_days,
        COUNT(*) FILTER(WHERE UPPER(COALESCE(p.point_state,''))='WORKED' AND jsonb_array_length(COALESCE(p.markings,'[]'::jsonb))=4)::int interval_days
      FROM employee_point_days p
      JOIN employees e ON e.id=p.employee_id
      JOIN companies c ON c.id=p.company_id JOIN branches b ON b.id=p.branch_id
      LEFT JOIN shifts s ON s.id=e.shift_id
      WHERE p.work_date >= $1::date AND p.work_date < ($1::date + INTERVAL '1 month') ${pointFilter}
      GROUP BY e.id,e.full_name,e.registration,e.shift_id,c.id,c.trade_name,b.id,b.name,s.name,s.senior_code
      ORDER BY c.trade_name,b.name,COALESCE(s.name,''),e.full_name
    `,params);

    const settingParams=[]; const settingFilters=["ss.setting_key='occurrences-management'"];
    if(companyId){settingParams.push(companyId);settingFilters.push(`ss.company_id=$${settingParams.length}::uuid`);}
    if(branchId){settingParams.push(branchId);settingFilters.push(`ss.branch_id=$${settingParams.length}::uuid`);}
    const {rows:settingRows}=await pool.query(`SELECT ss.company_id,ss.branch_id,ss.setting_value FROM system_settings ss WHERE ${settingFilters.join(" AND ")} ORDER BY ss.updated_at DESC`,settingParams);
    const configs=new Map(settingRows.map(item=>[`${item.company_id||""}|${item.branch_id||""}`,item.setting_value||{}]));
    for(const row of rows){
      const cfg=configs.get(`${row.company_id}|${row.branch_id}`)||{};
      const employeeCoordinator=cfg.employeeCoordinators?.[row.employee_id]||null;
      const shiftCoordinator=row.shift_id?cfg.shiftCoordinators?.[row.shift_id]||null:null;
      row.coordinator=employeeCoordinator||shiftCoordinator||null;
      row.coordinator_source=employeeCoordinator?"COLABORADOR":shiftCoordinator?"TURNO":null;
      const absences=Number(row.absences||0);
      const bankHours=Number(row.bank_hours||0);
      const bhEntries=Array.isArray(row.bh_occurrences)?row.bh_occurrences:[];
      const bhNetMinutes=bhEntries.reduce((sum,item)=>sum+parseBhMinutes(item),0);
      const bhPositiveMinutes=bhEntries.reduce((sum,item)=>{const value=parseBhMinutes(item);return sum+(value>0?value:0);},0);
      const bhNegativeMinutes=bhEntries.reduce((sum,item)=>{const value=parseBhMinutes(item);return sum+(value<0?Math.abs(value):0);},0);
      row.bh_net_minutes=bhNetMinutes;
      row.bh_positive_minutes=bhPositiveMinutes;
      row.bh_negative_minutes=bhNegativeMinutes;
      row.bh_net=formatBhMinutes(bhNetMinutes);
      row.bh_positive=formatBhMinutes(bhPositiveMinutes);
      row.bh_negative=bhNegativeMinutes?`-${formatBhMinutes(bhNegativeMinutes).replace(/^[-+]/,'')}`:'00:00';
      const reviews=Number(row.review_days||0);
      const earlyExits=Number(row.early_exits||0);
      const workedDays=Number(row.worked_days||0);
      const completeWorkDays=Number(row.complete_work_days||0);
      const incompleteDays=Math.max(0,workedDays-completeWorkDays);
      // Semáforo gerencial calibrado: ocorrências justificadas continuam
      // informativas. BH passa a ser analisado pelo tempo real acumulado, e
      // não pela simples quantidade de dias em que a Senior escreveu "BH".
      // Tolerância inicial: até 30 min líquidos não agrava o indicador.
      // Positivo: atenção acima de 30 min e crítico a partir de 10h.
      // Negativo: atenção acima de 30 min e crítico a partir de 4h.
      const critical=[]; const attention=[];
      if(absences>=2)critical.push(`${absences} faltas`); else if(absences===1)attention.push('1 falta');
      if(earlyExits>=3)critical.push(`${earlyExits} saídas antecipadas`); else if(earlyExits>0)attention.push(`${earlyExits} saída${earlyExits===1?'':'s'} antecipada${earlyExits===1?'':'s'}`);
      if(reviews>=3)critical.push(`${reviews} dias para revisão`); else if(reviews>0)attention.push(`${reviews} dia${reviews===1?'':'s'} para revisão`);
      if(incompleteDays>=3)critical.push(`${incompleteDays} jornadas incompletas`); else if(incompleteDays>0)attention.push(`${incompleteDays} jornada${incompleteDays===1?'':'s'} incompleta${incompleteDays===1?'':'s'}`);
      if(bhNegativeMinutes>=240)critical.push(`BH negativo ${row.bh_negative}`);
      else if(bhPositiveMinutes>=600)critical.push(`BH positivo ${row.bh_positive}`);
      else if(Math.abs(bhNetMinutes)>30||bhPositiveMinutes>30||bhNegativeMinutes>30)attention.push(`BH ${row.bh_net}`);
      row.indicator_status=critical.length?'RED':attention.length?'YELLOW':'GREEN';
      row.indicator_reasons=critical.length?critical:attention;
      row.incomplete_days=incompleteDays;
      row.green_eligible=row.indicator_status==='GREEN';
    }

    const summary=rows.reduce((acc,row)=>{
      for(const key of ["days_off","absences","bank_hours","medical","vacations","dsr","licenses","leaves","compensated","courses","bereavement","review_days"])acc[key]=(acc[key]||0)+Number(row[key]||0);
      acc.bh_positive_minutes=(acc.bh_positive_minutes||0)+Number(row.bh_positive_minutes||0);
      acc.bh_negative_minutes=(acc.bh_negative_minutes||0)+Number(row.bh_negative_minutes||0);
      acc.bh_net_minutes=(acc.bh_net_minutes||0)+Number(row.bh_net_minutes||0);
      return acc;
    },{});
    summary.bh_positive=formatBhMinutes(summary.bh_positive_minutes||0);
    summary.bh_negative=(summary.bh_negative_minutes||0)?`-${formatBhMinutes(summary.bh_negative_minutes).replace(/^[-+]/,'')}`:'00:00';
    summary.bh_net=formatBhMinutes(summary.bh_net_minutes||0);

    const importParams=[month]; const importFilters=[];
    if(!req.scope.isAdmin){importParams.push(req.scope.companyId);importFilters.push(`i.company_id=$${importParams.length}`);importParams.push(req.scope.branchIds);importFilters.push(`i.branch_id=ANY($${importParams.length}::uuid[])`);}
    if(companyId){importParams.push(companyId);importFilters.push(`i.company_id=$${importParams.length}::uuid`);}
    if(branchId){importParams.push(branchId);importFilters.push(`i.branch_id=$${importParams.length}::uuid`);}
    const importFilter=importFilters.length?` AND ${importFilters.join(" AND ")}`:"";
    const {rows:imports}=await pool.query(`
      SELECT DISTINCT i.company_id,i.branch_id,c.trade_name company_name,b.name branch_name,
        i.details->'period'->>'start' period_start,i.details->'period'->>'end' period_end
      FROM employee_imports i LEFT JOIN companies c ON c.id=i.company_id LEFT JOIN branches b ON b.id=i.branch_id
      WHERE i.import_type='PONTO_SENIOR'
        AND COALESCE(i.details->'period'->>'start','') ~ '^\\d{4}-\\d{2}-\\d{2}$'
        AND COALESCE(i.details->'period'->>'end','') ~ '^\\d{4}-\\d{2}-\\d{2}$'
        AND LEFT(i.details->'period'->>'end',7)=$1
        ${importFilter} ORDER BY company_name,branch_name
    `,importParams);
    res.json({month,companyId:companyId||null,branchId:branchId||null,summary,employees:rows,imports});
  }catch(error){next(error);}
});

router.get("/occurrences/journey",requireOccurrencesAccess,async(req,res,next)=>{
  try{
    const month=String(req.query.month||""); const employeeId=String(req.query.employeeId||"").trim();
    if(!/^\d{4}-\d{2}$/.test(month)||!employeeId)return res.status(400).json({error:"Informe competência e colaborador."});
    const params=[employeeId,`${month}-01`];
    let scope="";
    if(!req.scope.isAdmin){params.push(req.scope.companyId,req.scope.branchIds);scope=` AND p.company_id=$3 AND p.branch_id=ANY($4::uuid[])`;}
    const {rows}=await pool.query(`
      SELECT p.work_date,p.schedule_code,p.markings,p.point_state,p.occurrence,p.eligible_for_automatic_rest,
             e.full_name,e.registration,s.name shift_name,s.description shift_description
      FROM employee_point_days p JOIN employees e ON e.id=p.employee_id LEFT JOIN shifts s ON s.id=e.shift_id
      WHERE p.employee_id=$1::uuid AND p.work_date >= $2::date AND p.work_date < ($2::date + INTERVAL '1 month') ${scope}
      ORDER BY p.work_date
    `,params);
    res.json({month,employeeId,days:rows});
  }catch(error){next(error);}
});

router.get("/occurrences/management",requireOccurrencesAccess,async(req,res,next)=>{
  try{
    const companyId=String(req.query.companyId||"").trim(); const branchId=String(req.query.branchId||"").trim();
    if(!companyId||!branchId)return res.json({shiftCoordinators:{},employeeCoordinators:{}});
    if(!req.scope.isAdmin&&(String(companyId)!==String(req.scope.companyId)||!req.scope.branchIds.map(String).includes(String(branchId))))return res.status(403).json({error:"Filial fora do seu escopo."});
    const {rows}=await pool.query("SELECT setting_value FROM system_settings WHERE company_id=$1 AND branch_id=$2 AND setting_key='occurrences-management' ORDER BY updated_at DESC LIMIT 1",[companyId,branchId]);
    res.json(rows[0]?.setting_value||{shiftCoordinators:{},employeeCoordinators:{}});
  }catch(error){next(error);}
});

router.put("/occurrences/management",requireOccurrencesAccess,async(req,res,next)=>{
  try{
    const companyId=String(req.body?.companyId||"").trim(); const branchId=String(req.body?.branchId||"").trim();
    if(!companyId||!branchId)return res.status(400).json({error:"Selecione empresa e filial para salvar os coordenadores."});
    if(!req.scope.isAdmin&&(String(companyId)!==String(req.scope.companyId)||!req.scope.branchIds.map(String).includes(String(branchId))))return res.status(403).json({error:"Filial fora do seu escopo."});
    const cleanMap=value=>Object.fromEntries(Object.entries(value&&typeof value==='object'?value:{}).filter(([k,v])=>k&&v&&typeof v==='object'&&String(v.name||'').trim()).map(([k,v])=>[k,{id:String(v.id||''),name:String(v.name||'').trim()}]));
    const value={shiftCoordinators:cleanMap(req.body?.shiftCoordinators),employeeCoordinators:cleanMap(req.body?.employeeCoordinators)};
    const existing=await pool.query("SELECT id FROM system_settings WHERE company_id=$1 AND branch_id=$2 AND setting_key='occurrences-management' ORDER BY updated_at DESC LIMIT 1",[companyId,branchId]);
    if(existing.rows[0])await pool.query("UPDATE system_settings SET setting_value=$1::jsonb,updated_at=NOW() WHERE id=$2",[JSON.stringify(value),existing.rows[0].id]);
    else await pool.query("INSERT INTO system_settings(company_id,branch_id,setting_key,setting_value) VALUES($1,$2,'occurrences-management',$3::jsonb)",[companyId,branchId,JSON.stringify(value)]);
    await audit(req,"UPDATE_OCCURRENCES_MANAGEMENT","system_settings",null,{companyId,branchId,shiftAssignments:Object.keys(value.shiftCoordinators).length,employeeAssignments:Object.keys(value.employeeCoordinators).length});
    res.json({ok:true,...value});
  }catch(error){next(error);}
});

module.exports=router;
