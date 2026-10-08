// swift-tools-version:5.3
import PackageDescription
let package = Package(
    name: "tauri-plugin-native-export",
    platforms: [.iOS(.v13)],
    products: [.library(name: "tauri-plugin-native-export", type: .static, targets: ["tauri-plugin-native-export"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "tauri-plugin-native-export", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)
