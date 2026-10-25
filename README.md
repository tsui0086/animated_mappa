# Route Atlas

一个可部署到 Cloudflare Pages 或 Cloudflare Workers 的静态动画地图编辑器。它参考了 Map Animator 一类的“场景 → 路线 → 地图 → 标记 → 覆盖层 → 摄像机 → 预览导出”工作流，但不依赖后端项目数据服务。

## 已实现

- 多场景编辑：新增场景、切换场景、项目名称和本地自动保存；
- 路线编辑：地图点击绘制、撤销、清空、GPX 导入；
- 路线样式：实线、虚线、点线、颜色、粗细、描边、柔光；
- 移动符号：车辆、火车、飞机、船或无符号；
- 地图样式：Paper、Terrain、Night；
- 航点标记：标题、注释、绑定路线点；
- 叠加层：场景标题、路线副标题、品牌标记；
- 摄像机：跟随/固定、跟随平移、缩放偏置、缓动选择；
- 时间线：播放、暂停、拖动、速度切换；
- 导出：项目 JSON、本地剪贴板 JSON、浏览器 WebM 预览导出、浏览器本地 MP4 转码；
- 访问保护：Cloudflare Pages Functions 登录页、HTTP-only 会话 Cookie、全站未登录重定向；
- 响应式布局：桌面、平板和移动端；
- 手机适配：移动端优先显示地图预览，编辑面板下移；顶部步骤导航和地图工具支持触摸横向滚动，导出按钮和表单控件适配窄屏；
- Cloudflare Pages / Workers 配置文件。

## 本地预览

```bash
cd /home/seingeur/lavoro/elite830/maps
python3 -m http.server 4173
```

然后打开：`http://localhost:4173/`

也可以使用任意静态文件服务器。不要直接使用 `file://` 打开，因为 Leaflet 地图瓦片和浏览器模块安全策略可能会阻止部分功能。

## Cloudflare Pages

### GitHub 集成（推荐）

如果 Cloudflare Pages 已连接 GitHub/GitLab，不要把 `npx wrangler pages deploy` 设置为 Pages 的构建或部署命令。Git 集成会在提交后自动完成部署；在 Pages 控制台使用以下设置即可：

- 如果仓库根目录就是本项目：Root directory 留空，Build output directory 填 `.`；
- 如果本项目位于仓库的 `maps/` 子目录：Root directory 填 `maps`，Build output directory 填 `.`；
- Build command 可以留空，或者使用 `exit 0`；
- 不设置自定义 Deploy command。

Cloudflare Pages 会把 `login.html` canonicalize 为无扩展名的 `/login`。因此登录入口使用 `/login`，Pages Functions 必须同时将 `/login` 和 `/login.html` 视为公开路径；不要添加会覆盖登录页的全站 `_redirects` SPA fallback。

当前项目没有构建步骤。Git 集成部署不需要 `CLOUDFLARE_API_TOKEN`、D1、R2 或 KV；访问保护只需要 Pages Secrets。

在 Cloudflare Pages 项目的 **Settings → Variables and Secrets** 中配置生产环境 Secret：

```text
ROUTE_ATLAS_PASSWORD=你的工作区密码
ROUTE_ATLAS_SESSION_SECRET=一段随机的长字符串
```

不要把这两个值写入 GitHub。未配置 Secret 时，Pages Functions 会拒绝访问主应用，而不会退化成无密码模式。

### Wrangler Direct Upload（可选）

只有在不使用 Git 自动部署，或从本地/CI 直接上传时，才使用 Wrangler：

```bash
npx wrangler pages deploy /home/seingeur/lavoro/elite830/maps --project-name route-atlas-pages
```

`wrangler.toml` 已包含 `pages_build_output_dir = "."`。

Direct Upload 需要一个具有 Account → Cloudflare Pages → Edit 权限的 API Token，并通过 `CLOUDFLARE_API_TOKEN` 提供给 Wrangler。不要把 Token 写入仓库或提交到 GitHub。

## Cloudflare Workers Static Assets

```bash
npx wrangler deploy --config /home/seingeur/lavoro/elite830/maps/worker.wrangler.toml
```

Worker 仅负责把静态资源交给 Cloudflare Assets；应用本身不需要 API Key 或数据库。

## 数据和版权提示

- 在线地图底图使用公开瓦片服务，并在地图中保留提供方署名；生产环境如有更高流量需求，应替换为自己有权限使用的瓦片服务。
- GPX 只在浏览器本地解析，不上传服务器。
- 路线项目只写入浏览器 `localStorage`，JSON 由用户主动下载。
- 外部地图瓦片属于第三方服务，当前版本未内置离线底图。
- MP4 导出通过浏览器内的 FFmpeg WebAssembly 完成，首次使用会下载约 31 MB 的编码器；编码速度取决于设备性能，导出期间请保持页面打开。
- 导出画面会等待路线范围内的地图瓦片全部进入 Canvas 导出缓存后再开始录制，避免只加载前几行瓦片而导致剩余画面变成黄色背景。
- `index.html` 使用带版本号的 `app.js` URL，避免 Cloudflare 浏览器缓存继续执行旧的 MP4 导出逻辑；部署新版本后如仍看到旧行为，请强制刷新一次。
- 登录保护由 Pages Functions 执行，不把工作区密码放进前端 JavaScript；登录成功后使用 `HttpOnly`、`Secure`、`SameSite=Lax` Cookie 保存七天会话。

## 参考与设计取舍

参考网站的工作流包含 Route、Map、Signs、Overlays、Camera、Preview & export 六个编辑步骤。本项目保留这一信息架构，并将项目数据改为本地优先，避免为 Cloudflare 部署额外维护数据库和上传 API。登录会话采用签名 Cookie，因此当前仍不需要 D1、R2 或 KV。
