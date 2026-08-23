require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("./pool");

async function ensureCompany(client, data) {
  const existing = await client.query(
    "SELECT id FROM companies WHERE trade_name=$1 LIMIT 1",
    [data.tradeName]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const { rows } = await client.query(
    `INSERT INTO companies(legal_name,trade_name,cnpj,city,state,active)
     VALUES($1,$2,$3,$4,$5,TRUE)
     RETURNING id`,
    [data.legalName, data.tradeName, data.cnpj, data.city, data.state]
  );
  return rows[0].id;
}

async function ensureBranch(client, companyId, data) {
  const existing = await client.query(
    "SELECT id FROM branches WHERE company_id=$1 AND name=$2 LIMIT 1",
    [companyId, data.name]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const { rows } = await client.query(
    `INSERT INTO branches(company_id,name,cnpj,internal_code,city,state,active)
     VALUES($1,$2,$3,$4,$5,$6,TRUE)
     RETURNING id`,
    [companyId, data.name, data.cnpj, data.code, data.city, data.state]
  );
  return rows[0].id;
}

async function ensureCatalog(client, table, companyId, name, description = null) {
  const existing = await client.query(
    `SELECT id FROM ${table} WHERE company_id=$1 AND name=$2 LIMIT 1`,
    [companyId, name]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const hasDescription = table === "shifts";
  const sql = hasDescription
    ? `INSERT INTO ${table}(company_id,name,description,active)
       VALUES($1,$2,$3,TRUE) RETURNING id`
    : `INSERT INTO ${table}(company_id,name,active)
       VALUES($1,$2,TRUE) RETURNING id`;

  const params = hasDescription
    ? [companyId, name, description]
    : [companyId, name];

  const { rows } = await client.query(sql, params);
  return rows[0].id;
}

async function ensureEmployee(client, data) {
  const existing = await client.query(
    "SELECT id FROM employees WHERE registration=$1 LIMIT 1",
    [data.registration]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const { rows } = await client.query(
    `INSERT INTO employees(
      company_id,branch_id,shift_id,department_id,job_role_id,
      full_name,registration,cpf,job_title,admission_date,status,weekly_days_off
    )
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ATIVO',$11)
    RETURNING id`,
    [
      data.companyId,
      data.branchId,
      data.shiftId,
      data.departmentId,
      data.jobRoleId,
      data.fullName,
      data.registration,
      data.cpf,
      data.jobTitle,
      data.admissionDate,
      data.weeklyDaysOff
    ]
  );
  return rows[0].id;
}

(async()=>{
  const client = await pool.connect();
  try{
    await client.query("BEGIN");

    const adminName = process.env.ADMIN_NAME || "Administrador";
    const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || "";

    if (adminEmail && adminPassword.length >= 8) {
      const activeMaster=await client.query(`
        SELECT u.id,u.email
        FROM users u
        JOIN user_profiles p ON p.id=u.profile_id
        WHERE p.master_admin=TRUE AND u.active=TRUE
        ORDER BY u.created_at,u.id
        LIMIT 1
      `);
      const currentMaster=activeMaster.rows[0]||null;

      if(currentMaster&&String(currentMaster.email).toLowerCase()!==adminEmail){
        console.log(`Administrador inicial não alterado: a conta Master ativa é ${currentMaster.email}. Atualize ADMIN_EMAIL no Render antes de trocar essa identidade.`);
      }else{
        const adminHash = await bcrypt.hash(adminPassword, 12);
        await client.query(
          `INSERT INTO users(name,email,password_hash,role,profile_id,active)
           VALUES($1,$2,$3,'ADMIN',(
             SELECT id FROM user_profiles WHERE master_admin=TRUE AND base_role='ADMIN' LIMIT 1
           ),TRUE)
           ON CONFLICT(email)
           DO UPDATE SET name=EXCLUDED.name,role='ADMIN',profile_id=EXCLUDED.profile_id,active=TRUE`,
          [adminName, adminEmail, adminHash]
        );
        console.log("Administrador inicial preparado.");
      }
    } else {
      console.log("Administrador não atualizado: configure ADMIN_EMAIL e ADMIN_PASSWORD.");
    }

    if(String(process.env.DEMO_DATA||"").toLowerCase()==="true"){
      const empresa1 = await ensureCompany(client, {
        legalName: "Empresa Horizonte Logística Ltda.",
        tradeName: "Horizonte Logística",
        cnpj: "12.345.678/0001-90",
        city: "Goiânia",
        state: "GO"
      });

      const empresa2 = await ensureCompany(client, {
        legalName: "Empresa Vale Verde Operações Ltda.",
        tradeName: "Vale Verde Operações",
        cnpj: "98.765.432/0001-10",
        city: "Aparecida de Goiânia",
        state: "GO"
      });

      const hMatriz = await ensureBranch(client, empresa1, {
        name: "Matriz Goiânia",
        cnpj: "12.345.678/0001-90",
        code: "HZ-MTZ",
        city: "Goiânia",
        state: "GO"
      });

      const hCd = await ensureBranch(client, empresa1, {
        name: "Centro de Distribuição",
        cnpj: "12.345.678/0002-71",
        code: "HZ-CD",
        city: "Aparecida de Goiânia",
        state: "GO"
      });

      const vMatriz = await ensureBranch(client, empresa2, {
        name: "Matriz Aparecida",
        cnpj: "98.765.432/0001-10",
        code: "VV-MTZ",
        city: "Aparecida de Goiânia",
        state: "GO"
      });

      const vFilial = await ensureBranch(client, empresa2, {
        name: "Filial Anápolis",
        cnpj: "98.765.432/0002-09",
        code: "VV-ANA",
        city: "Anápolis",
        state: "GO"
      });

      const turno1 = await ensureCatalog(client, "shifts", empresa1, "1º Turno", "06:00 às 14:20");
      const turno2 = await ensureCatalog(client, "shifts", empresa1, "2º Turno", "14:00 às 22:20");
      const turno3 = await ensureCatalog(client, "shifts", empresa2, "Administrativo", "08:00 às 18:00");

      const cargoAux = await ensureCatalog(client, "job_roles", empresa1, "Auxiliar Operacional");
      const cargoConf = await ensureCatalog(client, "job_roles", empresa1, "Conferente");
      const cargoAdm = await ensureCatalog(client, "job_roles", empresa2, "Assistente Administrativo");

      const setorOp = await ensureCatalog(client, "departments", empresa1, "Operacional");
      const setorExp = await ensureCatalog(client, "departments", empresa1, "Expedição");
      const setorAdm = await ensureCatalog(client, "departments", empresa2, "Administrativo");

      const rhEmail = "rh.teste@controletermico.local";
      const rhPassword = "Teste@123";
      const rhHash = await bcrypt.hash(rhPassword, 12);

      const rhResult = await client.query(
        `INSERT INTO users(name,email,password_hash,role,company_id,branch_id,active)
         VALUES($1,$2,$3,'RH',$4,$5,TRUE)
         ON CONFLICT(email)
         DO UPDATE SET
           name=EXCLUDED.name,
           password_hash=EXCLUDED.password_hash,
           role='RH',
           company_id=EXCLUDED.company_id,
           branch_id=EXCLUDED.branch_id,
           active=TRUE
         RETURNING id`,
        ["RH Demonstração", rhEmail, rhHash, empresa1, hMatriz]
      );

      const rhId = rhResult.rows[0].id;
      await client.query("DELETE FROM user_branches WHERE user_id=$1", [rhId]);
      await client.query(
        `INSERT INTO user_branches(user_id,branch_id)
         VALUES($1,$2),($1,$3)
         ON CONFLICT DO NOTHING`,
        [rhId, hMatriz, hCd]
      );

      const employees = [
        {
          companyId: empresa1, branchId: hMatriz, shiftId: turno1,
          departmentId: setorOp, jobRoleId: cargoAux,
          fullName: "Carlos Henrique Souza", registration: "TESTE001",
          cpf: "111.111.111-11", jobTitle: "Auxiliar Operacional",
          admissionDate: "2026-01-15", weeklyDaysOff: [0]
        },
        {
          companyId: empresa1, branchId: hMatriz, shiftId: turno2,
          departmentId: setorExp, jobRoleId: cargoConf,
          fullName: "Mariana Alves Pereira", registration: "TESTE002",
          cpf: "222.222.222-22", jobTitle: "Conferente",
          admissionDate: "2026-02-10", weeklyDaysOff: [0]
        },
        {
          companyId: empresa1, branchId: hCd, shiftId: turno1,
          departmentId: setorOp, jobRoleId: cargoAux,
          fullName: "João Pedro Martins", registration: "TESTE003",
          cpf: "333.333.333-33", jobTitle: "Auxiliar Operacional",
          admissionDate: "2026-03-05", weeklyDaysOff: [6]
        },
        {
          companyId: empresa2, branchId: vMatriz, shiftId: turno3,
          departmentId: setorAdm, jobRoleId: cargoAdm,
          fullName: "Fernanda Lima Costa", registration: "TESTE004",
          cpf: "444.444.444-44", jobTitle: "Assistente Administrativo",
          admissionDate: "2026-01-20", weeklyDaysOff: [0,6]
        },
        {
          companyId: empresa2, branchId: vFilial, shiftId: turno3,
          departmentId: setorAdm, jobRoleId: cargoAdm,
          fullName: "Rafael Gomes Oliveira", registration: "TESTE005",
          cpf: "555.555.555-55", jobTitle: "Assistente Administrativo",
          admissionDate: "2026-04-01", weeklyDaysOff: [0]
        }
      ];

      for (const employee of employees) {
        await ensureEmployee(client, employee);
      }

      console.log("Cadastros de demonstração preparados: 2 empresas, 4 filiais, 1 RH e 5 colaboradores.");
    }else{
      console.log("DEMO_DATA desativado: nenhum cadastro de demonstração foi criado.");
    }

    await client.query("COMMIT");
  }catch(error){
    await client.query("ROLLBACK");
    console.error("Falha no seed:", error.message, { code:error.code, position:error.position, detail:error.detail });
    process.exitCode = 1;
  }finally{
    client.release();
    await pool.end();
  }
})();
