/**
 * IPER — API pública de leitura do Google Planilhas.
 *
 * Abas utilizadas:
 * - Banco de Dados
 * - Sistema FELPS
 */

function doGet() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const banco = spreadsheet.getSheetByName('Banco de Dados');
    const sistemaFelps = spreadsheet.getSheetByName('Sistema FELPS');

    if (!banco) {
      throw new Error('A aba "Banco de Dados" não foi encontrada.');
    }

  var urlWebhook = "https://iper-dashboard.pages.dev/api/dashboard"; 
  
  var payload = {
    "evento": "planilha_atualizada",
    "usuario": e.user.getEmail(),
    "timestamp": new Date().toISOString()
  };
  
  var opcoes = {
    "method" : "post",
    "contentType": "application/json",
    "payload" : JSON.stringify(payload)
  };
  
  // Envia a notificação para a sua aplicação limpar o cache
  UrlFetchApp.fetch(urlWebhook, opcoes);

  return jsonResponse_(payload);

  } catch (error) {
    return jsonResponse_({
      error: error && error.message
        ? error.message
        : String(error)
    });
  }
}

function readBancoDeDados_(sheet) {
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return [];
  }

  const headers = values[0].map(normalizeHeader_);
  const columns = {};

  headers.forEach(function (header, index) {
    columns[header] = index;
  });

  const required = [
    'ORGAO',
    'COMPETENCIA',
    'ANO'
  ];

  required.forEach(function (header) {
    if (columns[header] === undefined) {
      throw new Error(
        'Coluna obrigatória não encontrada: ' + header
      );
    }
  });

  const funds = {
    FF: 'Fundo Financeiro',
    FP: 'Fundo Previdenciário',
    FM: 'Fundo Militar'
  };

  return values.slice(1).reduce(function (records, row) {
    const agency = text_(getValue_(row, columns, 'ORGAO'));
    const competence = text_(
      getValue_(row, columns, 'COMPETENCIA')
    );
    const year = integerText_(
      getValue_(row, columns, 'ANO')
    );

    if (!agency || !competence || !year) {
      return records;
    }

    const patronal = number_(
      getValue_(row, columns, 'PATRONAL')
    );

    const insured = number_(
      getValue_(row, columns, 'SEGURADO')
    );

    const compensation = number_(
      getValue_(row, columns, 'COMPENSACAO')
    );

    const dischargeDate = getValue_(
      row,
      columns,
      'DATA DA BAIXA'
    );

    const fundCode = text_(
      getValue_(row, columns, 'FUNDO')
    ).toUpperCase();

    const revenue =
      patronal +
      insured +
      compensation;

    records.push({
      date: competenceDate_(competence, year),
      year: year,
      month: monthLabel_(competence, year),
      monthName: title_(competence),

      entity: title_(
        text_(getValue_(row, columns, 'PODER')) ||
        'Não informado'
      ),

      agency: agency,

      fund:
        funds[fundCode] ||
        fundCode ||
        'Não informado',

      payroll:
        text_(getValue_(row, columns, 'FOLHA')) ||
        'Não informado',

      category: title_(
        text_(
          getValue_(row, columns, 'CLASSIFICACAO')
        ) || 'Não informado'
      ),

      status: dischargeDate
        ? 'Baixado'
        : 'Sem data de baixa',

      debtType: 'Não informado',
      owner: 'Não informado',
      process: '',

      servers: integer_(
        getValue_(row, columns, 'SERVIDORES')
      ),

      dependents: integer_(
        getValue_(row, columns, 'DEPENDENTES')
      ),

      grossPay: round2_(
        number_(
          getValue_(
            row,
            columns,
            'REMUNERACAO BRUTA'
          )
        )
      ),

      calculationBase: round2_(
        number_(
          getValue_(
            row,
            columns,
            'BASE DE CALCULO'
          )
        )
      ),

      patronal: round2_(patronal),
      insured: round2_(insured),
      compensation: round2_(compensation),
      revenue: round2_(revenue),

      debt: null,

      ingress: title_(
        text_(
          getValue_(row, columns, 'INGRESSO')
        ) || 'Não informado'
      )
    });

    return records;
  }, []);
}

function readSistemaFelps_(sheet) {
  const referenceMonth = title_(
    text_(sheet.getRange('D2').getValue())
  );

  const referenceYear = integerText_(
    sheet.getRange('E2').getValue()
  );

  const rows = sheet
    .getRange('B4:E18')
    .getValues();

  const agencies = [];
  let financial = 0;
  let previdentiary = 0;
  let total = 0;

  rows.forEach(function (row) {
    const agency = text_(row[0]);

    if (!agency) {
      return;
    }

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
    reference:
      referenceMonth + '/' + referenceYear,

    financial: round2_(financial),
    previdentiary: round2_(previdentiary),
    total: round2_(total),
    agencies: agencies
  };
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function getValue_(row, columns, header) {
  const index = columns[normalizeHeader_(header)];

  return index === undefined
    ? ''
    : row[index];
}

function normalizeHeader_(value) {
  return text_(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[()]/g, ' ')
    .replace(/[^A-Z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function text_(value) {
  return value === null || value === undefined
    ? ''
    : String(value).trim();
}

function number_(value) {
  if (typeof value === 'number') {
    return isFinite(value) ? value : 0;
  }

  let normalized = text_(value)
    .replace(/\s/g, '');

  if (
    normalized.indexOf('.') >= 0 &&
    normalized.indexOf(',') >= 0
  ) {
    normalized = normalized
      .replace(/\./g, '')
      .replace(',', '.');
  } else {
    normalized = normalized.replace(',', '.');
  }

  normalized = normalized.replace(
    /[^0-9.-]/g,
    ''
  );

  const parsed = Number(normalized);

  return isFinite(parsed)
    ? parsed
    : 0;
}

function integer_(value) {
  return Math.round(number_(value));
}

function integerText_(value) {
  const parsed = number_(value);

  return parsed
    ? String(Math.round(parsed))
    : text_(value);
}

function round2_(value) {
  return Math.round(
    (number_(value) + Number.EPSILON) * 100
  ) / 100;
}

function title_(value) {
  return text_(value)
    .toLocaleLowerCase('pt-BR')
    .replace(
      /(^|\s)\S/g,
      function (letter) {
        return letter.toLocaleUpperCase('pt-BR');
      }
    );
}

function monthLabel_(month, year) {
  const months = {
    JANEIRO: 'Jan',
    FEVEREIRO: 'Fev',
    MARCO: 'Mar',
    ABRIL: 'Abr',
    MAIO: 'Mai',
    JUNHO: 'Jun',
    JULHO: 'Jul',
    AGOSTO: 'Ago',
    SETEMBRO: 'Set',
    OUTUBRO: 'Out',
    NOVEMBRO: 'Nov',
    DEZEMBRO: 'Dez'
  };

  const normalized = normalizeHeader_(month)
    .replace(/\s/g, '');

  const abbreviation =
    months[normalized] ||
    title_(month).slice(0, 3);

  return abbreviation + '/' + year;
}

function competenceDate_(month, year) {
  const months = {
    JANEIRO: '01',
    FEVEREIRO: '02',
    MARCO: '03',
    ABRIL: '04',
    MAIO: '05',
    JUNHO: '06',
    JULHO: '07',
    AGOSTO: '08',
    SETEMBRO: '09',
    OUTUBRO: '10',
    NOVEMBRO: '11',
    DEZEMBRO: '12'
  };

  const normalized = normalizeHeader_(month)
    .replace(/\s/g, '');

  return year +
    '-' +
    (months[normalized] || '01') +
    '-01';
}