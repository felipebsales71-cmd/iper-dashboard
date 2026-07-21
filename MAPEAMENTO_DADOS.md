# Mapeamento inicial dos dados

## Abas localizadas no arquivo

1. Extrato
2. Aposentados e Pensionistas
3. DIPR
4. Portal
5. Sistema FELPS
6. Banco de Dados
7. PARCELAMENTOS

A primeira versão do site usa somente as abas solicitadas: `Sistema FELPS` e `Banco de Dados`.

## Banco de Dados

Foram encontrados 1.016 números de linha, sendo 731 registros com órgão, competência e ano preenchidos. A base possui 42 rótulos distintos na coluna `Órgão` e 10 agrupamentos distintos na coluna `Poder`.

### Mapeamento para o dashboard

| Dashboard | Coluna da planilha | Regra |
|---|---|---|
| Ano | Ano | Conversão para inteiro |
| Mês/competência | Competência + Ano | Ex.: Jan/2026 |
| Ente/Poder | Poder | Agrupamento institucional |
| Órgão | Órgão | Unidade registrada na base |
| Fundo | Fundo | FF, FP ou FM convertidos para nome completo |
| Categoria | Classificação | Ex.: Mensal, Gratificação, Extras |
| Situação | Data da baixa | Baixado ou Sem data de baixa |
| Arrecadação | Patronal + Segurado + Compensação | Soma por registro |
| Ajustes | Encargos - Deduções | Mantido como campo auxiliar |

## Aba de origem “Sistema FELPS”

A aba possui um quadro de detalhamento por órgão e por referência, além de resumos quantitativos. No arquivo analisado, a referência visível do quadro é `Janeiro/2026`.

O dashboard mantém esse quadro no JSON em `systemIper`, para uso posterior em comparações e validação dos totais.

## Lacunas identificadas

As duas abas selecionadas não apresentam colunas estruturadas para:

- valor do débito;
- tipo de débito;
- número do processo;
- responsável pelo acompanhamento;
- meta institucional.

Por isso, esses indicadores aparecem como `Não disponível` no protótipo. A implementação correta depende da indicação de outra aba ou da inclusão dessas colunas na base. Nenhum valor foi inventado.

## Divergência a validar

A coluna `Órgão` do Banco de Dados contém 42 rótulos distintos. O conceito de “quantidade de entes” precisa ser definido administrativamente, pois alguns rótulos podem representar folhas, grupos ou unidades internas, e não entes autônomos. No protótipo, o indicador foi denominado `Quantidade de órgãos` e contabiliza os rótulos distintos existentes na base.
