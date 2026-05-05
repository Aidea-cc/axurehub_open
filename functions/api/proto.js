// functions/api/proto.js
// Axure 原型管理 v3 — 预签名 URL 直传方案 (基于 docs/proto.js 优化)

const _enc = new TextEncoder();

async function _hmac(key, data) {
  const k = typeof key  === 'string' ? _enc.encode(key)  : key;
  const d = typeof data === 'string' ? _enc.encode(data) : data;
  const ck = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', ck, d));
}

const _hex = buf => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');

async function _sha256hex(str) {
  return _hex(new Uint8Array(await crypto.subtle.digest('SHA-256', _enc.encode(str))));
}

// 更加严格的 S3 V4 编码函数
function awsEncode(str, encodeSlash = false) {
  let result = encodeURIComponent(str.normalize('NFC'))
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  if (!encodeSlash) {
    result = result.replace(/%2F/g, '/');
  }
  return result;
}

async function presignPut({ accountId, bucket, accessKeyId, secretKey, r2Key, contentType, expiresIn = 3600 }) {
  const host   = `${bucket}.${accountId}.r2.cloudflarestorage.com`.toLowerCase();
  const region = 'auto';
  const svc    = 's3';

  // 严格路径编码
  const encodedPath = awsEncode(r2Key.startsWith('/') ? r2Key : '/' + r2Key, false);

  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const credScope = `${dateStamp}/${region}/${svc}/aws4_request`;

  // 预签名参数
  const params = new URLSearchParams();
  params.set('X-Amz-Algorithm',      'AWS4-HMAC-SHA256');
  params.set('X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD');
  params.set('X-Amz-Credential',     `${accessKeyId}/${credScope}`);
  params.set('X-Amz-Date',           amzDate);
  params.set('X-Amz-Expires',        String(expiresIn));
  params.set('X-Amz-SignedHeaders',  'host'); // 核心修复：仅签名 host，避免 Content-Type 不匹配

  const sortedKeys = Array.from(params.keys()).sort();
  const canonicalQS = sortedKeys
    .map(k => `${awsEncode(k, true)}=${awsEncode(params.get(k), true)}`)
    .join('&');

  // 只包含 host 头部
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';

  const canonicalRequest = [
    'PUT',
    encodedPath,
    canonicalQS,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credScope,
    await _sha256hex(canonicalRequest),
  ].join('\n');

  let sk = await _hmac('AWS4' + secretKey, dateStamp);
  sk = await _hmac(sk, region);
  sk = await _hmac(sk, svc);
  sk = await _hmac(sk, 'aws4_request');

  const sig = _hex(await _hmac(sk, stringToSign));
  
  // 生成最终 URL
  return `https://${host}${encodedPath}?${canonicalQS}&X-Amz-Signature=${sig}`;
}

function getMime(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return ({
    html: 'text/html;charset=UTF-8',   htm: 'text/html;charset=UTF-8',
    js:   'application/javascript;charset=UTF-8',
    css:  'text/css;charset=UTF-8',    json: 'application/json;charset=UTF-8',
    png:  'image/png',                 jpg:  'image/jpeg', jpeg: 'image/jpeg',
    gif:  'image/gif',                 svg:  'image/svg+xml;charset=UTF-8',
    ico:  'image/x-icon',              woff: 'font/woff',  woff2: 'font/woff2',
    ttf:  'font/ttf',                  eot:  'application/vnd.ms-fontobject',
    xml:  'application/xml;charset=UTF-8',           
    txt:  'text/plain;charset=UTF-8',
    map:  'application/json;charset=UTF-8',
  })[ext] || 'application/octet-stream';
}

const checkAdmin = (req, env) => req.headers.get('X-Admin-Key') === env.ADMIN_PASSWORD;

const cors = () => ({
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
});

const jsonResp = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors(), 'Content-Type': 'application/json' },
});

