package com.imehc.viewer

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.OpenableColumns
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

@TauriPlugin
class NativeViewerPlugin(private val activity: Activity) : Plugin(activity) {
    private val queue = ArrayDeque<Uri>()
    private val busy = AtomicBoolean(false)
    private var loaded = false
    private var rejected = false
    private var cleaned = false
    private val root get() = File(activity.cacheDir, "mftp-model-inbox")

    override fun load(webView: WebView) {
        if (!loaded) { loaded = true; accept(activity.intent) }
    }
    override fun onNewIntent(intent: Intent) { accept(intent) }
    private fun accept(intent: Intent) {
        if (intent.action !in listOf(Intent.ACTION_VIEW, Intent.ACTION_SEND)) return
        val uri = if (intent.action == Intent.ACTION_VIEW) intent.data else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        }
        synchronized(queue) {
            if (uri == null || uri.scheme !in listOf("content", "file") || queue.size >= 8) rejected = true
            else queue.addLast(uri)
        }
    }
    private fun thermal(): String {
        if (Build.VERSION.SDK_INT < 29) return "unknown"
        return try {
            when ((activity.getSystemService(Activity.POWER_SERVICE) as PowerManager).currentThermalStatus) {
                0 -> "nominal"
                1, 2 -> "fair"
                3 -> "serious"
                else -> "critical"
            }
        } catch (_: Exception) { "unknown" }
    }
    private fun copy(uri: Uri): JSObject {
        val name = if (uri.scheme == "content") {
            activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        } else File(uri.path ?: "").name
        require(name != null && name.lowercase().endsWith(".glb") && name.toByteArray().size <= 240)
        require(root.mkdirs() || root.isDirectory)
        require(root.canonicalFile.parentFile == activity.cacheDir.canonicalFile && root.canonicalFile.name == "mftp-model-inbox")
        if (!cleaned) {
            // Only stale UUID files from earlier processes are eligible. Never delete sources.
            root.listFiles()?.forEach { file ->
                val owned = runCatching { UUID.fromString(file.nameWithoutExtension) }.isSuccess
                if (owned && file.extension == "glb" && file.canonicalFile.parentFile == root.canonicalFile && file.isFile && System.currentTimeMillis() - file.lastModified() > 86400000L) require(file.delete())
            }
            cleaned = true
        }
        val used = root.listFiles()?.sumOf { it.length() } ?: 0L
        val limit = 512L * 1024 * 1024
        require(used < limit)
        val destination = File(root, "${UUID.randomUUID()}.glb")
        var completed = false
        try {
            activity.contentResolver.openInputStream(uri)?.use { input ->
                destination.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        require(used + total <= limit)
                        output.write(buffer, 0, count)
                    }
                    require(total >= 12)
                }
            } ?: error("Cannot open model")
            destination.inputStream().use { val magic = ByteArray(4); java.io.DataInputStream(it).readFully(magic); require(magic.contentEquals(byteArrayOf(103, 108, 84, 70))) }
            completed = true
            return JSObject().put("path", destination.absolutePath).put("name", name)
        } finally {
            // Only this operation's newly created partial copy can be removed.
            if (!completed && destination.exists() && !destination.delete()) throw IllegalStateException("Copy cleanup failed")
        }
    }
    @Command
    fun poll(invoke: Invoke) {
        if (!busy.compareAndSet(false, true)) { invoke.reject("Viewer polling busy"); return }
        val items: List<Uri>
        var failed: Boolean
        synchronized(queue) { items = queue.toList(); queue.clear(); failed = rejected; rejected = false }
        Thread({
            val files = JSONArray()
            try {
                for (uri in items) try { files.put(copy(uri)) } catch (_: Exception) { failed = true }
                invoke.resolve(JSObject().put("files", files).put("failed", failed).put("thermal", thermal()))
            } finally { busy.set(false) }
        }, "mftp-model-import").start()
    }
}
