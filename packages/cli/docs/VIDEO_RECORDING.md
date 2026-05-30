# 命令行教程视频

已生成命令行操作教程视频：

```text
docs/media/cloud189-hermes-mcp-demo.mp4
```

同时保留原始演示文本：

```text
docs/media/cloud189-demo.txt
```

## 视频内容

视频演示以下命令：

```bash
cd ~/Projects/cloud189
./cloud189 status --json
./cloud189 agent-status --json
hermes mcp test cloud189
./cloud189 plan rm 123 --json --mode agent-safe
./cloud189 rm 123 --json --mode agent-safe
./cloud189 roots --json --mode agent-safe
```

重点展示：

- Cloud189 已登录；
- Agent write root 已初始化；
- Hermes 能连接 Cloud189 MCP 并发现 11 个工具；
- 危险操作 `rm` 会先进入 PLAN 模式；
- 在 `agent-safe` 下直接 `rm` 会被 `DENIED_AGENT_SAFE` 拒绝。

## 生成方式

当前环境没有 GUI，也没有 asciinema/agg，因此采用：

1. shell 脚本执行演示命令并保存 transcript；
2. Python + PIL 把 transcript 渲染成终端风格帧；
3. ffmpeg 合成 MP4。

这种方式保留了完整命令和输出，且不会暴露 token/cookie。
