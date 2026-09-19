# Controle Térmico — validação da Beta.79

## Correção principal

Corrigida a regularização de colaboradores novos pela Central de Conferência do Cartão de Ponto.

A rota `timecard-resolve-new-hires` da Beta.78 usava o leitor genérico de PDF. Os relatórios Senior `FPRE004.COL - Relação de Admitidos` são PDFs PDFium e já possuem no sistema um leitor específico (`extractSeniorMovementPdfText`) porque a ordem textual interna pode perder ou reordenar o cabeçalho e as colunas.

Na Beta.79:

- a regularização de novatos usa o mesmo leitor especializado da importação normal de Admitidos;
- `FPRE004.COL` passa a ser aceito como assinatura oficial de Relação de Admitidos, mesmo se o título textual não vier preservado pela extração;
- uma assinatura explícita de outro relatório Senior continua bloqueando a operação;
- quando o título se perde, o arquivo só é aceito se a estrutura de Admitidos for válida e contiver pelo menos uma das matrículas pendentes do Cartão de Ponto;
- a validação de empresa/filial e a regra de não mover colaborador já cadastrado em outra unidade permanecem ativas.

## Cenário reproduzido

Na leitura parcial `19/08/2026 a 17/09/2026`, a Central identificou 103 cartões, 101 vínculos e 2 pendências cadastrais. O usuário anexou `admitidos.pdf`, mas a Beta.78 retornou falso negativo: “O arquivo não foi reconhecido como Relação de Admitidos da Senior.”

A causa era o leitor incorreto na rota nova, não o fluxo de conferência.

## Testes

- 14 testes automatizados aprovados;
- teste de regressão confirma que a rota de regularização chama `extractSeniorMovementPdfText`;
- teste de regressão confirma reconhecimento da assinatura `FPRE004.COL`;
- `npm run check:sizes` aprovado;
- `npm run audit:startup` aprovado;
- todos os arquivos JavaScript passam em `node --check`.

Versão: `1.0.31-beta.79`.
