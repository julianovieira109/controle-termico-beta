# Escala 5x2 integrada ao Beta

A área Menu principal → Escala 5x2 utiliza autenticação e filiais do Beta. A interface React foi adaptada do projeto entregue em `Projeto_Escala_5x2_Integracao_Controle_Termico_Beta.zip`; suas regras de calendário, jornadas, folgas e cobertura foram reaproveitadas. Não são publicados o backup recebido, os seeds pessoais, listas históricas nominativas ou credenciais do aplicativo original. Não se utiliza o banco D1 nem a autenticação Cloudflare do projeto original.

## Separação do cadastro oficial

O módulo lê colaboradores, cargos e horários oficiais da unidade. Nome, matrícula, situação, datas, cargo, código e horário Senior são campos protegidos pelo servidor. Apenas planejamento é gravado em `roster_plans`, separado dos dados oficiais. As rotas não escrevem em employees, shifts, employee_point_days, employee_days_off, holidays, employee_imports ou senior_bh_imports. Consultar não cria planejamento nem inicializa exemplo.

O vínculo utiliza o UUID oficial. Alterar a matrícula preserva o vínculo existente; uma readmissão com novo UUID não recebe automaticamente o planejamento anterior. Registros destacados continuam preservados. Cadastros com matrícula ausente, inválida ou duplicada exigem revisão.

A API exige `roster.view` e, para gravações, `roster.manage`, além do escopo de empresa/filial. A migração inicial de permissões acompanha as permissões de colaboradores sem sobrescrever configurações explícitas. A interface usa o mesmo JWT; sair do sistema desmonta a interface e limpa seu conteúdo. As permissões são verificadas novamente em cada requisição.

## Migração conferida

O backup JSON é enviado privadamente à API, com limite de 3 MB, 2.000 pessoas e 20.000 exceções. A prévia compara matrícula normalizada e nome, não cria colaboradores, expira em 30 minutos e é vinculada ao usuário/unidade. A confirmação exige unidade conferida e escolha explícita quando parcial. Nome/cargo/horário de origem nunca substituem o cadastro oficial.

Cada confirmação arquiva integralmente a origem em `roster_import_archives`, junto ao resultado da conferência. Pendências conservam o registro de origem e suas exceções; podem ser conferidas novamente após corrigir cadastros oficiais. A regra específica de aprendiz somente é herdada mediante correspondência explícita. A confirmação não deve ser automatizada em casos ambíguos.

Gravações verificam versão do planejamento e impressão do cadastro oficial, com locks transacionais. Alterações simultâneas produzem conflito e exigem recarregar. Planejamento e auditoria são atômicos. Falha de auditoria reverte a gravação. Arquivos já aplicados são identificados por hash.

## Backup e manutenção

O exportador da área entrega o planejamento vinculado. O backup completo em Configurações → Backup e dados inclui planos, pendências e arquivos de origem; prévias temporárias não entram. Restauração Master usa ordem de dependências; arquivo antigo sem planejamento é recusado caso apagasse planos existentes. O reset Master remove explicitamente os dados desta área.

## Compilação e publicação

`npm ci` executa `postinstall` → `npm run build:escala`. O build esbuild gera arquivos estáticos com hash em `public/escalas-5x2` e regras CommonJS em `src/generated`; esses artefatos são ignorados no Git. esbuild é dependência de produção para instalação com dependências de desenvolvimento omitidas. Depois execute `npm run migrate` e inicie o servidor. Não rode seed para implantar o módulo.

Mudança local, push Git e deploy são etapas diferentes. Confirme `/api/health`, versão, banco conectado, assets e API autenticada no site após o deploy. Implantar a funcionalidade não confirma o backup de planejamento automaticamente.

## Validação

`npm test` cobre as regras existentes e a proteção do cadastro oficial. Para testes transacionais, defina `ROSTER_TEST_DATABASE_URL` apontando exclusivamente para PostgreSQL local descartável com banco terminado em `_test`; cada execução cria e remove um schema isolado. Os casos cobrem escopo, consulta sem seed, concorrência, adulteração de campos oficiais, confirmação parcial, pendências, arquivo original, auditoria e comparação dos relatórios Senior antes/depois de alterações planejadas.

`tools/audit-backup-restore.js`, com banco local descartável, verifica preservação de origem/pendências e históricos oficiais em backup/restauração, recusa de backup antigo e reset. A validação de navegador cobre seleção de unidade, prévia, confirmação parcial, PDF, alteração de folgas, campos oficiais somente leitura, perfil de consulta e viewport móvel, com dados fictícios.

## Padronização da interface — Beta.94

A área agora monta o React na própria página, em `#roster-host`, sem iframe nem menu lateral secundário. Shadow DOM aberto isola os seletores legados; o estilo compilado converte `:root` em `:host`, herda as variáveis visuais nativas e recebe o tema pelo atributo do host. O manifesto gerado no build informa os nomes com hash dos assets. A montagem é cancelada ou desmontada em logout e mudança de acesso, evitando reapresentar dados de outra sessão. O fallback em `/escalas-5x2/index.html` continua disponível com a mesma API autenticada.

As abas têm navegação por setas/Home/End e painel identificado. Os diálogos usam a área visível do navegador, preservam os campos oficiais somente leitura e liberam a rolagem ao fechar. As ferramentas de jornada da escala ficam em Horários e aplicação de jornadas. As regras de cálculo, datas, importação, confirmações e o backend não mudaram nesta padronização.

Pendências operacionais agora podem ser filtradas por cadastro/folgas, jornada e liderança. O total identifica ocorrências e pessoas/referências; pendências de vínculo/importação são apresentadas à parte. Unidades novas mostram orientação de configuração, sem inicializar dados. O estado de carregamento deixa de depender da existência de uma gravação anterior.

Validação de navegador local com PostgreSQL descartável: integração e migração parcial, PDF real, campos oficiais bloqueados, folgas futuras, isolamento por filial e perfil de consulta; layout semanal sem rolagem horizontal em notebook, abas por teclado, filtros, navegação ao cadastro, tema/cores herdados, celular sem transbordamento da página, diálogos visíveis e desmontagem em logout. Comparar os relatórios e o planejamento antes/depois da navegação, e conferir a versão e assets após o deploy.
