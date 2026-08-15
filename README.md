# @pd90506/dsh-web-search

DSH 插件：向 `ctx.web` seam 注册 **Brave Search** 与 **Tavily** 两个网页搜索提供方（与内置的
`@deepseek-ai/dsh-web-search-deepseek` 平级），并在 **设置 → Plugins → Plugin configuration** 中新增
**「Brave & Tavily / Brave 与 Tavily」** 配置卡片：默认搜索提供方下拉框 + Brave / Tavily 的 API key 管理。

## 结构

```
├── cordis.patch.yml   bundle 层：insert 本插件（`dsh plugin add` 自动追加到 profile bundles）
├── src/index.js       宿主插件入口：name/inject/Config/apply —— 注册两个提供方 + 挂载设置 RPC 服务
├── src/brave.js       BraveSearchProvider —— GET {baseURL}/web/search（X-Subscription-Token）
├── src/tavily.js      TavilySearchProvider —— POST {baseURL}/search（Authorization: Bearer），answer 映射为 content
├── src/shared.js      取消/错误/凭证解析的共享辅助（与 deepseek 提供方同一约定）
├── src/host-gateway.js webSearch 服务：getState / setDefaultProvider 两个 strict typert 端点
├── src/client/        配置卡片源码（React，注册 settings.plugin.item 槽位）
├── build.mjs          把客户端打成 __ModuleLoader__ 工厂格式 → lib/client.js（prepare 同款，git 安装时自动执行）
└── test/smoke.mjs     真实 API 冒烟测试（读取本目录 .env）
```

提供方 id：`brave`、`tavily`（内置为 `deepseek-official`）。

## 工作原理（与内置提供方对齐的事实）

- **注册**：`ctx.web.registerSearchProvider(provider)`；seam 自己负责 `maxResults` 截断。
- **凭证链**：字面 `apiKey` → credentials 服务（`$DSH_HOME/.credentials.yaml`，0600，热加载）→
  启动环境（进程环境 > 启动目录 `.env` > `$DSH_HOME/.env`）。缺钥报 `WEB_PROVIDER_CREDENTIAL_MISSING`。
- **提供方选择**：`web` 条目配置 `searchProvider`（环境变量 `DSH_WEB_SEARCH_PROVIDER` 为兜底），
  无兜底链——每次搜索只走一个提供方。base 层默认 `deepseek-official`，装上本插件不会改变现状。
- **默认提供方下拉框**：写入 profile 的 `~/.dsh/profiles/web/cordis.patch.yml`
  （`- id: web` 的 `config.searchProvider`，合并写入、保留注释与其他条目）；该文件被 HMR 监听，
  约一秒内生效、跨重启持久。无需手改。
- **设置页 RPC**：`webSearch/*` 通过共享 typert 注册表（`ctx.typert.register`）登记 strict 端点——
  运行时注册，不受插件内嵌 `@deepseek-ai/*` 副本与宿主模块实例差异影响（`@Remote` 装饰器路径
  受此影响，勿用）。key 的读写只走官方 `credentials.*` RPC（本机回环限定），key 永不回显。

## 安装（web profile，从 GitHub）

```bash
# 固定到某个 commit，避免后续推送悄悄改变安装期执行的代码
dsh plugin --profile web add github:pd90506/dsh-web-search#<commit-sha>
```

Git 安装拉的是**源码而非构建产物**（`lib/` 不入库），包内的 `prepare` 脚本（`node build.mjs`）
会在安装后现场构建 `lib/client.js`，无需 monorepo 等开发期上下文。pnpm ≥10 默认拒绝运行 git
依赖的构建脚本，因此第一次 `add` 会失败并提示：把本包加入该 profile 的 `pnpm-workspace.yaml`
白名单后重跑 `add`。注意白名单的键不是裸包名，而是 pnpm 打印的 `包名@tarball-URL` 整条
（commit sha 已钉在 URL 里）：

```yaml
# ~/.dsh/profiles/web/pnpm-workspace.yaml
allowBuilds:
  "@pd90506/dsh-web-search@https://codeload.github.com/pd90506/dsh-web-search/tar.gz/<commit-sha>": true
```

注意：该白名单等于**允许此包在安装期在你的机器上执行代码**（不受 agent 沙箱约束）——只为你信任的
包开启，并固定 commit（`#<sha>`）。

装完**重启 dsh 一次**（客户端模块清单只在启动时扫描）。之后默认提供方 / key 在
设置 → Plugins → Plugin configuration 的「Brave & Tavily」卡片即改即生效。

## 本地开发（link: 安装）

```bash
npm install                        # prepare 会自动构建 lib/client.js
dsh plugin --profile web add /Users/panda/repo/Agents/dsh-plugins/dsh-web-search
# pnpm 以 link: 引用本目录；dsh.bundle.patch 声明使 bundle 层自动生效，无需手改 profile
```

- 改 `src/client/` → `npm run build` → 浏览器热更新（client-hmr）；
- 改 `src/*.js`（宿主侧）→ 重启 dsh 生效（dsh 默认不开模块级 HMR）；
- 对外发布：`git push` 后使用者按上节从 GitHub 安装（git 安装不跟随本地改动）。

## 配置（可选）

bundle 层 insert 的 `config: {}` 可覆盖（写在 profile `cordis.patch.yml` 的同名条目里，
patch 语义为整段替换 config）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `braveApiKey` / `tavilyApiKey` | — | 字面 key（secret，不推荐落盘） |
| `braveApiKeyEnv` / `tavilyApiKeyEnv` | `BRAVE_API_KEY` / `TAVILY_API_KEY` | 凭证引用名 |
| `braveBaseURL` | `https://api.search.brave.com/res/v1` | API 根 |
| `tavilyBaseURL` | `https://api.tavily.com` | API 根 |
| `tavilySearchDepth` | `basic` | `basic`/`advanced` |
| `tavilyIncludeAnswer` | `true` | answer 映射为结果 `content` |
| `maxResults` | `10` | 请求未带 `maxResults` 时的上限（Brave 封顶 20） |

## 冒烟测试

```bash
npm install
echo 'BRAVE_API_KEY=...' >> .env
echo 'TAVILY_API_KEY=...' >> .env
npm test          # 先验证缺钥路径，再对每个提供方各发一发真实搜索
```

## 注意

- `.credentials.yaml` 只能**合并**写入（保留既有条目，权限 0600）——整体覆盖会清掉别的 key
  （这正是本插件第一次事故的根因）。日常请用设置页或 Models 页写 key。
- `webSearch/*` 端点走 typert 网关（trusted-host 域），仅暴露提供方状态与默认提供方写入，
  不触碰任何 key 本体。
