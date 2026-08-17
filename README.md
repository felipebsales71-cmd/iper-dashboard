# IPER — Dashboard de Arrecadação Previdenciária

Versão integralmente reformulada do dashboard público do Instituto de Previdência do Estado de Roraima.

## Estrutura visual

A área operacional segue a sequência definida pela equipe:

1. Filtros principais: ano, mês e fundo.
2. Indicadores:
   - arrecadado acumulado no ano;
   - arrecadado na competência;
   - quantitativo de servidores.
3. Arrecadação por fundo na competência.
4. Evolução acumulada da arrecadação por fundo.
5. Servidores por fundo e tipo: ativos, aposentados e pensionistas.
6. Ranking de arrecadação por órgão.
7. Tabela detalhada com patronal, segurado, compensação, total e servidores.

## Funcionalidades

- filtros integrados em todos os gráficos;
- painel de filtros avançados;
- gráficos clicáveis;
- ranking de órgãos com pesquisa e limite configurável;
- ordenação e paginação da tabela;
- exportação em CSV;
- atualização automática quando a versão do R2 muda;
- versão responsiva para celular;
- favicon institucional;
- abertura institucional com animação controlada pela rolagem.

## Arquitetura de atualização

- Google Planilhas: fonte administrativa.
- Google Apps Script: gera o JSON e dispara o webhook quando a planilha muda.
- Cloudflare Pages Functions: valida o webhook e atualiza o armazenamento.
- Cloudflare R2: guarda a última versão pronta dos dados.
- Navegador: lê o R2; não consulta a planilha a cada acesso.

## Rotas

- `GET /api/dashboard`: devolve os dados armazenados no R2.
- `GET /api/dashboard-version`: devolve somente a versão atual.
- `POST /api/dashboard-refresh`: recebe o webhook privado do Apps Script.

## Publicação

1. Envie todos os arquivos deste pacote para a raiz do repositório GitHub.
2. Mantenha o projeto como Cloudflare Pages.
3. Crie o bucket R2 `iper-dashboard-data`.
4. Vincule o bucket ao projeto com o binding `IPER_DATA`.
5. Cadastre `DASHBOARD_WEBHOOK_SECRET` como segredo no Cloudflare.
6. Substitua o código da planilha por `google-apps-script/Code.gs`.
7. Atualize a implantação do Apps Script.
8. Execute `instalarGatilhos()` e `atualizarDashboardAgora()`.

Consulte `CONFIGURACAO_WEBHOOK.md` para o procedimento completo.
