// functions/proto/[[path]].js
// 动态提供存储的 Axure 原型文件 (优先 R2，回退 KV)
// 使用 ETag + 标准缓存控制策略
// 兼容 Axure 9 / 10 等所有版本
// 关键修复：使用标准 HTTP 缓存指令，确保 Cloudflare 正确处理

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

/**
 * 获取标准 Cache-Control 头值
 * @param {string} filename - 文件名
 * @returns {string} 完整的 Cache-Control 头值
 */
function getCacheControlHeader(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();

  // HTML 文件：浏览器不缓存，CDN 缓存1小时（用于回源）
  if (ext === 'html' || ext === 'htm') {
    return 'no-cache, must-revalidate, s-maxage=3600, stale-while-revalidate=1800';
  }

  // JS/CSS/JSON：浏览器缓存5分钟，CDN缓存24小时
  if (['js', 'css', 'json'].includes(ext)) {
    return 'public, max-age=300, s-maxage=86400, stale-while-revalidate=43200, must-revalidate';
  }

  // 图片等静态资源：长缓存
  return 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400';
}

export async function onRequest(context) {
  const { request, env, params, waitUntil } = context;
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
  const cacheControl = getCacheControlHeader(resolvedPath);

  // ── 2. 从 R2 读取最新版本 ──
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

    // ── 3. ETag 验证：未修改则返回304 ──
    if (clientEtag && clientEtag === currentEtag) {
      return new Response(null, {
        status: 304,
        headers: {
          "ETag": currentEtag,
          "Cache-Control": cacheControl,
          "Vary": "Accept-Encoding",
          "X-Cache-Status": "HIT-ETAG",
          "X-R2-ETag": currentEtag,
          "X-Timestamp": new Date().toISOString(),
        }
      });
    }

    // ── 4. 返回最新内容 ──
    const contentType = r2Obj.httpMetadata?.contentType || getMime(resolvedPath);
    const response = new Response(r2Obj.body, {
      headers: {
        "Content-Type": contentType,
        "ETag": currentEtag,
        // 标准 Cache-Control，使用 s-maxage 控制 CDN 缓存
        "Cache-Control": cacheControl,
        "Vary": "Accept-Encoding",
        // 调试信息（生产环境可移除）
        "X-Cache-Status": "MISS-FRESH",
        "X-Storage": "R2",
        "X-Proto-Name": protoName,
        "X-File-Path": resolvedPath,
        "X-R2-ETag": currentEtag,
        "X-Content-Length": r2Obj.size?.toString() || 'unknown',
        "X-Timestamp": new Date().toISOString(),
      }
    });

    // 异步更新边缘缓存
    const cache = caches.default;
    waitUntil(cache.put(request, response.clone()).catch(e => {
      console.warn('[Proto] 边缘缓存更新失败:', e.message);
    }));

    return response;
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
            "ETag": currentEtag,
            "Cache-Control": 'no-cache, must-revalidate, s-maxage=3600',
            "X-Cache-Status": "HIT-ETAG",
          }
        });
      }

      const resp = new Response(indexR2.body, {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
          "ETag": currentEtag,
          "Cache-Control": 'no-cache, must-revalidate, s-maxage=3600',
          "X-Cache-Status": "MISS-FRESH",
          "X-Storage": "R2",
          "X-Timestamp": new Date().toISOString(),
        }
      });

      const cache = caches.default;
      waitUntil(cache.put(request, resp.clone()).catch(() => {}));
      return resp;
    }
  }

  // ── 5. 返回404页面 ──
  return new Response(get404PageHtml(protoName), {
    status: 404,
    headers: {
      "Content-Type": "text/html;charset=UTF-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "X-Cache-Status": "MISS-404",
      "X-Timestamp": new Date().toISOString(),
    }
  });
}
