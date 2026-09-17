# Controle Térmico — validação da Beta.78

## Objetivo
Permitir que a Central de Conferência resolva colaboradores novos encontrados no Cartão de Ponto sem transformar uma pendência cadastral em erro de leitura e sem liberar gravação sem vínculo.

## Fluxo implementado
1. O Cartão Senior é lido e conciliado normalmente.
2. Se a leitura/fechamento estiverem corretos, mas existirem matrículas sem cadastro, o status passa a ser **Aguardando vínculo cadastral**.
3. A confiança exibida passa a representar a **leitura/conciliação do PDF**; a cobertura cadastral fica separada no diagnóstico.
4. A Central lista os colaboradores pendentes com matrícula, nome e página.
5. O usuário pode anexar a **Relação de Admitidos da Senior** na própria Central.
6. O backend cadastra/reativa/atualiza **somente as matrículas pendentes do Cartão de Ponto** que forem encontradas no relatório de Admitidos.
7. Matrícula encontrada em outra unidade não é movida automaticamente; permanece pendente para evitar vínculo indevido.
8. Após a regularização, o mesmo arquivo de Cartão Ponto selecionado no navegador é relido e revalidado automaticamente.
9. A confirmação só é liberada quando todos os vínculos exigidos estiverem resolvidos e as demais validações continuarem válidas.

## Segurança
- Não existe botão "confirmar mesmo assim" para colaborador sem cadastro.
- O PDF de Admitidos precisa ser reconhecido como **Relação de Admitidos**.
- Empresa/filial continuam respeitando escopo de acesso e validação operacional.
- Somente as matrículas que estavam pendentes no Cartão são processadas pela ação de regularização.
- O Cartão Ponto é revalidado após qualquer alteração cadastral antes de liberar a confirmação.
- A ação gera auditoria `RESOLVE_TIMECARD_NEW_HIRES`.

## Interface
- Novo painel: **Novos colaboradores / cadastro pendente**.
- Lista os pendentes sem obrigar o usuário a sair da Central.
- Botão: **Cadastrar novatos e revalidar**.
- Status visual amarelo para pendência cadastral, em vez de vermelho de erro estrutural.
- O indicador principal passa a mostrar **Leitura** para deixar claro que 100% se refere ao PDF/conciliação.

## Testes
- `npm test`: 12 testes, 12 aprovados, 0 falhas.
- `npm run check:sizes`: aprovado; nenhum arquivo acima de 600 KB.
- `npm run audit:startup`: aprovado; 45 arquivos JavaScript passaram no `node --check`.
- Versão: `1.0.31-beta.78`.
