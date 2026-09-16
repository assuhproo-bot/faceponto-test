package br.com.faceponto.terminal.clock

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class PunchCooldownTest {
    private val firstPunch = Instant.parse("2026-09-16T08:00:00Z")

    @Test fun `blocks a punch made before five minutes have elapsed`() {
        assertEquals(true, PunchCooldown.stillActive(firstPunch, Instant.parse("2026-09-16T08:04:59Z")))
    }

    @Test fun `allows a punch made at five minutes`() {
        assertEquals(false, PunchCooldown.stillActive(firstPunch, Instant.parse("2026-09-16T08:05:00Z")))
    }
}
