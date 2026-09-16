package br.com.faceponto.terminal.clock

import java.time.Instant

object PunchCooldown {
    const val MINIMUM_INTERVAL_MS = 5 * 60 * 1_000L

    fun stillActive(lastPunch: Instant, currentPunch: Instant): Boolean =
        currentPunch.toEpochMilli() - lastPunch.toEpochMilli() < MINIMUM_INTERVAL_MS
}
