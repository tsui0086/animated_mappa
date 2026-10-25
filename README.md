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
- 导出：项目 JSON、本地剪贴板 JSON、浏览器 WebM 预览导出；
- 响应式布局：桌面、平板和移动端；
- Cloudflare Pages / Workers 配置文件。

## 本地预览

```bash
cd /home/seingeur/lavoro/elite830/maps
python3 -m http.server 4173
```

然后打开：`http://localhost:4173/`

也可以使用任意静态文件服务器。不要直接使用 `file://` 打开，因为 Leaflet 地图瓦片和浏览器模块安全策略可能会阻止部分功能。

## Cloudflare Pages

项目根目录就是本目录，构建命令为空，输出目录为 `.`。使用 Wrangler：

```bash
npx wrangler pages deploy /home/seingeur/lavoro/elite830/maps --project-name route-atlas-pages
```

`wrangler.toml` 已包含 `pages_build_output_dir = "."`。

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

## 参考与设计取舍

参考网站的工作流包含 Route、Map、Signs、Overlays、Camera、Preview & export 六个编辑步骤。本项目保留这一信息架构，并将项目数据改为本地优先，避免为 Cloudflare 部署额外维护数据库和上传 API。
