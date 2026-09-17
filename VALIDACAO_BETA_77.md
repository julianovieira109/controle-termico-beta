# Controle Térmico — validação da Beta.77

Correção direcionada ao teste real do fechamento 19/07/2026 a 18/08/2026.

## Falha encontrada na Beta.76

A Central identificou 103 de 104 cartões. As 31 linhas estruturadas não interpretadas correspondiam integralmente à página 104, colaborador matrícula 000008510 (ZENILDO FILHO SANTOS TEIXEIRA).

O rodapé oficial da página 104 é:
- Trabalho: 174:59
- BH-: 015:41
- BH+: 010:58
- HE 100%: 000:00
- Faltas: 000:00

Esses valores são exatamente a diferença entre os totais oficiais de 104 cartões e os totais exibidos para os 103 cartões conciliados na Beta.76.

## Correções Beta.77

- Divisão dos cartões pelo separador físico de página (`form-feed`) antes do fallback textual.
- Leitura robusta do cabeçalho quando `Empregado:`, matrícula e nome são entregues em linhas separadas pelo pdf2json.
- Mantida a proteção contra contaminação de rodapé entre colaboradores.
- Confiança não arredonda mais uma leitura bloqueada/incompleta para 100%.
- Teste automático específico para o caso da última página/matrícula 000008510.
- Versão atualizada para 1.0.31-beta.77.

## Resultado esperado no mesmo PDF

- 104 páginas/cartões
- 104 colaboradores identificados
- 3195/3195 linhas reconstruídas
- 3195/3195 linhas interpretadas
- 104/104 fechamentos conciliados
- Trabalho: 16455:31
- BH-: 1042:57
- BH+: 2090:46
- HE 100%: 000:00
- Faltas: 339:00

Os 20 dias para revisão podem permanecer como alertas de marcações/ocorrências. Eles não representam falha estrutural de leitura.
