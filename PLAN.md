# Codex 开发计划：Agent Safe Storage with Cloud189 Provider

## 0. 项目目标

把现有 `cloud189` Node.js CLI + MCP 服务升级成：

> 一个面向 AI Agent 的命令式安全云存储服务层，当前 provider 支持 Cloud189 / 天翼云盘。

核心原则：

```text
不挂载网盘
不模拟本地文件系统
不让 Agent 直接删除/移动/覆盖
所有文件操作基于 Cloud189 remoteId
Agent 默认只能搜索、下载、安全上传、安全同步
危险操作只生成计划，不自动执行
```

已有能力：

```text
login
login-qr
login-sso
list
roots
mkdir
rm
mv
rename-folder
quota
tree
search
upload
download
sync-upload
sync-download
status
```

本轮目标不是大改，而是加一层 **Agent-safe wrapper**。

---

# Phase 1：统一输出格式

## 1.1 给查询类命令加 `--json`

需要支持：

```bash
cloud189 roots --json
cloud189 list [remoteFolderId] --json
cloud189 tree [remoteFolderId] --depth <n> --json
cloud189 search <keyword> [remoteFolderId] --depth <n> --json
cloud189 quota --json
cloud189 status --json
```

默认保持现在的表格输出。

JSON 结构建议：

```json
{
  "ok": true,
  "items": [
    {
      "type": "dir",
      "id": "924491248923560804",
      "name": "share",
      "size": null,
      "modified": "2026-05-24 02:54:06",
      "parentId": "-11"
    }
  ]
}
```

错误统一：

```json
{
  "ok": false,
  "error": {
    "code": "NOT_LOGGED_IN",
    "message": "Please run cloud189 login-qr first."
  }
}
```

## 1.2 保持表格稳定

当前表格很好：

```text
TYPE  ID  NAME  SIZE  MODIFIED
```

不要频繁改列名。Agent 和人都可以读。

---

# Phase 2：Agent Safe Mode

## 2.1 新增配置文件

默认配置路径：

```bash
~/.agent-safe-storage/config.json
```

或先简单用：

```bash
~/.cloud189-agent/config.json
```

配置内容：

```json
{
  "provider": "cloud189",
  "mode": "user",
  "agent": {
    "name": "hermes",
    "writeRootId": "",
    "writeRootName": "hermes",
    "allowDelete": false,
    "allowMove": false,
    "allowRename": false,
    "allowOverwrite": false
  }
}
```

## 2.2 支持环境变量覆盖

```bash
CLOUD189_MODE=agent-safe
CLOUD189_AGENT_NAME=hermes
CLOUD189_WRITE_ROOT_ID=123456789
```

优先级：

```text
CLI 参数 > 环境变量 > config.json > 默认值
```

## 2.3 新增 `--mode`

所有命令支持：

```bash
cloud189 <command> --mode user
cloud189 <command> --mode agent-safe
```

默认：

```text
CLI 直接运行：user
MCP 服务运行：agent-safe
```

## 2.4 agent-safe 允许的命令

允许：

```text
status
quota
roots
list
tree
search
download
mkdir-safe
upload-safe
sync-upload-safe
plan
```

禁止：

```text
rm
mv
rename-folder
upload overwrite
sync-upload force
sync-download overwrite
任何删除远程文件的行为
任何移动远程文件的行为
任何覆盖远程变更的行为
```

禁止时返回：

```text
DENIED: rm is not allowed in agent-safe mode.
Use `cloud189 plan rm <id>` and ask the user to confirm.
```

JSON：

```json
{
  "ok": false,
  "error": {
    "code": "DENIED_AGENT_SAFE",
    "message": "rm is not allowed in agent-safe mode.",
    "suggestion": "Use cloud189 plan rm <id> and ask the user to confirm."
  }
}
```

---

# Phase 3：新增最小安全命令

## 3.1 `upload-safe`

命令：

```bash
cloud189 upload-safe <localPath> <remoteFolderId>
```

语义：

```text
远程目录不存在同名文件：上传
远程已有同名文件：失败，不覆盖
只允许上传到 agent writeRootId 下面
```

如果目前不好判断“是否在 writeRoot 下”，第一版只做：

```text
remoteFolderId 必须等于 writeRootId
```

后续再支持子目录。

错误：

```text
CONFLICT: remote file already exists. upload-safe refused to overwrite.
```

## 3.2 `mkdir-safe`

命令：

```bash
cloud189 mkdir-safe <remoteParentId> <name>
```

规则：

```text
agent-safe 下只能在 writeRootId 下创建目录
同名目录已存在则返回 existing id，不报错
```

这让 Agent 可以幂等初始化目录。

## 3.3 `sync-upload-safe`

命令：

```bash
cloud189 sync-upload-safe <localDir> <remoteFolderId> [--once] [--interval <ms>]
```

