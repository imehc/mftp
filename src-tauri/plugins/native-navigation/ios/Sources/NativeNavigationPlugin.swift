import Tauri
import UIKit
import WebKit

private struct NavigationConfig: Decodable {
    let enabled: Bool
    let href: String
}

/// WebKit owns interactive progress, velocity, cancellation and snapshots.
/// We only enable it when the SPA has a safe parent and no dismissal guard.
final class NativeNavigationPlugin: Plugin {
    private weak var webview: WKWebView?
    private var requestedURL: URL?
    private var enabled = false
    private var keyboardVisible = false
    private var gestureGate: NavigationGestureGate?
    private var observations = [NSKeyValueObservation]()
    private var notifications = [NSObjectProtocol]()

    override func load(webview: WKWebView) {
        detach()
        self.webview = webview
        enabled = false
        requestedURL = nil
        if gestureGate?.belongs(to: webview) != true {
            gestureGate = NavigationGestureGate(webview: webview)
        }
        observations = [
            webview.observe(\.url, options: [.new]) { [weak self] _, _ in self?.apply() },
            webview.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in self?.apply() },
        ]
        let center = NotificationCenter.default
        notifications = [
            center.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { [weak self] _ in self?.keyboardChanged(true) },
            center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in self?.keyboardChanged(false) },
            center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
                self?.gestureGate?.setEnabled(false, cancelActive: true)
            },
            center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.apply() },
        ]
    }

    @objc public func configure(_ invoke: Invoke) throws {
        let config = try invoke.parseArgs(NavigationConfig.self)
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.webview != nil else {
                invoke.reject("Navigation WebView is unavailable")
                return
            }
            self.requestedURL = URL(string: config.href)
            self.enabled = config.enabled
            self.apply()
            invoke.resolve()
        }
    }

    private func apply() {
        guard let webview = webview else { return }
        // A state update from the previous route cannot enable the new route.
        let canSwipe = enabled
            && requestedURL == webview.url
            && webview.canGoBack
            && !keyboardVisible
            && UIApplication.shared.applicationState == .active
        gestureGate?.setEnabled(canSwipe)
    }

    private func keyboardChanged(_ visible: Bool) {
        keyboardVisible = visible
        if visible { gestureGate?.setEnabled(false, cancelActive: true) }
        apply()
        // Same native visibility contract as Android; focus is not IME state.
        webview?.evaluateJavaScript("document.documentElement.dataset.imeVisible='\(visible ? "true" : "false")';", completionHandler: nil)
    }

    private func detach() {
        gestureGate?.setEnabled(false, cancelActive: true)
        observations.removeAll()
        notifications.forEach { NotificationCenter.default.removeObserver($0) }
        notifications.removeAll()
        keyboardVisible = false
    }

    deinit { detach() }
}

@_cdecl("init_plugin_native_navigation")
func initPluginNativeNavigation() -> Plugin { NativeNavigationPlugin() }
