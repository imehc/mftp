package com.imehc.mftp

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class FileOpenArgs {
  lateinit var path: String
}

@TauriPlugin
class FileOpenerPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun openFile(invoke: Invoke) {
    try {
      val file = File(invoke.parseArgs(FileOpenArgs::class.java).path)
      val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
      val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase())
        ?: "application/octet-stream"
      // Grant temporary read access to the original file, without a shared cache copy.
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mime)
        clipData = ClipData.newRawUri("", uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      activity.startActivity(Intent.createChooser(intent, null))
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject(error.message)
    }
  }
}
