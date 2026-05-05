# 📦 Axurehub Open

一个基于 Cloudflare Pages + Functions + KV + R2 构建的超轻量级、全栈 Serverless 内容管理系统。专为托管 **Axure 原型**、**静态 HTML 页面** 以及 **外部链接导航** 而设计。

## 🌟 开发背景

由于 Axure 官方宣布自 **2025 年 10 月 14 日**起，Axure RP 8 及更早版本将不再支持直接发布原型至 Axure Cloud。为了解决旧版 Axure 用户托管原型难的问题，本项目提供了一个基于 Cloudflare 的免费、高效、可私有化部署的替代方案。不仅支持旧版原型上传，还提供了更灵活的权限控制与管理功能。

此外，本项目不仅仅适用于个人开发者，亦非常适合**小微创业团队快速构建属于自己的“产品资料中心”**。通过几分钟的部署，即可拥有一个私有、专业且完全自主可控的内部原型分享与静态资源管理平台。

> [!TIP]
> 这是一个完全运行在边缘计算节点的项目，无需传统服务器，性能极高且成本几乎为零。

## ✨ 核心功能

- **🚀 Axure 原型分流托管**
  - 支持直接上传 Axure 导出的完整文件夹。
  - **前端分片并发上传**：通过浏览器端处理路径剥离与分包，绕过 Cloudflare Worker 的上传大小限制。
  - **自动识别索引**：智能识别根目录下的 `index.html`。
- **📃 静态 HTML 管理**
  - 支持单文件 HTML 的上传与版本管理。
- **🔗 外部链接导航**
  - 内置可排序、可搜索的外部链接列表，并支持自定义 Emoji 图标。
- **🔐 双重安全控制**
  - **全站访问控制**：通过 Middleware 实现全站密码保护。
  - **管理后台安全**：独立的管理员密码验证。
- **🔍 实时检索**
  - 首页支持对所有原型、页面和链接进行毫秒级实时搜索。

## 🛠️ 技术栈

- **Frontend**: Vanilla JS (ES6+), CSS3 (Modern Glassmorphism Design).
- **Backend**: Cloudflare Pages Functions (Edge Runtime).
- **Storage**:
  - **KV**: 存储配置、项目元数据及链接清单。
  - **R2**: 存储原始静态文件（如原型中的图片、JS、CSS）。

## 🚀 快速部署

### 1. 克隆项目
```bash
# 克隆仓库
git clone git@github.com:SucreYang/Axurehub_Open.git
cd Axurehub_Open

```

### 2. 配置 wrangler.toml
确保根目录下的 `wrangler.toml` 已正确配置环境名和变量：

```toml
name = "staticpages"
pages_build_output_dir = "."

[vars]
ADMIN_PASSWORD = "你的管理员密码"
SITE_PASSWORD = "全站访问密码"
```

### 3. 创建资源绑定
在 Cloudflare 控制台创建以下资源：
- **KV 命名空间**：建议命名为 `RDS_STORE`。
- **R2 存储桶**：建议命名为 `RDS_FILES`。

并在 Pages 项目设置中完成绑定。

### 4. 发布上线
```bash
npx wrangler pages deploy .
```

## 🙏 致谢

特别感谢 **Cloudflare**。

本项目深度依赖 Cloudflare 提供的 Pages, Workers, KV 和 R2 免费计划。Cloudflare 强大的基础设施让个人开发者能够以极低的门槛构建稳定、高效的企业级应用。

---

*Design By Sinner 🌞*
