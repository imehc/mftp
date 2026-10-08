import Foundation
import Tauri

private struct PollArgs: Decodable { let urls: [String] }

class NativeViewerPlugin: Plugin {
    private let worker = DispatchQueue(label: "mftp-model-import")
    private var cleaned = false

    private func copy(_ address: String) throws -> [String: String] {
        guard let source = URL(string: address), source.isFileURL,
              source.pathExtension.lowercased() == "glb", source.lastPathComponent.utf8.count <= 240,
              let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
        else { throw NSError(domain: "model-import", code: 1) }
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let root = cache.appendingPathComponent("mftp-model-inbox", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        guard root.resolvingSymlinksInPath().deletingLastPathComponent() == cache.resolvingSymlinksInPath() else { throw NSError(domain: "model-import", code: 1) }
        if !cleaned {
            for item in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey]) {
                let values = try item.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey])
                if UUID(uuidString: item.deletingPathExtension().lastPathComponent) != nil,
                   item.pathExtension == "glb", values.isRegularFile == true,
                   let date = values.contentModificationDate, Date().timeIntervalSince(date) > 86400 {
                    try FileManager.default.removeItem(at: item)
                }
            }
            cleaned = true
        }
        let used = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.fileSizeKey]).reduce(0) { sum, file in
            sum + ((try file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
        let limit = 512 * 1024 * 1024
        guard used < limit, let input = InputStream(url: source) else { throw NSError(domain: "model-import", code: 2) }
        let destination = root.appendingPathComponent(UUID().uuidString + ".glb")
        guard let output = OutputStream(url: destination, append: false) else { throw NSError(domain: "model-import", code: 2) }
        input.open(); output.open()
        var completed = false
        defer { input.close(); output.close() }
        do {
            var total = 0
            var magic = [UInt8]()
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 65536)
            defer { buffer.deallocate() }
            while true {
                let count = input.read(buffer, maxLength: 65536)
                if count == 0 { break }
                guard count > 0, used + total + count <= limit else { throw NSError(domain: "model-import", code: 2) }
                if magic.count < 4 { magic.append(contentsOf: UnsafeBufferPointer(start: buffer, count: min(count, 4 - magic.count))) }
                var offset = 0
                while offset < count {
                    let written = output.write(buffer.advanced(by: offset), maxLength: count - offset)
                    guard written > 0 else { throw NSError(domain: "model-import", code: 2) }
                    offset += written
                }
                total += count
            }
            guard total >= 12, magic == [103, 108, 84, 70] else { throw NSError(domain: "model-import", code: 1) }
            completed = true
        } catch {
            input.close(); output.close()
            if !completed { try FileManager.default.removeItem(at: destination) }
            throw error
        }
        return ["path": destination.path, "name": source.lastPathComponent]
    }
    @objc public func poll(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(PollArgs.self)
        worker.async {
            var files = [[String: String]]()
            var failed = args.urls.count > 8
            for address in args.urls.prefix(8) {
                do { files.append(try self.copy(address)) } catch { failed = true }
            }
            let thermal: String
            switch ProcessInfo.processInfo.thermalState {
            case .nominal: thermal = "nominal"
            case .fair: thermal = "fair"
            case .serious: thermal = "serious"
            case .critical: thermal = "critical"
            @unknown default: thermal = "unknown"
            }
            invoke.resolve(["files": files, "failed": failed, "thermal": thermal])
        }
    }
}
@_cdecl("init_plugin_native_viewer")
func initPluginNativeViewer() -> Plugin { NativeViewerPlugin() }
