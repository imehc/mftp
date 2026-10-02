package com.imehc.mftp

import android.webkit.WebView
import android.os.SystemClock
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** Lets the existing web overlay stack handle Back before native navigation. */
class WebViewBackNavigation(
  private val activity: AppCompatActivity,
  private val webView: WebView,
) {
  private var disposed = false
  private var pending = false
  private var keyboardVisible = false
  private var lastImeHiddenAt: Long? = null

  fun onImeVisibilityChanged(visible: Boolean) {
    if (keyboardVisible && !visible) lastImeHiddenAt = SystemClock.uptimeMillis()
    if (visible) lastImeHiddenAt = null
    keyboardVisible = visible
  }

  private val callback = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
      if (pending || disposed) return
      val imeVisible = ViewCompat.getRootWindowInsets(webView)
        ?.isVisible(WindowInsetsCompat.Type.ime()) == true
      // Flyme forwards the same Back after reporting the IME hidden. Consume
      // that trailing dispatch once within the IME transition (250 ms), so it
      // cannot also close a web dialog. Later Back presses dismiss normally.
      val trailingImeBack = lastImeHiddenAt?.let {
        SystemClock.uptimeMillis() - it in 0..250
      } == true
      lastImeHiddenAt = null
      if (imeVisible || trailingImeBack) {
        if (imeVisible) {
          WindowInsetsControllerCompat(activity.window, webView).hide(WindowInsetsCompat.Type.ime())
        }
        return
      }
      pending = true
      // Radix consumes Escape only in the topmost dismissable layer. Respect
      // preventDefault too, so a busy editor can keep its existing close guard.
      webView.evaluateJavascript(
        "(()=>{const e=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});" +
          "document.dispatchEvent(e);return e.defaultPrevented;})()"
      ) { consumed ->
        pending = false
        if (disposed || !activity.hasWindowFocus() || consumed == "true") return@evaluateJavascript
        // Temporarily disable only our callback; Tauri retains history/exit
        // behavior and Android keeps priority for dismissing the IME.
        isEnabled = false
        try {
          activity.onBackPressedDispatcher.onBackPressed()
        } finally {
          if (!disposed) isEnabled = true
        }
      }
    }
  }

  init {
    activity.onBackPressedDispatcher.addCallback(activity, callback)
  }

  fun dispose() {
    disposed = true
    callback.remove()
  }
}
