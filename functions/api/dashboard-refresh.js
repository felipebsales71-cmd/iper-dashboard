/**
 * IPER — webhook de atualização.
 *
 * O Google Apps Script chama esta rota somente quando a planilha muda.
 * A função busca o JSON atualizado no Apps Script e substitui o objeto no R2.
 */
const DEFAULT_DATA_KEY = 'dashboard/current.json';
const DEFAULT_GOOGLE_SHEETS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxpZpM5qYM7fLjqROHnCEcEhDa1jMS3IlsK3gi2S7xkwzydWOzA7CwzGtr6oYRFx0LA/exec';

function responseJson(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function validatePayload(payload) {
  if (payload?.error) throw new Error(String(payload.error));
  if (!Array.isArray(payload?.records)) {
    throw new Error('O formato recebido não contém a lista de registros esperada.');
  }
}

export async function onRequestPost(context) {
  if (!context.env.IPER_DATA) {
    return responseJson({ error: 'Binding R2 IPER_DATA não configurado.' }, 503);
  }

  const configuredSecret = String(context.env.DASHBOARD_WEBHOOK_SECRET || '');
  if (!configuredSecret) {
    return responseJson({ error: 'O segredo DASHBOARD_WEBHOOK_SECRET não está configurado.' }, 503);
  }

  const receivedSecret = String(context.request.headers.get('X-Webhook-Secret') || '');
  if (!receivedSecret || receivedSecret !== configuredSecret) {
    return responseJson({ error: 'Webhook não autorizado.' }, 401);
  }

  let eventPayload = {};
  try {
    eventPayload = await context.request.json();
  } catch {
    return responseJson({ error: 'Payload JSON inválido.' }, 400);
  }

  const endpointValue = context.env.GOOGLE_SHEETS_ENDPOINT || DEFAULT_GOOGLE_SHEETS_ENDPOINT;
  const endpoint = new URL(endpointValue);
  endpoint.searchParams.set('_fresh', String(Date.now()));
  if (eventPayload?.timestamp) endpoint.searchParams.set('_event', String(eventPayload.timestamp));

  try {
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

    const updatedAt = String(payload?.meta?.updatedAt || eventPayload?.timestamp || new Date().toISOString());
    const version = `${updatedAt}:${Date.now()}`;
    payload.meta = {
      ...(payload.meta || {}),
      source: payload.meta?.source || 'Google Planilhas do IPER',
      updatedAt,
      version,
      isDemo: false,
      connection: 'live',
      updateMode: 'webhook-r2',
      storage: 'Cloudflare R2',
      lastWebhookEvent: {
        event: String(eventPayload?.evento || 'planilha_atualizada'),
        sheet: String(eventPayload?.aba || ''),
        range: String(eventPayload?.intervalo || ''),
        receivedAt: new Date().toISOString()
      }
    };

    const key = context.env.DASHBOARD_DATA_KEY || DEFAULT_DATA_KEY;
    await context.env.IPER_DATA.put(key, JSON.stringify(payload), {
      httpMetadata: { contentType: 'application/json; charset=UTF-8' },
      customMetadata: {
        version,
        updatedAt,
        recordCount: String(payload.records.length)
      }
    });

    return responseJson({
      ok: true,
      message: 'Dashboard atualizado no R2.',
      version,
      updatedAt,
      records: payload.records.length
    });
  } catch (error) {
    return responseJson(
      {
        error: 'Falha ao atualizar o dashboard.',
        details: error instanceof Error ? error.message : String(error)
      },
      502
    );
  }
}

export function onRequestGet() {
  return responseJson({ error: 'Use POST para esta rota.' }, 405);
}
