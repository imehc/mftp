package com.imehc.export

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.UUID

// A distinct provider class prevents manifest merging from changing another plugin's authority.
class ModelExportFileProvider : FileProvider()

@InvokeArg
class ExportArgs {
    lateinit var id: String
    lateinit var path: String
    lateinit var mime: String
    lateinit var action: String
}

@InvokeArg
class CancelArgs { lateinit var id: String }

private class Pending(val args: ExportArgs, val file: File, val invoke: Invoke) {
    var cancelled = false
    var writing = false
}

@TauriPlugin
class NativeExportPlugin(private val activity: Activity) : Plugin(activity) {
    private var pending: Pending? = null
    private val cancelled = LinkedHashSet<String>()

    private fun reply(invoke: Invoke, outcome: String) {
        invoke.resolve(JSObject().put("outcome", outcome))
    }

    private fun complete(job: Pending, outcome: String) {
        if (pending === job) {
            pending = null
            reply(job.invoke, outcome)
        }
    }

    private fun validate(args: ExportArgs): File {
        UUID.fromString(args.id)
        val file = File(args.path).canonicalFile
        val root = File(activity.cacheDir, "mftp-model-exports").canonicalFile
        require(file.parentFile?.parentFile == root && file.parentFile?.name == args.id)
        require(file.isFile && file.length() in 1..(64L * 1024 * 1024))
        val expected = mapOf("png" to "image/png", "mp4" to "video/mp4", "webm" to "video/webm", "pdf" to "application/pdf", "txt" to "text/plain", "md" to "text/plain")
        require(expected[file.extension] == args.mime && args.action in listOf("save", "share"))
        return file
    }

    @Command
    fun present(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ExportArgs::class.java)
            val file = validate(args)
            activity.runOnUiThread {
                if (cancelled.remove(args.id)) { reply(invoke, "cancelled"); return@runOnUiThread }
                if (pending != null) { reply(invoke, "busy"); return@runOnUiThread }
                val job = Pending(args, file, invoke)
                pending = job
                try {
                    if (args.action == "share") {
                        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.mftp-export", file)
                        val intent = Intent(Intent.ACTION_SEND).apply {
                            type = args.mime
                            putExtra(Intent.EXTRA_STREAM, uri)
                            clipData = ClipData.newRawUri("", uri)
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        activity.startActivity(Intent.createChooser(intent, null))
                        // A chooser launch does not prove delivery or completion by the receiving app.
                        complete(job, "presented")
                    } else {
                        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = args.mime
                            putExtra(Intent.EXTRA_TITLE, file.name)
                        }
                        startActivityForResult(invoke, intent, "saveResult")
                    }
                } catch (_: Exception) { complete(job, "failed") }
            }
        } catch (_: Exception) { reply(invoke, "failed") }
    }

    @ActivityCallback
    fun saveResult(invoke: Invoke, result: ActivityResult) {
        val job = pending ?: return
        if (job.invoke !== invoke) return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null || job.cancelled) {
            complete(job, if (result.resultCode == Activity.RESULT_CANCELED || job.cancelled) "cancelled" else "failed")
            return
        }
        // Mark the real worker before leaving the UI thread. Cancellation cannot race into opening a target.
        job.writing = true
        Thread({
            val outcome = try {
                activity.contentResolver.openOutputStream(uri, "wt")?.use { output ->
                    job.file.inputStream().use { input -> input.copyTo(output, 64 * 1024) }
                    output.flush()
                } ?: throw IllegalStateException("No output stream")
                "saved"
            } catch (_: Exception) { "failed" }
            activity.runOnUiThread { complete(job, outcome) }
        }, "mftp-export-copy").start()
    }

    @Command
    fun cancel(invoke: Invoke) {
        try {
            val id = invoke.parseArgs(CancelArgs::class.java).id
            activity.runOnUiThread {
                val job = pending
                if (job?.args?.id == id) {
                    if (!job.writing) job.cancelled = true
                } else {
                    if (cancelled.size >= 32) cancelled.remove(cancelled.first())
                    cancelled.add(id)
                }
                invoke.resolve()
            }
        } catch (_: Exception) { invoke.reject("Native export cancellation failed") }
    }

    override fun onDestroy() {
        val job = pending
        if (job != null && !job.writing) complete(job, "cancelled")
        // An already-started copy keeps its invocation until the actual worker exits.
    }
}
