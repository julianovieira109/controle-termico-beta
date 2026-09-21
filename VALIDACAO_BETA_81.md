# Controle Térmico — Validação Beta.81

## Objetivo
Validar a etapa posterior ao botão **Confirmar importação do ponto**.

A Beta.81 mantém todas as regras validadas até a Beta.80 e acrescenta uma **auditoria pós-gravação transacional**.

## Comportamento novo

1. O Cartão Ponto é relido e conciliado normalmente antes da confirmação.
2. Dentro da mesma transação, o período anterior dos colaboradores localizados é substituído.
3. Os dias aprovados são gravados em `employee_point_days`.
4. Antes do `COMMIT`, o sistema relê do banco apenas os registros do novo `import_id`.
5. Compara novamente:
   - quantidade de colaboradores;
   - quantidade de dias;
   - menor e maior data gravadas;
   - Trabalho;
   - BH-;
   - BH+;
   - HE 100%;
   - Faltas;
   - Adicional Noturno;
   - Viagem.
6. Se qualquer valor divergir, a transação inteira recebe **ROLLBACK**. Nenhuma alteração é mantida.
7. Se fechar, a importação recebe `postWriteAudit.status = VALIDATED`.

## Reimportação sem duplicidade

A tabela `employee_point_days` já possui `UNIQUE(employee_id, work_date)`. A Beta.81 reforça a política de substituição por período e retorna `replacedDays`:

- `replacedDays = 0`: primeira importação do período;
- `replacedDays > 0`: reimportação/substituição de dias existentes.

O front-end passa a informar quantos dias anteriores foram substituídos.

## Testes automatizados

- 20 testes executados
- 20 aprovados
- 0 falhas

Foram adicionados testes para:

- criação do snapshot esperado;
- validação positiva do snapshot gravado;
- bloqueio quando qualquer total gravado diverge.

## Auditorias técnicas

- `npm test`: OK
- `npm run check:sizes`: OK
- `npm run audit:startup`: OK
- 48 arquivos JavaScript passaram no `node --check`

## Teste de homologação recomendado

### Teste A — primeira confirmação
Usar o PDF já validado `Ponto 19-08 a 17-09.pdf`.

Esperado:
- 103 colaboradores;
- 3009 dias gravados;
- auditoria pós-gravação VALIDATED;
- Trabalho 15195:15;
- BH- 2492:03;
- BH+ 1670:16;
- HE100 00:00;
- Faltas 710:23.

### Teste B — reimportar o mesmo PDF
Repetir exatamente o mesmo arquivo e filial.

Esperado:
- nenhum dia duplicado;
- os dias anteriores do mesmo período são substituídos;
- `replacedDays` deve refletir os registros substituídos;
- auditoria pós-gravação continua VALIDATED;
- os totais permanecem exatamente iguais.

### Teste C — período atualizado
Depois, importar um arquivo que amplie o período, por exemplo até 18/09.

Esperado:
- sobreposição substituída;
- novos dias acrescentados;
- nenhum registro duplicado;
- auditoria pós-gravação VALIDATED.
