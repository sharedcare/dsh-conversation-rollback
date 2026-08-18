# conversation-rollback

Codex 风格的会话回退与「修改输入并重新生成」，DSH Web 专用本地插件。

## 功能

- **修改输入**：入口在**用户输入气泡**的操作行里，紧挨着复制按钮（✎）。
  点击后弹出内联编辑框，保存时宿主会把日志截断到该轮之前，再通过 Agent
  inbox 以新消息驱动模型重新生成；原回复和后续轮次都会被删除。
- **回退到此**：入口在**助手回答尾部**的操作行里，紧挨着「在新对话中
  分支」按钮（↩，需二次点击确认）。删除该轮之后的所有消息并原地继续。
- 最新的已完成轮次只显示「修改输入」，不显示回退。
- 包含图片的输入暂不支持修改。
- 会话运行中、子代理会话、存在未结束回合时不可操作。

## 端点

`POST /api/conversation-rollback`

- 回退：`{ "sessionId": "...", "atSeq": <完成轮次内任一 seq> }`
- 修改：`{ "operation": "edit", "sessionId": "...", "turn": <turn number>, "text": "..." }`

## 安装

打包：

```sh
cd /tmp
npm pack ~/.dsh/profiles/node_modules/conversation-rollback
# 得到 conversation-rollback-1.3.0.tgz
```

安装到 web profile：

```sh
dsh plugin --profile web add /path/to/conversation-rollback-1.3.0.tgz
```

安装后重启 DSH Web 进程。若当前 profile 的 `cordis.patch.yml` 里还留有手工的
`- insert: conversation-rollback` 行，请删掉，避免和 bundle patch 重复。

## 文件

- `cordis.patch.yml`：bundle patch，安装时自动插入插件行。
- `lib/index.js`：host 端 HTTP 路由、日志截断、live Session 拼接、Agent 再驱动。
- `lib/client.js`：浏览器端通过低优先级 shadow renderer 注入
  `conversation.chat.user-actions`（修改输入）并注册
  `conversation.chat.assistant-actions`（回退），不修改任何上游包。

宿主依赖由 DSH 本体的 bundle 提供（`@deepseek-ai/dsh-session`、
`@deepseek-ai/dsh-llm`），插件不额外安装这些包。

## 故障排查

- 若「保存并重新生成」后出现 `Cannot read properties of undefined
  (reading 'adapterDefaults')`，说明 live Agent 仍缓存了被截断掉的
  request/header 状态。重启 Web 进程加载最新 `lib/index.js`；该版本会在
  拼接日志后重置 session 的 request/context fold、派生消息缓存、
  `agent.requestHeaderLogged` 和 runtime-context 投影。
