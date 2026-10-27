// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "tauri-plugin-native-navigation",
    platforms: [.iOS(.v13)],
    products: [.library(name: "tauri-plugin-native-navigation", type: .static, targets: ["tauri-plugin-native-navigation"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [
        .target(name: "tauri-plugin-native-navigation", dependencies: [.byName(name: "Tauri")], path: "Sources"),
        .testTarget(name: "NativeNavigationTests", dependencies: ["tauri-plugin-native-navigation"], path: "Tests")
    ]
)
