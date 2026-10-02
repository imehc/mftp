package com.imehc.mftp

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var webViewInsets: WebViewInsets? = null
  private var webViewBackNavigation: WebViewBackNavigation? = null
  // Android filters multicast packets unless a MulticastLock is held;
  // without it mDNS discovery (game rooms / LAN devices) sees nothing.
  private var multicastLock: WifiManager.MulticastLock? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    try {
      val wifi =
        applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      multicastLock = wifi.createMulticastLock("mftp-mdns").apply {
        setReferenceCounted(false)
        acquire()
      }
    } catch (_: Exception) {
      // No Wi-Fi service (TV/emulator edge cases): discovery degrades to
      // direct-connect, which needs no multicast.
    }
  }

  override fun onDestroy() {
    webViewBackNavigation?.dispose()
    webViewInsets?.dispose()
    try {
      multicastLock?.release()
    } catch (_: Exception) {}
    super.onDestroy()
  }

  override fun onWebViewCreate(webView: WebView) {
    webViewBackNavigation?.dispose()
    webViewInsets?.dispose()
    val backNavigation = WebViewBackNavigation(this, webView)
    webViewBackNavigation = backNavigation
    webViewInsets = WebViewInsets(this, webView, backNavigation::onImeVisibilityChanged)
  }

  override fun onResume() {
    super.onResume()
    AiCredentialLifecycle.onResume(this)
    webViewInsets?.apply()
  }

  override fun onPause() {
    // Invalidate synchronously before Android finishes leaving the Activity.
    AiCredentialLifecycle.onPause()
    super.onPause()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    // Losing focus to a biometric dialog must not cancel its authentication.
    if (hasFocus) AiCredentialLifecycle.onFocusGained(this)
  }

}
