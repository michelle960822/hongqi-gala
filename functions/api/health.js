export async function onRequestGet(context) {
  return new Response(JSON.stringify({
    ok: true,
    time: new Date().toISOString(),
    binding: !!context.env.DB,
    version: 'v5-skip-api-cache',
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
