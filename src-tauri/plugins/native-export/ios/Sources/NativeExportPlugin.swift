import Tauri
import UIKit
import WebKit

private struct ExportArgs: Decodable {
    let id: String
    let path: String
    let mime: String
    let action: String
}
private struct CancelArgs: Decodable { let id: String }

class NativeExportPlugin: Plugin, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    private var pending: (id: String, invoke: Invoke)?
    private weak var pendingController: UIViewController?
    private var cancelled = Set<String>()

    private func finish(_ id: String, _ outcome: String) {
        guard let current = pending, current.id == id else { return }
        pending = nil
        pendingController = nil
        current.invoke.resolve(["outcome": outcome])
    }

    @objc public func present(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ExportArgs.self)
        let file = URL(fileURLWithPath: args.path).resolvingSymlinksInPath()
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
        let mime = ["png": "image/png", "mp4": "video/mp4", "webm": "video/webm", "pdf": "application/pdf", "txt": "text/plain", "md": "text/plain"]
        guard UUID(uuidString: args.id) != nil,
              let cache = cache?.resolvingSymlinksInPath(),
              file.path.hasPrefix(cache.path + "/"),
              file.deletingLastPathComponent().lastPathComponent == args.id,
              file.deletingLastPathComponent().deletingLastPathComponent().lastPathComponent == "mftp-model-exports",
              mime[file.pathExtension] == args.mime,
              ["save", "share"].contains(args.action),
              let attributes = try? FileManager.default.attributesOfItem(atPath: file.path),
              let bytes = attributes[.size] as? NSNumber,
              bytes.int64Value > 0, bytes.int64Value <= 64 * 1024 * 1024,
              attributes[.type] as? FileAttributeType == .typeRegular
        else { invoke.resolve(["outcome": "failed"]); return }
        DispatchQueue.main.async {
            if self.cancelled.remove(args.id) != nil { invoke.resolve(["outcome": "cancelled"]); return }
            guard self.pending == nil else { invoke.resolve(["outcome": "busy"]); return }
            guard let host = self.manager.viewController, host.presentedViewController == nil else {
                invoke.resolve(["outcome": "busy"]); return
            }
            self.pending = (args.id, invoke)
            if args.action == "share" {
                let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                self.pendingController = sheet
                sheet.completionWithItemsHandler = { _, completed, _, error in
                    self.finish(args.id, error != nil ? "failed" : completed ? "presented" : "cancelled")
                }
                sheet.popoverPresentationController?.sourceView = host.view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 1, height: 1)
                sheet.popoverPresentationController?.permittedArrowDirections = []
                host.present(sheet, animated: true)
            } else {
                // Export the complete source using the system's copy workflow; never export a placeholder.
                let picker = UIDocumentPickerViewController(url: file, in: .exportToService)
                self.pendingController = picker
                picker.delegate = self
                host.present(picker, animated: true)
                picker.presentationController?.delegate = self
            }
        }
    }

    @objc public func cancel(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(CancelArgs.self)
        DispatchQueue.main.async {
            // Once presented, iOS owns the copy. Wait for its delegate rather than claiming an early stop.
            if self.pending?.id != args.id {
                if self.cancelled.count >= 32 { self.cancelled.removeAll() }
                self.cancelled.insert(args.id)
            }
            invoke.resolve()
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard pendingController === controller else { return }
        if let current = pending { finish(current.id, urls.isEmpty ? "failed" : "saved") }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard pendingController === controller else { return }
        if let current = pending { finish(current.id, "cancelled") }
    }

    public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        // A late dismissal from the previous picker must not complete a newer export.
        guard pendingController === presentationController.presentedViewController else { return }
        if let current = pending { finish(current.id, "cancelled") }
    }
}

@_cdecl("init_plugin_native_export")
func initPluginNativeExport() -> Plugin { NativeExportPlugin() }
