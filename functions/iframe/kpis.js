export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  url.pathname = "/iframe/kpis/";

  const asset = await context.env.ASSETS.fetch(
    new Request(url.toString(), context.request)
  );

  return new Response(asset.body, asset);
}
