# Android 构建说明

## 环境要求

- Android Studio（提供 SDK、NDK、JDK）。本项目脚本默认使用：
  - SDK：`~/Library/Android/sdk`
  - NDK：SDK 下版本号最高的 `ndk/`（当前 27.0.12077973）
  - JDK：Android Studio 自带的 JBR（`/Applications/Android Studio.app/Contents/jbr/Contents/Home`）
- Rust Android target（已安装过一次即可）：
  ```bash
  rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
  ```

所有 Android 命令都通过 `scripts/android.sh` 走，它会自动设置 `ANDROID_HOME` / `NDK_HOME` / `JAVA_HOME`，并为 vendored OpenSSL 生成 NDK r23+ 缺失的 `<triple>-ranlib` / `<triple>-ar` 工具 shim（这是 ssh2 依赖交叉编译所必需的）。Gradle 8.14.3 要求 Java 17–24；脚本会忽略不兼容的 `JAVA_HOME`（例如 Android Studio 自带的 Java 25），优先使用 Gradle 管理的兼容 JDK。

## 常用命令

开发调试使用独立的 `com.imehc.mftp.dev` 安装包，桌面名称为 `MFTP Dev`，可与正式版并存。`bundle.android.debugApplicationIdSuffix` 由 Tauri CLI 同步到 Gradle；保留原 Kotlin/JNI namespace，避免破坏插件加载。开发包的数据、WebView 设置及 Android Keystore 位于独立应用沙盒，不自动迁移正式版数据。

`pnpm tauri android dev`、`pnpm android:dev` 和 `pnpm android:build --debug` 均通过统一入口。Android 的 `dev --release` 被拒绝，因为 release 不应用 debug 包名后缀；需要正式产物时使用 `pnpm android:build`。开发入口的 `--config` 支持 JSON 文件或内联 JSON，覆盖项按顺序合并，但不能取消包名隔离；不使用 `TAURI_CONFIG` 手动注入配置。

隔离只覆盖应用管理的数据。主动选择的外部文件、公共下载目录和远程服务器仍是共享资源。

```bash
# 真机/模拟器开发调试（自动安装并打开，支持热更新）
pnpm android:dev

# 打 debug APK（debug 签名，可直接 adb install；--target aarch64 只编 arm64，最快）
pnpm android:build --debug --target aarch64

# 打 universal release APK + AAB（包含所有 ABI，会用 release 签名）
pnpm android:build

# 只编译 arm64-v8a release APK（文件名仍为 app-universal-release.apk）
pnpm android:build --target aarch64 --apk

# 只打 arm64-v8a release APK，并生成 app-arm64-release.apk
pnpm android:build --target aarch64 --split-per-abi --apk

# 按 ABI 分别生成 release APK
pnpm android:build --split-per-abi --apk
```

产物路径：

- universal APK：`src-tauri/gen/android/app/build/outputs/apk/universal/<debug|release>/`
- ARM64 APK：`src-tauri/gen/android/app/build/outputs/apk/arm64/<debug|release>/`
- 分 ABI APK：`src-tauri/gen/android/app/build/outputs/apk/<arm64|armv7|x86|x86_64>/<debug|release>/`
- universal AAB：`src-tauri/gen/android/app/build/outputs/bundle/universalRelease/`

`aarch64` 对应 Android ABI `arm64-v8a`。Tauri 的 `--target aarch64` 只限制编译和打包的目标 ABI，默认 Gradle flavor 仍名为 `universal`，所以产物会叫 `app-universal-release.apk`，但 APK 内实际只有 `arm64-v8a`。同时添加 `--split-per-abi` 后，产物目录和文件名才会变成 `arm64/release/app-arm64-release.apk`。

仅构建 ARM64 可以显著减小 APK 体积；需要兼容较老的 32 位 ARM 设备时，再构建包含全部 ABI 的 universal 包，或使用 `--split-per-abi` 分别构建。

## 真机安装

Android SDK 已包含 `adb`。macOS 默认路径为 `~/Library/Android/sdk/platform-tools/adb`；当前终端找不到 `adb` 时，先执行：

```bash
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
adb version
adb devices
```

需要永久生效时，将上面的 `export PATH=...` 加入 `~/.zshrc`，然后执行 `source ~/.zshrc`。

连接手机并开启 USB 调试后，可以直接安装 ARM64 release APK：

```bash
adb install -r \
  src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk
```

使用 `adb install` 可以获得比手机文件管理器更准确的安装错误码。当前应用的 `minSdk` 为 28、`targetSdk` 为 36，支持 Android 9 及以上系统，包括 Android 16。

release APK 只包含 `arm64-v8a`，32 位 ARM 设备和 x86 模拟器会报 `INSTALL_FAILED_NO_MATCHING_ABIS`；需要覆盖这些设备时构建 universal 包。

如果返回 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，说明手机中已安装相同包名但签名不同的版本，常见情况是先前安装过 debug APK。Android 不允许使用 release 签名覆盖 debug 签名，需要先卸载旧版本：

