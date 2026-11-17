# MFTP Native

使用 GPUI Kit 构建的原生桌面应用，提供待办创建、标题与富文本备注编辑、分类、优先级、计划日期与时刻、完成/废弃/恢复和确认删除。支持进行中、逾期、完成、废弃四个视图，分类与优先级筛选、搜索、日期分组，以及语言与主题设置。

待办数据服务复用共享 Rust crate，SQLite 初始化和读写由有界串行工作线程执行。待办、偏好与未提交草稿保存在独立的 `mftp-native.sqlite3` 中。重启恢复草稿，提交仍由用户操作；关闭前保存最新输入，退出时停止准入并等待已接受的任务完成。

可复用富文本组件位于 `src/components/rich_text/`，编辑内核采用固定版本的 `gpui-kit-markdown-editor`，源码来源、许可证及兼容修改见 `vendor/gpui-kit-markdown-editor/SOURCE.md`。支持文字格式、标题、列表、引用、代码、链接、图片粘贴/文件导入和撤销重做；备注采用版本化 Markdown 文档，与元数据在同一事务保存。旧纯文本按字面内容读取，原有符号不自动变成格式。工具栏按编辑区域宽度展开常用操作，右侧统计正文可见字符，忽略空白、格式标记和图片。Lucide 图标由 GPUI Kit 精选资源源嵌入。

静态 PNG、JPEG、WebP 图片使用共享 `mftp-image` 处理，输入最多 20 MB、1200 万像素、单边 8192，单张存储预算 500 KB、缩略图 50 KB。小图保持原样，超过存储预算时有界压缩；动画和超过输入限制的图片拒绝导入。处理时显示占位并允许继续编辑，失败可重试或移除，保存和关闭等待已接受的任务实际结束。每份备注最多 10 张图；文档仅存不透明资源 ID，图片存于当前应用独立数据库。列表展示首图缩略图与图片数量，备注右键可复制存储原图；当前应用内复制图文到另一任务时，图片生成独立资源，删除源任务不影响副本。文档协议与其他编辑器尚不互通，Markdown 不保存空段落的精确布局。当前未提供待办 MCP 或跨端版本 2 备份导入/导出。

从仓库根目录构建：

```sh
cargo check --manifest-path native/Cargo.toml --locked
cargo test --manifest-path native/Cargo.toml --locked
cargo build --manifest-path native/Cargo.toml --release --locked
```

运行应用：

```sh
cargo run --manifest-path native/Cargo.toml --locked
```

翻译源位于 `locales/en.yml` 和 `locales/zh-CN.yml`，由 `rust-i18n` 在编译期嵌入。使用稳定语义键，译者上下文写在 YAML 注释中，参数采用 `%{name}`。

应用标识为 `app.mftp.native`，默认数据目录位于系统本地应用数据目录下的同名子目录。可用 `MFTP_NATIVE_DATA_DIR` 配置目录，`--data-dir <directory>` 优先于环境变量。支持简体中文、英文及跟随系统语言，浅色、深色及跟随系统外观。

macOS 构建需要 Rust 工具链和 Xcode 命令行工具。
