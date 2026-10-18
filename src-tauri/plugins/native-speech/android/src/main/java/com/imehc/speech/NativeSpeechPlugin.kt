package com.imehc.speech

import android.app.Activity
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject

@InvokeArg
class SpeechStartArgs {
    var sessionId: String = ""
    var segments: List<String> = emptyList()
    var voiceId: String = ""
    var rate: Float = 1f
    var events: Channel? = null
}

@InvokeArg
class SpeechControlArgs {
    var sessionId: String = ""
    var action: String = ""
}

private class Playback(val args: SpeechStartArgs, val queue: SpeechQueue) {
    var phase = "preparing"
    var starting = true
    var sequence = 0L
    var rangeStart: Int? = null
    var rangeLength: Int? = null
}

@TauriPlugin
class NativeSpeechPlugin(private val activity: Activity) : Plugin(activity) {
    private val main = Handler(Looper.getMainLooper())
    private val audio = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    private var focus: AudioFocusRequest? = null
    private var focusGeneration = 0L
    private var engine: TextToSpeech? = null
    private var initialized = false
    private var initializing = false
    private var closed = false
    private var foreground = true
    private var initialization = 0L
    private val pending = mutableListOf<(Boolean) -> Unit>()
    private var playback: Playback? = null
    private var watchdog: Runnable? = null

    private fun reply(invoke: Invoke, code: String? = null) {
        invoke.resolve(JSObject().put("errorCode", code ?: JSONObject.NULL))
    }

    private fun ready(action: (Boolean) -> Unit) {
        if (closed) { action(false); return }
        if (initialized) { action(true); return }
        if (pending.size >= 8) { action(false); return }
        pending.add(action)
        if (initializing) return
        initializing = true
        val attempt = ++initialization
        try {
            engine = TextToSpeech(activity.applicationContext) { status ->
                main.post {
                    if (attempt == initialization && initializing) {
                        finishInitialization(status == TextToSpeech.SUCCESS)
                    }
                }
            }
            main.postDelayed({
                if (attempt == initialization && initializing) finishInitialization(false)
            }, 10000)
        } catch (_: Exception) { finishInitialization(false) }
    }

    private fun finishInitialization(success: Boolean) {
        initializing = false
        initialized = success && !closed && runCatching {
            engine?.setOnUtteranceProgressListener(listener) == TextToSpeech.SUCCESS &&
                engine?.setAudioAttributes(attributes) == TextToSpeech.SUCCESS
        }.getOrDefault(false)
        if (!initialized) {
            runCatching { engine?.shutdown() }
            engine = null
        }
        val waiting = pending.toList()
        pending.clear()
        waiting.forEach { it(initialized) }
    }

