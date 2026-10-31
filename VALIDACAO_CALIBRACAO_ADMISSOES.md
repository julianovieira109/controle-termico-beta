# Calibração de admissões — Beta.90

## Erro reproduzido

A Relação de Admitidos analisada tem 14 linhas. Com o código anterior ao commit `4034714`, a leitura retornou 13 registros, associando a matrícula da linha anterior ao nome e à admissão seguintes, misturando o código de Filial ao nome e o código do cargo ao cartão. A reprodução correspondeu exatamente aos quatro cadastros divergentes identificados no Beta. O leitor por coordenadas atual leu 14 de 14 identidades da própria linha, sem erros.

Os quatro nomes e matrículas coincidem entre os documentos de admissão, turnos e ponto de outubro. As quatro admissões estão dentro do período do ponto de outubro; as outras dez são posteriores a 18/10 e não devem ser cadastradas apenas para liberar esse ponto.

## Proteções acrescentadas

- Cada linha da prévia de Admitidos recebe comprovação assinada pelo servidor, vinculada aos dados de origem, usuário, empresa e filial, com validade de duas horas. Confirmar dados alterados, prévias antigas, vencidas, de outro contexto ou com matrículas repetidas é rejeitado antes da transação.
- A assinatura não altera os dados lidos do PDF; apenas impede que uma associação diferente da conferida seja gravada a partir da prévia.
- Cartão vazio preserva cartão legítimo. O artefato legado só é removido quando a origem é uma importação de admissões, o nome ainda contém o código da Filial, a identidade diverge da linha física validada e o cartão coincide com o código do cargo indevidamente copiado.
- A regularização pelo ponto trava a linha durante a conferência e rejeita matrículas ambíguas, com rollback.
- Correções registram campos anteriores e novos na auditoria individual do colaborador. Situação, demissão, matrícula, ID, turno, folgas, políticas e históricos existentes não são alterados pela rotina.
- A Central de Conferência distingue matrícula sem cadastro e nome divergente; ambos podem ser regularizados pelo PDF de Admitidos, somente nas matrículas sinalizadas. O ponto é relido automaticamente, sem confirmação automática de gravação.

## Validação antes da publicação

- Regressões para alterações em cada campo de origem, contexto de usuário/empresa/filial, assinatura ausente/inválida/futura/vencida e seleção duplicada.
- Regressões para 14 linhas com objetos de texto fora de ordem e preservação do último registro.
- Regressões para preservar cartões legítimos, situação e demissão e rejeitar matrículas ambíguas sem escrita parcial.
- Integração com PostgreSQL temporário e os PDFs reais: 98 matrículas localizadas, quatro nomes divergentes antes da correção; prévia de Admitidos com 14 linhas; tentativa adulterada rejeitada sem escrita; seleção corrigiu somente quatro, sem criar os dez posteriores.
- Navegador Chromium: os quatro nomes divergentes apareceram no quadro; a regularização com Admitidos corrigiu os quatro e a releitura automática liberou o botão de confirmação do ponto.
- Repetição da regularização: zero criados, zero atualizados e quatro já conferidos. Auditoria individual com antes/depois validada; zero dias de ponto gravados no teste.
- Testes incluíram estados ATIVO, DEMITIDO, AFASTADO e INATIVO e preservação da data de demissão, IDs e demais campos não corrigíveis pela rotina.

## Aplicação aos dados já importados

Após o deploy, atualizar a página com Ctrl+F5 e reler os documentos. Na Central de Conferência de Importações → Cartão de Ponto, enviar a Relação de Admitidos em **Regularizar cadastros e revalidar**, conferindo as matrículas sinalizadas. Alternativamente, em Importações → Colaboradores, ler Admitidos e selecionar somente as linhas comprovadamente incorretas. Prévia antiga precisa ser refeita.

A publicação não altera cadastros automaticamente. A execução de reparo dos quatro cadastros do caso é uma ação separada, autorizada pelo usuário, com cópia de segurança e comparação de campos e históricos antes/depois. Os arquivos de evidência e os dados privados permanecem fora do repositório. A confirmação do ponto não faz parte do reparo cadastral e exige conferência própria.
