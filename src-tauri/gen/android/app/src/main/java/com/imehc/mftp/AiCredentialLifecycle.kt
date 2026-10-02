package com.imehc.mftp

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import androidx.annotation.Keep

// This bridge carries lifecycle state only. Credentials never enter Kotlin here.
@Keep
object AiCredentialLifecycle {
  private var resumed = false

  @JvmStatic
  private external fun setForeground(foreground: Boolean)

  fun onResume(activity: Activity) {
    resumed = true
    onFocusGained(activity)
  }

  fun onPause() {
    resumed = false
    setForeground(false)
  }

  fun onFocusGained(activity: Activity) {
    val keyguard = activity.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    setForeground(resumed && !keyguard.isDeviceLocked)
  }
}
