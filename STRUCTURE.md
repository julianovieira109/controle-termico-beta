# Controle Térmico — Estrutura modular

A partir da V1.0.31 Beta.9, recursos novos devem preferencialmente ficar em módulos próprios.

## Frontend
- `public/js/calendar-reports.js`: orquestração das fichas e Cartão de Ponto.
- `public/js/occurrences-control.js`: lógica do Controle de Ocorrências.
- `public/js/occurrences-print-template.js`: documento independente de impressão das ocorrências.
- `public/css/occurrences.css`: tela e gráficos do Controle de Ocorrências.
- `public/css/occurrences-print.css`: fonte legível do CSS usado pelo relatório impresso.
- `public/css/enhancements.css`: melhorias gerais; não adicionar módulos completos aqui.

## Regra de manutenção
1. Não duplicar regra de negócio entre módulos.
2. A lógica oficial de repouso continua em `thermal-schedule.js`.
3. Novas telas devem ter JS/CSS próprios quando possível.
4. Não alterar banco apenas para reorganizar arquivos.
5. Rodar `npm test` e `node --check` antes de empacotar.
