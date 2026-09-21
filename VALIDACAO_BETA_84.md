# Controle Térmico — Validação Beta.84

Versão: **1.0.31-beta.84**

## Objetivo

Transformar a fila **Dias para revisão** em um controle de acompanhamento do DP sem permitir qualquer edição de ponto no Controle Térmico.

Regra permanente desta versão:

> O Controle Térmico nunca cria, completa, corrige ou infere horários. Marcações, jornada, BH e faltas são lidos e preservados conforme a Senior. Qualquer correção é feita exclusivamente na Senior e validada por uma nova importação do Cartão Ponto.

## Implementações

- Nova tabela `timecard_review_controls` para armazenar somente o acompanhamento da pendência.
- Status disponíveis ao DP:
  - `Não analisado`;
  - `Conferido`;
  - `Aguardando correção na Senior`;
  - `Senior corrigida — aguardando nova importação`.
- Status automático do sistema:
  - `Resolvido após nova leitura`.
- Observação livre do DP por colaborador/data.
- Registro do usuário e da data da última atualização do acompanhamento.
- Filtro da fila por status de acompanhamento.
- Nova coluna **Acompanhamento** na fila.
- Aviso explícito no detalhe de que nenhuma ação altera o ponto.
- Histórico das pendências que desapareceram após uma nova importação confirmada.
- Se uma pendência marcada como “Senior corrigida — aguardando nova importação” continuar no novo arquivo, ela volta para `Aguardando correção na Senior`.
- Se uma pendência já resolvida reaparecer, ela volta para `Não analisado`.
- A limpeza controlada do ambiente Beta também limpa os controles de revisão da unidade selecionada.
- Textos do módulo Ocorrências atualizados para deixar claro que a regularização das marcações acontece exclusivamente na Senior.

## Garantia de não alteração do ponto

A rota `/api/imports/timecard-review-control` grava somente metadados de acompanhamento em `timecard_review_controls`.

Foi incluído teste automatizado que falha caso essa rota passe a executar `INSERT`, `UPDATE` ou `DELETE` em `employee_point_days`.

A sincronização automática das pendências durante a confirmação do Cartão Ponto também altera apenas a tabela de acompanhamento. Os dados do ponto continuam sendo gravados exclusivamente a partir do PDF da Senior e submetidos à auditoria pós-gravação existente desde a Beta.81.

## Fluxo esperado

1. Ler Cartão Ponto da Senior.
2. Conferir a fila de exceções.
3. Registrar somente o acompanhamento da pendência no Controle Térmico.
4. Corrigir, quando necessário, exclusivamente na Senior.
5. Marcar `Senior corrigida — aguardando nova importação`.
6. Emitir e importar novo Cartão Ponto da Senior.
7. Se o problema não aparecer mais no novo relatório confirmado, o Controle Térmico marca automaticamente `Resolvido após nova leitura`.

## Validação técnica

- `npm test`: **34 testes aprovados / 0 falhas**.
- `npm run check:sizes`: aprovado.
- `npm run audit:startup`: aprovado.
- `node --check`: **51 arquivos JavaScript** aprovados.
- Nenhum arquivo ultrapassa o limite interno de 600 KB.
- Pacote GitHub permanece com menos de 100 arquivos reais.

## Regressões preservadas

A Beta.84 não altera as regras de leitura do Cartão Ponto validadas nas Betas 80–83:

- leitura por período real do PDF;
- 3º turno preservando a data oficial da Senior;
- conciliação de Trabalho, BH−, BH+, HE 100% e Faltas;
- cadastro de novatos via Relação de Admitidos;
- auditoria pós-gravação;
- reimportação sem duplicidade;
- fila de 25 dias no cartão de referência 19/08/2026 a 17/09/2026;
- classificação de 1 caso de alta prioridade e 24 casos explicados pela Senior no arquivo de referência.
