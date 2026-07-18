# mftp

一个轻量的桌面 SSH/SFTP 客户端，基于 **Tauri v2 + React 19 + Vite + Tailwind v4 + shadcn**。
后端用 Rust `ssh2`（libssh2）实现 shell 与 SFTP 通道，前端用 xterm.js 呈现交互式终端。

## 功能

| 模块 | 功能 |
| --- | --- |
| SSH 终端 | 多标签、交互式 shell（xterm.js + ssh2 shell 通道），可调整大小 |
| SFTP 文件管理 | 浏览、上传、下载、文件夹传输、删除、新建文件夹、重命名、移动、解压、冲突改名 |
| 局域网传输 | 启动本机接收服务，二维码/浏览器访问，共享目录、白名单、确认码、权限控制 |

## 快速开始

```bash
pnpm install
pnpm tauri dev     # 开发运行（桌面窗口）
pnpm build         # 前端构建（会先编译多语言词典）
pnpm tauri build   # 打包（同样会先编译多语言词典）
```

## 技术栈

- 前端：React 19、TypeScript、Vite、Tailwind v4、shadcn/ui、zustand、Lingui、@xterm/xterm
- 后端：Tauri v2、Rust、ssh2（vendored-openssl）、tauri-plugin-dialog

## 注意事项

- macOS 未签名包可能提示“mftp 已损坏，无法打开”，可执行：
> ```bash
> xattr -dr com.apple.quarantine /Applications/mftp.app
> ```
