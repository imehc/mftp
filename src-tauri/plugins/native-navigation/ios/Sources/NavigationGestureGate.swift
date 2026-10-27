import UIKit
import WebKit

/// Keep WebKit's history snapshots alive while independently gating its input.
final class NavigationGestureGate: NSObject {
    private weak var webview: WKWebView?
    private var recognizers = [UIGestureRecognizer]()
    private var enabled = false

    init(webview: WKWebView) {
        self.webview = webview
        super.init()
        let existing = Set((webview.gestureRecognizers ?? []).map(ObjectIdentifier.init))
        webview.allowsBackForwardNavigationGestures = true
        // Capture only the recognizers installed by this public WebKit setter.
        // Do not depend on private UIKit class names or replace their delegates.
        recognizers = (webview.gestureRecognizers ?? []).filter {
            !existing.contains(ObjectIdentifier($0)) && $0.isEnabled
        }
        if recognizers.isEmpty {
            // An unexpected host configuration must not enable root-page back.
            webview.allowsBackForwardNavigationGestures = false
        }
        for recognizer in recognizers {
            recognizer.addTarget(self, action: #selector(gestureChanged(_:)))
        }
        setEnabled(false)
    }

    func belongs(to webview: WKWebView) -> Bool { self.webview === webview }

    func setEnabled(_ enabled: Bool, cancelActive: Bool = false) {
        self.enabled = enabled
        for recognizer in recognizers {
            // A committed pop changes the URL before UIKit finishes its swipe.
            // Do not cancel that transition when the destination is a root page.
            if !cancelActive && (recognizer.state == .began || recognizer.state == .changed) { continue }
            if recognizer.isEnabled != enabled { recognizer.isEnabled = enabled }
        }
    }

    @objc private func gestureChanged(_ recognizer: UIGestureRecognizer) {
        if recognizer.state == .ended || recognizer.state == .cancelled || recognizer.state == .failed {
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.setEnabled(self.enabled)
            }
        }
    }

    deinit {
        for recognizer in recognizers {
            recognizer.removeTarget(self, action: nil)
            recognizer.isEnabled = false
        }
    }
}