```bash
adb uninstall com.imehc.mftp
adb install \
  src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk
```

卸载会清除应用本地数据。正式分发后必须始终使用同一把 release key 签名，才能保留数据并覆盖升级。

## Release 签名

签名信息从 `src-tauri/gen/android/keystore.properties` 读取（**已被 gitignore，不会提交**）：

```properties
storeFile=/Users/<you>/.keystores/mftp-release.jks
keyAlias=mftp
storePassword=...
keyPassword=...
```

- keystore 文件在 `~/.keystores/mftp-release.jks`，有效期 10000 天。
- 如果 `keystore.properties` 不存在，release 构建仍会成功，但产物是未签名的 `*-unsigned.apk`（无法安装）。
- **务必备份** `~/.keystores/mftp-release.jks` 和其中的密码：应用更新必须用同一把 key 签名，key 丢了就无法覆盖安装/上架更新。

### 重新生成 keystore（如需）

```bash
keytool -genkey -v -keystore ~/.keystores/mftp-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias mftp
```

然后更新 `keystore.properties` 中的密码。

### 在其他机器 / CI 上构建

1. 把 keystore 文件安全地传过去（CI 上通常 base64 后存入 secret）。
2. 生成 `src-tauri/gen/android/keystore.properties` 指向该文件。
3. 运行 `pnpm android:build`。

### GitHub Actions 自动构建

`release.yml` 中的 `android` job 会在每次发版时构建签名的 arm64-v8a release APK，并以 `mftp_<version>_arm64-v8a.apk` 上传到 GitHub Release。需要在仓库 Settings → Secrets 配置：

| Secret                      | 内容                                             |
| --------------------------- | ------------------------------------------------ |
| `ANDROID_KEYSTORE_BASE64`   | `base64 -i ~/.keystores/mftp-release.jks` 的输出 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 的 storePassword                        |
| `ANDROID_KEY_ALIAS`         | key 别名（当前为 `mftp`）                        |
| `ANDROID_KEY_PASSWORD`      | key 的 keyPassword                               |

缺少 `ANDROID_KEYSTORE_BASE64` 时该 job 会直接失败（不会产出未签名 APK），避免发布无法安装的包。

## 平台差异

Android 的 HTTPS 使用 `rustls-platform-verifier` 调用系统证书校验。`NativeTls` 在 `MainActivity.onCreate` 调用父类之前加载 Rust 主库并传入应用上下文，确保后台服务启动前完成初始化。Gradle 从 Cargo 锁定的 `rustls-platform-verifier-android` 包定位本地 Maven 组件，ProGuard 保留其 JNI 类；升级该依赖时需同时验证启动、HTTPS 请求和 release 混淆配置。

Android 15 起部分设备使用 16 KB 内存页，原生库必须按 16 KB 对齐链接，否则安装时被判为无效包（`INSTALL_FAILED_INVALID_APK`）。`src-tauri/build.rs` 在 `CARGO_CFG_TARGET_OS = android` 时输出 `cargo:rustc-link-arg=-Wl,-z,max-page-size=16384`：NDK r27 默认仍是 4 KB，r28 才改为 16 KB，显式声明不依赖 NDK 版本。

不要改用 `.cargo/config.toml` 的 `rustflags`：环境变量 `RUSTFLAGS` 会整体替换配置里的 rustflags 而不是合并，一旦构建链或本地环境设了它，对齐会静默退回 4 KB —— 实测设置 `RUSTFLAGS="-C debuginfo=0"` 后 config 方案产出 `p_align=0x1000`，而 build script 方案仍为 `0x4000`。`release.yml` 的 android job 在打包后校验 APK 内每个 `.so` 的 LOAD 段对齐，低于 16 KB 直接失败，作为最终门禁。

`AndroidManifest.xml` 把 `android.hardware.wifi` 显式声明为非必需：`CHANGE_WIFI_MULTICAST_STATE` 会隐式推导出必需的 Wi-Fi 特性，而局域网发现只是可选能力。

`native/translation/build.rs` 把 NDK sysroot 加入链接搜索路径时，必须让带 API 级别的目录（`sysroot/usr/lib/<triple>/28`，含 `libc.so`）排在不带级别的目录（`sysroot/usr/lib/<triple>`，只有 `libc.a`）之前。顺序反了，`-lc` 会解析成静态 Bionic，`libmftp_lib.so` 里会带入一份私有的 `__libc_shared_globals`（`auxv` 为空）；Rust `compiler-builtins` 的 `init_have_lse_atomics` 在 `System.loadLibrary` 阶段调用 `getauxval` 时解引用空指针，进程在进入任何应用代码前就 SIGSEGV（tombstone 为 `getauxval+28` / `init_have_lse_atomics+12`，只有 2 帧）。`release.yml` 的 `Verify libc stays dynamically linked` 步骤要求 `getauxval` 仍是 `.dynsym` 里的未定义符号，静态 libc 回归会直接失败。

Android 端与桌面端的功能差异（代码中已处理，无需手动关注）：

