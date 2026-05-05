// functions/proto/[[path]].js
// 动态提供存储的 Axure 原型文件 (优先 R2，回退 KV)
// 使用 Cloudflare Cache API 做边缘缓存

function getMime(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const mimes = {
    html: 'text/html;charset=UTF-8',
    htm:  'text/html;charset=UTF-8',
    js:   'application/javascript;charset=UTF-8',
    css:  'text/css;charset=UTF-8',
    json: 'application/json;charset=UTF-8',
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    gif:  'image/gif',
    svg:  'image/svg+xml',
    ico:  'image/x-icon',
    woff: 'font/woff',
    woff2:'font/woff2',
    ttf:  'font/ttf',
    eot:  'application/vnd.ms-fontobject',
    xml:  'application/xml',
    txt:  'text/plain;charset=UTF-8',
    map:  'application/json;charset=UTF-8',
  };
  return mimes[ext] || 'application/octet-stream';
}

const TEXT_TYPES = new Set(['html','htm','js','css','json','xml','txt','svg','csv','map']);

function isBinaryExt(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return !TEXT_TYPES.has(ext);
}

function getCacheTtl(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return (ext === 'html' || ext === 'htm') ? 86400 : 604800;
}

export async function onRequest(context) {
  const { request, env, params, waitUntil } = context;
  const kv = env.RDS_STORE;
  const r2 = env.RDS_FILES;
  
  if (!kv || !r2) return new Response("Configuration Error", { status: 500 });

  // ── 1. 先查 Cloudflare 边缘缓存 ──
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  // ── 2. 解析路径 ──
  const pathParts = params.path || [];
  if (pathParts.length < 1) return new Response("Not Found", { status: 404 });

  const protoName   = decodeURIComponent(pathParts[0]);
  const filePath    = pathParts.slice(1).map(p => decodeURIComponent(p)).join('/');
  const resolvedPath = filePath || 'index.html';
  const binary       = isBinaryExt(resolvedPath);
  const cacheTtl     = getCacheTtl(resolvedPath);

  // ── 3. 从 R2 读取 ──
  const r2Key = `proto/${protoName}/${resolvedPath}`;
  const r2Obj = await r2.get(r2Key);

  if (r2Obj !== null) {
    const response = new Response(r2Obj.body, {
      headers: {
        "Content-Type": r2Obj.httpMetadata?.contentType || getMime(resolvedPath),
        "ETag": r2Obj.etag,
        "Cache-Control": `public, max-age=${cacheTtl}`,
        "X-Cache": "MISS",
        "X-Storage": "R2",
      }
    });
    waitUntil(cache.put(request, response.clone()));
    return response;
  }

  // 尝试目录 index.html
  if (!resolvedPath.includes('.')) {
    const indexR2Key = `proto/${protoName}/${resolvedPath}/index.html`;
    const indexR2 = await r2.get(indexR2Key);
    if (indexR2) {
       const resp = new Response(indexR2.body, {
         headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": `public, max-age=86400`, "X-Storage": "R2" }
       });
       waitUntil(cache.put(request, resp.clone()));
       return resp;
    }
  }

  return new Response(`File not found: ${resolvedPath}`, { status: 404 });
}


