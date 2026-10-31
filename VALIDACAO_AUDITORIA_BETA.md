# Auditoria funcional e correções do Beta

Base inspecionada: `1520043e4ae593ff30db47370b67c082cb1d9b83`, aplicação `1.0.31-beta.88`.

## Resultado no site Beta

- Login e consulta da sessão autenticada: HTTP 200.
- 38 consultas de APIs: HTTP 200, abrangendo empresas, filiais, usuários/perfis, colaboradores, catálogos, importações, configurações, calendário, relatórios, painel, Ocorrências, comparação de períodos e diagnóstico do sistema.
- Nove telas abertas pelo menu: Painel, Empresas, Usuários, Colaboradores, Importações, Relatórios, Ocorrências, Configurações e Manual.
- Diagnóstico do sistema retornou seus sete indicadores aprovados. Os indicadores de disponibilidade de backup/restauração/zeragem não representam execução dessas operações no site.
- Consultas adicionais de agosto/setembro: relatórios de ponto e Ocorrências responderam com dados; nenhuma ficha remota foi usada como prova de correção integral dos cálculos de todos os colaboradores.
- Sem erros JavaScript durante a navegação. Em largura de 390 pixels, a página verificada não transbordou horizontalmente.
- Sem autenticação, consultas a usuários, colaboradores, diagnóstico e configurações retornaram 401.
- Conta disponibilizada tem perfil Administrador, sem privilégio Master. Acesso às funções exclusivas de Master foi exercitado somente na cópia local com dados fictícios.

As consultas e o login podem registrar auditoria de acesso. Não foram alterados cadastros, configurações ou dados operacionais remotos. Não houve envio de e-mail ou mensagem externa.

## Falhas reproduzidas e corrigidas localmente

1. Ocorrências consultava empresas e filiais em `DOMContentLoaded`, inclusive antes do login, causando dois HTTP 401. O carregamento passa a ocorrer pela navegação autorizada para a área.
2. Meses inexistentes, como `2026-13`/`2026-00`, datas inexistentes, como `2026-02-30`, e identificadores malformados chegavam ao PostgreSQL e retornavam HTTP 500. Ano textual no calendário retornava 200 em vez de rejeitar o filtro. Middleware compartilhado agora recusa esses filtros com HTTP 400, antes de consultar o banco; também verifica intervalos de demissão invertidos e parâmetros repetidos/estruturados. Autenticação continua sendo exigida antes da validação.
3. Auditoria npm encontrou dois avisos altos e um moderado. Atualizados `multer` 2.4.0 → 2.5.0, `body-parser` 1.20.8 → 1.20.9 e `qs` 6.16.0 → 6.16.2, com lockfile atualizado. Auditoria posterior: zero avisos conhecidos. Isso não equivale a uma certificação de segurança.

Manual, Ajuda e versões de cache dos scripts alterados foram atualizados. Para aplicar as correções após o deploy, atualizar a página com Ctrl+F5 e repetir as consultas; não é necessário reimportar dados existentes.

## Validação das correções

- `npm test`: 489 aprovados, zero falhas e zero ignorados. Inclui regressões HTTP para filtros/identificadores e inicialização sem consultas protegidas antes do login, além das suítes existentes de importação, admissões, demissões, ponto, BH, repouso e relatórios.
- `npm run audit:startup`: 144 arquivos JavaScript passaram na verificação de sintaxe.
- `npm run check:sizes`: 157 arquivos verificados; nenhum acima de 600 KB.
- `npm audit --omit=dev`: zero vulnerabilidades conhecidas retornadas pelo registro.
- `git diff --check`: aprovado.
- Integração com PostgreSQL real em banco temporário: 45 requisições aprovadas, cobrindo criação/edição/leitura/exclusão, matrícula duplicada, troca obrigatória de senha, permissões RH, isolamento de filial, rejeição dos filtros reproduzidos, backup com integridade, zeragem e restauração. Os totais anteriores à zeragem foram recuperados após restaurar. Banco de teste removido ao final.
- Chromium local: nove telas, duas fichas geradas em modo manual com dados fictícios, login sem consultas protegidas, layout de celular verificado e nenhum erro JavaScript/HTTP observado.

Os scripts auxiliares e logs desta execução estão em `/workspace/.onboarding`; eles não contêm senhas ou tokens gravados. Credenciais e tokens foram usados somente em memória/processos. Os testes de gravação usaram exclusivamente dados locais fictícios.

## Limites e publicação

Esta é uma verificação abrangente dos fluxos executados, não prova de ausência de falhas em todas as combinações de dados. Não foram executados testes de carga, disparo real de recuperação por e-mail, desafios CAPTCHA ou impressão física. Não foram reimportados PDFs reais no site, corrigidos cadastros remotos, restaurados backups remotos ou zerado o Beta. Dados importados existentes não foram reconciliados individualmente com os PDFs de origem.

Este relatório registra os testes realizados antes da publicação das correções, identificadas como `1.0.31-beta.89`. A confirmação da publicação exige consultar essa versão no site e repetir as verificações remotas; um push, sozinho, não confirma deploy. A publicação do ambiente de desenvolvimento não publica o site. Nenhuma alteração foi promovida ao sistema oficial.
