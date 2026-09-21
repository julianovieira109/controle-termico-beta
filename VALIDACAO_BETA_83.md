# Controle Térmico — Validação Beta.83

Versão: **1.0.31-beta.83**

## Objetivo

Refinar a fila **Dias para revisão** para que falta de marcações não seja tratada automaticamente como falha de leitura. A Beta.83 separa exceções explicadas pela própria Senior de situações que realmente exigem conferência prioritária do DP.

## Regras implementadas

- **BH/lançamento Senior sem marcações individuais:** atenção operacional, não erro do leitor.
- **Saída antecipada reconhecida pela Senior:** ocorrência explicada; preserva marcações e totais sem inventar batidas.
- **Atestado em horas:** ocorrência reconhecida pela Senior; não cria alerta novo por si só e não gera repouso automático sem jornada confirmada.
- **Sem marcações e sem justificativa explícita:** permanece **alta prioridade**.
- **Jornada incompleta / batida sem par:** permanece **alta prioridade**.
- **Marcações parciais com lançamento BH da Senior:** atenção operacional, preservando os valores oficiais.
- A fila continua **somente para auditoria**; nenhum valor é alterado automaticamente.

## Repouso térmico

- Sem horários suficientes ou jornada confirmada: **não gerar repouso automaticamente**.
- Quando houver um intervalo efetivamente confirmado pelas batidas e a regra atual já o considerar apto: o repouso pode usar **somente o intervalo confirmado**, sem inventar marcações ausentes.

## Caso real — Gilson Pereira do Carmo, 21/08/2026

Linha Senior: horário 0120, ocorrência **BH 50%**, sem batidas individuais, Trabalho **05:14**, BH+ **01:02**.

Resultado Beta.83:

- classificação: `SENIOR_CONSOLIDATED_NO_MARKINGS`;
- prioridade: **Atenção**, não alta;
- ocorrência reconhecida pela Senior: **sim**;
- repouso automático: **não**, por falta de horários individuais confirmados;
- Trabalho/BH preservados exatamente como vieram da Senior.

## Regressão sobre o cartão de referência 19/08/2026 a 17/09/2026

A análise textual de regressão preservou a mesma fila existente na Beta.82:

- colaboradores: **103**;
- dias: **3009**;
- dias na fila de revisão: **25**;
- colaboradores envolvidos: **17**;
- alta prioridade após a nova classificação: **1**;
- ocorrências/lançamentos explicados pela Senior: **24**.

A mudança **não aumenta artificialmente** a fila: atestado em horas e saída antecipada que já estão suficientemente explicados pela Senior não criam uma nova pendência por si só.

## Testes

- `npm test`: **30 aprovados / 0 falhas**;
- `npm run check:sizes`: aprovado;
- `npm run audit:startup`: aprovado;
- todos os arquivos JavaScript auditados por `node --check`.

## Resultado

A Beta.83 mantém as garantias já validadas nas Betas 80–82 (conciliação Senior, período parcial, cadastro, auditoria pós-gravação e reimportação sem duplicidade) e melhora a interpretação operacional da fila de revisão sem alterar automaticamente o ponto.
