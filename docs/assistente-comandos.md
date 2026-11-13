# Assistente com comandos do Controle Térmico Beta

## Comportamento desta versão

O menu **Assistente do sistema** abre um diálogo dentro da aplicação, com a sessão e as permissões do usuário. Não há API de IA, chave adicional, prompt externo ou envio dos pedidos a outro serviço. O interpretador reconhece tarefas conhecidas por sinônimos, acentos e correções conservadoras de uma letra em palavras de comando. Nomes e matrículas são preservados. Pedidos desconhecidos mostram sugestões; múltiplas tarefas pedem escolha. Não é uma IA de perguntas gerais nem automação irrestrita de todas as telas.

Depois de reconhecer uma tarefa, o assistente pergunta os campos que faltam, aceita escolhas por nome, matrícula, número ou botão e mostra os dados antes de qualquer gravação. `ajuda`, `cancelar`, **Novo pedido** e **Corrigir dados** permitem sair ou revisar o fluxo. Um novo comando durante o preenchimento pede confirmação de troca de tarefa, para não gravar o comando como nome ou outro campo. Fechar o diálogo mantém a memória até encerrar a página; sair da conta descarta os dados. A conversa não é persistida em banco ou localStorage.

| Pedido | Execução | Acesso |
| --- | --- | --- |
| Adicionar/cadastrar colaborador | Pergunta empresa, filial, nome, matrícula, admissão, cargo e turno; confere; usa o POST nativo de colaboradores. Situação inicial Ativo, relatório herda cargo, folga padrão do turno. Campos não informados precisam de indicação explícita. | `employees.view` + `employees.manage` |
| Demitir/desligar, registrar demissão ou “o João saiu” | Identifica o vínculo; pede data; confere antes de alterar situação e data com auditoria na mesma transação. | `employees.view` + `employees.manage` |
| Reativar, afastar ou inativar | Identifica o vínculo e a situação; informa a remoção da data de demissão. | `employees.view` + `employees.manage` |
| Consultar cadastro | Pesquisa autorizada; escolhe a matrícula em homônimos e exibe os dados. | `employees.view` |
| Repouso térmico/ficha de refeição | Pergunta competência e escopo; chama geração/validação nativas; abre a central de impressão com o tipo escolhido. | `reports.view` e acessos já usados pela tela nativa |
| BH/banco de horas/saldo de horas | Pede competência, pessoa e base (fechamento 19→18 ou calendário); consulta um snapshot calculado pela mesma função do comparador. | `dashboard.view` + acesso ao Controle de Ocorrências |
| Relação de intervalos | Consulta jornadas do período e aplica a função nativa de análise de realizado/previsto. Mostra pendências, escalas não interpretáveis e dados incompletos. | `dashboard.view` + acesso ao Controle de Ocorrências |
| Quem está mais crítico? | Pergunta se deve usar o semáforo gerencial RED ou intervalos com diferença absoluta maior que dez minutos. Exibe motivos/dias e ordenação explicada, sem nova pontuação inventada. | `dashboard.view` + acesso ao Controle de Ocorrências |
| Importar arquivos, cargos/turnos, feriados/folgas | Orienta e abre as telas completas, onde os arquivos, campos e prévias continuam sendo conferidos. Não automatiza esses formulários. | Permissões nativas da área |

O Controle de Ocorrências permanece restrito a Administrador Master ou administrador autorizado para `occurrences.view`. O assistente não transforma uma conta RH em administrador. O BH informa separadamente dados validados do ponto, movimentos analíticos e saldo sintético da data final. Valores ausentes continuam ausentes, não viram zero nem projeção de saldo. As fontes e períodos são exibidos. Intervalos e rankings refletem somente os pontos importados, que podem ser parciais.

## Execução e proteção dos dados

- O fluxo de situação usa apenas `/api/workflow-assistant/prepare` e `/confirm`, sem ferramentas gerais de IA. A conferência é assinada, vinculada ao ator, ao cadastro e à versão corrente, com validade de cinco minutos. Na confirmação, revalida permissões/escopo, bloqueia a linha e grava somente situação/data e auditoria na mesma transação. Planos repetidos ou concorrentes são recusados. Datas anteriores à admissão são bloqueadas.
- Cadastro reutiliza `/api/employees` e suas validações de duplicidade, cargo, turno e unidade. Não preenche silenciosamente matrículas ou datas. Durante o envio, os controles do assistente não aceitam outra gravação. Após resultado incerto, o assistente oferece consulta do cadastro antes de repetir.
- O novo `/api/reconciliation/snapshot` é somente leitura e usa `periodRange` e `compareSnapshot` existentes. Valida filtros e vínculo, seleciona somente relatórios confirmados e separa matrículas iguais de empresas/filiais diferentes.
- As fichas reutilizam o gerador, validador e central de impressão existentes. Não contornam bloqueios de ponto, políticas de cargo, turno, feriados ou autorização térmica. A impressão final depende da ação e da escolha de impressora pelo usuário. Relações de BH/intervalos/críticos podem ser impressas integralmente; a tela mostra cem linhas por página, sem truncar o arquivo impresso.
- Abertura do atalho usa `/?assistente=1`. O próprio aplicativo solicita login, quando necessário, e abre o diálogo após autenticação. O `.url` não contém tokens ou senhas. Precisa da versão publicada do site e de internet. Não instala um agente em segundo plano.

## Aplicação e validação

O assistente está incluído nesta versão do aplicativo; o deploy deve ser confirmado no site antes de informar publicação. Não há nova migração de banco. Após publicar o aplicativo, use Ctrl+F5. Dados existentes não precisam de reimportação.

Os testes usam dados fictícios. A validação cobre reconhecimento e datas, permissões, homônimos, revisão, cadastro sem envio antecipado, demissão/reativação com auditoria, conflito e reenvio, BH sem informação, separação de unidades, intervalos pendentes, ambos os rankings, geração/validação reais das fichas com APIs simuladas, central de impressão, atalho e tela estreita. Nenhum colaborador do site real é alterado para testar o recurso. A integração com o banco publicado e o teste no Windows do usuário continuam sendo uma etapa de homologação após a autorização de publicação.
