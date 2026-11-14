# Acervo seguro de justificativas — Controle Térmico Beta

## Objetivo
Criar um acervo próprio para comprovantes de ausência, atestados, advertências, suspensões e outros documentos, associado às justificativas, com inclusão de registros futuros. O controle é **complementar**: nenhuma justificativa altera marcações, BH, intervalos ou ocorrências calculadas pela Senior.

## Inventário e reconciliação
A planilha fonte contém respostas históricas e a coluna de anexo pode misturar URLs e observações. O levantamento privado identifica 407 IDs de arquivo distintos em 411 campos preenchidos (4 textos sem link). Os dados pessoais e URLs reais **não podem ser incorporados a este repositório público**.

A pasta temporária de cópias no Drive e o índice da planilha são auxiliares; não são o banco do sistema. Antes de continuar a cópia, reconciliar arquivo original ↔ cópia existente ↔ linha original para não duplicar; já houve uma execução parcial. Não divulgar anexos com nomes de colaboradores nem anexar amostras reais em issues/testes.

## Modelo de dados
1. **justification_cases:** justificativa, filial, nome original, matrícula quando conhecida, cargo, setor, data, motivo, responsável, fonte e chave original; status de conferência do DP, sem efeitos na Senior.
2. **justification_files:** cada anexo, estado da migração, nome e MIME, tamanho, SHA-256, ID/link da origem, status e usuário responsável.
3. **justification_file_contents:** bytes privados; o registro só é considerado preservado quando bytes puderem ser lidos e o hash SHA-256 coincidir.

Condições: a chave fonte é única por filial; o ID de arquivo é único por justificativa; mesmo hash não é importado duas vezes na mesma justificativa. Dados legados não são alterados ou apagados ao reprocessar o mesmo lote.

## Fluxo de implantação por etapas
1. **Schema Beta:** aplicar migração idempotente, preservar tabelas atuais e revisar espaço disponível no PostgreSQL.
2. **API segura:** autenticação por token existente; por padrão somente Master. Para outros perfis, exigir permissões explícitas de consulta ou gestão **e** escopo da empresa/filial. GET lista somente metadados; download autenticado por streaming com no-store e auditoria. Nunca devolver BYTEA em JSON.
3. **Upload interno:** PDF, JPG, PNG e WebP, limite e assinatura de arquivo validados; gravar bytes e metadados na mesma transação. Hash é calculado no servidor; salvar tamanho real, responsável e data.
4. **Importação histórica:** importar primeiro justificativas e links como PENDENTE, verificar empregado por matrícula e filial sem inferir; baixar documentos acessíveis em lotes, anexar binários e conferir SHA-256; registrar SEM_ACESSO e FALHA sem descartar casos. Não considerar um link como arquivo armazenado.
5. **Novos documentos:** adicionar formulário de inclusão/consulta diretamente no sistema; se Google Forms permanecer como entrada, criar integração autenticada e idempotente no servidor, com sincronização auditável e processamento de anexos.
6. **Backup e restauração:** criar backup criptografado compatível com binários, teste periódico de restauração e política de retenção. O backup atual do sistema não cobre essas novas tabelas; **não ativar produção antes de concluir essa etapa**.
7. **Homologação:** conferir contagem de respostas, links, bytes preservados, falhas, permissões cruzadas por filial, duplicidades, download após restauração e zero mutação nos dados da Senior.

## Privacidade
Comprovantes médicos são dados pessoais sensíveis: restringir acesso por necessidade de trabalho, registrar uploads e downloads, impedir link público, evitar dados sensíveis em logs/nomes de arquivos públicos e aplicar política de retenção. Repositório GitHub é público; nele devem existir somente código, esquema e dados fictícios.

## Implementação Beta preparada na branch de desenvolvimento
- Migração SQL idempotente integrada ao comando `npm run migrate`.
- API `/api/justification-archive` com autenticação JWT, acesso **exclusivo ao Administrador Master**, escopo de filial explícito em consultas/cadastros, estados de conferência e auditoria de operações.
- Upload privado de PDF, JPG, PNG ou WebP até 8 MB: validação de assinatura, SHA-256 e transação única entre metadados e BYTEA. Download autenticado com validação de hash.
- Interface responsiva no menu **Documentos**, incluída no manual e na Ajuda.
- Backup do sistema inclui metadados e bytes em base64, bloqueia exportações JSON superiores a 29 MB e impede restauração de backups antigos que eliminariam justificativas. Conferir rotina de backup PostgreSQL apropriada para acervos maiores.
- Ativação **bloqueada por padrão**: o administrador deverá definir `JUSTIFICATION_ARCHIVE_BETA=true` somente **no serviço Beta** após testar backup/restauração, capacidade do banco, upload/download e controles de acesso.
- Histórico da planilha **ainda não foi importado**. As 407 URLs são inventário para um importador futuro; 4 campos de texto não são anexos. Nunca transformar link em status `ARMAZENADO` sem confirmar bytes.

## Checklist de homologação antes de ativar
1. Concluir revisão de código, executar `npm ci`, `npm test` e `node --check` nos arquivos alterados; não declarar testes executados apenas pela existência de testes versionados.
2. Fazer snapshot do PostgreSQL Beta, confirmar que o banco correto está selecionado e permitir a migração sem alterar registros Senior.
3. Testar login: Master com acesso; Admin não-Master e RH com HTTP 403; sem flag retorna HTTP 503.
4. Cadastrar justificativa fictícia, anexar PDF/JPG/PNG/WebP, testar extensão inválida, limite de 8 MB, tentativa de duplicidade, download íntegro e trilha de auditoria.
5. Baixar backup, restaurar em banco descartável, confirmar 100% de correspondência entre anexos e hashes e impedir restauração de backup sem acervo.
6. Conferir que não existe documento real, link individual ou informação sensível neste repositório público.
7. Só depois realizar importação histórica em lotes idempotentes, registrar arquivos inacessíveis para providência e validar volume total.

**A branch e a proposta de alteração não representam deploy realizado nem acervo em produção.**