async function pLimit(items, fn, limit = 5) {
  let idx = 0;
  const results = [];
  async function worker() {
    while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function isSafePath(p) {
  if (!p || typeof p !== 'string') return false;
  const n = p.replace(/\\/g, '/');
  return !n.startsWith('/') && !n.includes('\0') &&
    !n.split('/').some(s => s === '..' || s === '.');
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });

  const kv = env.RDS_STORE;
  const r2 = env.RDS_FILES;
  if (!kv || !r2) return jsonResp({ error: 'KV or R2 not bound' }, 500);

  if (request.method === 'GET') {
    try {
      const protos = [];
      let cursor;
      do {
        const opts = { prefix: 'proto:', limit: 1000 };
        if (cursor) opts.cursor = cursor;
        const list = await kv.list(opts);
        const keys = list.keys.filter(k => k.name.endsWith(':manifest'));
        const raws = await pLimit(keys, k => kv.get(k.name), 10);
        for (const raw of raws) if (raw) protos.push(JSON.parse(raw));
        if (list.list_complete) break;
        cursor = list.cursor;
      } while (true);
      protos.sort((a, b) => b.uploadTime - a.uploadTime);
      return jsonResp(protos);
    } catch { return jsonResp([]); }
  }

  if (!checkAdmin(request, env)) return jsonResp({ error: 'Unauthorized' }, 403);

  if (request.method === 'POST') {
    const action   = url.searchParams.get('action');
    const name     = url.searchParams.get('name');
    const safeName = name?.trim();
    if (!safeName) return jsonResp({ error: 'name required' }, 400);

    if (action === 'presign') {
      const { R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
      if (!R2_ACCOUNT_ID || !R2_BUCKET_NAME || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
        return jsonResp({ error: '缺少 R2 签名环境变量' }, 500);
      }

      let body;
      try { body = await request.json(); }
      catch { return jsonResp({ error: '无效的 JSON body' }, 400); }

      const { files } = body;
      if (!Array.isArray(files) || !files.length) return jsonResp({ error: 'files 不能为空' }, 400);

      for (const f of files) {
        if (!isSafePath(f.name)) return jsonResp({ error: `不安全路径: ${f.name}` }, 400);
      }

      const urls = await pLimit(files, async (f) => {
        const normalizedFileName = f.name.normalize('NFC');
        const contentType = getMime(normalizedFileName);
        return {
          name:        normalizedFileName,
          contentType: contentType,
          url: await presignPut({
            accountId:   R2_ACCOUNT_ID,
            bucket:      R2_BUCKET_NAME,
            accessKeyId: R2_ACCESS_KEY_ID,
            secretKey:   R2_SECRET_ACCESS_KEY,
            r2Key:       `proto/${safeName.normalize('NFC')}/${normalizedFileName}`,
            contentType: contentType,
          }),
        };
      }, 10);

      if (!await kv.get(`proto:${safeName}:manifest`)) {
        await kv.put(`proto:${safeName}:manifest`, JSON.stringify({
          name: safeName, status: 'processing',
          uploadTime: Date.now(), fileCount: 0, files: [],
        }));
      }

      return jsonResp({ urls });
    }

    if (action === 'finish') {
      let body;
      try { body = await request.json(); }
      catch { return jsonResp({ error: '无效的 JSON body' }, 400); }

      const { files } = body;
      if (!Array.isArray(files)) return jsonResp({ error: 'files 必填' }, 400);

      // ── 清除该原型的Cloudflare边缘缓存，确保立即生效 ──
      context.waitUntil(clearProtoCache(safeName, request.url, files));

      await kv.put(`proto:${safeName}:manifest`, JSON.stringify({
        name: safeName, status: 'ready',
        fileCount: files.length, uploadTime: Date.now(), files,
      }));
      return jsonResp({ success: true });
    }

    return jsonResp({ error: `未知 action: ${action}` }, 400);
  }

  if (request.method === 'DELETE') {
    const name = url.searchParams.get('name');
    if (!name) return jsonResp({ error: 'name required' }, 400);

    // ── 0. 幂等性检查：如果已经在删除中，直接返回成功 ──
    const existingRaw = await kv.get(`proto:${name}:manifest`);
    if (existingRaw) {
      const existing = JSON.parse(existingRaw);
      if (existing.status === 'deleting') {
        return jsonResp({
          success: true,
          message: '该原型正在删除中，请稍候',
          status: 'deleting'
        });
      }
    }

    // ── 1. 读取当前manifest并立即锁定状态 ──
    const raw = existingRaw || await kv.get(`proto:${name}:manifest`);
    const manifest = raw ? JSON.parse(raw) : { name, status: 'unknown', uploadTime: Date.now() };

    // 立即标记为"删除中"并记录时间戳（用于超时检测）
    await kv.put(`proto:${name}:manifest`, JSON.stringify({
      ...manifest,
      status: 'deleting',
      lastActionTime: Date.now(),
      deleteStartedAt: Date.now(),  // 记录删除开始时间
    }));

    // ── 2. 立即清除边缘缓存（同步等待完成）──
    try {
      await clearProtoCache(name, request.url);
    } catch (cacheError) {
      console.error('[Delete] 缓存清除失败（不影响主流程）:', cacheError.message);
    }

    // ── 3. 异步执行R2文件删除（使用waitUntil保证执行）──
    context.waitUntil((async () => {
      const MAX_RETRIES = 3;  // 最大重试次数
      let retryCount = 0;

      while (retryCount < MAX_RETRIES) {
        try {
          let deletedCount = 0;
          let truncated = true;
          let cursor;

          // 分批列出并删除R2中的所有文件
          while (truncated) {
            const list = await r2.list({ prefix: `proto/${name}/`, cursor });
            if (list.objects && list.objects.length > 0) {
              await pLimit(list.objects, async (obj) => {
                try {
                  await r2.delete(obj.key);
                  deletedCount++;
                } catch (deleteErr) {
                  console.error(`[Delete] 删除文件失败 ${obj.key}:`, deleteErr.message);
                  // 单个文件失败不中断整体流程
                }
              }, 10);  // 10个并发
            }
            truncated = list.truncated;
            cursor = list.cursor;
          }

          console.log(`[Delete] 原型「${name}」R2文件删除完成，共删除 ${deletedCount} 个文件`);

          // ── 4. R2删除成功后，最后才删除KV manifest ──
          await kv.delete(`proto:${name}:manifest`);
          console.log(`[Delete] 原型「${name}」KV manifest已删除，删除流程完全结束`);

          return;  // 成功完成，退出重试循环

        } catch (e) {
          retryCount++;
          console.error(`[Delete] 原型「${name}」删除失败 (第${retryCount}/${MAX_RETRIES}次):`, e.message);

          if (retryCount >= MAX_RETRIES) {
            // 重试耗尽，标记为错误状态
            await kv.put(`proto:${name}:manifest`, JSON.stringify({
              ...manifest,
              status: 'error',
              error: `删除失败（已重试${MAX_RETRIES}次）: ${e.message}`,
              lastActionTime: Date.now(),
              failedAt: Date.now(),
              retryCount,
            }));
            console.error(`[Delete] 原型「${name}」删除最终失败，已标记为error状态`);
          } else {
            // 指数退避等待后重试
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
          }
        }
      }
    })());

    // ── 5. 立即返回响应给前端（不等待后台删除完成）──
    return jsonResp({
      success: true,
      message: '删除任务已启动，后台正在清理存储空间',
      estimatedTime: '3-5秒',  // 预估完成时间
      status: 'deleting'
    });
  }

  return new Response('Method Not Allowed', { status: 405 });
}

/**
 * 清除指定原型的Cloudflare边缘缓存（增强版）
 * @param {string} protoName - 原型名称
 * @param {string} baseUrl - 请求的基础URL
 * @param {Array<string>} [files] - 可选的文件列表，用于精确清除所有子资源缓存
 * @description 通过删除主页+所有子资源的缓存键，确保用户下次访问时能获取最新版本
 *              结合ETag机制，即使缓存未完全清除也能通过验证发现文件更新
 *              核心优化：支持部分文件更新场景，确保被修改的文件立即生效
 */
async function clearProtoCache(protoName, baseUrl, files = []) {
  try {
    const cache = caches.default;
    const urlObj = new URL(baseUrl);
    const encodedName = encodeURIComponent(protoName);

    // ── 1. 必须清除：原型主页和入口文件（保证入口点刷新）──
    const mainPageUrl = `${urlObj.origin}/proto/${encodedName}/`;
    await cache.delete(new Request(mainPageUrl));

    const indexUrl = `${urlObj.origin}/proto/${encodedName}/index.html`;
    await cache.delete(new Request(indexUrl));

    // ── 2. 优化清除：遍历文件清单，清除所有子资源的边缘缓存 ──
    // 这确保了"部分文件更新"场景下，被修改的文件能立即生效
    if (Array.isArray(files) && files.length > 0) {
      // 限制并发数，避免过多请求阻塞
      const BATCH_SIZE = 20;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(file => {
          const fileUrl = `${urlObj.origin}/proto/${encodedName}/${encodeURIComponent(file)}`;
          return cache.delete(new Request(fileUrl)).catch(() => {
            // 单个文件缓存删除失败不影响整体流程
          });
        }));
      }
    }

    console.log(`[Cache] 已清除原型「${protoName}」的缓存 (主页 + ${files.length || 0}个子资源)`);
  } catch (e) {
    console.error(`[Cache] 清除原型「${protoName}」缓存失败:`, e.message);
    // 缓存清除失败不影响主流程，ETag机制仍能保证数据一致性
  }
}