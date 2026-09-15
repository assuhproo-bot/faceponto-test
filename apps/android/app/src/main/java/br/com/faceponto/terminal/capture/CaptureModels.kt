package br.com.faceponto.terminal.capture

sealed interface RecognitionResult {
    data class Identified(val employeeId: String, val profileId: String, val profileVersion: Int) : RecognitionResult
    data object Unknown : RecognitionResult
    data object Ambiguous : RecognitionResult
    data object PoorQuality : RecognitionResult
    data object MultipleFaces : RecognitionResult
    data object SpoofSuspected : RecognitionResult
    data object ModelUnavailable : RecognitionResult
}

interface FaceRecognitionService {
    suspend fun recognize(frame: CameraFrame): RecognitionResult
}

data class CameraFrame(val rotationDegrees: Int, val capturedElapsedMs: Long)
enum class CaptureState { WAITING, CHECKING_QUALITY, CHECKING_LIVENESS, IDENTIFYING, PERSISTING, CONFIRMED, ERROR }
