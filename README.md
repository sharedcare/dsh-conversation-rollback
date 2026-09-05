# conversation-rollback

Codex-style conversation rollback, "edit input, then re-generate", and a
right-edge **session outline rail** for the DeepSeek Harness (DSH) Web UI.

- **v1.3.0** — rollback + edit-and-resend (the package's original scope).
- **v1.4.0** — merges the standalone `dsh-session-toc` outline rail into this
  package: one plugin, one client bundle, one install.

[English](#english) · [中文](#中文)

---

## English

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
- **Session outline rail** (new in 1.4.0): a right-edge table of contents for
  the conversation.
  - Collapsed: a 26px strip pinned to the right edge of the message column —
    one tick per prompt you sent; the highlighted (blue) tick is the turn
    currently under the top of the viewport.
  - Expanded (hover, click ☰ on the strip, or `Ctrl/Cmd+Shift+O` to pin):
    lists every prompt you sent as a row — with its turn number, timestamp and
    a `steer` marker for mid-run steering messages. Click a row (or a tick) to
    scroll that turn into view and flash-highlight it.
  - **Search**: filters the loaded window; if there is no hit it automatically
    pages backwards through history (`session.loadOlder()`, up to 40 pages)
    until a match loads or history ends.
  - Only `user` / `steering` chat nodes enter the outline: blank input,
    image-only input, tool rows and injected context are excluded.
  - The rail anchors to the **geometry of the conversation column**
    (`[data-conversation-scroll]`), not the window, and follows it with a
    `ResizeObserver` — so side panels that squeeze the column
    (dsh-better-sidebar, DSH's own details column, side-card bottom panels)
    never slide over it, and there is no z-index war.
  - Pinned state persists in `localStorage['dsh-session-toc:pinned']` (the
    same key the standalone plugin used, so existing pinned state survives).
- The latest completed turn only shows **Edit input**; rollback is not offered
  there.
- Editing inputs that contain images is not supported yet.
- Actions are unavailable while the session is running, for subagent sessions,
  and when an unfinished turn exists.

> Both rollback operations are destructive and cannot be undone: the original
> reply and all subsequent messages are permanently removed.

### Host endpoint

`POST /api/conversation-rollback`

- Rollback: `{ "sessionId": "...", "atSeq": <any seq inside a completed turn> }`
- Edit: `{ "operation": "edit", "sessionId": "...", "turn": <turn number>, "text": "..." }`

The outline rail is purely client-side and needs no endpoint.

### Requirements

- A DSH installation with the `web` profile (`dsh web`) **or** the DSH
  Desktop app (which uses the `desktop` profile).
- `pnpm` available on your `PATH` for `dsh plugin` management.
- `git` is required for the GitHub install and the local clone; `npm` is only
  required for the `npm pack` option.

### Installation

#### 1. Pick your profile first

`desktop` and `web` are two independent compositions, each with its own
`package.json` + `node_modules`. If the plugin never appears, the most likely
reason is that it was installed into the other one.

To detect the profile the running web process uses, fetch its root page and
look for the Desktop marker:

```sh
# bash / macOS / Linux — replace <port> with the URL from the env var DSH_WEB_URL
curl -s "http://127.0.0.1:<port>/" | grep -o dsh-plugin-desktop
```

```powershell
# PowerShell / Windows
(Invoke-WebRequest "http://127.0.0.1:<port>/" -UseBasicParsing).Content | Select-String "dsh-plugin-desktop"
```

A hit means the Desktop shell hosts this process — use `--profile desktop`.
No hit means a plain `dsh web` process — use `--profile web`.

#### 2. Install from GitHub (recommended)

```sh
dsh plugin --profile <web|desktop> add github:sharedcare/dsh-conversation-rollback#<sha-or-tag>
```

`dsh plugin` adds the package to the selected profile and automatically
registers the bundle patch layer. Pinning a commit or tag is recommended so a
later push cannot silently change the code that is actually running; the
`v1.4.0` tag points at commit `5de8731`.

For a fork, replace `sharedcare` with your GitHub username or use the full
repository URL, with the pin appended to the git URL:

```sh
dsh plugin --profile <web|desktop> add "git+https://github.com/<owner>/dsh-conversation-rollback.git#<sha-or-tag>"
```

The merged bundle is committed and the package declares **no** `prepare`
script, so a `github:` install pulls the source and runs no build — no pnpm
`allowBuilds` authorization is needed.

#### 3. Install from a local clone or tarball

For development, or if you prefer to build the package yourself:

```sh
git clone https://github.com/sharedcare/dsh-conversation-rollback.git
cd dsh-conversation-rollback
```

Option A — link this checkout directly into the profile (useful while
developing; edits take effect after `pnpm run build` + a page refresh):

```sh
dsh plugin --profile <web|desktop> add link:$PWD
```

Option B — install a packed tarball:

```sh
npm pack
dsh plugin --profile <web|desktop> add ./conversation-rollback-1.4.0.tgz
```

(The filename is whatever `npm pack` prints — `1.4.0` for the current
version.)

#### 4. Migrating from 1.3.0 (or from the standalone session-toc plugin)

- If you previously installed the standalone **`dsh-session-toc`** plugin,
  remove it, or the merged package will mount two rails:

  ```sh
  dsh plugin --profile <web|desktop> remove dsh-session-toc
  ```

- With a **web** profile installed before the bundle-patch era, the profile's
  `cordis.patch.yml` (`$DSH_HOME/profiles/web/cordis.patch.yml`, default
  `~/.dsh/profiles/web/cordis.patch.yml`) may still contain a hand-written
  `- insert: conversation-rollback` row. Remove it — the installed bundle
  patch adds that entry automatically and the manual row duplicates it.
- Upgrading a git/link-based install: `remove` it, then `add` again with the
  desired commit/tag as in step 2.

#### 5. Activate and verify

1. Restart the DSH Web process / Desktop so the host route and browser client
   are loaded. (Only adding or removing plugins needs a restart; re-served
   `lib/client.js` is read per request.)
2. Web profile:

   ```sh
   dsh plugin --profile web list
   dsh web --dump-config | grep conversation-rollback
   ```

   The dump should show the bundle section and an entry with
   `id: conversation-rollback`.

3. Desktop app (no `--dump-config` on the shell — probe the served bundle
   directly; `dsh-toc-root` is the rail's stylesheet root class):

   ```sh
   curl -s "http://127.0.0.1:<port>/plugins/conversation-rollback/client.js" | grep -c dsh-toc-root
   ```

   Expect `200` and a non-zero match count. If the rail is missing but the
   rollback buttons work, the client bundle is stale — hard-refresh the
   browser page and retry.

### Uninstall

```sh
dsh plugin --profile <web|desktop> remove conversation-rollback
```

Restart the DSH Web process / Desktop afterwards.

### Repository layout and build

The module loader serves **one** client bundle per plugin entry
(`/plugins/<id>/client.js`), and inside a factory `require` only resolves the
shared module table (react, react-dom/client, the injected `@deepseek-ai/*`).
Two features therefore cannot stay two bundles — `src/` holds the hand-written
inputs and `lib/` the committed product.

| File | Role |
| --- | --- |
| `src/client.rollback.js` | rollback client bundle (upstream code + the single `FORK DEVIATION` marker below) |
| `src/session-toc.js` | outline rail factory body (bundle shell stripped) |
| `lib/client.js` | product of `pnpm run build` — **do not edit by hand** |
| `lib/index.js` | host side; identical to the 1.3.0 host code |
| `tools/merge-client.mjs` | splice / unsplice tool |
| `test/smoke.mjs` | browserless smoke test (`pnpm test`) |

```sh
pnpm run build        # src/client.rollback.js + src/session-toc.js -> lib/client.js
pnpm test             # node --check lib/*.js + browserless smoke test
pnpm run build:strip  # inverse: lib/client.js -> src/client.rollback.js
```

Why the rail is wrapped in its own IIFE: both halves declare `function apply`
in the factory scope. A plain concatenation is legal JavaScript where the
**later** declaration silently wins — the rollback half would stop registering
its three slot entries without raising an error. `build` is not an npm
lifecycle script, so installing the package never triggers it (only
`prepare` would, and this package deliberately has none).

Why the product is committed: `github:` installs fetch the source and do not
build it, so either the package provides a self-contained `prepare` (users
would have to approve it via `allowBuilds` in the profile
`pnpm-workspace.yaml` — effectively authorizing code execution) or it ships
built output. This package ships built output: zero build, zero approval,
`.gitignore` explicitly refuses to ignore `lib/`.

The one deviation from upstream is marked in
`src/client.rollback.js` (`FORK DEVIATION`): the injected `<style>` carries
`data-plugin` / `data-plugin-css` — the only attributes `dsh-client-hmr`
matches to reclaim a plugin's stylesheet on a hot swap. Without them every
reload leaves an extra stale copy of the rollback CSS.

Keeping up with `lib/client.js` edits made elsewhere: `merge` and `strip` are
exact inverses (round trip is byte-identical), and the generated regions are
framed by `/* == session-toc: BEGIN/END ... == */` markers, so a conflict can
be moved out of the way first:

```sh
git merge <upstream>                          # conflict lands in lib/client.js
node tools/merge-client.mjs --strip           # peel the generated regions off
# resolve the conflict in src/client.rollback.js (or take upstream's version)
pnpm run build && pnpm test
```

The generator fails loudly when the whole-line anchors
(`exports.apply = apply;` / `exports.name = "conversation-rollback";`) are
missing or duplicated, rather than producing a half-featured bundle, and the
line anchors guarantee the upstream file's indentation survives. `smoke.mjs`
pins the merge itself: both halves register, the rollback `user`-node takeover
keeps `priority: -1`, the rail's projection and backwards paging work, a
prepend keeps the reader's viewport offset, a throwing rail cannot take
rollback down, and both stylesheets carry the HMR-reclaimable ownership
marker.

### Desktop: install-recovery ledger note

The Desktop host keeps an install-recovery ledger at
`<DSH Desktop data>/plugin-install-recovery/state.json` (macOS:
`~/Library/Application Support/DSH Desktop/...`, Windows:
`%APPDATA%\DSH Desktop\...`). One installation stops at
`phase: "awaiting-restart"`; the next one is then blocked with
`another plugin install recovery transaction is pending`, and the only way to
clear it is to restart Desktop (startup health check) or roll the transaction
back in the recovery page — there is no CLI commit command.

If you need to get past that without a restart, point that one call at a
different WAL location: the validation only requires the file to be named
`state.json` inside a directory named `plugin-install-recovery` (the
parent's parent is arbitrary, see `install-recovery-BD5jkQTK.js:121-129`).
The trade-off: this installation does not enter the app's regular ledger and
will not be rolled back automatically.

### Troubleshooting

- If "Save and regenerate" fails with `Cannot read properties of undefined
  (reading 'adapterDefaults')`, the live Agent still cached state from the
  truncated log. Restart the Web process so the current `lib/index.js` is
  loaded; this version resets the session request/context folds, derived
  message caches, `agent.requestHeaderLogged`, and runtime-context projections
  after splicing.
- If the buttons do not appear after installation, restart DSH Web, run the
  verification commands above, then hard-refresh the browser page.
- If the rail is missing and `/plugins/conversation-rollback/client.js`
  serves 200 but contains no `dsh-toc-root`, the served bundle predates
  1.4.0 — reinstall the new version and restart.
- If the rail fails to mount, a red diagnostic bar (`dsh-toc-bar`) appears at
  the bottom-left of the page with the error message; the rollback half stays
  usable (the rail mounts in its own try/catch).
- If `dsh plugin add` fails for a git-hosted fork that adds a
  `prepare`/`postinstall` script, follow the `allowBuilds` hint printed by
  pnpm and add the exact key to the profile's `pnpm-workspace.yaml`, then
  re-run the install. The upstream package has no build scripts, so the
  standard GitHub install needs no extra approval.

---

## 中文

### 功能

- **修改输入**：入口在**用户输入气泡**的操作行里，紧挨着复制按钮（✎）。
  点击后弹出内联编辑框；保存时宿主会把日志截断到该轮之前，再通过 Agent
  inbox 以新消息驱动模型重新生成。原回复和后续轮次都会被删除。
- **回退到此**：入口在**助手回答尾部**的操作行里，紧挨着「在新对话中
  分支」按钮（↩，需二次点击确认）。删除该轮之后的所有消息并原地继续。
- **会话目录（outline rail，1.4.0 新增）**：消息流右缘的会话目录。
  - 收起态：26px 窄条贴消息列右缘，每根刻度 = 你发过的一条提问；蓝色刻度
    表示当前视口顶部所在的轮次。
  - 展开态（悬停 / 点窄条上的 ☰ / `Ctrl/Cmd+Shift+O` 固定展开）：按轮次
    列出你发过的每条提问——含轮次号、时间戳，中途引导（steer）消息带
    `steer` 标记。点击行（或刻度）即滚动到那一轮并闪一下高亮。
  - **搜索**：在已加载窗口内过滤；没有命中就**自动向更早翻页**
    （`session.loadOlder()`，上限 40 页）直到匹配出现或历史到底。
  - 只收 `user` / `steering` 两类 Chat Node：空白输入、纯图片输入、工具行、
    注入上下文都不进目录。
  - 定位基准是**会话列**（`[data-conversation-scroll]`）的几何而不是窗口，
    并用 `ResizeObserver` 跟随——被侧栏/详情列/侧卡底部面板压缩列宽时
    rail 跟着移动而不被压住，也不需要抢 z-index。
  - 固定状态存在 `localStorage['dsh-session-toc:pinned']`（沿用旧独立插件
    的 key，合并前固定过的状态继续生效）。
- 最新的已完成轮次只显示「修改输入」，不显示回退。
- 包含图片的输入暂不支持修改。
- 会话运行中、子代理会话、存在未结束回合时不可操作。

> 两种回退操作都是不可撤销的破坏性操作：原回复及其后的所有消息会被永久
> 删除。

### 端点

`POST /api/conversation-rollback`

- 回退：`{ "sessionId": "...", "atSeq": <完成轮次内任一 seq> }`
- 修改：`{ "operation": "edit", "sessionId": "...", "turn": <turn number>, "text": "..." }`

会话目录是纯客户端功能，不需要端点。

### 环境要求

- 可正常启动 `web` profile 的 DSH 环境（`dsh web`），**或** DSH Desktop
  应用（使用 `desktop` profile）。
- `PATH` 中有 `pnpm`，供 `dsh plugin` 管理插件使用。
- GitHub 安装和本地 clone 需要 `git`；只有使用 `npm pack` 方式时才需要
  `npm`。

### 安装

#### 1. 先确认你在用哪个 profile

`desktop` 与 `web` 是两份独立组合，各有自己的 `package.json` +
`node_modules`。装完不生效，最常见的原因就是把插件装进了另一份。

探测当前运行进程使用的 profile——抓首页找 Desktop 标记：

```sh
# bash / macOS / Linux — <port> 替换成 DSH_WEB_URL 里的端口
curl -s "http://127.0.0.1:<port>/" | grep -o dsh-plugin-desktop
```

```powershell
# PowerShell / Windows
(Invoke-WebRequest "http://127.0.0.1:<port>/" -UseBasicParsing).Content | Select-String "dsh-plugin-desktop"
```

命中说明该进程由 Desktop 外壳承载——用 `--profile desktop`；没有命中说明
是普通的 `dsh web` 进程——用 `--profile web`。

#### 2. 从 GitHub 安装（推荐）

```sh
dsh plugin --profile <web|desktop> add github:sharedcare/dsh-conversation-rollback#<sha-or-tag>
```

`dsh plugin` 会把包加入所选 profile，并自动注册 bundle patch 层。建议锁
commit 或 tag，避免后续推送悄悄改变实际运行的代码；`v1.4.0` tag 指向
commit `5de8731`。

维护自己的 fork 时，把 `sharedcare` 换成你的 GitHub 用户名，或使用完整
仓库地址（锁点追加在 git URL 末尾）：

```sh
dsh plugin --profile <web|desktop> add "git+https://github.com/<owner>/dsh-conversation-rollback.git#<sha-or-tag>"
```

合并产物已提交，且本包**不声明** `prepare` 脚本，所以 `github:` 安装拉取
源码但不会运行构建——不需要 pnpm `allowBuilds` 授权。

#### 3. 从本地克隆或 tarball 安装

适合二次开发，或希望自行打包的场景：

```sh
git clone https://github.com/sharedcare/dsh-conversation-rollback.git
cd dsh-conversation-rollback
```

方式 A：直接把当前 checkout 链接进 profile（适合边改边调试；改动后执行
`pnpm run build` 再刷新页面即可）：

```sh
dsh plugin --profile <web|desktop> add link:$PWD
```

方式 B：先打包，再安装生成的 tarball：

```sh
npm pack
dsh plugin --profile <web|desktop> add ./conversation-rollback-1.4.0.tgz
```

（文件名以 `npm pack` 输出为准——当前版本是 `1.4.0`。）

#### 4. 从 1.3.0 升级（或从独立 session-toc 插件迁移）

- 之前单独装过**独立版 `dsh-session-toc`** 的话务必先卸掉，否则合并包会
  挂出两条目录 rail：

  ```sh
  dsh plugin --profile <web|desktop> remove dsh-session-toc
  ```

- **web** profile 若在 bundle patch 时代之前装过：profile 的
  `cordis.patch.yml`（`$DSH_HOME/profiles/web/cordis.patch.yml`，默认
  `~/.dsh/profiles/web/cordis.patch.yml`）里可能还留有旧方案的手工
  `- insert: conversation-rollback` 行——删掉；安装后的 bundle patch 会
  自动插入该条目，手工行会和它重复。
- 基于 git/link 安装的升级：先 `remove`，再按第 2 步用目标 commit/tag
  重新 `add`。

#### 5. 启用并验证

1. 重启 DSH Web 进程 / Desktop，以加载 host 路由和浏览器端 client。（只有
   **新增/删除插件**需要重启；`lib/client.js` 是宿主按请求读盘的，改产物
   不需要重启。）
2. web profile：

   ```sh
   dsh plugin --profile web list
   dsh web --dump-config | grep conversation-rollback
   ```

   配置 dump 中应出现 bundle 分节，以及 `id: conversation-rollback` 条目。

3. Desktop（外壳没有 `--dump-config`——直接探测被服务的 bundle；
   `dsh-toc-root` 是 rail 样式表的根类名）：

   ```sh
   curl -s "http://127.0.0.1:<port>/plugins/conversation-rollback/client.js" | grep -c dsh-toc-root
   ```

   期望返回 `200` 且匹配数非 0。若回退按钮正常但 rail 缺失，说明客户端
   bundle 是旧版——强制刷新浏览器页面后再试。

### 卸载

```sh
dsh plugin --profile <web|desktop> remove conversation-rollback
```

卸载后重启 DSH Web 进程 / Desktop。

### 代码布局与构建

模块加载器每个插件 entry 只服务**一个**客户端 bundle
（`/plugins/<id>/client.js`），factory 里的 `require` 只能解析共享模块表
（react、react-dom/client、被 inject 的 `@deepseek-ai/*`），所以两个功能
不可能留成两个 bundle——`src/` 是手写源码，`lib/` 是已提交的产物。

| 文件 | 角色 |
| --- | --- |
| `src/client.rollback.js` | rollback 的 client bundle（上游原文 + 下方唯一一处 `FORK DEVIATION`） |
| `src/session-toc.js` | rail 的 factory body（外壳已剥掉） |
| `lib/client.js` | `pnpm run build` 的产物，**不要手改** |
| `lib/index.js` | 宿主半，与 1.3.0 的宿主代码一致 |
| `tools/merge-client.mjs` | 拼接 / 反拼接工具 |
| `test/smoke.mjs` | 无浏览器冒烟测试（`pnpm test`） |

```sh
pnpm run build        # src/client.rollback.js + src/session-toc.js -> lib/client.js
pnpm test             # node --check lib/*.js + 无浏览器冒烟
pnpm run build:strip  # 反操作：lib/client.js -> src/client.rollback.js
```

rail 为什么要包进自己的 IIFE：两半都在 factory 作用域里声明
`function apply`，裸拼接是**合法 JavaScript 且后声明者静默胜出**——
rollback 的三处 slot 注册会直接消失，不抛任何错。`build` 不是 npm 生命
周期脚本，安装本包不会触发（会被触发的只有 `prepare`，本包故意没有）。

产物为什么要入库：`github:` 安装拉的是源码且**不会运行 build**，作者要么
提供自包含的 `prepare`（用户还得在 profile 的
`pnpm-workspace.yaml` 里写 `allowBuilds: { conversation-rollback: true }`
才允许跑——等于授权该包在用户机器上执行代码），要么直接分发产物。这里选
后者：零构建、零授权，`.gitignore` 明确写了不许忽略 `lib/`。

与上游的唯一偏差在 `src/client.rollback.js`（标了 `FORK DEVIATION`）：给它
注入的 `<style>` 补上 `data-plugin` / `data-plugin-css`——`dsh-client-hmr`
热替换只回收这两个属性匹配的样式表，不打标记每次重建都会多留一份旧 CSS。

`lib/client.js` 被别处改过时：merge 与 strip 是**精确互逆**（往返字节一致），
生成段用 `/* == session-toc: BEGIN/END ... == */` 成对标记框住，冲突可以
整体挪出这个特性：

```sh
git merge <上游>                        # 冲突落在 lib/client.js
node tools/merge-client.mjs --strip     # 先摘掉生成段，冲突面缩回纯 rollback
# 在 src/client.rollback.js 上解决冲突（或直接取上游版本），然后：
pnpm run build && pnpm test
```

生成器在锚点（`exports.apply = apply;` 与
`exports.name = "conversation-rollback";` 的**整行**）缺失或不唯一时报错
退出，不会产出一个少一半功能的 bundle；整行锚点也保证不会吞掉上游那行的
缩进。`smoke.mjs` 钉住合并本身：两半各自的注册都在、rollback 的 `user`
节点接管仍是 `priority: -1`、rail 的目录投影与向前翻页正常、prepend 时
保持读者视口位置、rail 抛错不拖垮 rollback、两份样式都带 HMR 可回收的
归属标记。

### 桌面端：安装恢复账本注意事项

Desktop 宿主维护一个安装恢复账本，位置在
`<DSH Desktop 数据目录>/plugin-install-recovery/state.json`（macOS：
`~/Library/Application Support/DSH Desktop/...`；Windows：
`%APPDATA%\DSH Desktop\...`）。一次安装会停在
`phase: "awaiting-restart"`，下一次安装会被
`another plugin install recovery transaction is pending` 挡下，而结清只能
靠重启 Desktop（启动健康确认）或在恢复页回滚——没有 CLI 提交命令。

需要绕开而不重启时，可以给那一次调用换 WAL 位置：校验只要求文件名为
`state.json`、父目录名为 `plugin-install-recovery`，再往上的父级随意（见
`install-recovery-BD5jkQTK.js:121-129`）。代价是这次安装不进应用的固定
账本，不会被自动回滚。

### 故障排查

- 若「保存并重新生成」后出现 `Cannot read properties of undefined
  (reading 'adapterDefaults')`，说明 live Agent 仍缓存了被截断掉的
  request/header 状态。重启 Web 进程加载当前 `lib/index.js`；该版本会在
  拼接日志后重置 session 的 request/context fold、派生消息缓存、
  `agent.requestHeaderLogged` 和 runtime-context 投影。
- 安装后看不到按钮：重启 DSH Web，执行上面的验证命令，然后强制刷新浏览器
  页面。
- rail 缺失但 `/plugins/conversation-rollback/client.js` 返回 200 且内容里
  搜不到 `dsh-toc-root`：服务的是 1.4.0 之前的旧 bundle——重新安装新版本
  并重启。
- rail 挂载失败时页面左下角会出现红色诊断条（`dsh-toc-bar`）显示错误
  信息；rollback 半身仍可用（rail 在自己的 try/catch 中挂载）。
- 如果你的 fork 新增了 `prepare`/`postinstall` 脚本，`dsh plugin add` 安装
  git 依赖时被 pnpm 拦截，请按 pnpm 打印的提示把对应 key 加入 profile 的
  `pnpm-workspace.yaml` 的 `allowBuilds`，再重新执行安装。上游包没有构建
  脚本，因此标准 GitHub 安装不需要额外放行。

## Repository

- <https://github.com/sharedcare/dsh-conversation-rollback>
- License: MIT
