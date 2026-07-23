# Mapeamento de dados do Dashboard IPER

## Abas lidas

- `Banco de Dados`
- `Sistema FELPS`

## Campos utilizados no dashboard

| Campo do JSON | Origem principal | Uso |
|---|---|---|
| `year` | ANO | filtro e acumulado anual |
| `month` | COMPETÊNCIA + ANO | filtro e gráficos mensais |
| `agency` | ÓRGÃO | ranking e tabela |
| `entity` | PODER | filtro avançado |
| `fund` | FUNDO | gráficos e filtro |
| `payroll` | FOLHA | filtro e inferência do tipo |
| `category` | CLASSIFICAÇÃO | filtro avançado |
| `serverType` | TIPO DE SERVIDOR ou FOLHA | ativo, aposentado ou pensionista |
| `servers` | SERVIDORES | quantitativo de servidores |
| `patronal` | PATRONAL | cota patronal |
| `insured` | SEGURADO | cota do segurado |
| `compensation` | COMPENSAÇÃO | compensação |
| `revenue` | cálculo | patronal + segurado + compensação |

## Regra do tipo de servidor

O Apps Script tenta ler, nesta ordem:

1. `TIPO DE SERVIDOR`;
2. `TIPO SERVIDOR`;
3. `TIPO`;
4. inferência pela coluna `FOLHA`.

Na inferência:

- folhas contendo `APOSENT` → `Aposentado`;
- folhas contendo `PENSION` → `Pensionista`;
- demais folhas → `Ativo`.

## Regras dos indicadores

### Acumulado anual

Soma de `revenue` desde janeiro até a competência selecionada.

### Arrecadado na competência

Soma de `revenue` apenas no mês selecionado.

### Quantitativo de servidores

Soma de `servers` apenas na competência selecionada, respeitando todos os filtros.
