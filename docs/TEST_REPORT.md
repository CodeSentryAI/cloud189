# Cloud189 Agent Safe Storage 测试报告

记录时间：2026-05-29
项目路径：`~/Projects/cloud189`

## 1. 测试目标

验证 Cloud189 CLI + MCP Server 是否适合接入 Hermes Agent：

- Hermes 可发现并连接 MCP server。
- MCP 默认运行在 `agent-safe` 模式。
- 查询、搜索、下载、安全上传、安全同步功能可用。
- 删除、移动、重命名、原始上传、原始同步等危险操作不会直接暴露给 Agent。
- 危险操作进入 PLAN 模式，说明“做什么、影响什么”，并要求用户 `approve` 或 `deny`。

## 2. 安装与配置验证

### 2.1 npm 依赖

```bash
cd ~/Projects/cloud189
npm install
npm test
```

结果：

```text
# tests 26
# pass 26
# fail 0
```

### 2.2 Hermes MCP 配置

执行：

```bash
hermes mcp add cloud189 --command node --args /home/ubuntu/Projects/cloud189/src/mcp-server.js
hermes mcp list
hermes mcp test cloud189
```

结果：Hermes 成功发现 11 个工具：

```text
cloud189_status
cloud189_roots
cloud189_list
cloud189_tree
cloud189_search
cloud189_download
cloud189_upload_safe
cloud189_mkdir_safe
cloud189_sync_upload_safe
cloud189_plan
cloud189_quota
```

## 3. Agent 初始化验证

执行：

```bash
./cloud189 init-agent hermes --json
./cloud189 agent-status --json
```

结果：

```json
{
  "ok": true,
  "agent": "hermes",
  "writeRoot": "/Agents/hermes",
  "writeRootId": "823511253988854581",
  "mode": "agent-safe"
}
```

状态确认：

```json
{
  "ok": true,
  "login": "ok",
  "mode": "agent-safe",
  "canSearch": true,
  "canDownload": true,
  "canUploadSafe": true,
  "canDelete": false,
  "canMove": false,
  "canOverwrite": false
}
```

备注：初始化过程中 SDK 曾向 stderr 打印一次 HTTP 400 日志，但命令返回码为 0，最终目录与配置均成功生成。推测是创建已存在目录时 SDK 内部打印错误，不影响结果；后续可优化为静默复用。

## 4. CLI 功能烟测

烟测命令覆盖：

- `status --json --mode agent-safe`
- `roots --json --mode agent-safe`
- `list <writeRootId> --json --mode agent-safe`
- `quota --json --mode agent-safe`
- `plan rm 123 --json --mode agent-safe`
- `rm 123 --mode agent-safe --json`（应被拒绝）
- `mkdir-safe <writeRootId> <folder> --json --mode agent-safe`
- `upload-safe <localFile> <writeRootId> --json --mode agent-safe`
- `search <keyword> <writeRootId> --depth 2 --json --mode agent-safe`
- `sync-upload-safe <localDir> <writeRootId> --once --json --mode agent-safe`
- `download <remoteFileId> <localPath> --mode agent-safe`

结果：全部通过。

关键输出：

```text
PLAN_OK
DENIED_OK
UPLOAD_OK
SEARCH_ITEMS=1
SYNC_UPLOADED=1
DOWNLOAD_OK
SMOKE_OK
```

## 5. MCP 直连烟测

使用 MCP SDK 直接连接 `src/mcp-server.js` 并调用：

- `cloud189_status`
- `cloud189_roots`
- `cloud189_plan`
- `cloud189_list`

结果：

```text
cloud189_status: OK
cloud189_roots: OK
cloud189_plan: OK
cloud189_list: OK
MCP_DIRECT_SMOKE_OK
```

## 6. PLAN 模式验证

新增 `test/plan-mode.test.js`，验证：

1. `planPayload('rm', ['123'])` 返回：
   - `planMode: true`
   - `requiresUserDecision: true`
   - `summary` 含 `PLAN MODE`
   - `intent` 说明要删除什么
   - `potentialImpact` 说明潜在影响
   - `userChoices: ['approve', 'deny']`
2. 原始 `upload` 的 PLAN 说明覆盖风险，并建议 `upload-safe`。
3. 不支持的 plan command 抛出 `UNKNOWN_PLAN`。

## 7. 结论

当前版本符合预期：

- Hermes 已安装 Cloud189 MCP server。
- Agent 默认只能使用安全工具。
- 危险操作进入 PLAN 模式，不会自动执行。
- 已有测试与实际登录环境烟测均通过。

## 8. 建议后续优化

- `init-agent` 对“已存在目录”场景做更干净的错误处理，避免 SDK 打印 HTTP 400 噪声。
- 增加 `download` 本地路径沙箱配置，避免 Agent 下载到不期望的位置。
- 为 MCP 工具增加更详细的 schema 描述，提示 Agent 在危险操作时只调用 `cloud189_plan`。