    private fun voices(): List<Voice> = engine?.voices.orEmpty().filter { voice ->
        !voice.isNetworkConnectionRequired &&
            voice.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) != true
    }.sortedWith(compareBy({ it.locale.toLanguageTag() }, { it.name }))

    @Command
    fun catalog(invoke: Invoke) {
        main.post {
            ready { available ->
                try {
                    val items = JSONArray()
                    if (available) for (voice in voices()) items.put(JSObject()
                        .put("id", voice.name).put("name", voice.name)
                        .put("language", voice.locale.toLanguageTag())
                        .put("quality", (voice.quality / 100).coerceIn(0, 5)))
                    invoke.resolve(JSObject().put("available", true).put("voices", items))
                } catch (_: Exception) { reply(invoke, "unavailable") }
            }
        }
    }

    @Command
    fun start(invoke: Invoke) {
        val args = invoke.parseArgs(SpeechStartArgs::class.java)
        main.post {
            ready { available ->
                if (!available || !foreground) { reply(invoke, "unavailable"); return@ready }
                try {
                    if (args.events == null || args.segments.isEmpty() || args.segments.size > 512 ||
                        args.segments.any { it.isBlank() } || args.segments.sumOf { it.length } > 65536 ||
                        !args.rate.isFinite() || args.rate !in 0.5f..1.5f) {
                        reply(invoke, "input_invalid"); return@ready
                    }
                    terminate("stopped")
                    val voice = voices().find { it.name == args.voiceId }
                    if (voice == null) { reply(invoke, "voice_missing"); return@ready }
                    val active = Playback(args, SpeechQueue(speechChunks(args.segments,
                        TextToSpeech.getMaxSpeechInputLength().coerceAtLeast(2))))
                    playback = active
                    if (engine?.setVoice(voice) != TextToSpeech.SUCCESS ||
                        engine?.setSpeechRate(args.rate) != TextToSpeech.SUCCESS || !acquireFocus()) {
                        terminate("failed", "start_failed")
                        reply(invoke, "start_failed"); return@ready
                    }
                    speakCurrent(active)
                    reply(invoke)
                } catch (_: Exception) {
                    terminate("failed", "start_failed")
                    reply(invoke, "start_failed")
                }
            }
        }
    }

    @Command
    fun control(invoke: Invoke) {
        val args = invoke.parseArgs(SpeechControlArgs::class.java)
        main.post {
            val active = playback
            if (active == null || active.args.sessionId != args.sessionId) { reply(invoke); return@post }
            try {
                when (args.action) {
                    "stop" -> terminate("stopped")
                    "pause" -> if (active.phase in listOf("preparing", "speaking")) {
                        active.queue.interrupt()
                        cancelWatchdog()
                        if (engine?.stop() != TextToSpeech.SUCCESS) {
                            terminate("failed", "control_failed")
                            reply(invoke, "control_failed"); return@post
                        }
                        releaseFocus()
                        publish(active, "paused")
                    }
                    "resume" -> if (active.phase == "paused") {
                        if (!foreground || !acquireFocus()) {
                            terminate("failed", "control_failed")
                            reply(invoke, "control_failed"); return@post
                        }
                        speakCurrent(active)
                    }
                    else -> { reply(invoke, "input_invalid"); return@post }
                }
                reply(invoke)
            } catch (_: Exception) {
                terminate("failed", "control_failed")
                reply(invoke, "control_failed")
            }
        }
    }

    private fun publish(active: Playback, phase: String, error: String? = null) {
        active.phase = phase
        val range = if (active.rangeStart != null && active.rangeLength != null)
            JSObject().put("start", active.rangeStart).put("length", active.rangeLength)
        else JSONObject.NULL
        val event = JSObject().put("sessionId", active.args.sessionId)
            .put("sequence", ++active.sequence).put("phase", phase)
            .put("segmentIndex", active.queue.current?.segment ?: (active.args.segments.size - 1))
            .put("textRange", range).put("errorCode", error ?: JSONObject.NULL)
        // Activity teardown may invalidate the bridge after the native audio has stopped.
        runCatching { active.args.events?.send(event) }
    }

    private fun speakCurrent(active: Playback) {
        if (playback !== active) return
        val chunk = active.queue.current
        if (chunk == null) { terminate("finished"); return }
        val token = active.queue.begin()
        active.rangeStart = null
        active.rangeLength = null
        active.starting = true
        publish(active, if (active.phase == "speaking") "speaking" else "preparing")
        cancelWatchdog()
        watchdog = Runnable {
            if (playback === active && active.queue.accepts(token) && active.starting)
                terminate("failed", "start_failed")
        }.also { main.postDelayed(it, 15000) }
        val result = engine?.speak(chunk.text, TextToSpeech.QUEUE_FLUSH, Bundle(), token)
        if (result != TextToSpeech.SUCCESS) terminate("failed", "start_failed")
    }

    private fun callback(id: String?, action: (Playback) -> Unit) {
        main.post {
            val active = playback
            if (active != null && active.queue.accepts(id)) {
                try { action(active) } catch (_: Exception) { terminate("failed", "control_failed") }
            }
        }
    }

    private val listener = object : UtteranceProgressListener() {
        override fun onStart(id: String?) = callback(id) {
            it.starting = false
            cancelWatchdog()
            publish(it, "speaking")
        }

        override fun onDone(id: String?) = callback(id) {
            if (it.queue.complete(id)) speakCurrent(it)
        }

        @Deprecated("Android legacy callback")
        override fun onError(id: String?) = callback(id) { terminate("failed", "start_failed") }

        override fun onError(id: String?, errorCode: Int) = callback(id) {
            terminate("failed", if (errorCode == TextToSpeech.ERROR_NOT_INSTALLED_YET) "voice_missing" else "start_failed")
        }

        override fun onStop(id: String?, interrupted: Boolean) = callback(id) { terminate("stopped") }

        override fun onRangeStart(id: String?, start: Int, end: Int, frame: Int) = callback(id) {
            val chunk = it.queue.current ?: return@callback
            if (it.phase != "speaking" || start < 0 || end <= start || end > chunk.text.length) return@callback
            val offset = chunk.start + start
            if (it.rangeStart?.let { previous -> offset < previous } == true) return@callback
            it.rangeStart = offset
            it.rangeLength = end - start
            publish(it, "speaking")
        }
    }

    private fun acquireFocus(): Boolean {
        releaseFocus()
        val generation = focusGeneration
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener({ change ->
                if (generation == focusGeneration && focus != null && change != AudioManager.AUDIOFOCUS_GAIN)
                    terminate("stopped")
            }, main).build()
        focus = request
        if (audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) return true
        releaseFocus()
        return false
    }

    private fun releaseFocus() {
        val previous = focus
        focus = null
        focusGeneration++
        if (previous != null) runCatching { audio.abandonAudioFocusRequest(previous) }
    }

    private fun cancelWatchdog() {
        watchdog?.let { main.removeCallbacks(it) }
        watchdog = null
    }

    private fun terminate(phase: String, error: String? = null) {
        val active = playback
        playback = null
        active?.queue?.interrupt()
        cancelWatchdog()
        val stopped = runCatching { engine?.stop() ?: TextToSpeech.SUCCESS }.getOrDefault(TextToSpeech.ERROR)
        releaseFocus()
        if (active != null) {
            active.rangeStart = null
            active.rangeLength = null
            publish(active, if (stopped == TextToSpeech.SUCCESS) phase else "failed",
                if (stopped == TextToSpeech.SUCCESS) error else "control_failed")
        }
    }

    override fun onResume(activity: AppCompatActivity) { foreground = true }

    override fun onPause(activity: AppCompatActivity) {
        foreground = false
        terminate("stopped")
    }

    override fun onDestroy(activity: AppCompatActivity) {
        closed = true
        foreground = false
        terminate("stopped")
        finishInitialization(false)
        main.removeCallbacksAndMessages(null)
    }
}
