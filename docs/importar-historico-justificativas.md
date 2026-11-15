# Importação do histórico — Gestão de Documentos Beta

## Origem
Planilha oficial de justificativas da Transzilog, aba **Respostas ao formulário 1** (11 colunas). O CSV deve ser exportado pelo próprio usuário, autenticado em sua conta do Google; **não** colocar dados reais no GitHub, issues, testes ou logs.

Campos: carimbo, colaborador, função, setor/departamento, data da ausência, motivo, detalhes, e-mail, anexo/link, e-mail do gestor e e-mail de origem.

## Operação segura
1. Antes de começar, gerar e guardar um **backup do Beta** em Configurações → Backup e dados.
2. No Google Sheets, abrir **Respostas ao formulário 1** e selecionar **Arquivo → Fazer download → Valores separados por vírgulas (.csv)**, sem alterar a ordem das 11 colunas.
3. No sistema Beta, entrar com perfil autorizado a **Gerenciar Documentos** e vinculado a uma única filial. Abrir **Documentos**: a filial será identificada pelo login, sem seleção manual.
4. Em **Importar histórico**, conferir a filial vinculada ao perfil e selecionar CSV (até 5 MB) e clicar **Conferir arquivo e gerar prévia**.
5. Conferir total de registros válidos, vínculos, já importados, links e inconsistências. A prévia **não grava nada**.
6. Marcar a caixa de autorização e clicar **Confirmar importação**. A confirmação é transacional (tudo ou nada).
7. Conferir o resumo que exibe histórico importado, anexos pendentes e registros sem nome. Gerar novo backup depois.

## Proteções
- A importação não acessa a Senior, não recalcula jornada, intervalos, faltas ou banco de horas.
- O Administrador Master configura as permissões **Consultar documentos** e **Gerenciar documentos**; o CSV só está disponível para um perfil autorizado com uma única filial.
- CSV conferido por cabeçalhos do formulário, com datas brasileiras validadas.
- Linhas sem nome ficam como **Não informado na origem** com status **Em conferência**. Nenhum nome é inferido.
- Registros inválidos são listados por número de linha e não entram; o CSV pode ser corrigido na origem e lido novamente.
- A deduplicação considera o hash SHA-256 das 11 colunas originais, independente da ordem das linhas exportadas. Reimportar o mesmo CSV não duplica justificativas ou anexos.
- A mesma origem não pode ser inserida em duas filiais da mesma empresa.
- Nenhum link é interpretado como documento já salvo: os identificadores do Google Drive entram como anexos **PENDENTES**.
- O arquivo CSV permanece somente em memória durante a leitura; a prévia expira após 15 minutos ou reinicialização do processo.
- Dados pessoais são gravados apenas no banco de dados restrito do Beta. Não são colocados no repositório público.

## Próxima etapa — documentos
Os arquivos de origem devem ser obtidos com autorização a partir do Drive, associados pelo ID do arquivo Google à justificativa e transferidos ao banco somente após confirmar bytes, assinatura do tipo, hash SHA-256 e recuperação pelo download. Não marcar como **ARMAZENADO** antes desses testes. Avaliar política de backup para acervo grande: o backup atual JSON tem limite de tamanho e arquivos binários podem ultrapassá-lo; planejar armazenamento/backup compatível antes da importação em massa.

## Fonte observada na conferência
- 2.017 respostas com data e motivo;
- 407 links válidos;
- 6 registros sem nome;
- 4 campos de anexos contendo apenas observações.

**Os números são indicativos da conferência da planilha, não significam que a importação já ocorreu no banco do Beta.**
