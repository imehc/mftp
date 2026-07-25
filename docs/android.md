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

# 打正式 release APK + AAB（会用 release 签名，见下文）
pnpm android:build

# 只打 arm64 的 release 包
pnpm android:build --target aarch64
```

产物路径：

- APK：`src-tauri/gen/android/app/build/outputs/apk/universal/<debug|release>/`
- AAB：`src-tauri/gen/android/app/build/outputs/bundle/universalRelease/`

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
- **release APK 装不上**：检查是不是 `*-unsigned.apk`（`keystore.properties` 缺失时的产物）。
- Gradle 输出中的 deprecation 警告来自 Tauri 生成的模板，可忽略。
