# MCP 首次配置

首次克隆仓库后，配置 Plumb 和 TalkToFigma。

## 官方链接

- [Plumb MCP 官方仓库](https://github.com/tathagat22/plumb-mcp)
- [TalkToFigma 官方仓库](https://github.com/grab/cursor-talk-to-figma-mcp)
- [TalkToFigma Figma Plugin](https://www.figma.com/community/plugin/1485687494525374295/cursor-talk-to-figma-mcp-plugin)

## Plumb

全局安装：

```bash
pnpm add --global plumb-mcp
```

确认命令可用：

```bash
plumb-mcp --help
```

Plumb 同样需要 Figma 桌面端插件。按照 [Plumb MCP 官方仓库](https://github.com/tathagat22/plumb-mcp)中的说明导入并启动对应插件。

## TalkToFigma

克隆官方仓库并初始化：

```bash
git clone https://github.com/grab/cursor-talk-to-figma-mcp.git
cd cursor-talk-to-figma-mcp
bun setup
```

启动本地 socket 服务，并保持终端运行：

```bash
bun socket
```

## Figma 桌面端

必须使用 Figma 桌面端，并启动 Plumb 和 TalkToFigma 对应插件：

1. 打开 Figma 桌面端。
2. 进入 `Plugins > Development > Import plugin from manifest...`。
3. 按各自官方仓库说明选择 Plumb 和 TalkToFigma 的 MCP plugin manifest 文件。
4. 导入后，从 `Plugins > Development` 启动 Plumb 和 TalkToFigma 插件。
5. 保持 `plumb-mcp`、`bun socket` 和两个 Figma 插件同时运行，确认它们已连接 MCP。

详细步骤和 manifest 位置以[官方仓库说明](https://github.com/grab/cursor-talk-to-figma-mcp)为准。