- **更新器（updater）与开机自启（autostart）** 仅桌面可用：
  - Rust 侧：`Cargo.toml` 中列在 `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`，`lib.rs` 中用 `#[cfg(desktop)]` 注册。
  - 权限：`src-tauri/capabilities/desktop.json` 仅对桌面平台生效。
  - 前端：`src/lib/platform.ts` 提供 `isDesktopPlatform()`，设置菜单在移动端隐藏相关入口，Android 更新走应用商店/手动安装 APK。
- Android 上应用数据目录为应用私有目录，`fs:scope` 中的 `$HOME` 等桌面路径不适用。

## 常见问题

- **`Blocking waiting for file lock`**：有另一个 cargo/gradle 构建在跑（包括 IDE 里的），等它结束或杀掉即可。
- **`aarch64-linux-android-ranlib: command not found`**：没有通过 `scripts/android.sh` 运行。请始终使用 `pnpm android:dev` / `pnpm android:build`。
- **release APK 装不上**：先确认文件不是 `*-unsigned.apk`，再用 `adb install -r <apk-path>` 获取准确错误码。`INSTALL_FAILED_UPDATE_INCOMPATIBLE` 表示已安装版本的签名不同，需要卸载旧版本或改用原签名 key 构建。手机安装器把这类失败统一显示为“安装包无效或不兼容”，与 ABI、`minSdk`、签名、对齐都无关的文案，必须靠 `adb install`/`logcat` 区分。
- **安装成功但一启动就闪退**：`adb logcat` 里看到 `SIGSEGV` 且只有 `getauxval` / `init_have_lse_atomics` 两帧，说明原生库静态链接了 Bionic，见上文 sysroot 链接顺序说明。
- **`zsh: command not found: adb`**：将 `$HOME/Library/Android/sdk/platform-tools` 加入 `PATH`，或使用 `/Users/<you>/Library/Android/sdk/platform-tools/adb` 绝对路径执行。
- Gradle 输出中的 deprecation 警告来自 Tauri 生成的模板，可忽略。

## 原生插件独立编译检查

`pnpm check:android-plugins` 编译 `native-export`、`native-viewer`、`native-speech` 三个 Android library，生成 AAR，并运行语音分句和恢复队列的 JVM 单元测试；不会生成完整 MFTP APK、启动 Gradle 安装任务或连接设备。用于本地和 PR CI 的 Kotlin/资源编译门槛，不代替 Android Rust 主库、整包或原生功能验收。

环境：Node.js 22、pnpm、Cargo、JDK 17–24，以及 Android SDK `platforms;android-36`、`build-tools;36.0.0`。显式配置 `JAVA_HOME` 和 `ANDROID_HOME`（或 `ANDROID_SDK_ROOT`）。不需要 NDK，也不需要先启动应用。

```bash
# 首次允许 Cargo/Gradle 下载锁定依赖；复用仓库的 Gradle wrapper 和依赖版本
pnpm check:android-plugins

# 依赖已经缓存后，在全新的临时工程中离线重新编译
pnpm check:android-plugins --offline

# 仅验证环境并生成隔离工程/源码摘要，不执行 Gradle
pnpm check:android-plugins --offline --prepare-only

# 本机只安装了其他兼容 Build Tools 时可显式选择，实际版本会写进报告
MFTP_ANDROID_BUILD_TOOLS=37.0.0 pnpm check:android-plugins --offline
```

脚本通过 `cargo metadata --locked --filter-platform aarch64-linux-android` 定位当前应用实际解析到的 Tauri API，避免从任意缓存目录挑选版本。Cargo 锁文件更新后，离线模式可能提示依赖未缓存，应先正常运行一次。

每次在系统临时目录新建 `mftp-android-plugins-*` 工程，复制 Tauri API 和插件源码（不复制旧 build/.gradle），不会向源码目录写构建产物。控制台打印完整目录；`check-report.json` 记录 Tauri/JDK/SDK/Build Tools、源码 SHA-256、离线模式及 prepared/passed/failed 状态。成功输出在各插件的 `build/outputs/aar/*-debug.aar`。工程和报告保留供排查；可在确认不再需要后手动清理该次临时目录。

PR 的 `Android plugins (compile only)` job 调用相同入口，使用 JDK 17 和 Build Tools 36.0.0，并上传摘要报告。CI 配置存在不表示远端执行已经通过，应以对应 PR 检查结果为准。

## 启动图标

`public/app-icon.png` 为原图。Android 自适应图标的前景画布为 108dp，常见启动器只显示中央约 72dp；直接铺满原图会裁掉留白，让图案显得过大。

执行 `pnpm android:icons`，通过 Tauri 图标生成器将原图居中放入 72dp 区域，并生成五种密度的前景 PNG。该脚本只更新 Android 自适应前景，保留 macOS、iOS 和旧式 Android 图标。重新运行全平台图标生成或 Android init 后，也应运行此命令恢复安全留白。实际遮罩和动效由系统启动器决定。
