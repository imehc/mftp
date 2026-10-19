# 应用内离线翻译引擎

此 crate 将固定版本的 llama.cpp/STQ 实现通过同步 C ABI 链接进 Rust 应用。最终用户仅需在模型管理界面主动下载权重，无需安装外部推理程序。

## 开发构建

需要项目原有 Rust/Tauri 平台工具链、C/C++ 编译器和 CMake 3.22+。Android 使用 Android NDK；iOS 使用 Xcode。CMake 不在 PATH 时，通过 `CMAKE` 指定其可执行文件。Android 交叉构建同时正确设置 `ANDROID_NDK_HOME` 及目标 Rust linker/CC/CXX/AR/RANLIB。

macOS 最低部署版本为 10.15，与引擎的 C++ `std::filesystem` 依赖一致。Tauri 构建会设置部署目标；直接调用 Cargo 时使用相同的最低版本。

以下命令从仓库根目录执行。首次构建前准备原生源码：

```sh
pnpm translation:prepare
```

该命令下载并校验 `engine.json` 指定的源码归档、应用 `legacy-stq.patch`，保存到 `src-tauri/target/translation-source/llama.cpp`。Tauri dev/build 包装脚本及 CI 会执行准备步骤；直接调用 Cargo 时须先自行准备。可用 `MFTP_TRANSLATION_SOURCE_ARCHIVE` 指定同版本本地源码归档，仍会校验 SHA-256。准备过程不会下载模型权重。

原生编译只用 CPU，禁用 Metal/Vulkan/CUDA/BLAS/OpenMP 等可选后端。指令集按目标选择（见 `build.rs`）：Apple Silicon macOS 与 iOS 模拟器为 armv8.2-a+dotprod+fp16；iOS 与 Android arm64 为 armv8-a；Intel macOS 为 AVX/F16C；Windows/Linux x86_64 为 AVX2/FMA/F16C/BMI2。每个请求均在 blocking worker 内执行。模型与上下文在请求间保留（KV 缓存每次清空），由应用在空闲 3 分钟、删除模型、重置数据或退出时调用 `release` 释放。

## 兼容边界

- 旧官方 STQ 文件的 tensor/filetype 编号与当前引擎冲突，只有通过目录哈希验证的资源可启用兼容标记。补丁按模型加载启用，不改写权重或全局枚举。
- 固定引擎的聊天模板启发式会误判 HY-MT2。桥接层对官方模板的单用户生成分支进行适配，保留 user/assistant 顺序和一个 BOS。
- 模型目录、提示词和采样参数由 `src-tauri/src/modules/translation/catalog.rs` 管理。新增模型需适配并验证 profile、模板、量化内核与许可。
- 输入超过 token 预算、生成超过输出上限、取消、引擎失败分别返回错误；部分结果不能当作完整译文。

## 测试

```sh
cargo test --manifest-path src-tauri/native/translation/Cargo.toml
cargo fmt --manifest-path src-tauri/native/translation/Cargo.toml --check
```

真实模型用例默认忽略，须显式提供隔离模型文件：

```sh
MFTP_TEST_TRANSLATION_MODEL=/absolute/test-model.gguf \
  cargo test --manifest-path src-tauri/native/translation/Cargo.toml \
  -- --include-ignored --nocapture
```

引擎用例默认使用旧 STQ 兼容参数；单独测试 Q4 的 `official_model_translates_and_cancels` 时另设 `MFTP_TEST_TRANSLATION_LEGACY=0`。

源码许可见 `LLAMA-LICENSE`；应用只附带引擎许可，模型权重不进入安装包。
