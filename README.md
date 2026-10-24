# dsh-deepseek-web-embed · DeepSeek 网页版

**把 chat.deepseek.com 原样嵌进 DeepSeek Harness 的 Web 界面**：侧边栏点一下，主区域就是官网页面，登录一次长期有效，不必再切浏览器标签。

<p>
  <a href="https://www.npmjs.com/package/dsh-deepseek-web-embed"><img alt="npm" src="https://img.shields.io/npm/v/dsh-deepseek-web-embed?color=4d6bfe"></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-2f6f4f">
  <img alt="dsh" src="https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.2-6b5bd2">
</p>

## 安装

GUI → 设置 → 插件 → **添加插件**，粘贴下面任意一个 spec：

| 渠道 | spec |
| --- | --- |
| GitHub（推荐，跟 main 走） | `github:howIdobetter/dsh-deepseek-web-embed` |
| npm | `dsh-deepseek-web-embed` |
| 本地目录 | `/absolute/path/to/dsh-deepseek-web` |

装完刷新一次 Web 界面，左侧图标栏出现 **DeepSeek**。命令行等价形式：`dsh plugin --profile <name> add <spec>`。

## 为什么不直接 iframe

官网响应头带 `content-security-policy: frame-ancestors 'none'`，普通 iframe 会被浏览器直接拒；它的接口又是绝对路径 `/api/v0/...`，就算绕过框架限制，接口请求也会打到 Harness 自己的域名上。所以插件在 **本机回环** 起了一个反向代理（默认 `localhost:45789`，同时监听 `127.0.0.1` 与 `[::1]`），让整站在独立站点上跑起来：

| 卡点 | 处理 |
| --- | --- |
| `frame-ancestors 'none'` | 文档由代理重发，去掉 CSP / XFO 头 |
| 接口 `/api/v0/*` | 同源命中代理，原样流式转发到 `chat.deepseek.com`（含 SSE、上传、PoW 校验头） |
| 静态资源在 `fe-static.deepseek.com`，CORS 只给 deepseek 域 | HTML 与 bundle 的 publicPath 都改写到本机 `/__cdn/`，脚本变同源加载，顺带去掉 `crossorigin` / `integrity` |
| 接口对匿名请求回 429（WAF） | 转发页面自己发出的 `authorization`，WAF 放行（实测：带 token 200、不带 429） |
| Cookie 串味 | 站点 cookie 只留在代理侧 jar，不回传浏览器；也绝不把 Harness 自己的 cookie 发出去 |
| 存储隔离 | 代理用 `localhost`，界面在 `127.0.0.1` → 不同站点，localStorage 互不相干 |
| 进程隔离 | 站点不同 → Chromium 给 iframe 单独渲染进程；它崩只黑一块，不拖垮 Harness |
| 浏览器状态污染 | 响应头走白名单，绝不透传 `strict-transport-security`（会把 loopback 钉成强制 HTTPS）或 `alt-svc` |
| 代理自身异常 | 全链路 `try/catch`、`clientError`/`upgrade` 兜底、请求体有上限缓冲，异常只回 500 |

## 使用

1. 点侧边栏 **DeepSeek**，先看到一张启动卡片（此时还没加载官网），点「进入 DeepSeek」。
2. 首次在里面登录（手机号 / 邮箱）。之后每次打开都是登录态。
3. 登录被验证码卡住时用「导入登录态」：
   - 浏览器打开 chat.deepseek.com（保持已登录）→ F12 → Console → `copy(localStorage.userToken)`
   - 回到面板 → 右上角 `⋯` → 导入登录态 → 粘贴 → 写入并重载

聊天、深度思考、联网搜索、文件上传、会话历史、分享链接都是官网原样行为——插件不重写任何请求体。

## 界面

只有一条 2.4rem 的细头栏（名称 + 两个图标按钮），下面是满铺的官网页面；按下 `⋯` 才展开「复制地址 / 导入登录态」。所有颜色、圆角、字号都取 Harness 的主题 token，跟随明暗、皮肤与缩放。

## 配置

`cordis.patch.yml` 里的 `port` 是首选端口（被占用时自动向上找 24 个）。端口固定有意义：官网登录态存在这个站点 origin 的 localStorage 里，换端口等于换设备。

## 端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/dsh-deepseek-web/endpoint` | 回报代理地址与端口（走 connection 的信任围栏） |
| POST | `/api/dsh-deepseek-web/session` | 写入导入的登录态（一次性，下次文档加载时注入） |

代理自身另有 `GET /__dsw/health` 与 `GET /__dsw/log`（本机诊断）。

## 已知边界

- 只绑本机回环（`127.0.0.1` + `[::1]`），不对外网开放。
- 语音朗读的 `wss://…/api/v0/chat/tts/` 未代理（返回 501），其它功能不依赖它。
- 站点的图形验证码（shumei / hcaptcha / Turnstile）按域名发放令牌，代理域下可能被拒；登录态导入是兜底路径。
- 每次请求都记在 `~/.dsh/deepseek-web/requests.log`（含失败响应体），排查问题时看它。

## 目录

```
dsh-deepseek-web/
├── index.js            # Host：回环反代（HTML 改写、API 透传、cookie jar、诊断日志）
├── client.js           # 浏览器：侧边栏图标 + 细头栏 + 整页 iframe + 导入登录态弹窗
├── cordis.patch.yml    # bundle 行（port）
├── locale/{zh,en}.json # 插件管理器里的标题与描述
└── icon.svg
```

## License

MIT © 2026 howIdobetter
