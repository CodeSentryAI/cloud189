# Cloud189 Agent Safe Storage 用户说明

Cloud189 Agent Safe Storage 是一个面向 AI Agent 的天翼云盘安全存储层。它提供 CLI 和 MCP Server 两种入口，让 Agent 能搜索、下载、上传结果，但默认不能删除、移动、重命名或覆盖云盘文件。

## 一句话理解

> Agent 可以读云盘、下载文件、把结果安全上传到自己的工作区；危险操作只生成计划，必须由用户确认。

## 1. 安装

```bash
cd ~/Projects/cloud189
npm install
```

可选：安装全局命令。

```bash
./install.sh
# 或
npm link
```

## 2. 登录

如果已经登录，可直接检查：

```bash
./cloud189 status --json
```

如果未登录，推荐二维码登录：

```bash
./cloud189 login-qr
./cloud189 status
```

也支持：

```bash
./cloud189 login --username <账号> --password <密码>
./cloud189 login-sso --cookie <SSON_COOKIE>
```

Token 默认保存在：

```text
~/.config/cloud189-cli/
```

## 3. 初始化 Agent 安全工作区

```bash
./cloud189 init-agent hermes --json
./cloud189 agent-status --json
```

初始化会在云盘创建或复用：

```text
/Agents/hermes/
├── inbox/
├── results/
├── workspace/
└── logs/
```

并把 write root ID 写到：

```text
~/.cloud189-agent/config.json
```

## 4. Hermes MCP 安装

```bash
hermes mcp add cloud189 --command node --args /home/ubuntu/Projects/cloud189/src/mcp-server.js
hermes mcp test cloud189
```

然后重启 Hermes 或开启新会话。新会话里会出现 `mcp_cloud189_*` 工具。

## 5. MCP 暴露的安全工具

| 工具 | 作用 |
|---|---|
| `cloud189_status` | 查看登录、状态、write root |
| `cloud189_roots` | 查看内置根目录 ID |
| `cloud189_list` | 列出远程目录 |
| `cloud189_tree` | 递归列出远程目录 |
| `cloud189_search` | 搜索远程文件 |
| `cloud189_download` | 下载远程文件/目录 |
| `cloud189_upload_safe` | 安全上传，不覆盖同名文件 |
| `cloud189_mkdir_safe` | 在 agent write root 下创建文件夹 |
| `cloud189_sync_upload_safe` | 安全同步上传，不删除远程文件，冲突即停止 |
| `cloud189_plan` | 为危险操作生成计划 |
| `cloud189_quota` | 查看容量 |

MCP 不暴露原始 `rm/mv/rename/upload/sync-upload/sync-download`。

## 6. 安全模式规则

默认 `agent-safe` 模式允许：

```text
status, quota, roots, list, tree, search, download,
mkdir-safe, upload-safe, sync-upload-safe, plan,
init-agent, agent-status
```

禁止：

```text
rm, mv, rename-folder, raw upload, raw sync-upload, sync-download
```

危险操作应先生成 PLAN：

```bash
./cloud189 plan rm <remoteId> --mode agent-safe
```

PLAN 必须说明：

1. 准备做什么；
2. 可能影响什么；
3. 用户可选择 `approve` 或 `deny`。

## 7. 常见工作流

### 查找并下载文件

```bash
./cloud189 roots --json --mode agent-safe
./cloud189 search "关键词" -11 --depth 3 --json --mode agent-safe
./cloud189 download <remoteFileId> ./downloads/file.md --mode agent-safe
```

### 安全上传结果

```bash
./cloud189 agent-status --json
./cloud189 upload-safe ./result.md <writeRootId> --mode agent-safe
```

### 安全同步目录

```bash
./cloud189 sync-upload-safe ./results <writeRootId> --once --mode agent-safe
```

## 8. Agent 使用原则

- 先 `status/agent-status`，确认登录和 write root。
- 先 `search/list/tree` 找 remote ID，不要猜路径。
- 下载到本地临时目录后再处理。
- 产物写到本地，然后用 `upload-safe` 或 `sync-upload-safe` 上传。
- 任何删除、移动、重命名、覆盖风险都必须 `plan`，并等待用户确认。

## 9. 故障排查

### Hermes 找不到 Cloud189 工具

```bash
hermes mcp list
hermes mcp test cloud189
```

确认配置后开启新 Hermes 会话。

### 无法安全上传

检查 write root：

```bash
./cloud189 agent-status --json
```

如果 `canUploadSafe=false`，执行：

```bash
./cloud189 init-agent hermes --json
```

### 删除/移动被拒绝

这是预期行为。改用：

```bash
./cloud189 plan rm <remoteId> --mode agent-safe
```

然后人工确认是否需要用用户模式执行危险命令。
