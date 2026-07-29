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

所有 Android 命令都通过 `scripts/android.sh` 走，它会自动设置 `ANDROID_HOME` / `NDK_HOME` / `JAVA_HOME`，并为 vendored OpenSSL 生成 NDK r23+ 缺失的 `<triple>-ranlib` / `<triple>-ar` 工具 shim（这是 ssh2 依赖交叉编译所必需的）。

## 常用命令

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

使用 `adb install` 可以获得比手机文件管理器更准确的安装错误码。当前应用的 `minSdk` 为 24、`targetSdk` 为 36，支持 Android 7.0 及以上系统，包括 Android 16。

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

## 平台差异

Android 端与桌面端的功能差异（代码中已处理，无需手动关注）：

- **更新器（updater）与开机自启（autostart）** 仅桌面可用：
  - Rust 侧：`Cargo.toml` 中列在 `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`，`lib.rs` 中用 `#[cfg(desktop)]` 注册。
  - 权限：`src-tauri/capabilities/desktop.json` 仅对桌面平台生效。
  - 前端：`src/lib/platform.ts` 提供 `isDesktopPlatform()`，设置菜单在移动端隐藏相关入口，Android 更新走应用商店/手动安装 APK。
- Android 上应用数据目录为应用私有目录，`fs:scope` 中的 `$HOME` 等桌面路径不适用。

## 常见问题

- **`Blocking waiting for file lock`**：有另一个 cargo/gradle 构建在跑（包括 IDE 里的），等它结束或杀掉即可。
- **`aarch64-linux-android-ranlib: command not found`**：没有通过 `scripts/android.sh` 运行。请始终使用 `pnpm android:dev` / `pnpm android:build`。
- **release APK 装不上**：先确认文件不是 `*-unsigned.apk`，再用 `adb install -r <apk-path>` 获取准确错误码。`INSTALL_FAILED_UPDATE_INCOMPATIBLE` 表示已安装版本的签名不同，需要卸载旧版本或改用原签名 key 构建。
- **`zsh: command not found: adb`**：将 `$HOME/Library/Android/sdk/platform-tools` 加入 `PATH`，或使用 `/Users/<you>/Library/Android/sdk/platform-tools/adb` 绝对路径执行。
- Gradle 输出中的 deprecation 警告来自 Tauri 生成的模板，可忽略。
