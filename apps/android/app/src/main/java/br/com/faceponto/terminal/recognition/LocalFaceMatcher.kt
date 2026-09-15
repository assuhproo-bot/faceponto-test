package br.com.faceponto.terminal.recognition

import android.util.Log
import br.com.faceponto.terminal.storage.FacialProfileCandidate
import kotlin.math.sqrt

data class LocalMatch(val employeeId: String, val employeeName: String, val similarity: Float)

class LocalFaceMatcher(private val cipher: BiometricCipher = BiometricCipher()) {
    fun identify(probe: FloatArray, candidates: List<FacialProfileCandidate>): LocalMatch? {
        val ranked = candidates.asSequence()
            .filter { it.modelSha256 == OpenCvFaceEngine.RECOGNITION_SHA256 }
            .map { candidate ->
                val enrolled = cipher.decrypt(candidate.employeeId, candidate.modelSha256, candidate.encryptedEmbedding)
                LocalMatch(candidate.employeeId, candidate.employeeName, cosine(probe, enrolled))
            }
            .sortedByDescending(LocalMatch::similarity)
            .toList()
        val best = ranked.firstOrNull() ?: return null
        val second = ranked.getOrNull(1)
        if (br.com.faceponto.terminal.BuildConfig.DEBUG) Log.d("FacePontoMatch", "best_similarity=%.3f candidates=%d".format(best.similarity, ranked.size))
        return best.takeIf { it.similarity >= COSINE_THRESHOLD && (second == null || it.similarity - second.similarity >= MINIMUM_MARGIN) }
    }

    private fun cosine(left: FloatArray, right: FloatArray): Float {
        if (left.size != right.size || left.isEmpty()) return -1f
        var dot = 0.0; var leftNorm = 0.0; var rightNorm = 0.0
        for (index in left.indices) {
            dot += left[index] * right[index]
            leftNorm += left[index] * left[index]
            rightNorm += right[index] * right[index]
        }
        if (leftNorm == 0.0 || rightNorm == 0.0) return -1f
        return (dot / (sqrt(leftNorm) * sqrt(rightNorm))).toFloat()
    }

    companion object {
        const val COSINE_THRESHOLD = .363f
        const val MINIMUM_MARGIN = .08f
    }
}
