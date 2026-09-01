# Inicialização segura — V1.0.31 Beta.10

## O que foi identificado
O `render.yaml` executava `npm run seed` em **todo deploy**:

`npm ci && npm run migrate && npm run seed`

O arquivo `seed.js` contém cadastros de demonstração (empresas, filiais, usuário RH e colaboradores)
quando `DEMO_DATA=true`. Portanto, uma variável de ambiente configurada incorretamente poderia fazer
esses dados reaparecerem em uma atualização.

## Regra nova
- Deploy automático executa **somente migração de esquema**.
- Seed nunca é executado automaticamente.
- `npm run setup` executa somente `migrate`.
- Seed manual exige `ALLOW_SEED=true`.
- Em produção também exige `ALLOW_PRODUCTION_SEED=true`.
- Dados de demonstração em produção exigem ainda `ALLOW_PRODUCTION_DEMO_DATA=true`.

## Importante
Nenhuma tabela existente é apagada nesta versão.
Nenhum dado atual do banco é removido automaticamente.
A mudança evita recriação futura de dados por seed durante atualizações.