最简规则：

```text
本地新增文件：上传
本地文件比远程新：上传/更新
远程文件比本地新：冲突，停止
本地删除：忽略，不删除远程
远程多余文件：忽略
移动：不处理
重命名：按新文件处理，旧远程文件保留
```

不要做 backup/mirror/version/policy。第一版就叫 safe。

## 3.4 本地同步状态

保存到本地目录：

```text
<localDir>/.cloud189-sync.json
```

内容：

```json
{
  "remoteFolderId": "924491248923560804",
  "lastSyncAt": "2026-05-28T23:00:00Z",
  "files": {
    "note.md": {
      "remoteId": "123456789",
      "localMtimeMs": 1779990000000,
      "localSize": 12345,
      "remoteModified": "2026-05-28 23:00:00",
      "remoteSize": 12345
    }
  }
}
```

判断逻辑：

```text
remote not exists -> upload
local mtime/size changed AND remote unchanged since last sync -> upload
remote changed since last sync -> conflict
local deleted -> ignore
```

第一版只用：

```text
mtime + size
```

不要上 hash，除非后面用户反馈需要。

---

# Phase 4：Plan 模式

## 4.1 新增 `plan`

命令：

```bash
cloud189 plan rm <remoteId>
cloud189 plan mv <remoteId> <targetFolderId>
cloud189 plan rename-folder <remoteFolderId> <newName>
cloud189 plan upload <localPath> <remoteFolderId>
cloud189 plan sync-upload <localDir> <remoteFolderId>
```

只输出，不执行。

表格：

```text
ACTION     TYPE  ID                  NAME      RISK
---------  ----  ------------------  --------  ----------------
delete     file  123456789           a.md      requires-confirm
overwrite  file  888888888           b.md      requires-confirm
upload     file  local:c.md           c.md      safe
```

JSON：

```json
{
  "ok": true,
  "dryRun": true,
  "actions": [
    {
      "action": "delete",
      "type": "file",
      "id": "123456789",
      "name": "a.md",
      "risk": "requires-confirm"
    }
  ]
}
```

Agent-safe 下危险操作只允许 `plan`，不允许执行。

---

# Phase 5：MCP 服务改造

## 5.1 MCP 默认只暴露安全工具

暴露这些工具：

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
```

不要暴露：

```text
cloud189_rm
cloud189_mv
cloud189_rename
cloud189_upload_raw
cloud189_sync_upload_raw
cloud189_sync_download_raw
```

如果已经暴露，则在 agent-safe 下必须拒绝执行。

## 5.2 所有 MCP 工具参数必须校验

至少校验：

```text
remoteId 必须是字符串或数字字符串
remoteFolderId 必须是字符串或数字字符串
localPath 不能包含危险路径
localPath 不能默认访问 /etc /root /home 以外任意路径
download 目标目录必须是配置允许的 workspace
upload localPath 必须存在
```

MCP 工具规范建议服务端做输入验证、访问控制、限流、输出清洗，客户端对敏感操作确认并记录审计；你的 MCP 层要把这些当作设计约束，而不是只依赖模型自觉。([Model Context Protocol][1])

## 5.3 MCP 工具返回结构

统一：

```json
{
  "ok": true,
  "summary": "Uploaded 1 file.",
  "data": {}
}
```

错误：

```json
{
  "ok": false,
  "error": {
    "code": "DENIED_AGENT_SAFE",
    "message": "Dangerous operation denied in agent-safe mode."
  }
}
```

---

# Phase 6：Hermes Skill

Hermes 有 skills 和 MCP integration 文档，发布时应该提供一个可复制的 skill，而不是只给 CLI 文档。([Hermes Agent][2])

创建：

```text
skills/cloud189-agent-storage/SKILL.md
```

内容骨架：

````md
---
name: cloud189-agent-storage
description: Use Agent Safe Storage with Cloud189 provider to search, download, upload, and safely sync cloud files.
version: 0.1.0
---

# Cloud189 Agent Storage

Use Cloud189 as persistent storage for research results, generated files, shared files, and reusable knowledge.

This is not a mounted drive. Always use CLI/MCP commands.

## Safety Rules

1. Always use agent-safe mode.
2. Cloud189 operations require remote IDs, not paths.
3. Use roots/list/tree/search to find remote IDs before acting.
4. Never delete, move, rename, or overwrite remote files.
5. Use upload-safe for uploads.
6. Use sync-upload-safe for safe backup-style sync.
7. If an operation may delete, move, rename, or overwrite, use plan and ask the user to execute it manually.
8. If multiple files have the same name, do not guess. Show candidates.

## Common Workflow

1. Check status.
2. Search existing cloud knowledge.
3. Download needed files into local workspace.
4. Do the work.
5. Save final result as markdown.
6. Upload with upload-safe or sync-upload-safe.

## Common Commands

Check login:

```bash
cloud189 status
````

