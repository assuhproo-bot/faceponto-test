package br.com.faceponto.terminal.capture

data class PadFrame(
    val capturedElapsedMs: Long,
    val faceConfidence: Float,
    val movementChallengeCompleted: Boolean,
    /** Ephemeral passive-PAD score. It is never persisted with the punch. */
    val passiveScore: Float? = null,
)

data class PadProviderDescriptor(
    val providerId: String,
    val modelVersion: String,
    val modelSha256: String,
    val policyVersion: Int,
)

sealed interface PadDecision {
    data class Passed(
        val sessionId: String,
        val score: Float,
        val descriptor: PadProviderDescriptor,
    ) : PadDecision

    data class Failed(val reason: String, val score: Float? = null) : PadDecision
    data class Unavailable(val reason: String) : PadDecision
}

interface PresentationAttackDetectionProvider {
    suspend fun evaluate(frames: List<PadFrame>): PadDecision
}

/** Production-safe default while no reviewed PAD implementation is provisioned. */
class UnavailablePadProvider : PresentationAttackDetectionProvider {
    override suspend fun evaluate(frames: List<PadFrame>): PadDecision =
        PadDecision.Unavailable("Nenhum provedor PAD homologado foi configurado")
}

/**
 * Records the existing movement challenge as test evidence only. It is deliberately
 * selected by the debug build, never by production. A moved photo or replay can still
 * satisfy this provider, so it must not be represented as passive PAD.
 */
class ActiveChallengeTestPadProvider : PresentationAttackDetectionProvider {
    override suspend fun evaluate(frames: List<PadFrame>): PadDecision {
        if (frames.size < MINIMUM_FRAMES) return PadDecision.Failed("Evidência de presença insuficiente")
        if (frames.zipWithNext().any { (previous, next) -> next.capturedElapsedMs <= previous.capturedElapsedMs }) {
            return PadDecision.Failed("Ordem temporal inválida")
        }
        if (!frames.last().movementChallengeCompleted) return PadDecision.Failed("Desafio de movimento incompleto")
        return PadDecision.Passed(
            sessionId = java.util.UUID.randomUUID().toString(), score = 1f,
            descriptor = PadProviderDescriptor(
                providerId = "active-challenge-test", modelVersion = "1",
                modelSha256 = "1c2f9ff1f849abfa656da4f7bad4300dc68180c5587056c18808f886d7d1002f",
                policyVersion = 1,
            ),
        )
    }

    private companion object { const val MINIMUM_FRAMES = 3 }
}

/**
 * Debug/test-only policy: a completed active challenge plus a MiniFASNet V1SE/V2
 * ensemble score from the current frames. The model files live in src/debug/assets,
 * so a release APK cannot use this provider.
 */
class ExperimentalMiniFasPadProvider : PresentationAttackDetectionProvider {
    override suspend fun evaluate(frames: List<PadFrame>): PadDecision {
        val active = ActiveChallengeTestPadProvider().evaluate(frames)
        if (active !is PadDecision.Passed) return active
        val scores = frames.mapNotNull { it.passiveScore }.takeLast(MINIMUM_PASSIVE_SCORES)
        if (scores.size < MINIMUM_PASSIVE_SCORES) {
            return PadDecision.Unavailable("PAD passivo experimental ainda carregando")
        }
        val score = scores.average().toFloat()
        if (score < PASS_THRESHOLD) {
            return PadDecision.Failed("PAD passivo experimental recusou a apresenta\u00e7\u00e3o", score)
        }
        return PadDecision.Passed(
            sessionId = java.util.UUID.randomUUID().toString(),
            score = score,
            descriptor = DESCRIPTOR,
        )
    }

    companion object {
        const val PASS_THRESHOLD = .80f
        const val MINIMUM_PASSIVE_SCORES = 3
        val DESCRIPTOR = PadProviderDescriptor(
            providerId = "minifasnet-v1se-v2-experimental",
            modelVersion = "2026-test-1",
            modelSha256 = "1f1ff7268858f92ff9777f6860cdd38a13a0cc2552f9514c427f7c9deb7200f2",
            policyVersion = 2,
        )
    }
}

fun defaultPadProvider(debugBuild: Boolean): PresentationAttackDetectionProvider =
    if (debugBuild) ExperimentalMiniFasPadProvider() else UnavailablePadProvider()
