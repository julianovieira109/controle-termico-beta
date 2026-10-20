# Regras de manutenção

- Toda alteração que afete o uso do sistema deve atualizar, na mesma entrega, o Manual do Sistema (`public/index.html`) e a Ajuda (`public/js/help-manual.js`).
- Documentar caminhos de menu, permissões, condições de uso, limites, mensagens relevantes e passos necessários para aplicar mudanças a dados já importados.
- Manter exemplos e orientações coerentes com o comportamento implementado. Não apresentar um diagnóstico como certeza quando ele depender de logs ou confirmação externa.
- Ao alterar arquivos do navegador, atualizar a versão de cache correspondente em `public/index.html`.
- Distinguir mudanças locais, envio ao GitHub e deploy confirmado. Não afirmar publicação no site apenas porque o push terminou.
