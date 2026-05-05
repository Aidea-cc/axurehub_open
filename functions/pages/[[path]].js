// functions/pages/[[path]].js
// 动态提供存储的静态HTML页面 (优先 R2，回退 KV)

export async function onRequest(context) {
  const { request, env, params, waitUntil } = context;
  const kv = env.RDS_STORE;
  const r2 = env.RDS_FILES;
  
  if (!kv || !r2) return new Response("Configuration Error", { status: 500 });

  // ── 1. 先查边缘缓存 ──
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  // ── 2. 解析页面名 ──
  const pathParts = params.path || [];
  if (pathParts.length < 1) return new Response("Not Found", { status: 404 });

  let pageName = decodeURIComponent(pathParts[0]).replace(/\.html?$/i, '');

  // ── 3. 从 R2 读取 ──
  const r2Key = `static/${pageName}/content.html`;
  const r2Obj = await r2.get(r2Key);
  
  if (r2Obj !== null) {
     const response = new Response(r2Obj.body, {
       headers: {
         "Content-Type": "text/html;charset=UTF-8",
         "Cache-Control": "public, max-age=86400",
         "X-Cache": "MISS",
         "X-Storage": "R2",
       }
     });
     waitUntil(cache.put(request, response.clone()));
     return response;
  }

  return new Response(`Page not found: ${pageName}`, { status: 404 });
}


