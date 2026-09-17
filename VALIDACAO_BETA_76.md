# Controle Térmico — validação da Beta.76

## Objetivo

A Beta.76 corrige a Central de Conferência do Cartão Ponto Senior com base nos PDFs reais de fechamento e período parcial.

## Correções principais

- Rodapé oficial (`Trabalho`, `BH-`, `BH+`, `HE 100%`, `Faltas`) reconstruído pela posição física dos textos da página, sem depender da ordem textual interna do PDF.
- Correção da separação entre colaboradores: o bloco de um funcionário não herda mais o rodapé da página anterior.
- Cabeçalho `Trabalho` da tabela diária não pode mais ser confundido com `Trabalho:` do rodapé.
- `Feriado` e `Auxílio Doença` passam a ser interpretados como dias do cartão, preservando a linha e impedindo perda silenciosa de datas.
- Confirmação exige 100% das linhas reconstruídas e 100% das linhas estruturadas interpretadas.
- Matrícula não localizada e divergência real de nome bloqueiam a confirmação.
- A conciliação global compara apenas colaboradores que possuem rodapé oficial nos dois lados da comparação; não mistura universos diferentes.
- Data do 3º turno permanece a data oficial impressa pela Senior. A virada de 00:00 é tratada dentro da jornada, sem deslocar o dia.
- Período do arquivo é a fonte da importação. O sistema classifica fechamento completo, período parcial, mês inteiro ou período que atravessa mais de um fechamento. O fechamento padrão considera início no dia 19 (configurável por `TIMECARD_CLOSING_START_DAY`).
- Banco de Horas Sintético permanece conceitualmente separado: é saldo acumulado na data de referência, não movimentação do período do cartão.

## Resultado da validação com os cartões reais

### 19/07/2026 a 18/08/2026

- 104 páginas/cartões identificados.
- 3.195 linhas diárias reconstruídas.
- 3.195 linhas interpretadas.
- 104/104 colaboradores conciliados com o rodapé oficial.
- Totais oficiais: Trabalho `16455:31`; BH- `1042:57`; BH+ `2090:46`; HE 100% `0:00`; Faltas `339:00`.

### 19/08/2026 a 13/09/2026

- 104 páginas/cartões identificados.
- 2.605 linhas diárias reconstruídas.
- 2.605 linhas interpretadas.
- 104/104 colaboradores conciliados com o rodapé oficial.
- Totais oficiais: Trabalho `12706:16`; BH- `1709:22`; BH+ `1399:31`; HE 100% `0:00`; Faltas `431:02`.
- Classificação esperada com fechamento 19→18: período parcial do fechamento `19/08/2026 a 18/09/2026`.

## Banco de Horas Sintético

O relatório fornecido possui referência em 14/09/2026 e saldo final total de `383:30`. Como o Cartão Ponto atual termina em 13/09/2026, a diferença de datas deve ser apresentada como informação de referência e não como divergência direta de BH+/BH-.

## Testes incluídos

A versão inclui testes para rodapé fragmentado, jornada noturna, regra noturna de 80%, feriado, auxílio-doença, contaminação entre páginas, conciliação por universo equivalente e bloqueio por estrutura/nome. Também foram restaurados `check:sizes` e `audit:startup`.
