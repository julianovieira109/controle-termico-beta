require("dotenv").config();
const pool=require("./pool");

const sql=`
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Estrutura base em ordem de dependência.
-- Em banco antigo, CREATE IF NOT EXISTS não altera os dados.
-- Em banco novo, todas as tabelas existem antes dos ALTERs.
-- ============================================================

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name VARCHAR(180) NOT NULL,
  trade_name VARCHAR(120) NOT NULL,
  cnpj VARCHAR(18),
  city VARCHAR(100),
  state CHAR(2),
  logo_url TEXT,
  primary_color VARCHAR(20) DEFAULT '#154c79',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL,
  cnpj VARCHAR(18),
  internal_code VARCHAR(40),
  city VARCHAR(100),
  state CHAR(2),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(180) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN','RH')),
  company_id UUID REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  password_changed_at TIMESTAMPTZ,
  password_reset_token_hash TEXT,
  password_reset_expires_at TIMESTAMPTZ,
  password_reset_requested_at TIMESTAMPTZ,
  password_reset_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(80) NOT NULL UNIQUE,
  base_role VARCHAR(20) NOT NULL DEFAULT 'RH' CHECK (base_role IN ('ADMIN','RH')),
  protected BOOLEAN NOT NULL DEFAULT FALSE,
  master_admin BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS master_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS user_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id,code_hash)
);

CREATE TABLE IF NOT EXISTS profile_permissions (
  profile_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  permission_key VARCHAR(80) NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(profile_id,permission_key)
);

CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(180),
  senior_code VARCHAR(20),
  weekly_days_off SMALLINT[] NOT NULL DEFAULT ARRAY[0]::SMALLINT[],
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(company_id,name)
);

-- V1.0.3 Beta: nomes podem se repetir; códigos numéricos ignoram zeros à esquerda.
ALTER TABLE shifts
  DROP CONSTRAINT IF EXISTS shifts_company_id_name_key;

CREATE TABLE IF NOT EXISTS job_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  report_policy VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(company_id,name)
);

CREATE TABLE IF NOT EXISTS job_role_branch_report_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_role_id UUID NOT NULL REFERENCES job_roles(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  report_policy VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_role_id,branch_id)
);

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(company_id,name)
);

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  job_role_id UUID REFERENCES job_roles(id) ON DELETE SET NULL,
  report_policy_override VARCHAR(20),
  full_name VARCHAR(180) NOT NULL,
  registration VARCHAR(50),
  cpf VARCHAR(14),
  job_title VARCHAR(120) NOT NULL DEFAULT '',
  admission_date DATE,
  termination_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'ATIVO',
  weekly_days_off SMALLINT[] NOT NULL DEFAULT ARRAY[0]::SMALLINT[],
  use_shift_days_off BOOLEAN NOT NULL DEFAULT TRUE,
  source VARCHAR(40),
  last_imported_at TIMESTAMPTZ,
  point_card VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  description VARCHAR(180) NOT NULL,
  automatic BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id,branch_id,holiday_date)
);

CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  setting_key VARCHAR(100) NOT NULL,
  setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id,branch_id,setting_key)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,
  entity VARCHAR(80) NOT NULL,
  entity_id UUID,
  details JSONB,
  ip_address VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_branches (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id,branch_id)
);

CREATE TABLE IF NOT EXISTS employee_days_off (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  off_date DATE NOT NULL,
  description VARCHAR(180) NOT NULL DEFAULT 'Folga',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id,off_date)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key VARCHAR(80) NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(user_id,permission_key)
);

INSERT INTO user_profiles(name,base_role,protected,master_admin,active)
VALUES
  ('Administrador Master','ADMIN',TRUE,TRUE,TRUE),
  ('Administrador','ADMIN',TRUE,FALSE,TRUE),
  ('RH','RH',FALSE,FALSE,TRUE)
ON CONFLICT(name) DO UPDATE SET
  base_role=EXCLUDED.base_role,
  protected=EXCLUDED.protected,
  master_admin=EXCLUDED.master_admin,
  active=TRUE;

INSERT INTO profile_permissions(profile_id,permission_key,allowed)
SELECT p.id,v.permission_key,v.allowed
FROM user_profiles p
JOIN (VALUES
  ('dashboard.view',TRUE),
  ('employees.view',TRUE),
  ('employees.manage',TRUE),
  ('imports.manage',TRUE),
  ('reports.view',TRUE),
  ('settings.view',TRUE),
  ('calendar.manage',FALSE)
) AS v(permission_key,allowed) ON TRUE
WHERE p.name='RH'
ON CONFLICT(profile_id,permission_key) DO NOTHING;

-- V1.48: perfil operacional padrão para Coordenador.
-- Em bancos existentes, cria o perfil somente quando ele ainda não existe.
INSERT INTO user_profiles(name,base_role,protected,active)
VALUES ('Coordenador','RH',FALSE,TRUE)
ON CONFLICT(name) DO NOTHING;

-- O perfil novo recebe somente Relatórios. Se um perfil Coordenador já tiver
-- sido personalizado pelo Administrador, suas permissões são preservadas.
INSERT INTO profile_permissions(profile_id,permission_key,allowed)
SELECT p.id,'reports.view',TRUE
FROM user_profiles p
WHERE p.name='Coordenador'
  AND NOT EXISTS (
    SELECT 1 FROM profile_permissions existing
    WHERE existing.profile_id=p.id
  )
ON CONFLICT(profile_id,permission_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS employee_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  import_type VARCHAR(20) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  detected_company TEXT,
  detected_branch TEXT,
  total_found INTEGER NOT NULL DEFAULT 0,
  total_created INTEGER NOT NULL DEFAULT 0,
  total_updated INTEGER NOT NULL DEFAULT 0,
  total_not_found INTEGER NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES user_profiles(id) ON DELETE RESTRICT;

UPDATE users u
SET profile_id=p.id
FROM user_profiles p
WHERE u.profile_id IS NULL
  AND (
    (u.role='ADMIN' AND p.name='Administrador')
    OR
    (u.role='RH' AND p.name='RH')
  );

-- V1.61.1: mantém somente a conta que já possui o perfil Master. Na ausência
-- dela, preserva o administrador ativo mais antigo. Nenhum e-mail pessoal
-- fica gravado na migração.
WITH chosen_master AS (
  SELECT u.id
  FROM users u
  LEFT JOIN user_profiles p ON p.id=u.profile_id
  WHERE u.role='ADMIN'
  ORDER BY
    CASE
      WHEN p.master_admin=TRUE THEN 0
      ELSE 1
    END,
    u.active DESC,
    u.created_at ASC NULLS LAST,
    u.id ASC
  LIMIT 1
)
UPDATE users u
SET profile_id=CASE
  WHEN u.id=(SELECT id FROM chosen_master)
    THEN (SELECT id FROM user_profiles WHERE master_admin=TRUE AND base_role='ADMIN' LIMIT 1)
  ELSE (SELECT id FROM user_profiles WHERE name='Administrador' AND base_role='ADMIN' LIMIT 1)
END,
updated_at=NOW()
WHERE u.role='ADMIN';

-- ============================================================
-- Compatibilidade com bases criadas por versões anteriores.
-- Todos os ALTERs ocorrem somente depois dos CREATEs.
-- ============================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS legal_name VARCHAR(180),
  ADD COLUMN IF NOT EXISTS trade_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS cnpj VARCHAR(18),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state CHAR(2),
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS primary_color VARCHAR(20) DEFAULT '#154c79',
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS cnpj VARCHAR(18),
  ADD COLUMN IF NOT EXISTS internal_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state CHAR(2),
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS email VARCHAR(180),
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS role VARCHAR(20),
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shifts' AND column_name='weekly_days_off'
  ) THEN
    ALTER TABLE shifts
      ADD COLUMN weekly_days_off SMALLINT[] NOT NULL DEFAULT ARRAY[0]::SMALLINT[];

    UPDATE shifts
    SET weekly_days_off=ARRAY[6]::SMALLINT[]
    WHERE LOWER(COALESCE(name,'')) LIKE '%3º%'
       OR LOWER(COALESCE(name,'')) LIKE '%3°%'
       OR LOWER(COALESCE(name,'')) LIKE '%3o turno%'
       OR LOWER(COALESCE(name,'')) LIKE '%terceir%';
  END IF;
END $$;

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS description VARCHAR(180),
  ADD COLUMN IF NOT EXISTS senior_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS weekly_days_off SMALLINT[] NOT NULL DEFAULT ARRAY[0]::SMALLINT[],
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE job_roles
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='job_roles'
      AND column_name='report_policy'
  ) THEN
    ALTER TABLE job_roles
      ADD COLUMN report_policy VARCHAR(20) NOT NULL DEFAULT 'PENDING';
    UPDATE job_roles SET report_policy='BOTH';
  END IF;
END $$;

UPDATE job_roles
SET report_policy='PENDING'
WHERE report_policy IS NULL
   OR report_policy NOT IN ('PENDING','BOTH','THERMAL_ONLY','MEAL_ONLY','NONE');

-- V1.32: remove falsos cargos produzidos por versões antigas do leitor Senior.
-- Somente registros sem qualquer colaborador vinculado podem ser apagados.
INSERT INTO job_roles(company_id,name,active,report_policy)
SELECT company_id,clean_name,active,report_policy
FROM (
  SELECT company_id,active,report_policy,
    TRIM(REGEXP_REPLACE(
      REGEXP_REPLACE(name,'^[[:space:]]*[0-9]{1,3}([.][0-9]{3})*,[0-9]{2}[[:space:]]*','','i'),
      '[[:space:]]*(Total|Grupo Zilli|Cadastro|Per[ií]odo:|[0-9]{2}:[0-9]{2}:[0-9]{2}[[:space:]]+Usu[aá]rio:).*$',
      '', 'i'
    )) clean_name
  FROM job_roles
) cleaned
WHERE clean_name ~ '[[:alpha:]]{3}'
  AND LENGTH(clean_name)<=120
ON CONFLICT(company_id,name) DO NOTHING;

WITH role_map AS (
  SELECT dirty.id dirty_id,clean.id clean_id
  FROM job_roles dirty
  JOIN job_roles clean ON clean.company_id=dirty.company_id
    AND clean.name=TRIM(REGEXP_REPLACE(
      REGEXP_REPLACE(dirty.name,'^[[:space:]]*[0-9]{1,3}(\.[0-9]{3})*,[0-9]{2}[[:space:]]*','','i'),
      '[[:space:]]*(Total|Grupo Zilli|Cadastro|Per[ií]odo:|[0-9]{2}:[0-9]{2}:[0-9]{2}[[:space:]]+Usu[aá]rio:).*$',
      '', 'i'
    ))
  WHERE dirty.id<>clean.id
)
UPDATE employees e
SET job_role_id=role_map.clean_id,
    job_title=(SELECT name FROM job_roles WHERE id=role_map.clean_id)
FROM role_map
WHERE e.job_role_id=role_map.dirty_id;

DELETE FROM job_roles jr
WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.job_role_id=jr.id)
  AND (
    jr.name ~ '^[[:space:]]*[0-9]{1,3}(\.[0-9]{3})*,[0-9]{2}'
    OR jr.name ~* '[0-9]{2}:[0-9]{2}:[0-9]{2}[[:space:]]+Usu[aá]rio:'
    OR jr.name ~* '(Total|Grupo Zilli|Cadastro|Per[ií]odo:)'
  );

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_role_id UUID REFERENCES job_roles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS report_policy_override VARCHAR(20),
  ADD COLUMN IF NOT EXISTS full_name VARCHAR(180),
  ADD COLUMN IF NOT EXISTS registration VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cpf VARCHAR(14),
  ADD COLUMN IF NOT EXISTS job_title VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS admission_date DATE,
  ADD COLUMN IF NOT EXISTS termination_date DATE,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ATIVO',
  ADD COLUMN IF NOT EXISTS weekly_days_off SMALLINT[] NOT NULL DEFAULT ARRAY[0]::SMALLINT[],
  ADD COLUMN IF NOT EXISTS source VARCHAR(40),
  ADD COLUMN IF NOT EXISTS last_imported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS point_card VARCHAR(30),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='employees' AND column_name='use_shift_days_off'
  ) THEN
    ALTER TABLE employees
      ADD COLUMN use_shift_days_off BOOLEAN NOT NULL DEFAULT TRUE;

    UPDATE employees
    SET use_shift_days_off=FALSE
    WHERE weekly_days_off IS DISTINCT FROM ARRAY[0]::SMALLINT[];
  END IF;
END $$;

ALTER TABLE holidays
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS holiday_date DATE,
  ADD COLUMN IF NOT EXISTS description VARCHAR(180),
  ADD COLUMN IF NOT EXISTS automatic BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();


-- Compatibilidade adicional V7.23 para cadastro manual/importação.
ALTER TABLE employees
  ALTER COLUMN job_title SET DEFAULT '';

UPDATE employees SET job_title='' WHERE job_title IS NULL;
ALTER TABLE employees ALTER COLUMN job_title SET NOT NULL;

-- Dados legados RH -> user_branches
INSERT INTO user_branches(user_id,branch_id)
SELECT id,branch_id FROM users
WHERE role='RH' AND branch_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Duplicidades antigas de feriados automáticos
DELETE FROM holidays a
USING holidays b
WHERE a.automatic=TRUE
  AND b.automatic=TRUE
  AND a.id>b.id
  AND a.holiday_date=b.holiday_date
  AND a.company_id IS NOT DISTINCT FROM b.company_id
  AND a.branch_id IS NOT DISTINCT FROM b.branch_id;

-- V1.55.2: remove a conta Master antiga solicitada, somente quando outra
-- conta Master ativa já garante a continuidade do acesso administrativo.
DO $$
DECLARE
  target_user_id UUID;
  other_active_masters INTEGER;
BEGIN
  SELECT u.id INTO target_user_id
  FROM users u
  JOIN user_profiles p ON p.id=u.profile_id
  WHERE LOWER(u.email)=LOWER('julianomendonca@tzl.com.br')
    AND p.master_admin=TRUE
  LIMIT 1;

  IF target_user_id IS NOT NULL THEN
    SELECT COUNT(*)::int INTO other_active_masters
    FROM users u
    JOIN user_profiles p ON p.id=u.profile_id
    WHERE p.master_admin=TRUE
      AND u.active=TRUE
      AND u.id<>target_user_id;

    IF other_active_masters>0 THEN
      DELETE FROM users WHERE id=target_user_id;
    END IF;
  END IF;
END $$;

-- Índices
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_password_reset_expires ON users(password_reset_expires_at);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id);
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(full_name);
CREATE INDEX IF NOT EXISTS idx_employees_registration ON employees(registration);
CREATE INDEX IF NOT EXISTS idx_employees_period ON employees(admission_date,termination_date);
CREATE INDEX IF NOT EXISTS idx_job_role_branch_policy_role ON job_role_branch_report_policies(job_role_id);
CREATE INDEX IF NOT EXISTS idx_job_role_branch_policy_branch ON job_role_branch_report_policies(branch_id);
DROP INDEX IF EXISTS idx_shifts_senior_code;
DROP INDEX IF EXISTS uq_shifts_company_senior_code_exact;

-- Consolida códigos equivalentes (0007, 007 e 7), preservando os vínculos.
DO $$
DECLARE
  duplicate_group RECORD;
  canonical_id UUID;
BEGIN
  FOR duplicate_group IN
    SELECT company_id,(BTRIM(senior_code)::numeric)::text normalized_code
    FROM shifts
    WHERE senior_code IS NOT NULL AND BTRIM(senior_code) ~ '^[0-9]+$'
    GROUP BY company_id,(BTRIM(senior_code)::numeric)::text
    HAVING COUNT(*)>1
  LOOP
    SELECT id INTO canonical_id
    FROM shifts
    WHERE company_id=duplicate_group.company_id
      AND BTRIM(senior_code) ~ '^[0-9]+$'
      AND (BTRIM(senior_code)::numeric)::text=duplicate_group.normalized_code
    ORDER BY LENGTH(BTRIM(senior_code))-LENGTH(LTRIM(BTRIM(senior_code),'0')) DESC,id
    LIMIT 1;

    UPDATE employees SET shift_id=canonical_id
    WHERE shift_id IN (
      SELECT id FROM shifts
      WHERE company_id=duplicate_group.company_id
        AND id<>canonical_id
        AND BTRIM(senior_code) ~ '^[0-9]+$'
        AND (BTRIM(senior_code)::numeric)::text=duplicate_group.normalized_code
    );

    DELETE FROM shifts
    WHERE company_id=duplicate_group.company_id
      AND id<>canonical_id
      AND BTRIM(senior_code) ~ '^[0-9]+$'
      AND (BTRIM(senior_code)::numeric)::text=duplicate_group.normalized_code;
  END LOOP;

  UPDATE shifts
  SET senior_code=(BTRIM(senior_code)::numeric)::text
  WHERE senior_code IS NOT NULL AND BTRIM(senior_code) ~ '^[0-9]+$';
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_company_senior_code_normalized
  ON shifts(company_id,(CASE WHEN BTRIM(senior_code) ~ '^[0-9]+$' THEN (BTRIM(senior_code)::numeric)::text ELSE UPPER(BTRIM(senior_code)) END))
  WHERE senior_code IS NOT NULL AND BTRIM(senior_code)<>'';
CREATE INDEX IF NOT EXISTS idx_employee_days_off_employee ON employee_days_off(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_days_off_date ON employee_days_off(off_date);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_recovery_codes_user ON user_recovery_codes(user_id,used_at);
CREATE INDEX IF NOT EXISTS idx_employee_imports_created ON employee_imports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_activity ON audit_logs(entity,entity_id,action,created_at DESC);


-- V7.24: cria proteção física somente quando não há duplicidades antigas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE registration IS NOT NULL AND TRIM(registration)<>''
    GROUP BY registration
    HAVING COUNT(*)>1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_registration_global
    ON employees(registration)
    WHERE registration IS NOT NULL AND TRIM(registration)<>'';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_auto_date
ON holidays(holiday_date)
WHERE automatic=TRUE AND company_id IS NULL AND branch_id IS NULL;


-- V1.0.0 Oficial — saneamento de folgas herdadas.
-- Colaboradores em modo SHIFT seguem somente turno ATIVO.
-- Exceções CUSTOM (use_shift_days_off=FALSE) permanecem intactas.
UPDATE employees e
SET weekly_days_off=CASE
  WHEN s.id IS NOT NULL AND s.active=TRUE
    THEN COALESCE(s.weekly_days_off,ARRAY[]::SMALLINT[])
  ELSE ARRAY[]::SMALLINT[]
END,
updated_at=NOW()
FROM (
  SELECT e2.id employee_id,s2.id,s2.active,s2.weekly_days_off
  FROM employees e2
  LEFT JOIN shifts s2 ON s2.id=e2.shift_id
  WHERE e2.use_shift_days_off=TRUE
) s
WHERE e.id=s.employee_id
  AND e.use_shift_days_off=TRUE
  AND e.weekly_days_off IS DISTINCT FROM CASE
    WHEN s.id IS NOT NULL AND s.active=TRUE
      THEN COALESCE(s.weekly_days_off,ARRAY[]::SMALLINT[])
    ELSE ARRAY[]::SMALLINT[]
  END;
`;

(async()=>{
  try{
    await pool.query(sql);
    console.log("Migrações V1.33 concluídas.");
  }catch(error){
    console.error("Falha nas migrações V1.33:",{
      message:error.message,
      code:error.code,
      detail:error.detail,
      position:error.position
    });
    process.exitCode=1;
  }finally{
    await pool.end();
  }
})();
