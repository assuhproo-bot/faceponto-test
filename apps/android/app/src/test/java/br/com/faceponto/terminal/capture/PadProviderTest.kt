package br.com.faceponto.terminal.capture

import org.junit.Assert.assertTrue
import org.junit.Test

class PadProviderTest {
    @Test fun `test provider requires an ordered completed movement challenge`() {
        val result = kotlinx.coroutines.runBlocking {
            ActiveChallengeTestPadProvider().evaluate(listOf(frame(10), frame(20), frame(30, completed = true)))
        }
        assertTrue(result is PadDecision.Passed)
    }

    @Test fun `test provider rejects incomplete or unordered evidence`() {
        val provider = ActiveChallengeTestPadProvider()
        val incomplete = kotlinx.coroutines.runBlocking { provider.evaluate(listOf(frame(10), frame(20), frame(30))) }
        val unordered = kotlinx.coroutines.runBlocking { provider.evaluate(listOf(frame(10), frame(10), frame(30, completed = true))) }
        assertTrue(incomplete is PadDecision.Failed)
        assertTrue(unordered is PadDecision.Failed)
    }

    @Test fun `production selection blocks capture without an approved passive provider`() {
        assertTrue(defaultPadProvider(debugBuild = false) is UnavailablePadProvider)
        assertTrue(defaultPadProvider(debugBuild = true) is ExperimentalMiniFasPadProvider)
    }

    @Test fun `experimental provider requires both active and passive evidence`() {
        val provider = ExperimentalMiniFasPadProvider()
        val passed = kotlinx.coroutines.runBlocking {
            provider.evaluate(listOf(frame(10, passiveScore = .91f), frame(20, passiveScore = .90f), frame(30, completed = true, passiveScore = .89f)))
        }
        val rejected = kotlinx.coroutines.runBlocking {
            provider.evaluate(listOf(frame(10, passiveScore = .20f), frame(20, passiveScore = .10f), frame(30, completed = true, passiveScore = .30f)))
        }
        assertTrue(passed is PadDecision.Passed)
        assertTrue(rejected is PadDecision.Failed)
    }

    private fun frame(time: Long, completed: Boolean = false, passiveScore: Float? = null) = PadFrame(time, .99f, completed, passiveScore)
}
