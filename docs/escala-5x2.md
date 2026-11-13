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

## Folgas, coordenação e referência Senior — Beta.95

Dias sem planejamento deixam de estar desabilitados: o clique inicia o cadastro das duas folgas com vigência e confirmação, sem escolher a segunda folga. Existe definição coletiva para colaboradores dos filtros atuais sem planejamento, com exclusão de aprendizes e jornadas reduzidas. As marcações pontuais passam a valer somente na data por padrão. Novas regras recorrentes são validadas para duas folgas; o legado sem alterações é preservado.

A projeção consulta somente a configuração `occurrences-management` da mesma empresa e filial e utiliza o resolvedor nativo de coordenadores. O vínculo individual tem prioridade sobre o turno. Apenas nome, identificador e origem do coordenador resolvido para cada colaborador são apresentados junto ao planejamento, sob `roster.view`; a configuração completa e as ocorrências continuam nas rotas/permissões próprias. O módulo não altera os vínculos de coordenação. Os novos campos são somente leitura no PUT, entram no fingerprint de concorrência e são atualizados pela referência oficial. Um cadastro sem coordenador permanece explicitamente sem vínculo.

A separação segue turno, coordenador e folgas, com filtro e exportação. Comercial/ADM são reconhecidos do nome oficial do turno quando não existe classificação planejada; não se deduz o responsável a partir do cargo. Identificadores UUID e filiais continuam isolados.

As sugestões usam os quatro horários efetivamente descritos na Senior; os antigos modelos por código fixo deixam de prevalecer sobre o texto atual. O turno 3 conserva a referência da escala 56. A comparação inicial de 40h é apenas proposta, com alternativas 42h/44h. Horários incompletos, contratos reduzidos e aprendizes não recebem propostas automáticas. Não é uma certificação de conformidade legal: conversão noturna, descansos e convenção coletiva precisam de revisão operacional/jurídica. Nenhum cálculo escreve em employees, shifts, ponto, BH, folgas oficiais ou configuração de coordenação.

Validação adicional: projeção Comercial e campos imutáveis; grupos com responsáveis diferentes; precedência individual/turno e isolamento por filial em PostgreSQL; mudança de coordenador bloqueia gravação obsoleta; entrada real às 20h da escala 56 produz proposta 40h com saída às 05h; horário incompleto não é completado; jornadas reduzidas são excluídas; nova regra semanal exige duas folgas. No navegador: primeira marcação, persistência, edição pontual/recorrente, lote filtrado preservando planejados e aprendiz, modelos com referência oficial, PDF/CSV e celular, com relatórios oficiais comparados antes/depois.

## Resolução de pendências — Beta.96

Cada pendência traz tipo, instrução e ação específica. Folgas são distinguidas de jornada; código oficial ausente leva ao cadastro nativo, sem editar o campo protegido. Jornada especial/reduzida deixa de receber indicação de carga coletiva. As definições de folga e jornada iniciadas por uma pendência usam a data de referência do período selecionado, em vez de mudar silenciosamente para hoje. Definir folgas ativa a inclusão no formulário, sem escolher os dias automaticamente.

A conferência de liderança individual ou da equipe apresenta cargo, turno e coordenador e pode ser salva sem alternar um checkbox já correto. A decisão é registrada somente no planejamento, com data e auditoria da API existente. Lotes respeitam os filtros da equipe e preservam planejamento existente. Há retorno de Jornadas para a lista atualizada. O encerramento de uma etapa pode revelar outra pendência, sem ocultar avisos nem declarar dados faltantes como resolvidos.

Testes adicionais cobrem cadeia folgas → jornada, reconhecimento de liderança, direcionamento de código ausente e exclusão de carga coletiva para jornadas especiais. No navegador com PostgreSQL local: confirmação individual e coletiva, persistência, data histórica em folgas/jornadas, retorno à lista, preservação de planos já configurados, consulta sem gravação, celular e comparação dos relatórios oficiais antes/depois. Esta mudança não escreve nas escalas oficiais da Senior.

