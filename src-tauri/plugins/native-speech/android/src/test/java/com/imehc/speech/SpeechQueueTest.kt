package com.imehc.speech

import org.junit.Assert.*
import org.junit.Test

class SpeechQueueTest {
    @Test fun sentenceOffsetsPreserveUtf16AndParagraphs() {
        val chunks = speechChunks(listOf("静夜思。唐，李白。", "月😀明。 夜静！"), 4000)
        assertEquals(listOf(0, 4, 0, 5), chunks.map { it.start })
        assertEquals(listOf(0, 0, 1, 1), chunks.map { it.segment })
        assertEquals("月😀明。 夜静！", chunks.filter { it.segment == 1 }.joinToString("") { it.text })
    }

    @Test fun engineLimitNeverSplitsSurrogatePair() {
        val text = "月😀亮😀夜😀"
        val chunks = speechChunks(listOf(text), 2)
        assertEquals(text, chunks.joinToString("") { it.text })
        assertTrue(chunks.all { it.text.length <= 2 && !Character.isHighSurrogate(it.text.last()) })
    }

    @Test fun pauseResumesSameSentenceAndRejectsOldCompletion() {
        val queue = SpeechQueue(speechChunks(listOf("第一句。第二句。"), 4000))
        val first = queue.begin()
        queue.interrupt()
        val resumed = queue.begin()
        assertFalse(queue.complete(first))
        assertEquals(0, queue.index)
        assertTrue(queue.complete(resumed))
        assertEquals(1, queue.index)
        assertFalse(queue.complete(resumed))
    }
}
