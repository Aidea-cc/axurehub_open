// functions/_middleware.js

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // --- ⚙️ 配置区域 ---
  const SITE_PASSWORD = context.env.SITE_PASSWORD;
  const COOKIE_NAME = "site_access_token";
  const COOKIE_VALUE = "authorized_user";
  const MAX_AGE = 60 * 60 * 24 * 30; // 30天

  const PAGE_TITLE = "INTERNAL DISTRIBUTION ONLY";
  const TIP_TEXT = "请联系管理员获取访问密码";
  // ----------------

  // 放行：管理后台（有自己的密码逻辑）
  if (url.pathname.startsWith('/admin/') || url.pathname === '/admin') {
    return next();
  }

  // 放行：API 接口（各自验证管理员权限）
  if (url.pathname.startsWith('/api/')) {
    return next();
  }

  // 放行：原型文件动态路由（KV提供内容）
  if (url.pathname.startsWith('/proto/')) {
    return next();
  }

  // 放行：静态页面动态路由（KV提供内容）
  if (url.pathname.startsWith('/pages/')) {
    return next();
  }

  // 1. 检查 Cookie
  const cookieString = request.headers.get("Cookie") || "";
  if (cookieString.includes(`${COOKIE_NAME}=${COOKIE_VALUE}`)) {
    return next();
  }

  // 2. 处理密码提交
  if (request.method === "POST") {
    const formData = await request.formData();
    const inputPassword = formData.get("password");

    if (inputPassword === SITE_PASSWORD) {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": url.pathname,
          "Set-Cookie": `${COOKIE_NAME}=${COOKIE_VALUE}; Path=/; Max-Age=${MAX_AGE}; Secure; HttpOnly; SameSite=Strict`
        }
      });
    } else {
      return new Response(getHtml(PAGE_TITLE, TIP_TEXT, "密码错误，请重试"), {
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      });
    }
  }

  // 3. 默认显示登录页
  return new Response(getHtml(PAGE_TITLE, TIP_TEXT), {
    headers: { "Content-Type": "text/html;charset=UTF-8" }
  });
}

function getHtml(title, tip, error = null) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: url('https://images.unsplash.com/photo-1717810135803-830d2c4e0d43');
      background-repeat: no-repeat;
      background-size: cover;
      background-position: center;
    }
    .card {
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(10px);
      padding: 2.5rem;
      border-radius: 16px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      width: 100%;
      max-width: 400px;
      text-align: center;
      transition: transform 0.3s ease;
    }
    .card:hover { transform: translateY(-5px); }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #1a202c; }
    p { color: #718096; margin-bottom: 2rem; font-size: 0.95rem; }
    .input-group { margin-bottom: 1.5rem; text-align: left; }
    input {
      width: 100%;
      padding: 0.8rem 1rem;
      border: 2px solid #e2e8f0;
      border-radius: 8px;
      font-size: 1rem;
      transition: border-color 0.2s;
      outline: none;
    }
    input:focus { border-color: #667eea; }
    button {
      width: 100%;
      padding: 0.8rem;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover { background: #5a67d8; }
    .error {
      color: #e53e3e;
      background: #fff5f5;
      padding: 0.5rem;
      border-radius: 6px;
      margin-bottom: 1rem;
      font-size: 0.9rem;
      border: 1px solid #feb2b2;
    }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 3rem; margin-bottom: 1rem;">🔒</div>
    <h1>${title}</h1>
    <p>${tip}</p>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="POST">
      <div class="input-group">
        <input type="password" name="password" placeholder="输入访问密码..." required autofocus>
      </div>
      <button type="submit">授权登录</button>
    </form>
  </div>
</body>
</html>`;
}