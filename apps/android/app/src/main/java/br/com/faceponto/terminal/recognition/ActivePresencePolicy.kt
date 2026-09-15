package br.com.faceponto.terminal.recognition

/**
 * Versioned evidence for the local, active presence check used by the test terminal.
 *
 * This is intentionally separate from a passive PAD model. The canonical material is
 * hashed so server-side facial profiles and captured events identify exactly which
 * policy authorized the event without retaining camera frames.
 */
object ActivePresencePolicy {
    const val VERSION = 1
    const val SHA256 = "1c2f9ff1f849abfa656da4f7bad4300dc68180c5587056c18808f886d7d1002f"

    fun passed(challenge: MovementChallengeState): Boolean =
        challenge.step == MovementStep.COMPLETE
}
