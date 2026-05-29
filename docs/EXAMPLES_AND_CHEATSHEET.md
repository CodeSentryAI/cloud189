# Cloud189 Agent Storage 教程与 Cheatsheet

## 0. 核心概念

- **remoteId**：天翼云盘文件/目录 ID。所有操作基于 ID，不基于挂载路径。
- **agent-safe**：Agent 默认安全模式。允许读、搜索、下载、安全上传；禁止删除、移动、重命名、覆盖。
- **writeRootId**：Agent 只能写入的远程目录 ID，通常是 `/Agents/hermes`。
- **PLAN 模式**：危险操作只生成 dry-run 计划，说明影响，等待用户 `approve` 或 `deny`。

## 1. 三个 Agent 常见最小使用例子

### 例子 A：资料检索 Agent

目标：在云盘里找资料并下载到本地分析。

```text
你是资料检索 Agent。
1. 调用 cloud189_status 确认登录。
2. 调用 cloud189_roots 找根目录。
3. 调用 cloud189_search 搜索关键词。
4. 如果多个候选，不要猜，列出来让用户选。
5. 调用 cloud189_download 下载选中的 remoteId 到本地工作目录。
6. 总结文件内容。
安全限制：不要删除、移动、重命名、覆盖任何云盘文件。
```

最小工具序列：

```text
cloud189_status -> cloud189_search -> cloud189_download
```

### 例子 B：报告生成 Agent

目标：生成报告并安全上传到 Agent 工作区。

```text
你是报告生成 Agent。
1. 调用 cloud189_status / cloud189_agent-status 确认 writeRootId。
2. 在本地生成 report.md。
3. 调用 cloud189_upload_safe 上传到 writeRootId。
4. 如果同名冲突，停止并提示用户，不要覆盖。
```

最小工具序列：

```text
cloud189_status -> 本地生成文件 -> cloud189_upload_safe
```

### 例子 C：批量产物同步 Agent

目标：把本地结果目录同步到云盘，不删除远程文件。

```text
你是批量产物同步 Agent。
1. 调用 cloud189_status 确认 writeRootId。
2. 将所有产物写入本地 ./results。
3. 调用 cloud189_sync_upload_safe ./results <writeRootId>。
4. 如果出现冲突，停止并报告冲突列表。
```

最小工具序列：

```text
本地写 ./results -> cloud189_sync_upload_safe
```

## 2. 三个用户命令使用例子

### 例子 1：让 Agent 查找并总结文件

```text
请用公司云盘搜索“项目周报”，列出候选文件，不要下载多个；我选中后再下载并总结。
```

Agent 应该：

1. `cloud189_search` 搜索关键词；
2. 列出文件名、remoteId、路径；
3. 等用户选择；
4. `cloud189_download` 下载单个文件；
5. 总结。

### 例子 2：让 Agent 保存结果到云盘

```text
把这次分析结果写成 Markdown，然后安全上传到我的 Cloud189 Agent 工作区。
```

Agent 应该：

1. 本地写 `result.md`；
2. `cloud189_status` 获取 writeRootId；
3. `cloud189_upload_safe result.md <writeRootId>`；
4. 如果冲突，报告冲突，不覆盖。

### 例子 3：让 Agent 准备删除文件但不执行

```text
帮我准备删除 remoteId=123456 的计划，先不要执行，告诉我会影响什么。
```

Agent 应该：

1. 调用 `cloud189_plan`；
2. 返回 PLAN 模式说明：
   - 要做什么；
   - 可能影响什么；
   - 用户可选 `approve` 或 `deny`；
3. 不执行删除。

## 3. CLI Cheatsheet

### 安装与测试

```bash
cd ~/Projects/cloud189
npm install
npm test
```

### 登录与状态

```bash
./cloud189 login-qr
./cloud189 status --json
./cloud189 quota --json
```

### 初始化 Agent 工作区

```bash
./cloud189 init-agent hermes --json
./cloud189 agent-status --json
```

