// functions/proto/[[path]].js
// 动态提供存储的 Axure 原型文件 (优先 R2)
// 关键策略：完全禁用所有缓存层，确保每次请求都直接读取R2最新内容
// 这是为了解决Cloudflare多层缓存导致的"新旧文件混合"问题

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

/**
 * 生成强制的防缓存头
 * 使用多个指令确保所有缓存层都不缓存
 */
function getNoCacheHeaders() {
  return {
    // 标准HTTP 1.1：禁止缓存
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0',
    // HTTP 1.0 兼容
    'Pragma': 'no-cache',
    // 过期时间设为过去
    'Expires': 'Thu, 01 Jan 1970 00:00:00 GMT',
    // 确保CDN不缓存
    'CDN-Cache-Control': 'no-store, max-age=0',
    // Cloudflare特定（如果支持）
    'Cloudflare-CDN-Cache-Control': 'no-store, max-age=0',
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const kv = env.RDS_STORE;
  const r2 = env.RDS_FILES;

  if (!kv || !r2) {
    return new Response("Configuration Error", { status: 500 });
  }

  // ── 1. 解析路径 ──
  const pathParts = params.path || [];
  if (pathParts.length < 1) {
    return new Response("Not Found", { status: 404 });
  }

  const protoName   = decodeURIComponent(pathParts[0]);
  const filePath    = pathParts.slice(1).map(p => decodeURIComponent(p)).join('/');
  const resolvedPath = filePath || 'index.html';

  // ── 2. 从 R2 直接读取（每次都读取最新版本）──
  const r2Key = `proto/${protoName}/${resolvedPath}`;
  let r2Obj = null;

  try {
    r2Obj = await r2.get(r2Key);
  } catch (e) {
    console.error(`[Proto] R2读取失败: ${r2Key}`, e.message);
    return new Response(`Storage Error: ${e.message}`, { status: 502 });
  }

  if (r2Obj !== null) {
    const currentEtag = r2Obj.etag;
    const clientEtag = request.headers.get('If-None-Match');

    // ── 3. ETag 验证（仅用于节省带宽，不影响缓存策略）──
    if (clientEtag && clientEtag === currentEtag) {
      return new Response(null, {
        status: 304,
        headers: {
          ...getNoCacheHeaders(),
          "ETag": currentEtag,
          "X-Cache-Status": "NOT-MODIFIED",
          "X-R2-ETag": currentEtag,
        }
      });
    }

    // ── 4. 返回最新内容（强制不缓存）──
    const contentType = r2Obj.httpMetadata?.contentType || getMime(resolvedPath);
    
    return new Response(r2Obj.body, {
      headers: {
        ...getNoCacheHeaders(),
        "Content-Type": contentType,
        "ETag": currentEtag,
        "X-Cache-Status": "NO-CACHE-DIRECT",
        "X-Storage": "R2",
        "X-Proto-Name": protoName,
        "X-File-Path": resolvedPath,
        "X-R2-ETag": currentEtag,
        "X-Content-Length": r2Obj.size?.toString() || 'unknown',
        "X-Timestamp": new Date().toISOString(),
      }
    });
  }

  // 尝试目录 index.html
  if (!resolvedPath.includes('.')) {
    const indexR2Key = `proto/${protoName}/${resolvedPath}/index.html`;
    let indexR2 = null;

    try {
      indexR2 = await r2.get(indexR2Key);
    } catch (e) {
      console.error(`[Proto] R2读取失败(index): ${indexR2Key}`, e.message);
    }

    if (indexR2 !== null) {
      const currentEtag = indexR2.etag;
      const clientEtag = request.headers.get('If-None-Match');

      if (clientEtag && clientEtag === currentEtag) {
        return new Response(null, {
          status: 304,
          headers: {
            ...getNoCacheHeaders(),
            "ETag": currentEtag,
            "X-Cache-Status": "NOT-MODIFIED",
          }
        });
      }

      return new Response(indexR2.body, {
        headers: {
          ...getNoCacheHeaders(),
          "Content-Type": "text/html;charset=UTF-8",
          "ETag": currentEtag,
          "X-Cache-Status": "NO-CACHE-DIRECT",
          "X-Storage": "R2",
        }
      });
    }
  }

  // ── 5. 返回404页面（也不缓存）──
  return new Response(get404PageHtml(protoName), {
    status: 404,
    headers: {
      ...getNoCacheHeaders(),
      "Content-Type": "text/html;charset=UTF-8",
      "X-Cache-Status": "NO-CACHE-404",
    }
  });
}
