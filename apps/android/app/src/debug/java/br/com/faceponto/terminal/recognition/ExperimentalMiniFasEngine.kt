package br.com.faceponto.terminal.recognition

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import br.com.faceponto.terminal.BuildConfig
import org.opencv.core.Mat
import org.opencv.core.Rect
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import java.nio.FloatBuffer
import java.security.MessageDigest

/**
 * Local passive PAD inference used only by the debug APK. Both models are packaged
 * under src/debug/assets and are checked before a session is opened. No image, crop,
 * logits, or score is written to the database; the caller retains only a transient
 * score for the current capture challenge.
 */
class ExperimentalMiniFasEngine(private val context: Context) : PassivePadScorer, AutoCloseable {
    private val environment = OrtEnvironment.getEnvironment()
    private lateinit var v1se: Model
    private lateinit var v2: Model

    override fun initialize() {
        check(BuildConfig.DEBUG) { "MiniFASNet experimental is unavailable in release" }
        v1se = Model(
            bytes = loadVerified(MODEL_V1SE, MODEL_V1SE_SHA256),
            cropScale = 4.0f,
        )
        v2 = Model(
            bytes = loadVerified(MODEL_V2, MODEL_V2_SHA256),
            cropScale = 2.7f,
        )
    }

    override fun score(bgr: Mat, faceX: Float, faceY: Float, faceWidth: Float, faceHeight: Float): Float {
        check(::v1se.isInitialized && ::v2.isInitialized) { "MiniFASNet ainda n\u00e3o inicializado" }
        return (v1se.realScore(bgr, faceX, faceY, faceWidth, faceHeight) +
            v2.realScore(bgr, faceX, faceY, faceWidth, faceHeight)) / 2f
    }

    override fun close() {
        if (::v1se.isInitialized) v1se.close()
        if (::v2.isInitialized) v2.close()
    }

    private fun loadVerified(name: String, hash: String): ByteArray =
        context.assets.open("models/$name").use { input -> input.readBytes() }.also { bytes ->
            check(sha256(bytes) == hash) { "Hash inv\u00e1lido para o modelo PAD $name" }
        }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private inner class Model(bytes: ByteArray, private val cropScale: Float) : AutoCloseable {
        private val session = environment.createSession(bytes, OrtSession.SessionOptions())
        private val inputName = session.inputNames.single()

        fun realScore(bgr: Mat, x: Float, y: Float, width: Float, height: Float): Float {
            val tensor = cropToTensor(bgr, x, y, width, height, cropScale)
            OnnxTensor.createTensor(environment, FloatBuffer.wrap(tensor), INPUT_SHAPE).use { input ->
                session.run(mapOf(inputName to input)).use { output ->
                    @Suppress("UNCHECKED_CAST")
                    val logits = (output[0].value as Array<FloatArray>)[0]
                    require(logits.size >= 2) { "Sa\u00edda inv\u00e1lida do MiniFASNet" }
                    return softmaxProbability(logits, REAL_CLASS_INDEX)
                }
            }
        }

        override fun close() = session.close()
    }

    private fun cropToTensor(image: Mat, x: Float, y: Float, width: Float, height: Float, scale: Float): FloatArray {
        require(width > 1f && height > 1f) { "Caixa facial inv\u00e1lida" }
        val boundedScale = minOf((image.rows() - 1) / height, (image.cols() - 1) / width, scale)
        val newWidth = width * boundedScale
        val newHeight = height * boundedScale
        val centerX = x + width / 2f
        val centerY = y + height / 2f
        val left = (centerX - newWidth / 2f).toInt().coerceIn(0, image.cols() - 1)
        val top = (centerY - newHeight / 2f).toInt().coerceIn(0, image.rows() - 1)
        val right = (centerX + newWidth / 2f).toInt().coerceIn(left + 1, image.cols() - 1)
        val bottom = (centerY + newHeight / 2f).toInt().coerceIn(top + 1, image.rows() - 1)
        val cropped = image.submat(Rect(left, top, right - left + 1, bottom - top + 1))
        val resized = Mat()
        try {
            Imgproc.resize(cropped, resized, Size(80.0, 80.0))
            val bgrBytes = ByteArray(80 * 80 * 3)
            resized.get(0, 0, bgrBytes)
            return FloatArray(80 * 80 * 3).also { values ->
                for (channel in 0..2) for (pixel in 0 until 80 * 80) {
                    values[channel * 80 * 80 + pixel] = (bgrBytes[pixel * 3 + channel].toInt() and 0xff).toFloat()
                }
            }
        } finally {
            cropped.release()
            resized.release()
        }
    }

    private fun softmaxProbability(logits: FloatArray, classIndex: Int): Float {
        val maximum = logits.maxOrNull() ?: error("Logits ausentes")
        val denominator = logits.sumOf { kotlin.math.exp((it - maximum).toDouble()) }
        return (kotlin.math.exp((logits[classIndex] - maximum).toDouble()) / denominator).toFloat()
    }

    companion object {
        private const val MODEL_V1SE = "MiniFASNetV1SE.onnx"
        private const val MODEL_V2 = "MiniFASNetV2.onnx"
        private const val MODEL_V1SE_SHA256 = "ebab7f90c7833fbccd46d3a555410e78d969db5438e169b6524be444862b3676"
        private const val MODEL_V2_SHA256 = "b32929adc2d9c34b9486f8c4c7bc97c1b69bc0ea9befefc380e4faae4e463907"
        private const val REAL_CLASS_INDEX = 1
        private val INPUT_SHAPE = longArrayOf(1, 3, 80, 80)
    }
}
