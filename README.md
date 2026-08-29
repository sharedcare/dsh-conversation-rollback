# conversation-rollback

Codex-style conversation rollback and "edit input, then re-generate" for the
DeepSeek Harness (DSH) Web UI.

> **这里是本地 fork。** 基线是 upstream v1.3.0
> （<https://github.com/sharedcare/dsh-conversation-rollback>），在它之上合并了
> `dsh-session-toc`——消息流右缘的 outline rail（会话目录）。下面 `## English` / `## 中文`
> 两节是 **upstream 原文**，只有安装方式与文件布局以紧接其后的这一节为准。

[English](#english) · [中文](#中文)

---

## 本 fork 的改动：outline rail（会话目录）

- 收起态：26px 窄条贴消息流右缘，每根刻度 = 你发过的一条提问，蓝点 = 当前视口所在轮次。
- 展开态（悬停 / 点 ☰ / `Ctrl/Cmd+Shift+O` 固定展开）：按轮次列出你发过的每条提问（含 `steering` 中途引导），点击即滚动到那一轮并闪一下高亮。
- 搜索：已加载窗口里没有命中就**自动向更早翻页**（`session.loadOlder()`，上限 40 页）直到匹配出现。
- 只收 `user` / `steering` 两类 Chat Node：空白输入、纯图片输入、工具行、注入上下文都不进目录。
- 定位基准是会话列（`[data-conversation-scroll]`）的几何而**不是窗口**，并用 ResizeObserver 跟随。`dsh-better-sidebar` 是 layout push（`#root { margin-right: var(--dsh-sidebar-width) }` + 固定面板盖住让出的那条带），DSH 自己的 details 列和侧卡底部面板同理——按窗口右缘定位必然被压住。rail 也不跟侧卡抢 z-index（它自己叠了 50/52/55/60，60 那层是它的下拉菜单）。
- pinned 状态存在 `localStorage['dsh-session-toc:pinned']`：沿用旧独立插件的 key，所以合并后原有的固定状态继续生效。

## 代码布局：`src/` 是手写的，`lib/` 是产物

模块加载器每个插件 entry 只服务一个文件（`/plugins/<id>/client.js`），factory 里的 `require`
只能解析共享模块表（react、react-dom/client、被 inject 的 `@deepseek-ai/*`），所以两个功能不可能留成两个 bundle。

| 文件 | 角色 |
| --- | --- |
| `src/client.rollback.js` | rollback 的 client bundle（上游原文 + 下面唯一一处 `FORK DEVIATION`） |
| `src/session-toc.js` | rail 的 factory body（外壳已剥掉） |
| `lib/client.js` | `pnpm run build` 的产物，**不要手改** |
| `lib/index.js` | 宿主半，与上游一致 |
| `tools/merge-client.mjs` | 拼接 / 反拼接 |
| `test/smoke.mjs` | 无浏览器冒烟测试（`pnpm test`） |

rail 被包进自己的 IIFE，这是硬性要求而不是风格问题：两半都声明 `function apply`，同一个 factory
作用域里裸拼接是**合法 JavaScript 且后声明者静默胜出**——rollback 的三处 slot 注册会直接消失，不抛任何错。
胶水只在尾部一处：`applyAll` 先跑 rollback，rail 包在 try/catch 里（rail 坏掉不能带崩 rollback）。

**与上游的唯一偏差**（`src/client.rollback.js` 里标了 `FORK DEVIATION`）：给它注入的 `<style>` 补上
`data-plugin` / `data-plugin-css`。`dsh-client-hmr` 热替换只回收 `style[data-plugin="<loader entry 名>"]`
（`dsh-client-hmr/lib/client.js:26-29`，逐字比对包名），不打标记每次重建都会多留一份旧 CSS。

**生成物为什么入库**：本包不声明 `prepare`。[发布规范](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)
写明 `github:` 安装拉的是**源码且不会运行 build**，作者要么提供一个自包含的 `prepare`（用户还得在 profile 的
`pnpm-workspace.yaml` 里写 `allowBuilds: { conversation-rollback: true }` 才允许跑，等于授权该包在你机器上执行代码），
要么直接分发产物。这里选后者：产物已提交，`github:` 安装零构建、零授权。所以 `.gitignore` 里明确写了不许忽略 `lib/`。

## 改代码

```bash
pnpm run build        # src/client.rollback.js + src/session-toc.js -> lib/client.js
pnpm test             # node --check + 无浏览器冒烟
pnpm run build:strip  # 反操作：lib/client.js -> src/client.rollback.js
```

`build` 不是 npm 生命周期脚本，装上本包不会被触发，只有开发者手动跑（会被触发的是 `prepare`，本包故意没有）。

merge 与 strip 是**精确互逆**的（已验证往返字节一致），生成段用 `/* == session-toc: BEGIN/END ... == */`
成对标记框住。所以 `lib/client.js` 被别处（上游）改过时，冲突可以整体挪出这个特性：

```bash
git merge <上游>                 # 冲突落在 lib/client.js
node tools/merge-client.mjs --strip   # 先摘掉生成段，冲突面缩回纯 rollback
# 在 src/client.rollback.js 上解决冲突（或直接取上游版本），然后：
pnpm run build && pnpm test
```

生成器在锚点（`exports.apply = apply;` 与 `exports.name = "conversation-rollback";` 的**整行**）缺失或不唯一时
报错退出，不会产出一个少一半功能的 bundle——整行锚点也保证不会把上游那行的缩进吞掉。`test/smoke.mjs`
既验 rail 的目录投影 / 向前翻页 / prepend 时的滚动补偿，也钉住合并本身（两半各自的注册都在、rollback 的
`user` 节点接管仍是 `priority: -1`、rail 抛错不会带崩 rollback、两份样式都带 HMR 可回收的归属标记）。

## 安装

**先确认你在用哪个 profile**——`desktop` 与 `web` 是两份独立组合（各自 `package.json` + `node_modules`），装错那份重启多少次都不会出现：

```powershell
# 端口取 $env:DSH_WEB_URL；命中 dsh-plugin-desktop 就说明是桌面 profile
(Invoke-WebRequest "http://127.0.0.1:<端口>/" -UseBasicParsing).Content | Select-String "dsh-plugin-desktop"
```

从 git 装（本包产物已提交，所以不需要 `allowBuilds` 授权；规范建议锁 commit，避免后续推送悄悄改变实际运行的代码）：

```powershell
dsh plugin --profile desktop add github:sharedcare/dsh-conversation-rollback#<sha>
```

本地 link 装（开发循环，改完刷新即可）：

```powershell
dsh plugin --profile desktop add link:C:/Users/<you>/Projects/<path>/conversation-rollback

# 之前单独装过 dsh-session-toc 的话务必卸掉，否则会挂出两条 rail
dsh plugin --profile desktop remove dsh-session-toc
```

改 `src/session-toc.js` 或 `src/client.rollback.js` 之后：`pnpm run build` 再刷新页面即可（宿主按请求读盘，改产物不需要重启；只有**新增/删除插件**才需要重启，因为 bundle 树在宿主启动时组合）。
判断有没有真挂上：`http://127.0.0.1:<端口>/plugins/conversation-rollback/client.js` 返 200 且内容里搜得到 `dsh-toc-root`。

桌面端 `dsh plugin` 背后有个安装恢复账本（`%APPDATA%\DSH Desktop\plugin-install-recovery\state.json`）：一次安装会停在
`phase: "awaiting-restart"`，下一次安装被 `another plugin install recovery transaction is pending` 挡下，而结清只能靠重启
Desktop（启动健康确认）或在恢复页回滚——没有 CLI 提交命令。需要绕开就给那一次调用换 WAL 位置（校验只要求文件名为
`state.json`、父目录名为 `plugin-install-recovery`，再往上的父级随意，见 `install-recovery-BD5jkQTK.js:121-129`）；
代价是这次安装不进应用的固定账本，不会被自动回滚。

---

## English

`conversation-rollback` is a DSH Web plugin that rewinds a conversation log to
a completed-turn boundary (Codex-style rewind) and can also edit a previous
user message and drive the model again from that point.

### Features

- **Edit input**: the entry point lives in the **user message bubble** action
  row, next to the copy button (✎). Clicking it opens an inline editor. On
  save, the host truncates the session log to just before that turn and pushes
  the edited text through the Agent inbox as a new message so the model
  regenerates the answer. The original reply and all later turns are deleted.
- **Rollback to here**: the entry point lives at the **bottom of an assistant
  answer**, next to the "branch in new chat" button (↩, with a second-click
  confirmation). It deletes every message after that turn and continues the
  conversation in place.
- The latest completed turn only shows **Edit input**; rollback is not offered
  there.
- Editing inputs that contain images is not supported yet.
- Actions are unavailable while the session is running, for subagent sessions,
  and when an unfinished turn exists.

> Both operations are destructive and cannot be undone: the original reply and
> all subsequent messages are permanently removed.

### Endpoint

`POST /api/conversation-rollback`

- Rollback: `{ "sessionId": "...", "atSeq": <any seq inside a completed turn> }`
- Edit: `{ "operation": "edit", "sessionId": "...", "turn": <turn number>, "text": "..." }`

### Requirements

- A working DSH installation with the `web` profile (`dsh web`).
- `pnpm` available on your `PATH` for `dsh plugin` management.
- `git` is required for the GitHub install and the local clone; `npm` is only
  required for the `npm pack` option.

### Installation

#### Install from GitHub (recommended)

```sh
dsh plugin --profile web add github:sharedcare/dsh-conversation-rollback
```

`dsh plugin` adds the package to the selected profile and automatically
registers the bundle patch layer. If you maintain a fork, replace `sharedcare`
with your GitHub username or use the full repository URL:

```sh
dsh plugin --profile web add "git+https://github.com/<owner>/dsh-conversation-rollback.git"
```

To pin an exact commit or tag, append `#<commit-or-tag>` to the full git URL.

#### Install from a local clone or tarball

For development, or if you prefer to build the package yourself:

```sh
git clone https://github.com/sharedcare/dsh-conversation-rollback.git
cd dsh-conversation-rollback
```

Option A — link this checkout directly into the profile (useful while
developing):

```sh
dsh plugin --profile web add "$PWD"
```

Option B — install a packed tarball:

```sh
npm pack
dsh plugin --profile web add ./conversation-rollback-<version>.tgz
```

Replace `<version>` with the version printed by `npm pack` (for example
`1.3.0`).

#### Activate and verify

1. Restart the DSH Web process so the host route and browser client are
   loaded.
2. If the profile's `cordis.patch.yml`
   (`$DSH_HOME/profiles/web/cordis.patch.yml`, default
   `~/.dsh/profiles/web/cordis.patch.yml`) still contains a hand-written
   `- insert: conversation-rollback` entry from an older setup, remove it —
   the installed bundle patch adds that entry automatically.
3. Verify the plugin is installed and loaded:

```sh
dsh plugin --profile web list
dsh web --dump-config | grep conversation-rollback
```

The dump should show the bundle section and an entry with
`id: conversation-rollback`.

### Uninstall

```sh
dsh plugin --profile web remove conversation-rollback
```

Restart the DSH Web process afterwards. To upgrade a git-based install, remove
it and run the `add` command again with the desired commit/tag.

### Files

- `cordis.patch.yml`: bundle patch; the installer inserts the plugin entry
  automatically.
- `lib/index.js`: host-side HTTP route, log truncation, live-session splicing,
  and Agent re-driving.
- `lib/client.js`: browser side; injects
  `conversation.chat.user-actions` (edit input) and registers
  `conversation.chat.assistant-actions` (rollback) through a low-priority
  shadow renderer without modifying any upstream package.

Host dependencies are provided by the DSH bundles themselves
(`@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-llm`); the plugin does not pull
in its own copies of those packages.

### Troubleshooting

- If "Save and regenerate" fails with `Cannot read properties of undefined
  (reading 'adapterDefaults')`, the live Agent still cached state from the
  truncated log. Restart the Web process so the current `lib/index.js` is
  loaded; this version resets the session request/context folds, derived
  message caches, `agent.requestHeaderLogged`, and runtime-context projections
  after splicing.
- If the buttons do not appear after installation, restart DSH Web, run the
  verification commands above, then hard-refresh the browser page.
- If `dsh plugin add` fails for a git-hosted fork that adds a
  `prepare`/`postinstall` script, follow the `allowBuilds` hint printed by
  pnpm and add the exact key to
  `$DSH_HOME/profiles/web/pnpm-workspace.yaml`, then re-run the install. The
  upstream package has no build scripts, so the standard GitHub install needs
  no extra approval.

---

## 中文

`conversation-rollback` 是一个 DSH Web 插件：既能把会话日志回退到某个已完成
回合的边界（Codex 风格），也能修改之前的用户输入，并从该位置重新驱动模型
生成。

### 功能

- **修改输入**：入口在**用户输入气泡**的操作行里，紧挨着复制按钮（✎）。
  点击后弹出内联编辑框；保存时宿主会把日志截断到该轮之前，再通过 Agent
  inbox 以新消息驱动模型重新生成。原回复和后续轮次都会被删除。
- **回退到此**：入口在**助手回答尾部**的操作行里，紧挨着「在新对话中
  分支」按钮（↩，需二次点击确认）。删除该轮之后的所有消息并原地继续。
- 最新的已完成轮次只显示「修改输入」，不显示回退。
- 包含图片的输入暂不支持修改。
- 会话运行中、子代理会话、存在未结束回合时不可操作。

> 两种操作都是不可撤销的破坏性操作：原回复及其后的所有消息会被永久删除。

### 端点

`POST /api/conversation-rollback`

- 回退：`{ "sessionId": "...", "atSeq": <完成轮次内任一 seq> }`
- 修改：`{ "operation": "edit", "sessionId": "...", "turn": <turn number>, "text": "..." }`

### 环境要求

- 可正常启动 `web` profile 的 DSH 环境（`dsh web`）。
- `PATH` 中有 `pnpm`，供 `dsh plugin` 管理插件使用。
- GitHub 安装和本地 clone 需要 `git`；只有使用 `npm pack` 方式时才需要
  `npm`。

### 安装

#### 从 GitHub 直接安装（推荐）

```sh
dsh plugin --profile web add github:sharedcare/dsh-conversation-rollback
```

`dsh plugin` 会把包加入所选 profile，并自动注册 bundle patch 层。如果你维护
自己的 fork，把 `sharedcare` 替换成你的 GitHub 用户名，或使用完整仓库地址：

```sh
dsh plugin --profile web add "git+https://github.com/<owner>/dsh-conversation-rollback.git"
```

如需固定到某个 commit 或 tag，在完整 git URL 末尾追加 `#<commit-or-tag>`。

#### 从本地克隆或 tarball 安装

适合二次开发，或希望自行打包的场景：

```sh
git clone https://github.com/sharedcare/dsh-conversation-rollback.git
cd dsh-conversation-rollback
```

方式 A：直接把当前 checkout 链接进 profile（适合边改边调试）：

```sh
dsh plugin --profile web add "$PWD"
```

方式 B：先打包，再安装生成的 tarball：

```sh
npm pack
dsh plugin --profile web add ./conversation-rollback-<version>.tgz
```

请把 `<version>` 替换为 `npm pack` 输出的版本号（例如 `1.3.0`）。

#### 启用并验证

1. 重启 DSH Web 进程，以加载 host 路由和浏览器端 client。
2. 若 profile 的 `cordis.patch.yml`（位于
   `$DSH_HOME/profiles/web/cordis.patch.yml`，默认是
   `~/.dsh/profiles/web/cordis.patch.yml`）里还留有旧方案的手工
   `- insert: conversation-rollback` 行，请删掉；安装后的 bundle patch 会
   自动插入该条目，手工行会和它重复。
3. 验证插件已安装并已加载：

```sh
dsh plugin --profile web list
dsh web --dump-config | grep conversation-rollback
```

配置 dump 中应出现 bundle 分节，以及 `id: conversation-rollback` 条目。

### 卸载

```sh
dsh plugin --profile web remove conversation-rollback
```

卸载后重启 DSH Web 进程。基于 git 安装时，如需升级，先执行上面的 remove，
再用目标 commit/tag 重新执行 `add`。

### 文件

- `cordis.patch.yml`：bundle patch，安装时自动插入插件行。
- `lib/index.js`：host 端 HTTP 路由、日志截断、live Session 拼接、Agent
  再驱动。
- `lib/client.js`：浏览器端通过低优先级 shadow renderer 注入
  `conversation.chat.user-actions`（修改输入）并注册
  `conversation.chat.assistant-actions`（回退），不修改任何上游包。

宿主依赖由 DSH 本体的 bundle 提供（`@deepseek-ai/dsh-session`、
`@deepseek-ai/dsh-llm`），插件不额外安装这些包。

### 故障排查

- 若「保存并重新生成」后出现 `Cannot read properties of undefined
  (reading 'adapterDefaults')`，说明 live Agent 仍缓存了被截断掉的
  request/header 状态。重启 Web 进程加载当前 `lib/index.js`；该版本会在
  拼接日志后重置 session 的 request/context fold、派生消息缓存、
  `agent.requestHeaderLogged` 和 runtime-context 投影。
- 安装后看不到按钮：重启 DSH Web，执行上面的验证命令，然后强制刷新浏览器
  页面。
- 如果你的 fork 新增了 `prepare`/`postinstall` 脚本，`dsh plugin add` 安装
  git 依赖时被 pnpm 拦截，请按 pnpm 打印的提示把对应 key 加入
  `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds`，再重新执行
  安装。上游包没有构建脚本，因此标准 GitHub 安装不需要额外放行。

## Repository

- <https://github.com/sharedcare/dsh-conversation-rollback>
- License: MIT
