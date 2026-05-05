// functions/api/links.js
// 外部链接 CRUD，写操作需要管理员密码

const KV_KEY = "links";

function checkAdmin(request, env) {
  const adminPassword = env.ADMIN_PASSWORD;
  return request.headers.get("X-Admin-Key") === adminPassword;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  const kv = env.RDS_STORE;
  if (!kv) {
    return new Response(JSON.stringify({ error: "KV not bound" }), {
      status: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }

  // GET：返回链接列表
  if (request.method === "GET") {
    try {
      const raw = await kv.get(KV_KEY);
      const links = raw ? JSON.parse(raw) : [];
      return new Response(JSON.stringify(links), {
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify([]), {
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    }
  }

  // 写操作需要管理员权限
  if (!checkAdmin(request, env)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403,
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }

  // POST：保存完整链接列表（覆盖）
  if (request.method === "POST") {
    const body = await request.json();
    if (!Array.isArray(body.links)) {
      return new Response(JSON.stringify({ error: "links must be an array" }), {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    }
    await kv.put(KV_KEY, JSON.stringify(body.links));
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
