/**
 * 404错误页面模块
 * 提供美观的404错误页面HTML内容
 * 可独立维护和修改，不影响业务逻辑代码
 */

// 导入404页面的HTML模板（通过import引入静态文件）
const fs = await import('fs:./404.html');

/**
 * 获取404错误页面的HTML内容
 * @param {string} protoName - 原型名称（用于动态显示）
 * @returns {string} 完整的HTML页面代码
 */
export function get404PageHtml(protoName) {
  // 从导入的文件获取基础HTML模板
  let html = fs.default || '';

  // 如果无法导入文件，返回内嵌的简化版本
  if (!html) {
    return getFallback404Page(protoName);
  }

  // 动态替换原型名称占位符
  html = html.replace('id="proto-name-display">--</span>', `id="proto-name-display">${escapeHtml(protoName)}</span>`);

  // 更新页面标题
  html = html.replace('<title>404 - 页面未找到</title>', `<title>404 - 原型「${escapeHtml(protoName)}」未找到</title>`);

  return html;
}

/**
 * HTML转义函数，防止XSS攻击
 * @param {string} str - 需要转义的字符串
 * @returns {string} 转义后的安全字符串
 */
function escapeHtml(str) {
  const escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;'
  };
  return String(str).replace(/[&<>"'`=/]/g, char => escapeMap[char]);
}

/**
 * 备用的404页面（当外部文件无法加载时使用）
 * @param {string} protoName - 原型名称
 * @returns {string} 简化的HTML页面
 */
function getFallback404Page(protoName) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - 页面未找到</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #e2e8f0;
    }
    .container { text-align: center; padding: 3rem; max-width: 600px; }
    .error-code {
      font-size: 8rem; font-weight: 900;
      background: linear-gradient(135deg, #ef4444, #f97316, #eab308);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      line-height: 1; margin-bottom: 1rem;
    }
    .error-title { font-size: 1.8rem; font-weight: 700; color: #f1f5f9; margin-bottom: 1rem; }
    .error-message { font-size: 1.05rem; color: #94a3b8; line-height: 1.6; margin-bottom: 1rem; }
    .proto-name {
      display: inline-block; background: rgba(59,130,246,0.15); color: #60a5fa;
      padding: 0.3rem 0.8rem; border-radius: 6px; font-family: monospace;
      border: 1px solid rgba(59,130,246,0.3);
    }
    .actions { display: flex; gap: 1rem; justify-content: center; margin-top: 2rem; }
    .btn {
      padding: 0.75rem 1.8rem; border-radius: 8px; font-size: 0.95rem;
      font-weight: 600; text-decoration: none; transition: all 0.25s;
      cursor: pointer; border: none; display: inline-flex; align-items: center; gap: 0.5rem;
    }
    .btn-primary { background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; }
    .btn-primary:hover { transform: translateY(-2px); }
    .btn-secondary { background: rgba(51,65,85,0.8); color: #e2e8f0; border: 1px solid rgba(71,85,105,0.6); }
    .btn-secondary:hover { background: rgba(71,85,105,0.9); transform: translateY(-2px); }
    .footer-text { margin-top: 2rem; font-size: 0.8rem; color: #64748b; }
    @media (max-width:640px) { .error-code{font-size:5rem} .container{padding:2rem 1.5rem} .actions{flex-direction:column} .btn{width:100%;justify-content:center} }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-code">404</div>
    <h1 class="error-title">哎呀，页面不见了</h1>
    <p class="error-message">
      您访问的原型 <span class="proto-name">${escapeHtml(protoName)}</span> 当前无法加载
    </p>
    <p class="error-message" style="margin-top:1rem;">
      可能原因：该原型已被删除、正在上传中、或路径不正确
    </p>
    <div class="actions">
      <a href="/" class="btn btn-primary">🏠 返回首页</a>
      <button onclick="location.reload()" class="btn btn-secondary">🔄 刷新页面</button>
    </div>
    <p class="footer-text">如果问题持续存在，请联系管理员获取帮助</p>
  </div>
</body>
</html>`;
}
