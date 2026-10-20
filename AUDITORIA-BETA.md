# Verificação do Beta

Escopo: checkout `controle-termico-beta`, banco e servidor locais. O ambiente oficial não foi alterado. O site Render não pôde ser validado: o proxy retornou HTTP 403 ao tentar acessar o domínio. Não houve acesso ao banco publicado.

## Verificações aprovadas

- 298 testes automatizados, sem falhas ou testes ignorados.
- Auditoria de sintaxe e inicialização: 119 arquivos JavaScript.
- Verificação de tamanho dos arquivos e `git diff --check`.
- Página inicial, conexão PostgreSQL, login e resumo autenticado.
- Navegação em Painel, Empresas, Usuários, Colaboradores, Importações, Relatórios, Ocorrências, Configurações e Manual, sem exceções JavaScript ou respostas HTTP 500 durante o percurso testado.
- Navegação nos formulários de ponto/colaboradores/turnos/BH; preservação do arquivo ao alternar abas; leitura e confirmação de BH e histórico.
- Cadastro dos 28 históricos demitidos, sem admissão inventada; reimportação sem duplicação; rejeição de dados inválidos e matrícula de outra unidade.
- Comparação de mês e ano; períodos de 19 a 18; rótulos de ausência de dados; bloqueio por permissão e escopo.
- Totais de impressão de Ocorrências, sem alterar a tela original ou duplicar identificadores.
- Restauração completa em banco temporário isolado, preservando ponto, marcações JSON, valores de horas, referência à importação, anotações de revisão e BH.
- Auditoria npm após atualização: nenhuma vulnerabilidade conhecida reportada.

## Correções realizadas nesta verificação

1. O backup não exportava `employee_point_days` nem `timecard_review_controls`. Ambas agora participam de exportação, restauração e limpeza na ordem das referências.
2. Campos JSON/JSONB agora são serializados corretamente na restauração, preservando arrays como as marcações, sem confundi-los com arrays nativos do PostgreSQL.
3. A exportação de backup usa uma transação de leitura consistente. O diagnóstico do sistema verifica também tabelas e colunas essenciais de ponto, BH e revisão.
4. As dependências transitivas `proxy-addr` e `ip-address` foram atualizadas para 2.0.8 e 10.7.4. A auditoria inicial apontava alertas críticos/moderados propagados a Express e ao limitador de acesso; a nova auditoria não apontou alertas.
5. Manual e Ajuda explicam a cobertura do backup e a limitação dos arquivos antigos, que não podem recuperar dados que nunca foram exportados.

## Pendências dos arquivos da Senior

- O cartão histórico de 437 páginas continua com divergência de 8.000 horas entre dias e rodapés de oito cartões. O sistema mantém o bloqueio; a verificação não alterou os valores nem liberou a divergência.
- No ensaio com o ponto mensal, foram lidos 101 colaboradores e 2.881 dias. Houve 2.760 dias comparáveis com BH: 2.340 coincidentes e 420 com diferenças a conferir. Estes números descrevem os arquivos enviados e não comprovam erro ou causa de lançamento na Senior.
- Os 92 saldos de fechamento do BH Analítico coincidiram com o BH Sintético de 18/10/2026: saldo líquido de 143h18. Isso não substitui a conferência diária.

## Repetir a verificação de restauração

`node tools/audit-backup-restore.js` exige `DATABASE_URL` de PostgreSQL local, permissão CREATEDB, credenciais de administrador de teste nas variáveis `ADMIN_EMAIL`/`ADMIN_PASSWORD` e `JWT_SECRET`. Cria um banco temporário e inicia o servidor na porta 3002; não restaura nem zera o banco configurado. Remove o banco temporário ao concluir. Se a porta estiver ocupada, a execução falha antes das requisições de restauração.

A publicação e a verificação do deploy são etapas separadas. Após publicar, gere um novo backup para incluir os históricos que os arquivos antigos omitiam.

## Revisão visual dos temas

Foi adicionada uma paleta de contraste por componente para Painel, alertas, Ocorrências, calendário, repouso automático, segurança, Leitor Senior e resultados de leitura de PDF. Textos, números, opções de listas e mensagens mantêm cores de sucesso, atenção e bloqueio. O Manual e a Ajuda incluem orientações de tema para todos os perfis.

A varredura de navegador percorreu 52 cenários nos temas claro e escuro, incluindo os nove módulos, abas de importação/configurações, formulários de cadastro, capítulos do Manual e estados representativos da leitura de PDFs, com cadastros de demonstração em banco temporário isolado. Não houve exceções JavaScript nem ocorrências abaixo do limiar de contraste do verificador nos elementos avaliados. O verificador mede texto sobre fundos sólidos; não constitui certificação de todos os estados visuais ou fundos em gradiente.

A navegação dos nove módulos também passou no celular. Foram aprovados os testes específicos de contraste de BH/Ocorrências, o ensaio de impressão (totais 88/1350 preservados) e os 298 testes automatizados. A nova folha de estilos se aplica somente à tela, preservando a paleta de papel. Esta revisão visual ainda precisa ser publicada.
