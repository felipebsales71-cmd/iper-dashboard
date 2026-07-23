/**
 * IPER — endpoint leve para páginas já abertas verificarem se houve atualização.
 * Não consulta o Google Planilhas; lê apenas os metadados do objeto no R2.
 */
const DEFAULT_DATA_KEY = 'dashboard/current.json';

export async function onRequestGet(context) {
  if (!context.env.IPER_DATA) {
    return Response.json(
      { error: 'Binding R2 IPER_DATA não configurado.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const key = context.env.DASHBOARD_DATA_KEY || DEFAULT_DATA_KEY;
  const object = await context.env.IPER_DATA.head(key);

  if (object === null) {
    return Response.json(
      { ready: false, version: null },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return Response.json(
    {
      ready: true,
      version: object.customMetadata?.version || object.etag,
      updatedAt: object.customMetadata?.updatedAt || null,
      records: Number(object.customMetadata?.recordCount || 0)
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    }
  );
}
