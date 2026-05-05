// functions/api/auth.js
// 管理员密码验证接口（专用，不影响任何数据）


function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const adminPassword = context.env.ADMIN_PASSWORD;
    const ok = body.password === adminPassword;
    return new Response(JSON.stringify({ ok }), {
      status: ok ? 200 : 403,
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
