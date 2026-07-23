# Atualização do dashboard somente quando a planilha muda

## Como funciona

1. O Google Apps Script detecta uma edição nas abas `Banco de Dados` ou `Sistema FELPS`.
2. O script envia um POST autenticado para `/api/dashboard-refresh`.
3. A função do Cloudflare busca o JSON atualizado no Apps Script.
4. O JSON é gravado no Cloudflare R2 em `dashboard/current.json`.
5. Quando alguém acessa o site, o dashboard lê o R2, sem consultar a planilha.
6. Uma página que já estiver aberta consulta apenas a versão do objeto a cada 15 segundos. Quando a versão muda, os dados visuais são recarregados.

O intervalo de 15 segundos no navegador não consulta o Google Planilhas. Ele lê somente os metadados do R2, que são leves e rápidos.

## Etapa 1 — criar o bucket R2

No Cloudflare:

1. Abra **R2 Object Storage**.
2. Clique em **Create bucket**.
3. Nome: `iper-dashboard-data`.
4. Crie o bucket.

O `wrangler.toml` usa o binding `IPER_DATA` e esse nome de bucket.

## Etapa 2 — criar o segredo no Apps Script

1. Substitua o código da planilha pelo arquivo `google-apps-script/Code.gs`.
2. Salve.
3. No seletor de funções, escolha `gerarSegredoWebhook`.
4. Clique em **Executar**.
5. Autorize o script.
6. Copie o segredo exibido.

## Etapa 3 — cadastrar o segredo no Cloudflare

No projeto Pages:

1. Abra **Settings**.
2. Entre em **Variables and Secrets** ou **Environment variables**.
3. Adicione uma variável secreta:
   - Nome: `DASHBOARD_WEBHOOK_SECRET`
   - Valor: o segredo copiado do Apps Script.
4. Use o mesmo valor em produção e preview, se necessário.
5. Salve e faça uma nova implantação.

Nunca publique esse segredo no GitHub.

## Etapa 4 — atualizar a implantação do Apps Script

1. No Apps Script, clique em **Implantar → Gerenciar implantações**.
2. Edite a implantação existente.
3. Selecione **Nova versão**.
4. Confirme:
   - Executar como: **Eu**.
   - Quem pode acessar: **Qualquer pessoa**.
5. Implante.

A URL `/exec` permanece a mesma quando a implantação existente é atualizada.

## Etapa 5 — instalar os gatilhos

No Apps Script:

1. Execute `instalarGatilhos`.
2. Autorize o acesso externo solicitado.
3. Execute `atualizarDashboardAgora` para carregar a primeira versão no R2.

A resposta esperada contém:

```json
{
  "ok": true,
  "message": "Dashboard atualizado no R2."
}
```

## Testes

### Ver dados armazenados

Abra:

`https://iper-dashboard.pages.dev/api/dashboard`

### Ver somente a versão atual

Abra:

`https://iper-dashboard.pages.dev/api/dashboard-version`

### Testar edição

1. Altere uma célula em `Banco de Dados` ou `Sistema FELPS`.
2. Abra **Execuções** no Apps Script para confirmar o gatilho.
3. Consulte `/api/dashboard-version` e verifique se a versão mudou.
4. O site aberto deverá se atualizar em até aproximadamente 15 segundos.

## Observação sobre alterações feitas por outros scripts

Gatilhos instaláveis de edição são acionados quando um usuário altera células. Alterações feitas por outro script ou por API não disparam automaticamente o gatilho de edição. Nesse caso, o script que grava a planilha deve chamar `atualizarDashboardAgora()` ao terminar.
