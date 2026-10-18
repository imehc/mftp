package com.imehc.mftp

import android.content.Context
import androidx.annotation.Keep

@Keep
object NativeTls {
  init {
    // Wry normally loads this library later in super.onCreate(). HTTPS must
    // have its application context before Rust starts background services.
    System.loadLibrary("mftp_lib")
  }

  @JvmStatic
  external fun initialize(context: Context)
}
