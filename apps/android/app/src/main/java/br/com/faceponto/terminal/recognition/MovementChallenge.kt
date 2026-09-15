package br.com.faceponto.terminal.recognition

import kotlin.random.Random

enum class MovementStep { CENTER, FIRST_SIDE, OPPOSITE_SIDE, COMPLETE }

data class MovementChallengeState(
    val step: MovementStep = MovementStep.CENTER,
    val firstWasLeft: Boolean = false,
    val stableFrames: Int = 0,
    val lastValidElapsedMs: Long = 0,
) {
    val instruction: String get() = when (step) {
        MovementStep.CENTER -> "Centralize o rosto para iniciar"
        MovementStep.FIRST_SIDE -> if (firstWasLeft) "Vire a cabeça para a esquerda" else "Vire a cabeça para a direita"
        MovementStep.OPPOSITE_SIDE -> if (firstWasLeft) "Agora vire a cabeça para a direita" else "Agora vire a cabeça para a esquerda"
        MovementStep.COMPLETE -> "Presença confirmada"
    }

    fun advance(observation: FaceObservation, identified: Boolean, nowElapsedMs: Long): MovementChallengeState {
        if (lastValidElapsedMs > 0 && nowElapsedMs - lastValidElapsedMs > SESSION_TIMEOUT_MS) return create()
        if (!identified || !observation.usable || observation.yawRatio == null) return this
        val position = observation.yawRatio
        return when (step) {
            MovementStep.CENTER -> accumulate(position in CENTER_MIN..CENTER_MAX, MovementStep.FIRST_SIDE)
            MovementStep.FIRST_SIDE -> accumulate(if (firstWasLeft) position <= SIDE_MIN else position >= SIDE_MAX, MovementStep.OPPOSITE_SIDE)
            MovementStep.OPPOSITE_SIDE -> accumulate(if (firstWasLeft) position >= SIDE_MAX else position <= SIDE_MIN, MovementStep.COMPLETE)
            MovementStep.COMPLETE -> this
        }.copy(lastValidElapsedMs = nowElapsedMs)
    }

    private fun accumulate(condition: Boolean, next: MovementStep): MovementChallengeState {
        if (!condition) return copy(stableFrames = 0)
        val count = stableFrames + 1
        return if (count >= REQUIRED_FRAMES) copy(step = next, stableFrames = 0) else copy(stableFrames = count)
    }

    companion object {
        private const val CENTER_MIN = .38f
        private const val CENTER_MAX = .62f
        private const val SIDE_MIN = .36f
        private const val SIDE_MAX = .64f
        private const val REQUIRED_FRAMES = 3
        private const val SESSION_TIMEOUT_MS = 5_000L
        fun create(): MovementChallengeState = MovementChallengeState(firstWasLeft = Random.nextBoolean())
    }
}
