CONTROLE TÉRMICO — CONECTOR SENIOR BETA.110

MONITOR 24H
- O conector verifica a Senior a cada 2 horas, 24 horas por dia:
  00h, 02h, 04h, 06h, 08h, 10h, 12h, 14h, 16h, 18h, 20h e 22h.
- O Edge precisa permanecer em execução.
- A sessão da Senior precisa continuar válida.
- A aba do Controle Térmico não precisa ficar aberta.

INSTALAÇÃO / ATUALIZAÇÃO
1. Extraia este ZIP para uma pasta fixa, por exemplo:
   C:\ControleTermico\ConectorSenior

2. No Microsoft Edge, abra:
   edge://extensions

3. Ative "Modo de desenvolvedor".

4. Se já existir uma versão anterior do Conector Senior:
   - remova ou recarregue a extensão depois de substituir os arquivos da pasta.

5. Clique em "Carregar sem compactação" e selecione a pasta extraída.

6. Mantenha a Senior aberta e autenticada em uma aba.

7. Abra o Controle Térmico Beta:
   Importações > Senior Direto

8. Ative "Monitor 24h".

SEGURANÇA
- As consultas na Senior são somente GET.
- Senha, cookie e assertion da Senior não são enviados ao Controle Térmico.
- O servidor recebe somente os dados operacionais já retornados pela Senior.
- O monitor usa uma chave própria, revogável, emitida pelo Controle Térmico.
- Ao desativar o monitor, a chave é trocada e deixa de funcionar.
