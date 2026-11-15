-- Acervo de justificativas independente da Senior.
-- Nao altera employee_point_days, saldos de BH nem marcacoes.
-- A migracao cria somente estruturas; nenhum arquivo e importado automaticamente.

CREATE TABLE IF NOT EXISTS justification_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  employee_name VARCHAR(200) NOT NULL,
  employee_registration VARCHAR(40),
  job_title VARCHAR(180),
  department VARCHAR(160),
  absence_date DATE,
  reason VARCHAR(250) NOT NULL,
  details TEXT,
  manager_email VARCHAR(254),
  submitted_by_email VARCHAR(254),
  submitted_at TIMESTAMPTZ,
  source_system VARCHAR(30) NOT NULL DEFAULT 'MANUAL'
    CHECK (source_system IN ('MANUAL','GOOGLE_FORMS','GOOGLE_SHEETS','INTEGRACAO')),
  source_key VARCHAR(240),
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status VARCHAR(24) NOT NULL DEFAULT 'PENDENTE'
    CHECK (review_status IN ('PENDENTE','EM_CONFERENCIA','CONFERIDO','DIVERGENTE','DESCONSIDERADO')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT justification_source_key_required
    CHECK (source_system = 'MANUAL' OR source_key IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_justification_source
  ON justification_cases(company_id,branch_id,source_system,source_key)
  WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_justification_unit_date
  ON justification_cases(company_id,branch_id,absence_date DESC);
CREATE INDEX IF NOT EXISTS idx_justification_employee_date
  ON justification_cases(employee_id,absence_date DESC);
CREATE INDEX IF NOT EXISTS idx_justification_review
  ON justification_cases(company_id,branch_id,review_status);

-- Um registro abaixo com status PENDENTE representa apenas um link.
-- Documento preservado = binario validado em justification_file_contents.
CREATE TABLE IF NOT EXISTS justification_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES justification_cases(id) ON DELETE RESTRICT,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  sha256 CHAR(64),
  source_drive_id VARCHAR(180),
  source_url TEXT,
  storage_state VARCHAR(24) NOT NULL DEFAULT 'PENDENTE'
    CHECK (storage_state IN ('PENDENTE','ARMAZENADO','SEM_ACESSO','FALHA')),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  stored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT justification_file_stored_fields CHECK (
    storage_state <> 'ARMAZENADO' OR
    (sha256 IS NOT NULL AND size_bytes IS NOT NULL AND stored_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_justification_file_origin
  ON justification_files(case_id,source_drive_id)
  WHERE source_drive_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_justification_file_hash
  ON justification_files(case_id,sha256)
  WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_justification_file_state
  ON justification_files(storage_state,created_at);

-- O BYTEA e a primeira implementacao sem dependencia de servico externo.
-- Manter fora de respostas de listagem. Backup restauravel e obrigatorio
-- antes de ativar esta tabela em producao.
CREATE TABLE IF NOT EXISTS justification_file_contents (
  file_id UUID PRIMARY KEY REFERENCES justification_files(id) ON DELETE RESTRICT,
  bytes BYTEA NOT NULL,
  stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (octet_length(bytes) > 0)
);

COMMENT ON TABLE justification_cases IS
  'Justificativas complementares ao ponto oficial Senior, sem recalculo de jornada ou BH.';
COMMENT ON TABLE justification_file_contents IS
  'Arquivos privados. Nunca expor em links publicos ou retornos JSON de listagem.';
