# Controle Térmico — Validação Beta.82

Versão: **1.0.31-beta.82**

## Objetivo

Transformar o indicador **Dias para revisão** da Central de Conferência em uma fila operacional para o DP, preservando integralmente os dados originais do Cartão Ponto Senior.

## Implementado

- Nova aba **Dias para revisão** na Central de Conferência.
- Contador da fila no próprio menu da Central.
- Resumo com total de dias, quantidade de alta prioridade e colaboradores afetados.
- Filtro por prioridade e busca por colaborador, matrícula, data, motivo e código de horário.
- Tabela com colaborador, data, horário Senior, motivo, marcações, ocorrência, BH-, BH+, faltas e ação de conferência.
- Detalhe do dia preservando página/linha de origem, marcações usadas, marcações desconsideradas, ocorrência e texto original.
- A fila é **somente de conferência**: não altera automaticamente marcações, BH ou ponto.
- `Jornada Incompleta` passou a ser identificada explicitamente como ocorrência de revisão.

## PDF de referência 19/08/2026 a 17/09/2026

A validação de regressão manteve:

- 103 colaboradores;
- 3009 dias interpretados;
- 25 dias para revisão;
- 17 colaboradores afetados pela fila;
- 5 dias classificados como alta prioridade pela regra de diagnóstico;
- nenhuma alteração nas regras de conciliação do fechamento Senior.

## Segurança

A Beta.82 não transforma a revisão em correção automática. A confirmação do Cartão continua obedecendo às regras já validadas na Beta.81, incluindo conciliação Senior, vínculo cadastral, auditoria pós-gravação e substituição sem duplicidade.

## Testes

- `npm test`: 23 testes aprovados, 0 falhas.
- `npm run check:sizes`: aprovado.
- `npm run audit:startup`: aprovado.
- JavaScript validado com `node --check`.
