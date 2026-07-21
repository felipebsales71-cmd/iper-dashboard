/**
 * IPER — endpoint JSON para o dashboard.
 * Vincule este script à Google Planilha que contém as abas:
 *   - Sistema FELPS
 *   - Banco de Dados
 *
 * Publique como Aplicativo da Web:
 *   Executar como: proprietário da planilha
 *   Quem tem acesso: qualquer pessoa
 *
 * O endereço gerado deve ser cadastrado no Cloudflare Pages como
 * GOOGLE_SHEETS_ENDPOINT. O site público não recebe credenciais do Google.
 */

function doGet() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const banco = spreadsheet.getSheetByName('Banco de Dados');
    const sistema = spreadsheet.getSheetByName('Sistema FELPS');

    if (!banco || !sistema) {
      throw new Error('As abas "Banco de Dados" e "Sistema FELPS" são obrigatórias.');
    }

    const payload = {
      meta: {
        source: 'Google Planilhas do IPER',
        updatedAt: getLastUpdated_(spreadsheet),
        isDemo: false,
        capabilities: {
          debts: false,
          processes: false,
          responsible: false
        },
        notes: [
          'A base atual não contém colunas estruturadas de débito, processo ou responsável.',
          'Arrecadação calculada como Patronal + Segurado + Compensação.'
        ]
      },
      systemIper: readSistemaIper_(sistema),
      records: readBancoDeDados_(banco)
    };

    return json_(payload, 200);
  } catch (error) {
    return json_({ error: String(error && error.message || error) }, 500);
  }
}

function readBancoDeDados_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(normalizeHeader_);
  const col = {};
  headers.forEach((name, index) => col[name] = index);

  const required = ['ORGAO', 'FUNDO', 'FOLHA', 'COMPETENCIA', 'PATRONAL', 'COMPENSACAO', 'SEGURADO', 'PODER', 'CLASSIFICACAO', 'ANO'];
  required.forEach(name => {
    if (col[name] === undefined) throw new Error('Coluna obrigatória não encontrada: ' + name);
  });

  const fundNames = {
    FF: 'Fundo Financeiro',
    FP: 'Fundo Previdenciário',
    FM: 'Fundo Militar'
  };

  return values.slice(1).reduce((records, row) => {
    const agency = text_(row[col.ORGAO]);
    const monthName = text_(row[col.COMPETENCIA]);
    const year = integerText_(row[col.ANO]);
    if (!agency || !monthName || !year) return records;

    const dischargeDate = value_(row, col, 'DATA DA BAIXA');
    const fundCode = text_(row[col.FUNDO]);
    const patronal = number_(row[col.PATRONAL]);
    const insured = number_(row[col.SEGURADO]);
    const compensation = number_(row[col.COMPENSACAO]);
    const adjustment =
      number_(value_(row, col, 'ENCARGO P')) - number_(value_(row, col, 'DEDUCAO P')) +
      number_(value_(row, col, 'ENCARGO S')) - number_(value_(row, col, 'DEDUCAO S'));

    records.push({
      date: isoDate_(dischargeDate),
      year: year,
      month: monthLabel_(monthName, year),
      monthName: title_(monthName),
      entity: title_(text_(row[col.PODER]) || 'Não informado'),
      agency: agency,
      fund: fundNames[fundCode] || fundCode || 'Não informado',
      payroll: text_(row[col.FOLHA]) || 'Não informado',
      category: title_(text_(row[col.CLASSIFICACAO]) || 'Não informado'),
      status: dischargeDate ? 'Baixado' : 'Sem data de baixa',
      debtType: 'Não informado',
      owner: 'Não informado',
      process: '',
      servers: integer_(value_(row, col, 'SERVIDORES')),
      dependents: integer_(value_(row, col, 'DEPENDENTES')),
      grossPay: round2_(number_(value_(row, col, 'REMUNERACAO BRUTA'))),
      calculationBase: round2_(number_(value_(row, col, 'BASE DE CALCULO'))),
      patronal: round2_(patronal),
      insured: round2_(insured),
      compensation: round2_(compensation),
      adjustment: round2_(adjustment),
      revenue: round2_(patronal + insured + compensation),
      debt: null,
      ingress: title_(text_(value_(row, col, 'INGRESSO')) || 'Não informado')
    });
    return records;
  }, []);
}

function readSistemaIper_(sheet) {
  const referenceMonth = title_(text_(sheet.getRange('D2').getValue()));
  const referenceYear = integerText_(sheet.getRange('E2').getValue());
  const rows = sheet.getRange('B4:E18').getValues();
  const agencies = [];
  let financial = 0;
  let previdentiary = 0;
  let total = 0;

  rows.forEach(row => {
    const agency = text_(row[0]);
    if (!agency) return;
    if (normalizeHeader_(agency) === 'TOTAL') {
      financial = number_(row[1]);
      previdentiary = number_(row[2]);
      total = number_(row[3]);
      return;
    }
    agencies.push({
      agency: agency,
      financial: round2_(number_(row[1])),
      previdentiary: round2_(number_(row[2])),
      total: round2_(number_(row[3]))
    });
  });

  return {
    reference: referenceMonth + '/' + referenceYear,
    financial: round2_(financial),
    previdentiary: round2_(previdentiary),
    total: round2_(total),
    agencies: agencies
  };
}

function getLastUpdated_(spreadsheet) {
  try {
    return DriveApp.getFileById(spreadsheet.getId()).getLastUpdated().toISOString();
  } catch (error) {
    return new Date().toISOString();
  }
}

function json_(payload, status) {
  // ContentService não permite definir o status HTTP diretamente no Web App;
  // o campo status é incluído apenas para diagnóstico no corpo quando houver erro.
  if (status >= 400 && payload && payload.error) payload.status = status;
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeHeader_(value) {
  return text_(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[()]/g, ' ')
    .replace(/[^A-Z0-9]+/gi, ' ')
    .trim().replace(/\s+/g, ' ')
    .toUpperCase();
}

function value_(row, columns, header) {
  const index = columns[normalizeHeader_(header)];
  return index === undefined ? '' : row[index];
}

function text_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function number_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  const normalized = text_(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const parsed = Number(normalized);
  return isFinite(parsed) ? parsed : 0;
}

function integer_(value) {
  return Math.round(number_(value));
}

function integerText_(value) {
  const n = number_(value);
  return n ? String(Math.round(n)) : text_(value);
}

function round2_(value) {
  return Math.round((number_(value) + Number.EPSILON) * 100) / 100;
}

function isoDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'America/Boa_Vista', 'yyyy-MM-dd');
  }
  return '';
}

function title_(value) {
  return text_(value).toLocaleLowerCase('pt-BR').replace(/(^|\s)\S/g, letter => letter.toLocaleUpperCase('pt-BR'));
}

function monthLabel_(month, year) {
  const months = {
    JANEIRO: 'Jan', FEVEREIRO: 'Fev', MARCO: 'Mar', 'MARÇO': 'Mar', ABRIL: 'Abr',
    MAIO: 'Mai', JUNHO: 'Jun', JULHO: 'Jul', AGOSTO: 'Ago', SETEMBRO: 'Set',
    OUTUBRO: 'Out', NOVEMBRO: 'Nov', DEZEMBRO: 'Dez'
  };
  const normalized = normalizeHeader_(month).replace(/ /g, '');
  return (months[normalized] || title_(month).slice(0, 3)) + '/' + year;
}
