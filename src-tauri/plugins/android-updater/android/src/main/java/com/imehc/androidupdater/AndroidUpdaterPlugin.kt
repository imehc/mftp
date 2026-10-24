package com.imehc.androidupdater

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageInfo
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

class AndroidUpdateFileProvider : FileProvider()

@InvokeArg
class InstallArgs {
    lateinit var path: String
    var expectedVersionCode: Long = 0
}

private class PendingInstall(
    val file: File,
    val targetVersionCode: Long,
    val invoke: Invoke,
)

@TauriPlugin
class AndroidUpdaterPlugin(private val activity: Activity) : Plugin(activity) {
    private var pending: PendingInstall? = null

    private fun packageInfo(): PackageInfo = activity.packageManager.getPackageInfo(activity.packageName, 0)

    private fun versionCode(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

    private fun canRequestPackageInstalls(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activity.packageManager.canRequestPackageInstalls()

    private fun reply(invoke: Invoke, outcome: String, extra: JSObject? = null) {
        val result = extra ?: JSObject()
        result.put("outcome", outcome)
        invoke.resolve(result)
    }

    @Command
    fun info(invoke: Invoke) {
        try {
            val info = packageInfo()
            reply(
                invoke,
                "ok",
                JSObject()
                    .put("packageName", activity.packageName)
                    .put("versionName", info.versionName ?: "")
                    .put("versionCode", versionCode(info))
                    .put("canRequestPackageInstalls", canRequestPackageInstalls()),
            )
        } catch (_: Exception) {
            invoke.reject("Unable to read Android package information")
        }
    }

    @Command
    fun install(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(InstallArgs::class.java)
            val file = File(args.path).canonicalFile
            val root = File(activity.cacheDir, "android-updates").canonicalFile
            require(file.parentFile == root)
            require(file.isFile && file.length() > 0L && file.extension.equals("apk", ignoreCase = true))
            require(args.expectedVersionCode > 0L)

            val current = packageInfo()
            val currentCode = versionCode(current)
            require(args.expectedVersionCode > currentCode)

            val archive = activity.packageManager.getPackageArchiveInfo(file.path, 0)
                ?: throw IllegalArgumentException("Invalid APK")
            require(archive.packageName == activity.packageName)
            require(versionCode(archive) == args.expectedVersionCode)

            activity.runOnUiThread {
                if (pending != null) {
                    reply(invoke, "busy")
                    return@runOnUiThread
                }
                if (!canRequestPackageInstalls()) {
                    reply(invoke, "permission_required")
                    return@runOnUiThread
                }
                val uri = FileProvider.getUriForFile(
                    activity,
                    "${activity.packageName}.mftp-android-updater",
                    file,
                )
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                try {
                    pending = PendingInstall(file, args.expectedVersionCode, invoke)
                    startActivityForResult(invoke, intent, "installResult")
                } catch (_: Exception) {
                    pending = null
                    reply(invoke, "failed")
                }
            }
        } catch (_: Exception) {
            reply(invoke, "invalid")
        }
    }

    @Command
    fun openInstallSettings(invoke: Invoke) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                reply(invoke, "unsupported")
                return
            }
            val intent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${activity.packageName}"),
            )
            activity.startActivity(intent)
            reply(invoke, "opened")
        } catch (_: Exception) {
            reply(invoke, "failed")
        }
    }

    @ActivityCallback
    fun installResult(invoke: Invoke, result: ActivityResult) {
        val job = pending ?: return
        if (job.invoke !== invoke) return
        if (result.resultCode != Activity.RESULT_OK && result.resultCode != Activity.RESULT_CANCELED) {
            pending = null
            reply(invoke, "failed")
            return
        }
        val installed = try { versionCode(packageInfo()) >= job.targetVersionCode } catch (_: Exception) { false }
        if (installed) launchWhenInstalled(job, 0)
        else {
            pending = null
            reply(invoke, if (result.resultCode == Activity.RESULT_CANCELED) "cancelled" else "failed")
        }
    }

    private fun launchWhenInstalled(job: PendingInstall, attempt: Int) {
        activity.runOnUiThread {
            val installed = try { versionCode(packageInfo()) >= job.targetVersionCode } catch (_: Exception) { false }
            if (installed) {
                pending = null
                try {
                    job.file.delete()
                    val launch = activity.packageManager.getLaunchIntentForPackage(activity.packageName)
                    if (launch != null) {
                        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                        activity.startActivity(launch)
                    }
                    reply(job.invoke, "installed")
                } catch (_: Exception) {
                    reply(job.invoke, "installed")
                }
            } else if (attempt < 12) {
                activity.window.decorView.postDelayed({ launchWhenInstalled(job, attempt + 1) }, 250L)
            } else {
                pending = null
                reply(job.invoke, "unknown")
            }
        }
    }

    override fun onResume(activity: AppCompatActivity) {
        val job = pending ?: return
        launchWhenInstalled(job, 0)
    }

    override fun onDestroy(activity: AppCompatActivity) {
        val job = pending
        if (job != null) {
            // The system installer owns the actual transaction; only release the
            // JS callback when no install activity is still in flight.
            pending = null
            reply(job.invoke, "cancelled")
        }
    }
}
