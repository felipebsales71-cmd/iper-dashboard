/**
 * IPER — entrega rápida do dashboard a partir do R2.
 *
 * Esta rota NÃO consulta o Google Planilhas em cada acesso.
 * O objeto no R2 é atualizado pela rota POST /api/dashboard-refresh,
 * chamada pelo gatilho instalável do Google Apps Script.
 */
const DEFAULT_DATA_KEY = 'dashboard/current.json';
const DEFAULT_GOOGLE_SHEETS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxpZpM5qYM7fLjqROHnCEcEhDa1jMS3IlsK3gi2S7xkwzydWOzA7CwzGtr6oYRFx0LA/exec';

function jsonError(message, status = 500, details) {
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

function validatePayload(payload) {
  if (payload?.error) {
    throw new Error(String(payload.error));
  }
  if (!Array.isArray(payload?.records)) {
    throw new Error('O formato recebido não contém a lista de registros esperada.');
  }
  return payload;
}

async function fetchFreshPayload(env) {
  const endpointValue = env.GOOGLE_SHEETS_ENDPOINT || DEFAULT_GOOGLE_SHEETS_ENDPOINT;
  const endpoint = new URL(endpointValue);
  endpoint.searchParams.set('_fresh', String(Date.now()));

  const upstream = await fetch(endpoint.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: {
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
      'Cache-Control': 'no-cache'
    }
  });

  if (!upstream.ok) {
    throw new Error(`O Google Apps Script respondeu com HTTP ${upstream.status}.`);
  }

  const raw = await upstream.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error('O Google Apps Script não retornou JSON válido.');
  }

  validatePayload(payload);
  const version = String(payload?.meta?.updatedAt || new Date().toISOString());
  payload.meta = {
    ...(payload.meta || {}),
    source: payload.meta?.source || 'Google Planilhas do IPER',
    updatedAt: version,
    version,
    isDemo: false,
    connection: 'live',
    updateMode: 'webhook-r2',
    storage: 'Cloudflare R2'
  };

  return payload;
}

async function storePayload(env, key, payload) {
  const serialized = JSON.stringify(payload);
  const updatedAt = String(payload?.meta?.updatedAt || new Date().toISOString());
  const version = String(payload?.meta?.version || updatedAt);

  await env.IPER_DATA.put(key, serialized, {
    httpMetadata: { contentType: 'application/json; charset=UTF-8' },
    customMetadata: {
      version,
      updatedAt,
      recordCount: String(payload.records.length)
    }
  });
}

export async function onRequestGet(context) {
  if (!context.env.IPER_DATA) {
    return jsonError(
      'O binding R2 IPER_DATA não está configurado no Cloudflare Pages.',
      503,
      'Crie o bucket iper-dashboard-data e vincule-o ao projeto com o nome IPER_DATA.'
    );
  }

  const key = context.env.DASHBOARD_DATA_KEY || DEFAULT_DATA_KEY;
  let object = await context.env.IPER_DATA.get(key);

  // Inicialização única: se o bucket ainda estiver vazio, busca a planilha uma vez.
  if (object === null) {
    try {
      const payload = await fetchFreshPayload(context.env);
      await storePayload(context.env, key, payload);
      object = await context.env.IPER_DATA.get(key);
    } catch (error) {
      return jsonError(
        'Ainda não há dados armazenados no R2 e não foi possível inicializá-los.',
        502,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  if (object === null) {
    return jsonError('O armazenamento do dashboard está vazio.', 503);
  }

  const etag = object.httpEtag || object.etag;
  const requestEtag = context.request.headers.get('If-None-Match');
  if (etag && requestEtag === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }

  const body = await object.text();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      ...(etag ? { ETag: etag } : {}),
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      'X-IPER-Data-Source': 'r2-webhook'
    }
  });
}
