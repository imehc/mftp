package com.imehc.speech

internal data class SpeechChunk(val segment: Int, val start: Int, val text: String)

internal fun speechChunks(segments: List<String>, limit: Int): List<SpeechChunk> {
    require(limit >= 2)
    return segments.flatMapIndexed { segment, text ->
        val chunks = mutableListOf<SpeechChunk>()
        var start = 0
        while (start < text.length) {
            var end = minOf(start + limit, text.length)
            if (end < text.length && Character.isHighSurrogate(text[end - 1])) end--
            for (index in start until end) {
                if (text[index] in "。！？!?；;\n") {
                    end = index + 1
                    break
                }
            }
            val part = text.substring(start, end)
            if (part.isNotBlank()) chunks.add(SpeechChunk(segment, start, part))
            start = end
        }
        chunks
    }
}

/** Tokens change on pause/stop/restart so late binder callbacks cannot advance the queue. */
internal class SpeechQueue(val chunks: List<SpeechChunk>) {
    private val identity = java.util.UUID.randomUUID().toString()
    var index = 0
        private set
    private var generation = 0L
    private var token: String? = null
    val current get() = chunks.getOrNull(index)

    fun begin(): String {
        generation++
        return "$identity:$generation:$index".also { token = it }
    }

    fun accepts(id: String?) = id != null && token == id

    fun interrupt() { token = null }

    fun complete(id: String?): Boolean {
        if (!accepts(id)) return false
        token = null
        index++
        return true
    }
}
