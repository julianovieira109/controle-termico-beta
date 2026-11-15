const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const sql=fs.readFileSync(path.join(__dirname,'../src/db/migrations/20261113_acervo_justificativas.sql'),'utf8');

test('acervo nao altera calculos Senior',()=>{
  assert.match(sql,/CREATE TABLE IF NOT EXISTS justification_cases/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS justification_files/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS justification_file_contents/);
  assert.doesNotMatch(sql,/\b(?:UPDATE|DELETE FROM|TRUNCATE)\s+(?:employee_point_days|senior_bh_imports|employees)\b/i);
});
test('os anexos tem hash e estado explicito antes de serem considerados preservados',()=>{
  assert.match(sql,/sha256 CHAR\(64\)/);
  assert.match(sql,/storage_state VARCHAR\(24\) NOT NULL DEFAULT 'PENDENTE'/);
  assert.match(sql,/storage_state <> 'ARMAZENADO'/);
  assert.match(sql,/bytes BYTEA NOT NULL/);
});
test('justificativas importadas possuem chave de origem e indice de deduplicacao',()=>{
  assert.match(sql,/ux_justification_source/);
  assert.match(sql,/justification_source_key_required/);
  assert.match(sql,/ux_justification_file_origin/);
});
