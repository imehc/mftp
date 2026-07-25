# iOS 构建说明

## 环境要求

- Xcode(含 iOS SDK 与模拟器)。
- Homebrew 依赖:`xcodegen`、`cocoapods`(真机日志还需 `libimobiledevice`):
  ```bash
  brew install xcodegen cocoapods
  ```
- Rust iOS target(已安装过一次即可):
  ```bash
  rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
  ```

iOS 不需要类似 `scripts/android.sh` 的环境包装脚本(交叉编译 vendored OpenSSL 用的是 Xcode 自带工具链),命令直接走 `tauri ios`。

## 常用命令

```bash
# 模拟器/真机开发调试(会列出可选设备,支持热更新)
pnpm ios:dev

# 指定模拟器
pnpm ios:dev "iPhone 17 Pro"

# 打 release IPA(需要签名,见下文)
pnpm ios:build

# 打开 Xcode 工程手动调试/配置
pnpm tauri ios dev --open
```

产物路径:

- IPA:`src-tauri/gen/apple/build/arm64/mftp.ipa`
- xcarchive:`src-tauri/gen/apple/build/mftp_iOS.xcarchive`

## 签名

- **模拟器**运行不需要签名。
- **真机/发布**需要 Apple 开发者账号的 Team ID,两种配置方式任选:
  - 环境变量:`TAURI_APPLE_DEVELOPMENT_TEAM=<TEAM_ID> pnpm ios:build`
  - 或在 `src-tauri/tauri.conf.json` 的 `bundle.iOS.developmentTeam` 中写死。
- Team ID 可在 [Apple Developer 会员页](https://developer.apple.com/account#MembershipDetailsCard) 查到,或用
  `security find-identity -v -p codesigning` 查看本机证书。
- 首次真机运行需要在 Xcode 中登录账号并信任设备(`pnpm tauri ios dev --open` 后按提示操作)。

## 工程再生成

`src-tauri/gen/apple` 由 `pnpm tauri ios init` 生成,已提交到 git。以下文件包含手工定制,
重新 init 会被覆盖,需要注意保留:

- `project.yml` / `mftp_iOS/Info.plist`:本地网络权限声明(`NSLocalNetworkUsageDescription`、
  `NSBonjourServices: [_mftp._tcp]`),局域网传输依赖它们。
- 版本号:`scripts/version.mjs` 的 check/bump 会同步 `project.yml` 与 `Info.plist` 中的
  `CFBundleShortVersionString` / `CFBundleVersion`(Android 是构建时从 `tauri.properties` 读取,iOS 是 init 时硬编码,故需脚本同步)。

修改 `project.yml` 后运行 `xcodegen generate` 或重新 `tauri ios init` 让 `.xcodeproj` 生效。

## 平台差异

- **更新器(updater)与开机自启(autostart)** 仅桌面可用,处理方式与 Android 相同
  (`Cargo.toml` 平台条件依赖 + `#[cfg(desktop)]` + `capabilities/desktop.json` + 前端 `isDesktopPlatform()`),iOS 更新走 App Store/TestFlight。
- **局域网传输在移动端整体隐藏**:入口通过 `src/features/home/entries.tsx` 的 `platforms`
  字段声明(过滤逻辑通用,后续其他桌面独占功能同样加 `platforms: ["desktop"]` 即可),路由有
  `desktopOnlyGuard` 兜底,Rust 侧的服务自启动也用 `#[cfg(desktop)]` 限定——移动端不会开任何
  局域网 socket,因此正式包不触发「本地网络」授权弹窗。原因:iOS 上 mDNS 收发组播需要 Apple
  单独审批的 `com.apple.developer.networking.multicast` 权益,普通开发者账号无法自行开启,
  自动发现基本不可用。Info.plist 中的 `NSLocalNetworkUsageDescription` + `NSBonjourServices`
  保留,dev 模式连 Mac 上的 vite dev server 仍需要本地网络授权。
- iOS 应用数据目录为沙盒私有目录,`fs:scope` 中的 `$HOME` 等桌面路径不适用(与 Android 相同)。

## 常见问题

- **`Blocking waiting for file lock`**:有另一个 cargo 构建在跑,等它结束或杀掉即可。
- **`ios build` 报签名错误**:未配置 Team ID,见上文「签名」。
- **模拟器列表为空**:Xcode → Settings → Components 中下载 iOS Simulator runtime。
- **真机上局域网功能无反应**:检查 设置 → 隐私与安全性 → 本地网络 中是否已授权 mftp。
- **国行 iPhone:dev 包联网被静默拦截(白屏/连不上 dev server)**:国行固件有独立的
  「无线数据」权限(设置 → mftp → 无线数据)。App Store 安装会自动弹授权窗,但 **Xcode
  侧载的开发包经常不弹窗且默认拦截**,需手动到设置里选「WLAN与蜂窝网络」,必要时重启手机。
  该权限无 API/Info.plist 键可声明,开发者无法干预;TestFlight/App Store 分发不受影响。
- **本地网络权限开了仍连不上**:开发签名的 App 反复重装后 TCC 授权缓存可能失效——删除
  App 重装重新授权,仍不行就重启手机。
