// functions/proto/[[path]].js
// 动态提供存储的 Axure 原型文件 (优先 R2)
// 智能缓存策略：允许缓存 + ETag验证 + 上传时主动清除
// 确保：上传/更新后立即生效，未更新时使用缓存保证速度

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
 * 根据文件类型获取缓存配置
 * 策略：浏览器短缓存 + CDN中等缓存 + ETag验证
 */
function getCacheConfig(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();

  // HTML文件：浏览器不缓存（每次验证），CDN缓存1小时
  if (ext === 'html' || ext === 'htm') {
    return {
      browserMaxAge: 0,      // 浏览器每次都验证
      cdnMaxAge: 3600,       // CDN缓存1小时
    };
  }

  // JS/CSS/JSON：浏览器缓存5分钟，CDN缓存24小时
  if (['js', 'css', 'json'].includes(ext)) {
    return {
      browserMaxAge: 300,
      cdnMaxAge: 86400,
    };
  }

  // 图片等静态资源：浏览器缓存1天，CDN缓存7天
  return {
    browserMaxAge: 86400,
    cdnMaxAge: 604800,
  };
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
  const cacheConfig = getCacheConfig(resolvedPath);

  // ── 2. 从 R2 读取最新版本（获取最新ETag）──
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

    // ── 3. ETag验证：如果客户端缓存未过期且ETag匹配，返回304 ──
    if (clientEtag && clientEtag === currentEtag) {
      return new Response(null, {
        status: 304,
        headers: {
          "ETag": currentEtag,
          "Cache-Control": `public, max-age=${cacheConfig.browserMaxAge}, s-maxage=${cacheConfig.cdnMaxAge}, must-revalidate`,
          "X-Cache-Status": "HIT-ETAG",
          "X-R2-ETag": currentEtag,
        }
      });
    }

    // ── 4. 返回最新内容（允许缓存，但使用ETag确保一致性）──
    const contentType = r2Obj.httpMetadata?.contentType || getMime(resolvedPath);
    const response = new Response(r2Obj.body, {
      headers: {
        "Content-Type": contentType,
        "ETag": currentEtag,
        // 允许缓存，但必须验证ETag
        "Cache-Control": `public, max-age=${cacheConfig.browserMaxAge}, s-maxage=${cacheConfig.cdnMaxAge}, must-revalidate`,
        "Vary": "Accept-Encoding",
        // 调试信息
        "X-Cache-Status": "MISS",
        "X-Storage": "R2",
        "X-Proto-Name": protoName,
        "X-File-Path": resolvedPath,
        "X-R2-ETag": currentEtag,
      }
    });

    // 异步更新边缘缓存（下次访问更快）
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
            "Cache-Control": "public, max-age=0, s-maxage=3600, must-revalidate",
            "X-Cache-Status": "HIT-ETAG",
          }
        });
      }

      const resp = new Response(indexR2.body, {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
          "ETag": currentEtag,
          "Cache-Control": "public, max-age=0, s-maxage=3600, must-revalidate",
          "X-Cache-Status": "MISS",
          "X-Storage": "R2",
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
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Cache-Status": "MISS-404",
    }
  });
}
