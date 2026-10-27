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
  private var request = 0
  private val timeout = Runnable { pending = false; request += 1 }
  private var keyboardVisible = false
  private var lastImeHiddenAt: Long? = null

  fun onImeVisibilityChanged(visible: Boolean) {
    if (keyboardVisible && !visible) lastImeHiddenAt = SystemClock.uptimeMillis()
    if (visible) lastImeHiddenAt = null
    keyboardVisible = visible
  }

  private val callback = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
      if (pending || disposed || !activity.hasWindowFocus()) return
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
      val current = ++request
      webView.postDelayed(timeout, 1500)
      // Radix consumes Escape only in the topmost dismissable layer. Respect
      // preventDefault too, so a busy editor can keep its existing close guard.
      webView.evaluateJavascript(
        "(()=>{const e=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});" +
          "document.dispatchEvent(e);if(e.defaultPrevented)return 'handled';" +
          "const b=new KeyboardEvent('keydown',{key:'BrowserBack',bubbles:true,cancelable:true});" +
          "document.dispatchEvent(b);if(b.defaultPrevented)return 'handled';" +
          "return document.documentElement.dataset.mobileNavigation==='root'?'background':'unavailable';})()"
      ) { consumed ->
        if (current != request) return@evaluateJavascript
        webView.removeCallbacks(timeout)
        pending = false
        if (disposed || !activity.hasWindowFocus() || consumed == "\"handled\"") return@evaluateJavascript
        if (consumed == "\"background\"") {
          activity.moveTaskToBack(true)
          return@evaluateJavascript
        }
        // During startup/reload the SPA may not have a handler yet. Only this
        // unavailable case delegates to Tauri; ready root pages never goBack.
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
    request += 1
    webView.removeCallbacks(timeout)
    callback.remove()
  }
}
