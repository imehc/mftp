import XCTest
import WebKit
@testable import tauri_plugin_native_navigation

final class NavigationGestureGateTests: XCTestCase {
    @MainActor func testDisabledRootStillRecordsSnapshots() {
        let webview = WKWebView()
        let original = webview.gestureRecognizers ?? []
        let gate = NavigationGestureGate(webview: webview)
        let added = (webview.gestureRecognizers ?? []).filter { candidate in
            !original.contains { $0 === candidate }
        }
        XCTAssertTrue(webview.allowsBackForwardNavigationGestures)
        XCTAssertGreaterThanOrEqual(added.count, 2)
        XCTAssertTrue(added.allSatisfy { !$0.isEnabled })
        gate.setEnabled(true)
        XCTAssertGreaterThanOrEqual(added.filter(\.isEnabled).count, 2)
        gate.setEnabled(false)
        XCTAssertTrue(webview.allowsBackForwardNavigationGestures)
        XCTAssertTrue(added.allSatisfy { !$0.isEnabled })
    }

    @MainActor func testExistingTouchRecognizersRemainUnchanged() {
        let webview = WKWebView()
        let tap = UITapGestureRecognizer()
        let disabledPan = UIPanGestureRecognizer()
        disabledPan.isEnabled = false
        webview.addGestureRecognizer(tap)
        webview.addGestureRecognizer(disabledPan)
        let gate = NavigationGestureGate(webview: webview)
        gate.setEnabled(true)
        gate.setEnabled(false, cancelActive: true)
        XCTAssertTrue(tap.isEnabled)
        XCTAssertFalse(disabledPan.isEnabled)
        XCTAssertTrue(webview.scrollView.panGestureRecognizer.isEnabled)
        XCTAssertTrue(gate.belongs(to: webview))
        XCTAssertFalse(gate.belongs(to: WKWebView()))
    }

    @MainActor func testReleasingGateDisablesNavigation() {
        let webview = WKWebView()
        let original = Set((webview.gestureRecognizers ?? []).map(ObjectIdentifier.init))
        var gate: NavigationGestureGate? = NavigationGestureGate(webview: webview)
        gate?.setEnabled(true)
        weak var released = gate
        gate = nil
        XCTAssertNil(released)
        let added = (webview.gestureRecognizers ?? []).filter { !original.contains(ObjectIdentifier($0)) }
        XCTAssertTrue(added.allSatisfy { !$0.isEnabled })
    }
}
