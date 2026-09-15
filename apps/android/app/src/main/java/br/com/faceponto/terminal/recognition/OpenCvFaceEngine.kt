package br.com.faceponto.terminal.recognition

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import br.com.faceponto.terminal.BuildConfig
import org.opencv.android.OpenCVLoader
import org.opencv.android.Utils
import org.opencv.core.Mat
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import org.opencv.objdetect.FaceDetectorYN
import org.opencv.objdetect.FaceRecognizerSF
import java.io.File
import java.security.MessageDigest

data class FaceObservation(
    val count: Int,
    val confidence: Float,
    val usable: Boolean,
    /** Nose position between the two eyes. Around .5 means the face is frontal. */
    val yawRatio: Float? = null,
)
data class FaceAnalysis(
    val observation: FaceObservation,
    val embedding: FloatArray? = null,
    /** In-memory-only ensemble score from the debug MiniFASNet test implementation. */
    val passivePadScore: Float? = null,
)

interface PassivePadScorer {
    fun initialize()
    fun score(bgr: Mat, faceX: Float, faceY: Float, faceWidth: Float, faceHeight: Float): Float
}

/** Keeps the experimental scorer out of the release classpath and APK. */
private object ExperimentalPassivePadFactory {
    fun create(context: Context): PassivePadScorer? {
        if (!BuildConfig.DEBUG) return null
        return runCatching {
            val type = Class.forName("br.com.faceponto.terminal.recognition.ExperimentalMiniFasEngine")
            (type.getConstructor(Context::class.java).newInstance(context) as PassivePadScorer).also { it.initialize() }
        }.onSuccess {
            Log.i("FacePontoPad", "experimental_minifas_ready")
        }.onFailure { error ->
            Log.e("FacePontoPad", "experimental_minifas_unavailable=${error.javaClass.simpleName}")
        }.getOrNull()
    }
}

class OpenCvFaceEngine(private val context: Context) {
    private lateinit var detector: FaceDetectorYN
    private lateinit var recognizer: FaceRecognizerSF
    private var experimentalPad: PassivePadScorer? = null

    fun initialize() {
        check(OpenCVLoader.initLocal()) { "OpenCV indisponível" }
        val detection = materialize(DETECTION_FILE, DETECTION_SHA256)
        val recognition = materialize(RECOGNITION_FILE, RECOGNITION_SHA256)
        detector = FaceDetectorYN.create(detection.absolutePath, "", Size(320.0, 320.0), .85f, .3f, 5000)
        recognizer = FaceRecognizerSF.create(recognition.absolutePath, "")
        experimentalPad = ExperimentalPassivePadFactory.create(context)
    }

    @Synchronized fun analyze(bitmap: Bitmap): FaceAnalysis {
        val scaled = Bitmap.createScaledBitmap(bitmap, 320, 320, true)
        val rgba = Mat(); val bgr = Mat(); val faces = Mat()
        return try {
            Utils.bitmapToMat(scaled, rgba); Imgproc.cvtColor(rgba, bgr, Imgproc.COLOR_RGBA2BGR)
            detector.setInputSize(Size(bgr.cols().toDouble(), bgr.rows().toDouble())); detector.detect(bgr, faces)
            val count = faces.rows(); val confidence = if (count == 1) faces.get(0, 14)[0].toFloat() else 0f
            val yawRatio = if (count == 1) {
                val eyeA = faces.get(0, 4)[0]
                val eyeB = faces.get(0, 6)[0]
                val nose = faces.get(0, 8)[0]
                val eyeMin = minOf(eyeA, eyeB)
                val eyeSpan = kotlin.math.abs(eyeA - eyeB)
                if (eyeSpan > 1.0) ((nose - eyeMin) / eyeSpan).toFloat() else null
            } else null
            val observation = FaceObservation(count, confidence, count == 1 && confidence >= .90f, yawRatio)
            val embedding = if (observation.usable) {
                val aligned = Mat(); val feature = Mat()
                try {
                    recognizer.alignCrop(bgr, faces.row(0), aligned)
                    recognizer.feature(aligned, feature)
                    FloatArray(feature.cols() * feature.rows()).also { feature.get(0, 0, it) }
                } finally { aligned.release(); feature.release() }
            } else null
            val passivePadScore = if (observation.usable) runCatching {
                experimentalPad?.score(
                    bgr = bgr,
                    faceX = faces.get(0, 0)[0].toFloat(),
                    faceY = faces.get(0, 1)[0].toFloat(),
                    faceWidth = faces.get(0, 2)[0].toFloat(),
                    faceHeight = faces.get(0, 3)[0].toFloat(),
                )
            }.getOrNull() else null
            FaceAnalysis(observation, embedding, passivePadScore)
        } finally { rgba.release(); bgr.release(); faces.release(); if (scaled !== bitmap) scaled.recycle() }
    }

    private fun materialize(name: String, expectedHash: String): File {
        val target = File(context.noBackupFilesDir, name)
        if (!target.exists() || sha256(target) != expectedHash) context.assets.open("models/$name").use { input -> target.outputStream().use(input::copyTo) }
        check(sha256(target) == expectedHash) { "Hash de modelo inválido" }
        return target
    }

    private fun sha256(file: File): String = MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it) }

    companion object {
        const val DETECTION_FILE = "face_detection_yunet_2023mar.onnx"
        const val DETECTION_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
        const val RECOGNITION_FILE = "face_recognition_sface_2021dec.onnx"
        const val RECOGNITION_SHA256 = "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"
    }
}
