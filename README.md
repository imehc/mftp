# mftp — Termius Lite

一个轻量的桌面 SSH/SFTP 客户端，基于 **Tauri v2 + React 19 + Vite + Tailwind v4 + shadcn**。
后端用 Rust `ssh2`（libssh2）实现 shell 与 SFTP 通道，前端用 xterm.js 呈现交互式终端。

## 功能

| 模块 | 功能 |
| --- | --- |
| 主机管理 | 主机连接配置的增删改查，本地 JSON 持久化 |
| SSH 终端 | 多标签、交互式 shell（xterm.js + ssh2 shell 通道），可调整大小 |
| SFTP 文件管理 | 浏览、上传、下载、删除、新建文件夹、重命名 |
| 密钥管理 | 导入私钥（文件选择器）、口令保护、按主机选用 |

## 快速开始

```bash
pnpm install
pnpm tauri dev     # 开发运行（桌面窗口）
pnpm tauri build   # 打包
```

## 使用

1. 侧栏点击 **+** 新建主机，填写地址/用户名，选择密码或密钥认证。
2. 密钥认证：先点 **钥匙** 图标进入密钥管理，导入私钥（可标记口令保护）。
3. 双击主机或点闪电图标连接 → 打开终端标签。
4. 标签上的文件夹图标可切换到该连接的 **SFTP** 文件管理视图。

## 数据位置

macOS：`~/Library/Application Support/com.imehc.mftp/`
（`hosts.json`、`keys.json`、私钥目录 `keys/` 权限 0600）

> 说明：这是 lite 版，主机密码与私钥以本地文件形式保存，未做加密的密钥库。请勿在不可信设备上使用。

## 技术栈

- 前端：React 19、TypeScript、Tailwind v4、shadcn/ui、zustand、@xterm/xterm
- 后端：Tauri v2、Rust、ssh2（vendored-openssl）、tauri-plugin-dialog
