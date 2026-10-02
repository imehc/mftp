package com.imehc.mftp

import android.app.Activity
import android.graphics.Rect
import android.os.Build
import android.view.View
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/** Publishes native geometry once; pages and portals share the same viewport. */
class WebViewInsets(
  private val activity: Activity,
  private val webView: WebView,
  private val onImeVisibilityChanged: (Boolean) -> Unit,
) {
  private var script: String? = null
  private val reapply = Runnable { apply() }
  private val layoutListener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
    ViewCompat.getRootWindowInsets(webView)?.let { update(it) }
  }

  init {
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      update(insets)
      // Initial insets can precede the HTML document; keep the existing late retry.
      webView.removeCallbacks(reapply)
      webView.postDelayed(reapply, 500)
      webView.postDelayed(reapply, 2000)
      insets
    }
    webView.addOnLayoutChangeListener(layoutListener)
    ViewCompat.requestApplyInsets(webView)
  }

  private fun update(insets: WindowInsetsCompat) {
    val bars = insets.getInsets(
      WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    )
    val keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
    onImeVisibilityChanged(keyboardVisible)
    // Flyme can hide the navigation bar while retaining the bottom gesture area.
    val bottomInset = maxOf(bars.bottom, insets.getInsets(
      WindowInsetsCompat.Type.mandatorySystemGestures()
    ).bottom)
    val position = IntArray(2)
    webView.getLocationOnScreen(position)
    val availableHeight = if (keyboardVisible) {
      val keyboardTop = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        activity.windowManager.currentWindowMetrics.bounds.bottom -
          insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      } else {
        // Before WindowMetrics, the visible frame already excludes the IME.
        val frame = Rect()
        webView.getWindowVisibleDisplayFrame(frame)
        frame.bottom
      }
      // Some WebViews resize themselves; min prevents subtracting the IME twice.
      minOf(webView.height, keyboardTop - position[1]).coerceAtLeast(0)
    } else webView.height
    val density = activity.resources.displayMetrics.density
    fun dp(px: Int) = px / density
    script = "(()=>{const r=document.documentElement;if(!r)return;" +
      "r.style.setProperty('--safe-top','${dp(bars.top)}px');" +
      "r.style.setProperty('--safe-bottom','${dp(if (keyboardVisible) 0 else bottomInset)}px');" +
      "r.style.setProperty('--safe-left','${dp(bars.left)}px');" +
      "r.style.setProperty('--safe-right','${dp(bars.right)}px');" +
      "r.style.setProperty('--native-viewport-height','${dp(availableHeight)}px');})()"
    apply()
  }

  fun apply() {
    script?.let { webView.evaluateJavascript(it, null) }
  }

  fun dispose() {
    webView.removeCallbacks(reapply)
    webView.removeOnLayoutChangeListener(layoutListener)
    ViewCompat.setOnApplyWindowInsetsListener(webView, null)
  }
}