List roots:

```bash
cloud189 roots
```

List folder:

```bash
cloud189 list <remoteFolderId>
```

Search:

```bash
cloud189 search "<keyword>" <remoteFolderId> --depth 3
```

Download:

```bash
cloud189 download <remoteId> ./downloads/
```

Safe upload:

```bash
cloud189 upload-safe ./result.md <agentWriteRootId>
```

Safe sync:

```bash
cloud189 sync-upload-safe ./results <agentWriteRootId> --once
```

Dangerous operation plan:

```bash
cloud189 plan rm <remoteId>
```

````

---

# Phase 7：初始化命令

## 7.1 新增 `init-agent`

命令：

```bash
cloud189 init-agent hermes
````

作用：

```text
检查登录
创建 /Agents
创建 /Agents/hermes
创建 /Agents/hermes/inbox
创建 /Agents/hermes/results
创建 /Agents/hermes/workspace
创建 /Agents/hermes/logs
保存 writeRootId 到配置
```

输出：

```text
KEY             VALUE
--------------  ------------------
agent           hermes
write_root      /Agents/hermes
write_root_id   925000000000000001
mode            agent-safe
```

如果目录已存在，复用，不报错。

## 7.2 新增 `agent-status`

命令：

```bash
cloud189 agent-status
```

输出：

```text
KEY               VALUE
----------------  -------------------------------
login             ok
provider          cloud189
mode              agent-safe
agent             hermes
write_root_id     925000000000000001
can_search        yes
can_download      yes
can_upload_safe   yes
can_delete        no
can_move          no
can_overwrite     no
```

---

# Phase 8：发布文档

## 8.1 README 标题

不要叫：

```text
Cloud189 MCP Server
```

建议：

```text
Agent Safe Storage
```

副标题：

```text
A command-based safe cloud storage layer for AI agents. Currently supports Cloud189.
```

中文：

```text
面向 AI Agent 的命令式安全云存储层，目前支持天翼云盘。
```

## 8.2 README 必须包含

```text
What is this
Why not mount cloud drive
Install
QR login
Basic CLI usage
Agent-safe mode
MCP setup
Hermes skill setup
Safety model
Disclaimer
```

## 8.3 免责声明

```md
## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by China Telecom or Cloud189.
Cloud189 is currently supported as a storage provider.
```

中文：

```md
## 免责声明

本项目不是天翼云盘官方项目，与中国电信/天翼云盘没有隶属、赞助或背书关系。
天翼云盘只是当前支持的一个存储后端。
```

---

# Phase 9：测试用例

## 9.1 CLI 测试

覆盖：

```text
status 未登录
login-qr 后 status
roots --json
list --json
search --json
upload-safe 新文件成功
upload-safe 同名文件失败
agent-safe 下 rm 被拒绝
agent-safe 下 mv 被拒绝
plan rm 只输出不执行
sync-upload-safe 本地新增上传
sync-upload-safe 本地删除不删除远程
```

## 9.2 MCP 测试

覆盖：

```text
cloud189_status
cloud189_search
cloud189_upload_safe
cloud189_plan
危险工具不可见或被拒绝
```

## 9.3 手动 Demo

准备 3 个 demo：

```text
Demo 1：扫码登录、列目录、搜索文件
Demo 2：Agent 下载资料、生成 result.md、upload-safe 上传
Demo 3：sync-upload-safe 同步本地 results 目录，不删除远程文件
```

---

# Phase 10：实现顺序

严格按这个顺序：

```text
1. 查询类命令加 --json
2. 统一错误结构
3. 加 agent-safe mode
4. 加 upload-safe
5. 加 mkdir-safe
6. 加 plan
7. 加 sync-upload-safe
8. 加 init-agent / agent-status
9. 收缩 MCP 暴露工具，只保留安全工具
10. 写 Hermes skill
11. 整理 README
12. npm publish
```

不要先做：

```text
多 provider
复杂 ACL
hash 对比
版本历史
Web UI
数据库
挂载
全文索引
自动知识库
双向同步
自动删除
复杂冲突合并
```

---

# 最小完成标准

第一版完成后，应该能跑通：

```bash
cloud189 login-qr
cloud189 init-agent hermes
cloud189 agent-status
cloud189 search "solana" -11 --depth 3
cloud189 download <remoteId> ./workspace/
cloud189 upload-safe ./result.md <hermesWriteRootId>
cloud189 sync-upload-safe ./results <hermesWriteRootId> --once
```

Agent 侧能做到：

```text
搜索云盘历史资料
下载上下文
完成任务
保存结果
安全上传
遇到删除/覆盖/移动只生成 plan
```
