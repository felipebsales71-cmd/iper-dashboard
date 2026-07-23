/**
 * IPER — API JSON e webhook de atualização do dashboard.
 *
 * Abas monitoradas:
 * - Banco de Dados
 * - Sistema FELPS
 *
 * ARQUITETURA:
 * 1. doGet() apenas entrega o JSON da planilha quando o Cloudflare solicita.
 * 2. Um gatilho instalável detecta alterações nas abas monitoradas.
 * 3. O gatilho envia POST para /api/dashboard-refresh.
 * 4. O Cloudflare busca o JSON atualizado e o grava no R2.
 * 5. Os visitantes leem o R2; a planilha não é consultada a cada acesso.
 */

const IPER_WEBHOOK_URL = 'https://iper-dashboard.pages.dev/api/dashboard-refresh';
const IPER_MONITORED_SHEETS = ['Banco de Dados', 'Sistema FELPS'];

/**
 * Endpoint público de leitura usado somente pelo Cloudflare.
 */
function doGet() {
  try {
    const spreadsheet = getSpreadsheet_();
    const banco = spreadsheet.getSheetByName('Banco de Dados');
    const sistema = spreadsheet.getSheetByName('Sistema FELPS');

    if (!banco || !sistema) {
      throw new Error('As abas "Banco de Dados" e "Sistema FELPS" são obrigatórias.');
    }

    const updatedAt = getLastUpdated_(spreadsheet);
    const payload = {
      meta: {
        source: 'Google Planilhas do IPER',
        updatedAt: updatedAt,
        version: updatedAt,
        isDemo: false,
        capabilities: {
          revenue: true,
          servers: true,
          funds: true,
          agencies: true
        },
        notes: [
          'Arrecadação calculada como Patronal + Segurado + Compensação.',
          'O tipo de servidor é lido da coluna TIPO DE SERVIDOR, quando disponível, ou inferido pela folha.'
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

/**
 * Execute UMA VEZ no editor do Apps Script.
 * Gera um segredo, salva o ID da planilha e mostra o valor que deve ser
 * cadastrado no Cloudflare como DASHBOARD_WEBHOOK_SECRET.
 */
function gerarSegredoWebhook() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('Abra este script a partir da própria Google Planilha.');
  }

  const properties = PropertiesService.getScriptProperties();
  const existing = properties.getProperty('DASHBOARD_WEBHOOK_SECRET');
  const secret = existing || (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');

  properties.setProperties({
    DASHBOARD_WEBHOOK_SECRET: secret,
    DASHBOARD_WEBHOOK_URL: IPER_WEBHOOK_URL,
    SPREADSHEET_ID: spreadsheet.getId()
  });

  SpreadsheetApp.getUi().alert(
    'Segredo do webhook',
    'Copie o valor abaixo e cadastre no Cloudflare Pages como segredo ' +
      'DASHBOARD_WEBHOOK_SECRET:\n\n' + secret +
      '\n\nDepois volte ao Apps Script e execute instalarGatilhos().',
    SpreadsheetApp.getUi().ButtonSet.OK
  );

  Logger.log('DASHBOARD_WEBHOOK_SECRET=%s', secret);
  return secret;
}

/**
 * Execute após cadastrar o segredo no Cloudflare.
 * Instala os gatilhos de edição e de alteração estrutural.
 */
function instalarGatilhos() {
  const spreadsheet = getSpreadsheet_();
  const managedFunctions = ['onPlanilhaEditada_', 'onEstruturaAlterada_'];

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (managedFunctions.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('onPlanilhaEditada_')
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();

  ScriptApp.newTrigger('onEstruturaAlterada_')
    .forSpreadsheet(spreadsheet)
    .onChange()
    .create();

  SpreadsheetApp.getUi().alert(
    'Integração instalada',
    'Os gatilhos foram instalados. Agora execute atualizarDashboardAgora() ' +
      'para carregar a primeira versão no Cloudflare R2.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Gatilho instalável: executado quando um usuário altera o valor de uma célula.
 * Não use esta função manualmente.
 */
function onPlanilhaEditada_(e) {
  try {
    if (!e || !e.range) return;

    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    if (IPER_MONITORED_SHEETS.indexOf(sheetName) === -1) return;

    notificarDashboard_({
      evento: 'celula_editada',
      aba: sheetName,
      intervalo: e.range.getA1Notation(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Falha no webhook de edição:', error);
  }
}

/**
 * Gatilho instalável: detecta inclusão/remoção de linhas, colunas e abas.
 * Não use esta função manualmente.
 */
function onEstruturaAlterada_(e) {
  try {
    const changeType = e && e.changeType ? String(e.changeType) : 'UNKNOWN';
    // O gatilho de edição já trata alterações de células. Evita atualização duplicada.
    if (changeType === 'EDIT') return;

    notificarDashboard_({
      evento: 'estrutura_alterada',
      tipoAlteracao: changeType,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Falha no webhook estrutural:', error);
  }
}

/**
 * Atualização manual e inicial do R2.
 */
function atualizarDashboardAgora() {
  const result = notificarDashboard_({
    evento: 'atualizacao_manual',
    timestamp: new Date().toISOString()
  });

  SpreadsheetApp.getUi().alert(
    'Atualização enviada',
    'Resposta do Cloudflare:\n\n' + result,
    SpreadsheetApp.getUi().ButtonSet.OK
  );

  return result;
}

/**
 * Remove somente os gatilhos gerenciados por esta integração.
 */
function removerGatilhos() {
  const managedFunctions = ['onPlanilhaEditada_', 'onEstruturaAlterada_'];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (managedFunctions.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function notificarDashboard_(eventPayload) {
  const properties = PropertiesService.getScriptProperties();
  const webhookUrl = properties.getProperty('DASHBOARD_WEBHOOK_URL') || IPER_WEBHOOK_URL;
  const webhookSecret = properties.getProperty('DASHBOARD_WEBHOOK_SECRET');

  if (!webhookSecret) {
    throw new Error('Execute gerarSegredoWebhook() antes de instalar a integração.');
  }

  const payload = Object.assign({
    origem: 'Google Planilhas IPER',
    spreadsheetId: getSpreadsheet_().getId()
  }, eventPayload || {});

  const response = UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-Webhook-Secret': webhookSecret
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: true
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error('Cloudflare respondeu HTTP ' + status + ': ' + body.slice(0, 500));
  }

  return body;
}

function getSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty('SPREADSHEET_ID');

  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('ID da planilha não configurado. Execute gerarSegredoWebhook().');
  }
  return active;
}

function readBancoDeDados_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(normalizeHeader_);
  const col = {};
  headers.forEach(function(name, index) { col[name] = index; });

  const required = [
    'ORGAO', 'FUNDO', 'FOLHA', 'COMPETENCIA', 'PATRONAL',
    'COMPENSACAO', 'SEGURADO', 'PODER', 'CLASSIFICACAO', 'ANO'
  ];

  required.forEach(function(name) {
    if (col[name] === undefined) {
      throw new Error('Coluna obrigatória não encontrada: ' + name);
    }
  });

  const fundNames = {
    FF: 'Fundo Financeiro',
    FP: 'Fundo Previdenciário',
    FM: 'Fundo Militar'
  };

  return values.slice(1).reduce(function(records, row) {
    const agency = text_(row[col.ORGAO]);
    const monthName = text_(row[col.COMPETENCIA]);
    const year = integerText_(row[col.ANO]);
    if (!agency || !monthName || !year) return records;

    const dischargeDate = value_(row, col, 'DATA DA BAIXA');
    const fundCode = text_(row[col.FUNDO]).toUpperCase();
    const patronal = number_(row[col.PATRONAL]);
    const insured = number_(row[col.SEGURADO]);
    const compensation = number_(row[col.COMPENSACAO]);
    const adjustment =
      number_(value_(row, col, 'ENCARGO P')) - number_(value_(row, col, 'DEDUCAO P')) +
      number_(value_(row, col, 'ENCARGO S')) - number_(value_(row, col, 'DEDUCAO S'));

    records.push({
      date: competenceDate_(monthName, year),
      year: year,
      month: monthLabel_(monthName, year),
      monthName: title_(monthName),
      entity: title_(text_(row[col.PODER]) || 'Não informado'),
      agency: agency,
      fund: fundNames[fundCode] || fundCode || 'Não informado',
      payroll: text_(row[col.FOLHA]) || 'Não informado',
      category: title_(text_(row[col.CLASSIFICACAO]) || 'Não informado'),
      status: dischargeDate ? 'Baixado' : 'Sem data de baixa',
      serverType: serverType_(row, col),
      servers: integer_(value_(row, col, 'SERVIDORES')),
      dependents: integer_(value_(row, col, 'DEPENDENTES')),
      grossPay: round2_(number_(value_(row, col, 'REMUNERACAO BRUTA'))),
      calculationBase: round2_(number_(value_(row, col, 'BASE DE CALCULO'))),
      patronal: round2_(patronal),
      insured: round2_(insured),
      compensation: round2_(compensation),
      adjustment: round2_(adjustment),
      revenue: round2_(patronal + insured + compensation),
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

  rows.forEach(function(row) {
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


function serverType_(row, columns) {
  const explicit =
    text_(value_(row, columns, 'TIPO DE SERVIDOR')) ||
    text_(value_(row, columns, 'TIPO SERVIDOR')) ||
    text_(value_(row, columns, 'TIPO'));

  const source = normalizeHeader_(explicit || value_(row, columns, 'FOLHA'));
  if (source.indexOf('APOSENT') !== -1) return 'Aposentado';
  if (source.indexOf('PENSION') !== -1) return 'Pensionista';
  return 'Ativo';
}

function getLastUpdated_(spreadsheet) {
  try {
    return DriveApp.getFileById(spreadsheet.getId()).getLastUpdated().toISOString();
  } catch (error) {
    return new Date().toISOString();
  }
}

function json_(payload, status) {
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

  let normalized = text_(value).replace(/\s/g, '');
  if (normalized.indexOf('.') >= 0 && normalized.indexOf(',') >= 0) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = normalized.replace(',', '.');
  }

  normalized = normalized.replace(/[^0-9.-]/g, '');
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

function title_(value) {
  return text_(value)
    .toLocaleLowerCase('pt-BR')
    .replace(/(^|\s)\S/g, function(letter) {
      return letter.toLocaleUpperCase('pt-BR');
    });
}

function monthLabel_(month, year) {
  const months = {
    JANEIRO: 'Jan', FEVEREIRO: 'Fev', MARCO: 'Mar', ABRIL: 'Abr',
    MAIO: 'Mai', JUNHO: 'Jun', JULHO: 'Jul', AGOSTO: 'Ago',
    SETEMBRO: 'Set', OUTUBRO: 'Out', NOVEMBRO: 'Nov', DEZEMBRO: 'Dez'
  };
  const normalized = normalizeHeader_(month).replace(/\s/g, '');
  return (months[normalized] || title_(month).slice(0, 3)) + '/' + year;
}

function competenceDate_(month, year) {
  const months = {
    JANEIRO: '01', FEVEREIRO: '02', MARCO: '03', ABRIL: '04',
    MAIO: '05', JUNHO: '06', JULHO: '07', AGOSTO: '08',
    SETEMBRO: '09', OUTUBRO: '10', NOVEMBRO: '11', DEZEMBRO: '12'
  };
  const normalized = normalizeHeader_(month).replace(/\s/g, '');
  return year + '-' + (months[normalized] || '01') + '-01';
}
