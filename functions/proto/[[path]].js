// functions/proto/[[path]].js
// 动态提供存储的 Axure 原型文件 (优先 R2，回退 KV)
// 使用 ETag + Cloudflare Cache API 智能缓存策略
// 核心优化：文件更新后立即生效，未更新时使用缓存保证速度

import { get404PageHtml } from '../errors/404.js';

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

  // ── 1. 解析路径 ──
  const pathParts = params.path || [];
  if (pathParts.length < 1) return new Response("Not Found", { status: 404 });

  const protoName   = decodeURIComponent(pathParts[0]);
  const filePath    = pathParts.slice(1).map(p => decodeURIComponent(p)).join('/');
  const resolvedPath = filePath || 'index.html';
  const binary       = isBinaryExt(resolvedPath);
  const cacheTtl     = getCacheTtl(resolvedPath);

  // ── 2. 从 R2 读取（始终获取最新版本用于ETag比对）──
  const r2Key = `proto/${protoName}/${resolvedPath}`;
  const r2Obj = await r2.get(r2Key);

  if (r2Obj !== null) {
    const currentEtag = r2Obj.etag;
    const clientEtag = request.headers.get('If-None-Match');

    // ── 3. ETag 缓存验证：如果客户端ETag匹配，返回304 ──
    if (clientEtag && clientEtag === currentEtag) {
      return new Response(null, {
        status: 304,
        headers: {
          "ETag": currentEtag,
          "Cache-Control": `public, max-age=${cacheTtl}, must-revalidate`,
          "X-Cache": "HIT-VALIDATED",
          "X-Storage": "R2",
        }
      });
    }

    // ── 4. 文件已更新或无缓存，返回最新内容并更新边缘缓存 ──
    const response = new Response(r2Obj.body, {
      headers: {
        "Content-Type": r2Obj.httpMetadata?.contentType || getMime(resolvedPath),
        "ETag": currentEtag,
        "Cache-Control": `public, max-age=${cacheTtl}, must-revalidate`,
        "X-Cache": "MISS",
        "X-Storage": "R2",
      }
    });

    // 异步更新Cloudflare边缘缓存（下次请求可直接使用）
    const cache = caches.default;
    waitUntil(cache.put(request, response.clone()));

    return response;
  }

  // 尝试目录 index.html
  if (!resolvedPath.includes('.')) {
    const indexR2Key = `proto/${protoName}/${resolvedPath}/index.html`;
    const indexR2 = await r2.get(indexR2Key);
    if (indexR2) {
      const currentEtag = indexR2.etag;
      const clientEtag = request.headers.get('If-None-Match');

      if (clientEtag && clientEtag === currentEtag) {
        return new Response(null, {
          status: 304,
          headers: {
            "ETag": currentEtag,
            "Cache-Control": `public, max-age=86400, must-revalidate`,
            "X-Cache": "HIT-VALIDATED",
            "X-Storage": "R2"
          }
        });
      }

      const resp = new Response(indexR2.body, {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
          "ETag": currentEtag,
          "Cache-Control": `public, max-age=86400, must-revalidate`,
          "X-Cache": "MISS",
          "X-Storage": "R2"
        }
      });

      const cache = caches.default;
      waitUntil(cache.put(request, resp.clone()));
      return resp;
    }
  }

  // ── 返回美观的404错误页面（从独立模块加载）──
  return new Response(get404PageHtml(protoName), {
    status: 404,
    headers: { "Content-Type": "text/html;charset=UTF-8" }
  });
}


