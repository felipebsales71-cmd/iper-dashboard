/**
 * IPER — Cloudflare Pages Function.
 *
 * A URL do Google Apps Script abaixo é pública e serve somente JSON de leitura.
 * Ela pode ser substituída no Cloudflare pela variável GOOGLE_SHEETS_ENDPOINT.
 */
const DEFAULT_GOOGLE_SHEETS_ENDPOINT = "https://script.google.com/macros/s/AKfycbxpZpM5qYM7fLjqROHnCEcEhDa1jMS3IlsK3gi2S7xkwzydWOzA7CwzGtr6oYRFx0LA/exec";

function jsonError(message, status, details) {
  return Response.json(
    { error: message, ...(details ? { details } : {}) },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff'
      }
    }
  );
}

export async function onRequestGet(context) {
  const endpointValue = context.env.GOOGLE_SHEETS_ENDPOINT || DEFAULT_GOOGLE_SHEETS_ENDPOINT;
  const endpoint = new URL(endpointValue);

  // Evita qualquer resposta reaproveitada entre o Cloudflare e o Apps Script.
  endpoint.searchParams.set('_fresh', String(Date.now()));

  let upstream;
  try {
    upstream = await fetch(endpoint.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    return jsonError(
      'Não foi possível estabelecer conexão com o Google Planilhas.',
      502,
      error instanceof Error ? error.message : String(error)
    );
  }

  if (!upstream.ok) {
    return jsonError(
      'O Google Apps Script respondeu com erro.',
      502,
      `HTTP ${upstream.status}`
    );
  }

  const raw = await upstream.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return jsonError(
      'A fonte de dados não retornou JSON válido. Verifique se a implantação permite acesso a qualquer pessoa.',
      502,
      raw.slice(0, 180)
    );
  }

  if (payload?.error) {
    return jsonError(
      'A planilha informou um erro durante a leitura.',
      502,
      String(payload.error)
    );
  }

  if (!Array.isArray(payload?.records)) {
    return jsonError(
      'O formato recebido não contém a lista de registros esperada.',
      502
    );
  }

  payload.meta = {
    ...(payload.meta || {}),
    source: payload.meta?.source || 'Google Planilhas do IPER',
    isDemo: false,
    connection: 'live',
    cache: 'disabled',
    proxiedBy: 'Cloudflare Pages Functions'
  };

  return Response.json(payload, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'CDN-Cache-Control': 'no-store',
      'Cloudflare-CDN-Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
