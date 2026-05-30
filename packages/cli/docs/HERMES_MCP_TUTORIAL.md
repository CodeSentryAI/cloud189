# Hermes + Cloud189 MCP 完整教程

本教程面向 Hermes Agent 用户，目标是在 Hermes 中安全使用天翼云盘作为 Agent 持久存储。

## 1. 前置条件

- Node.js 16+
- Hermes Agent 已安装
- 当前机器已登录 Cloud189 CLI
- 项目路径：`~/Projects/cloud189`

检查：

```bash
cd ~/Projects/cloud189
node --version
./cloud189 status --json
```

## 2. 安装依赖

```bash
npm install
npm test
```

期望测试通过：

```text
# pass 26
# fail 0
```

## 3. 初始化 Agent 安全写入根

```bash
./cloud189 init-agent hermes --json
./cloud189 agent-status --json
```

你会得到一个 `writeRootId`，例如：

```json
{
  "writeRoot": "/Agents/hermes",
  "writeRootId": "823511253988854581",
  "mode": "agent-safe"
}
```

## 4. 安装 MCP 到 Hermes

```bash
hermes mcp add cloud189 --command node --args /home/ubuntu/Projects/cloud189/src/mcp-server.js
hermes mcp list
hermes mcp test cloud189
```

如果 `hermes mcp add` 询问：

```text
Enable all 11 tools? [Y/n/select]:
```

输入 `Y`。

## 5. 重启 Hermes 或开启新会话

MCP 工具在新会话启动时发现。配置完成后需要新开 Hermes 会话。

## 6. 在 Hermes 中的推荐提示词

### 搜索文件

```text
请用 Cloud189 MCP 搜索“季度报告”，只列出候选文件名、remoteId、路径，不要下载多个，不要删除或覆盖任何文件。
```

### 下载并总结

```text
请下载 remoteId=xxx 的文件到本地临时目录，阅读后总结。不要移动、重命名或删除云盘文件。
```

### 上传结果

```text
请把本次分析结果写成 result.md，并用 Cloud189 的安全上传工具上传到 agent write root。如果同名冲突，停止并告诉我。
```

### 危险操作

```text
请为删除 remoteId=xxx 生成 PLAN，不要执行。说明要做什么、可能影响什么，然后让我 approve 或 deny。
```

## 7. MCP 工具行为说明

Hermes 中工具名会被 MCP server 名称加前缀，常见形式：

```text
mcp_cloud189_cloud189_status
mcp_cloud189_cloud189_search
mcp_cloud189_cloud189_download
mcp_cloud189_cloud189_upload_safe
mcp_cloud189_cloud189_sync_upload_safe
mcp_cloud189_cloud189_plan
```

你不需要记工具名，直接用自然语言要求 Hermes 使用 Cloud189 即可。

## 8. PLAN 模式规范

Agent 一旦遇到危险操作，必须进入 PLAN 模式。

危险操作包括：

- 删除远程文件/目录
- 移动远程文件/目录
- 重命名远程目录
- 原始上传，可能覆盖文件
- 原始同步，可能删除或覆盖远程文件

PLAN 必须包含：

```text
PLAN MODE
What this would do: ...
Potential impact: ...
Safe alternative: ...
User decision required: approve or deny
```

用户选择：

- `approve`：用户明确批准后，才可以考虑由用户手动执行原始 CLI 命令；默认仍建议人类自己执行。
- `deny`：取消，不做任何远程变更。

## 9. 常见问题

### Q1：为什么 Agent 不能直接删除？

因为云盘是持久共享存储，一旦删除可能不可逆或影响其他人。Agent 默认只能生成计划，不自动执行。

### Q2：为什么上传要用 upload-safe？

`upload-safe` 会检查同名文件冲突，发现冲突就停止，不覆盖远程文件。

### Q3：为什么 sync-upload-safe 不删除远程文件？

它是备份式安全同步，只上传新增/变更文件；远程发生变化时会停止并报告冲突。

### Q4：Hermes 看不到工具怎么办？

运行：

```bash
hermes mcp list
hermes mcp test cloud189
```

确认后新开会话。

## 10. 验证脚本摘要

可按下面思路做烟测：

```bash
ROOT_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.cloud189-agent/config.json','utf8')).agent.writeRootId)")
./cloud189 status --json --mode agent-safe
./cloud189 roots --json --mode agent-safe
./cloud189 list "$ROOT_ID" --json --mode agent-safe
./cloud189 plan rm 123 --json --mode agent-safe
./cloud189 rm 123 --mode agent-safe --json || true
```

期望：

- `plan` 返回 `planMode: true` 和 `requiresUserDecision: true`
- `rm` 返回 `DENIED_AGENT_SAFE`
