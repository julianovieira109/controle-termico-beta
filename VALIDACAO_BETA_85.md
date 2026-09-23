# Controle Térmico — Validação Beta.85

Versão: **1.0.31-beta.85**

## Princípio central

A Senior é a fonte oficial dos dados de ponto. O Controle Térmico é uma camada de **leitura, conferência, indicadores e acompanhamento**.

O sistema não cria, completa, corrige, altera ou infere marcações, jornada, BH, faltas ou ocorrências para substituir a Senior. Quando houver necessidade de correção, ela deve ocorrer exclusivamente na Senior e retornar ao Controle Térmico por nova importação/releitura.

A importação grava somente o snapshot lido do relatório para uso interno e auditoria. Saídas derivadas do Controle Térmico (indicadores e relatórios próprios) não alteram o ponto oficial na Senior.

## Alterações da Beta.85

### 1. Fonte oficial visível na Central

A Central de Conferência passa a exibir permanentemente:

> **Senior é a fonte oficial · Controle Térmico somente lê, confere e sinaliza**

### 2. Nova aba Indicadores

Foi criada a aba **Indicadores**, separada da fila de revisão, para apresentar situações informativas sem editar o ponto.

Indicadores iniciais:

- **Falta sem marcações no dia** → possível ausência integral;
- **Falta com marcações parciais** → possível intervalo incompleto/batida de intervalo ausente;
- **Descanso entre jornadas inferior a 11 horas** → aviso informativo calculado somente quando as marcações reais permitem aferição segura.

Nenhum desses indicadores altera ou bloqueia automaticamente o ponto.

### 3. Regra de Falta

Conforme o comportamento informado da Senior:

- se existe `Falta` e não há marcações no dia, o sistema apenas sinaliza **possível ausência integral**;
- se existe `Falta` e há marcações no dia, o sistema sinaliza **possível intervalo incompleto**;
- o Controle Térmico não tenta descobrir qual batida está faltando.

### 4. Interjornada de 11 horas

O sistema calcula apenas um aviso quando consegue identificar com segurança:

`última marcação real da jornada anterior → primeira marcação real da jornada seguinte`.

Se o intervalo for inferior a 11 horas, exibe aviso. Se as marcações estiverem incompletas, não estima horários e a interjornada não é calculada por aproximação.

### 5. Conciliação sem ajuste automático

Foi removida a antiga compensação automática de pequenos resíduos de BH−.

A partir desta versão, a conciliação é estritamente comparativa: se dias e rodapé Senior divergirem, o status permanece **MISMATCH**. Nenhum minuto é adicionado ou removido para forçar o fechamento.

As regras de interpretação já comprovadas nos relatórios Senior (ex.: bases especiais noturnas) continuam preservando o valor bruto na origem e servem somente para interpretar a estrutura do próprio relatório; não representam edição do ponto.

## Segurança

- A fila de acompanhamento continua sem permissão para editar `employee_point_days`.
- A conciliação não altera mais os valores de um dia para eliminar resíduos.
- Indicadores são somente leitura.
- Correções continuam exclusivas da Senior.

## Validação técnica

- `npm test`: **39 testes aprovados / 0 falhas**.
- Incluídos testes para:
  - Falta sem marcações;
  - Falta com marcações parciais;
  - interjornada abaixo de 11h;
  - não estimar interjornada em jornada incompleta;
  - impedir ajuste automático de BH para forçar fechamento.
