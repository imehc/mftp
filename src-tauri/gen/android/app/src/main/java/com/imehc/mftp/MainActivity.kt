package com.imehc.mftp

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var safeAreaJs: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val density = resources.displayMetrics.density
      fun toDp(px: Int) = px / density
      safeAreaJs =
        "document.documentElement.style.setProperty('--safe-top','${toDp(bars.top)}px');" +
        "document.documentElement.style.setProperty('--safe-bottom','${toDp(bars.bottom)}px');" +
        "document.documentElement.style.setProperty('--safe-left','${toDp(bars.left)}px');" +
        "document.documentElement.style.setProperty('--safe-right','${toDp(bars.right)}px');"
      applySafeArea()
      // The page may not have loaded when the first inset pass runs; re-apply
      // shortly after so the SPA document picks the values up.
      webView.postDelayed({ applySafeArea() }, 500)
      webView.postDelayed({ applySafeArea() }, 2000)
      insets
    }
  }

  override fun onResume() {
    super.onResume()
    applySafeArea()
  }

  private fun applySafeArea() {
    val js = safeAreaJs ?: return
    webView?.evaluateJavascript(js, null)
  }
}