### 查询

```bash
./cloud189 roots --json --mode agent-safe
./cloud189 list -11 --json --mode agent-safe
./cloud189 tree -11 --depth 2 --json --mode agent-safe
./cloud189 search "关键词" -11 --depth 3 --json --mode agent-safe
```

### 下载

```bash
./cloud189 download <remoteFileId> ./downloads/file.md --mode agent-safe
./cloud189 download <remoteFolderId> ./downloads/folder --dir --mode agent-safe
```

### 安全写入

```bash
./cloud189 upload-safe ./result.md <writeRootId> --mode agent-safe
./cloud189 mkdir-safe <writeRootId> results --mode agent-safe
./cloud189 sync-upload-safe ./results <writeRootId> --once --mode agent-safe
```

### 危险操作 PLAN 模式

```bash
./cloud189 plan rm <remoteId> --mode agent-safe
./cloud189 plan mv <remoteId> <targetFolderId> --mode agent-safe
./cloud189 plan rename-folder <folderId> <newName> --mode agent-safe
./cloud189 plan upload ./file.md <remoteFolderId> --mode agent-safe
./cloud189 plan sync-upload ./dir <remoteFolderId> --mode agent-safe
```

PLAN 输出必须包含：

```text
PLAN MODE
What this would do
Potential impact
Safe alternative
User decision required: approve or deny
```

### Hermes MCP

```bash
hermes mcp add cloud189 --command node --args /home/ubuntu/Projects/cloud189/src/mcp-server.js
hermes mcp list
hermes mcp test cloud189
```

新 Hermes 会话里可用工具名通常为：

```text
mcp_cloud189_cloud189_status
mcp_cloud189_cloud189_roots
mcp_cloud189_cloud189_list
mcp_cloud189_cloud189_tree
mcp_cloud189_cloud189_search
mcp_cloud189_cloud189_download
mcp_cloud189_cloud189_upload_safe
mcp_cloud189_cloud189_mkdir_safe
mcp_cloud189_cloud189_sync_upload_safe
mcp_cloud189_cloud189_plan
mcp_cloud189_cloud189_quota
```

## 4. Agent 决策表

| 用户意图 | Agent 应该用 | 是否需要确认 |
|---|---|---|
| 查找文件 | search/list/tree | 否 |
| 下载文件 | download | 一般否；多个候选时先让用户选 |
| 上传新结果 | upload_safe | 否；冲突时停止 |
| 同步结果目录 | sync_upload_safe | 否；冲突时停止 |
| 删除 | plan | 是，approve/deny |
| 移动 | plan | 是，approve/deny |
| 重命名 | plan | 是，approve/deny |
| 原始上传/可能覆盖 | plan 或 upload_safe | 覆盖风险必须确认 |
| 原始 sync-upload | plan 或 sync_upload_safe | 删除/覆盖风险必须确认 |

## 5. 完整教程：从 0 到 Hermes 使用

```bash
# 1. 进入项目
cd ~/Projects/cloud189

# 2. 安装依赖
npm install

# 3. 确认登录
./cloud189 status --json

# 4. 初始化 Agent 安全工作区
./cloud189 init-agent hermes --json
./cloud189 agent-status --json

# 5. 运行测试
npm test

# 6. 接入 Hermes MCP
hermes mcp add cloud189 --command node --args /home/ubuntu/Projects/cloud189/src/mcp-server.js
hermes mcp test cloud189

# 7. 新开 Hermes 会话，然后提问：
# “用 Cloud189 搜索 xxx，列出候选，不要删除或覆盖任何文件。”
```

## 6. 安全提醒

- 不要把 `~/.config/cloud189-cli/`、`~/.cloud189-agent/config.json`、token、cookie 提交到 git。
- Agent 看到多个同名文件时不能猜，必须列候选。
- `rm/mv/rename/upload/sync-upload` 这类危险操作必须 PLAN，不自动执行。
- `sync-upload-safe` 不删除远程文件；遇到冲突会停止。
