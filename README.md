# IPER — Dashboard Previdenciário

Dashboard público do Instituto de Previdência do Estado de Roraima, publicado no Cloudflare Pages e alimentado pelo Google Planilhas.

## Arquitetura atual

- Google Planilhas: fonte administrativa dos dados.
- Google Apps Script: gera o JSON e detecta alterações.
- Cloudflare Pages Functions: recebe o webhook e serve a API.
- Cloudflare R2: armazena a última versão pronta do dashboard.
- Navegador: lê o R2, sem consultar a planilha em cada acesso.

## Rotas

- `GET /api/dashboard`: devolve a última versão armazenada no R2.
- `GET /api/dashboard-version`: devolve somente versão, data e quantidade de registros.
- `POST /api/dashboard-refresh`: webhook privado usado pelo Apps Script.

## Por que o acesso ficou mais rápido

A planilha não é mais lida quando um visitante abre o site. Ela é lida apenas quando:

- uma célula é alterada nas abas monitoradas;
- a estrutura da planilha muda;
- o administrador executa `atualizarDashboardAgora()`;
- o bucket está vazio e precisa da inicialização única.

O R2 possui leitura rápida e o objeto é substituído pelo webhook após cada alteração relevante.

## Configuração obrigatória

Leia `CONFIGURACAO_WEBHOOK.md` antes de publicar.

Resumo:

1. Criar o bucket R2 `iper-dashboard-data`.
2. Publicar os arquivos no GitHub/Cloudflare Pages.
3. Substituir o código da planilha por `google-apps-script/Code.gs`.
4. Executar `gerarSegredoWebhook()`.
5. Cadastrar o valor como segredo `DASHBOARD_WEBHOOK_SECRET` no Cloudflare.
6. Atualizar a implantação do Apps Script.
7. Executar `instalarGatilhos()`.
8. Executar `atualizarDashboardAgora()`.

## Segurança

- O segredo do webhook não deve ser salvo no GitHub.
- `/api/dashboard-refresh` rejeita chamadas sem o cabeçalho correto.
- O site público permanece somente leitura.
- O navegador não recebe credenciais do Google nem permissão de escrita no R2.

## Contingência

Se o R2 ou a Function estiverem indisponíveis, o front-end tenta carregar `data/dashboard.json` ou `data/demo.json` para manter a interface acessível.
