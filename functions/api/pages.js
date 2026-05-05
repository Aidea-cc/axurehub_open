// functions/api/pages.js
// 静态HTML页面管理（单文件，存入R2）


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
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  const kv = env.RDS_STORE;
  const r2 = env.RDS_FILES;
  
  if (!kv || !r2) {
    return new Response(JSON.stringify({ error: "KV or R2 not bound" }), {
      status: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }

  // GET：分页遍历 static:*:meta 条目
  if (request.method === "GET") {
    try {
      const pages = [];
      let cursor = undefined;

      do {
        const listOpts = { prefix: "static:", limit: 1000 };
        if (cursor) listOpts.cursor = cursor;

        const list = await kv.list(listOpts);
        const metaKeys = list.keys.filter(k => k.name.endsWith(":meta"));

        for (const key of metaKeys) {
          const raw = await kv.get(key.name);
          if (raw) pages.push(JSON.parse(raw));
        }

        if (list.list_complete) break;
        cursor = list.cursor;
      } while (true);

      pages.sort((a, b) => b.uploadTime - a.uploadTime);
      return new Response(JSON.stringify(pages), {
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify([]), {
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    }
  }

  if (!checkAdmin(request, env)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403,
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }

  // POST：上传一个静态HTML页面
  if (request.method === "POST") {
    const body = await request.json();
    const { name, content } = body;
    if (!name || !content) {
      return new Response(JSON.stringify({ error: "name and content required" }), {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    }

    const safeName = name.replace(/\.html$/i, '');
    const meta = { name: safeName, uploadTime: Date.now() };

    await kv.put(`static:${safeName}:meta`, JSON.stringify(meta));
    // 内容存入 R2
    await r2.put(`static/${safeName}/content.html`, content, {
      httpMetadata: { contentType: 'text/html; charset=UTF-8' }
    });

    return new Response(JSON.stringify({ success: true, name: safeName }), {
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }

  // DELETE
  if (request.method === "DELETE") {
    const name = url.searchParams.get("name");
    if (!name) {
      return new Response(JSON.stringify({ error: "name required" }), {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    }
    await kv.delete(`static:${name}:meta`);
    // 从 R2 删除内容
    await r2.delete(`static/${name}/content.html`);
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
}

