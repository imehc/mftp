// swift-tools-version:5.3
import PackageDescription
let package = Package(
    name: "tauri-plugin-native-viewer",
    platforms: [.iOS(.v13)],
    products: [.library(name: "tauri-plugin-native-viewer", type: .static, targets: ["tauri-plugin-native-viewer"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "tauri-plugin-native-viewer", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)
