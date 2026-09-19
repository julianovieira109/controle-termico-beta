# Controle Térmico — validação da Beta.80

Versão: `1.0.31-beta.80`

## Correção principal

A Beta.80 corrige uma divergência real de 22 minutos no BH- do Cartão Ponto Senior de 19/08/2026 a 17/09/2026.

O caso foi localizado no colaborador:

- Matrícula: `000007213`
- Nome: MATHEUS LOPES DE ALMEIDA
- Página: 69
- Data crítica: 15/09/2026
- Ocorrência: `BH (-) Saída Antecipada Noturn`
- Trabalho: `03:06`
- BH- bruto: `07:19`
- Falta: `01:06`
- Adicional Noturno: `03:06`

A regra anterior tratava todo lançamento especial sem marcações normais como 80% do BH- bruto:

`07:19 x 80% = 05:51`

Porém, nesse formato específico, o próprio fechamento Senior demonstra que o BH- efetivo é o BH- bruto menos a parcela registrada na coluna Falta:

`07:19 - 01:06 = 06:13`

A diferença entre `06:13` e `05:51` é exatamente `00:22`, que era o resíduo exibido pela Central de Conferência.

## Regra atualizada

1. `Faltas Noturnas` continua usando a normalização de 80%, já validada nos cartões anteriores.
2. Em lançamento especial sem marcações normais, quando existe valor na coluna `Falta`, o BH- efetivo passa a ser `BH- bruto - Falta`.
3. Quando não existe coluna Falta aplicável, permanece o fallback de 80% para os formatos especiais já conhecidos.
4. A conciliação continua exigindo fechamento exato; nenhuma tolerância de 22 minutos foi criada.

## Impacto esperado no PDF 19/08/2026 a 17/09/2026

Antes da correção:

- BH- calculado: `2491:41`
- BH- Senior: `2492:03`
- Diferença: `-00:22`
- Conciliação: `102/103`

Depois da correção:

- BH- calculado esperado: `2492:03`
- BH- Senior: `2492:03`
- Diferença esperada: `00:00`
- Conciliação esperada: `103/103`

Os demais indicadores já estavam conciliados e não são alterados por esta correção:

- Trabalho: `15195:15`
- BH+: `1670:16`
- HE 100%: `00:00`
- Faltas: `710:23`

## Regressão

Foram incluídos testes específicos para:

- o caso real de Matheus Lopes em 15/09/2026;
- preservação da regra de 80% para `Faltas Noturnas`;
- cálculo `BH- bruto - Falta` em lançamento especial sem marcações normais.

Resultado dos testes:

- `17/17` testes aprovados;
- `check:sizes` aprovado;
- `audit:startup` aprovado;
- `46` arquivos JavaScript aprovados no `node --check`;
- pacote GitHub com `61` arquivos, abaixo de 100.
