# IPER — Dashboard Previdenciário

Versão final preparada para publicação no Cloudflare Pages, com conexão ao Google Planilhas por meio de Cloudflare Pages Functions.

## Estado da integração

- Endpoint do Google Apps Script cadastrado: `https://script.google.com/macros/s/AKfycbxpZpM5qYM7fLjqROHnCEcEhDa1jMS3IlsK3gi2S7xkwzydWOzA7CwzGtr6oYRFx0LA/exec`
- Rota pública do site: `/api/dashboard`
- Cache padrão: 300 segundos
- Fonte principal: Google Planilhas
- Contingência: `data/dashboard.json`

Quando publicado no Cloudflare Pages, o navegador chama apenas `/api/dashboard`. A função do Cloudflare consulta o Apps Script, valida o JSON e guarda o resultado em cache.

## Publicação no Cloudflare Pages

1. Envie todos os arquivos desta pasta para um repositório GitHub.
2. No Cloudflare, abra **Workers & Pages → Create → Pages → Connect to Git**.
3. Selecione o repositório.
4. Framework preset: `None`.
5. Build command: deixe vazio.
6. Build output directory: `.`.
7. Publique.

O arquivo `wrangler.toml` já contém o endpoint e o tempo de cache. A variável `GOOGLE_SHEETS_ENDPOINT` também pode ser substituída no painel do Cloudflare sem alterar o código.

## Como confirmar a conexão

Após a publicação, acesse:

- `/api/dashboard` — deve mostrar JSON;
- a página inicial — deve exibir “Conectado ao Google Planilhas”.

Caso apareça “Modo de contingência local”, verifique se a implantação do Apps Script foi definida como **Executar como: Eu** e **Quem pode acessar: Qualquer pessoa**.

## Atualização dos dados

A planilha é consultada automaticamente. Por causa do cache, alterações podem levar até 5 minutos para aparecer no dashboard.

## Segurança

O site é público e somente leitura. A área administrativa permanece visual nesta versão; autenticação e edição de dados devem ser implementadas separadamente. Nenhuma credencial do Google é enviada ao navegador.