## Gerador operacional — Beta.97

`Escalas e folgas → Gerar folgas operacionais` usa uma busca determinística por equipe (turno/área e coordenador) com limites configuráveis de pessoas, líderes e cargo. O primeiro descanso semanal é sábado no terceiro turno e domingo nos demais; a segunda folga é escolhida entre os outros dias. Folgas consecutivas são preferência, não uma garantia quando houver necessidade de distribuição. Cada grupo de descanso precisa de líder próprio e nenhum cargo é inferido como substituto de outro.

Grupos já definidos, regras futuras, exceções, funções e coordenadores não são reatribuídos. A geração abrange apenas pessoas selecionadas nos filtros sem planejamento, com vínculo e dados completos; contratos especiais e áreas administrativas são preservados conforme o escopo explícito. O máximo é 400 elegíveis. Os mínimos padrão são uma referência calculada pela capacidade e número de líderes, não dimensionamento de demanda nem certificação legal. Eles são escolhidos por prévia, sem configuração permanente nova.

A busca gulosa seguida de refinamento balanceia folgas por papel e liderança. Uma validação final de 28 dias verifica presença diária, funções e liderança nas janelas de referência, jornadas após meia-noite, grupos sem líder e sequência superior a cinco dias. Capacidade insuficiente e dados incompletos ficam explícitos; não é um solucionador que prove inviabilidade global. A operação é modelada pela data de entrada e pelo descanso fixo de cada turno. Intervalos, funções, liderança e horas vêm do cadastro/proposta já existente; a geração não cria jornadas nem pressupõe férias/atestados ausentes na 5x2.

Prévia é somente memória do navegador. Alterar configuração invalida confirmação. Aplicar exige validação sem impedimentos e confirmação explícita; usa o PUT auditado do planejamento com versão e fingerprint oficial, de modo que uma alteração concorrente bloqueia a gravação. A API mantém as proteções dos campos oficiais. O resumo de mínimos e a geração ficam no histórico/auditoria do planejamento; cadastros Senior, ponto, BH e vínculos gerenciais não são alterados.

Testes cobrem dois descansos, sábado noturno/domingo demais, líderes por grupo, cargos sem intercâmbio, preservação de grupos/futuro/contratos, limites inválidos, dados incompletos, cobertura após meia-noite e lacunas por função/horário. Navegador com banco local testa prévia sem escrita, aplicação impedida e confirmada, conflito concorrente, persistência, preservação de grupos e relatórios oficiais, celular e perfil de consulta.

## Clareza do bloqueio e exportação da prévia — Beta.98

A confirmação de leitura da prévia deixa de depender de `canApply`; marcá-la não remove alertas nem libera gravação com desfalques. O status ao lado do botão de aplicação diferencia ausência de prévia, ausência de elegíveis, perfil somente leitura, impedimentos e conferência pendente. Comercial/ADM fora do lote é identificado como preservação, não causa de bloqueio.

Alertas repetidos por dia são agrupados por equipe/motivo, com número e amostra de datas. Atalhos levam aos impedimentos ou aos parâmetros da equipe; dados incompletos remetem ao cadastro e à conferência da referência Senior. Falta de líder aponta para identificação/cobertura, sem reduzir automaticamente mínimos nem inventar qualificações.

O download CSV é permitido para prévias com propostas, inclusive bloqueadas; rotula explicitamente rascunho com impedimentos e não aplicado, inclui os motivos e não escreve em banco. Campos de texto são escapados para CSV e entradas que poderiam ser interpretadas como fórmula são prefixadas para leitura textual. Aplicar continua condicionado à validação operacional, confirmação, permissão e versão da gravação.

Validação no navegador local: confirmação marcável em prévia bloqueada, aplicação ainda desabilitada, exportação de rascunho sem alteração de plano, navegação aos alertas/limites, invalidação da prévia após mudar parâmetros, aplicação válida, concorrência, contratos/grupos existentes, horários oficiais, celular e consulta sem gravação.
