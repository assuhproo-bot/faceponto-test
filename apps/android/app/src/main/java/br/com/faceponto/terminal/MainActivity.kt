package br.com.faceponto.terminal

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.graphics.Matrix
import android.graphics.Bitmap
import android.media.AudioManager
import android.media.ToneGenerator
import android.speech.tts.TextToSpeech
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.core.ImageAnalysis
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import br.com.faceponto.terminal.auth.*
import br.com.faceponto.terminal.clock.BootIdentity
import br.com.faceponto.terminal.storage.TerminalDatabase
import br.com.faceponto.terminal.sync.TerminalSyncWorker
import br.com.faceponto.terminal.recognition.OpenCvFaceEngine
import br.com.faceponto.terminal.recognition.FaceObservation
import br.com.faceponto.terminal.recognition.FaceAnalysis
import br.com.faceponto.terminal.recognition.BiometricCipher
import br.com.faceponto.terminal.recognition.LocalFaceMatcher
import br.com.faceponto.terminal.recognition.LocalMatch
import br.com.faceponto.terminal.recognition.MovementChallengeState
import br.com.faceponto.terminal.recognition.MovementStep
import br.com.faceponto.terminal.recognition.ActivePresencePolicy
import br.com.faceponto.terminal.capture.PadDecision
import br.com.faceponto.terminal.capture.PadFrame
import br.com.faceponto.terminal.capture.PresentationAttackDetectionProvider
import br.com.faceponto.terminal.capture.defaultPadProvider
import br.com.faceponto.terminal.storage.FacialProfileEntity
import br.com.faceponto.terminal.storage.CatalogEmployeeEntity
import br.com.faceponto.terminal.storage.PunchEventEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors
import java.time.Instant
import java.util.UUID
import java.util.Calendar
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.DEBUG && intent.getBooleanExtra("offline_probe", false)) lifecycleScope.launch(Dispatchers.IO) {
            runCatching { br.com.faceponto.terminal.sync.OfflineProbe.enqueue(applicationContext) }
                .onSuccess { android.util.Log.i("FacePontoProbe", "synthetic_event_enqueued=$it") }
                .onFailure { android.util.Log.e("FacePontoProbe", "probe_failed=${it.message}") }
        }
        if (BuildConfig.DEBUG && intent.getBooleanExtra("offline_probe_status", false)) lifecycleScope.launch(Dispatchers.IO) {
            android.util.Log.i("FacePontoProbe", "pending_count=${TerminalDatabase.open(applicationContext).punches().pendingCount()}")
        }
        setContent { FacePontoApp() }
    }
}

private class FacePontoVoice(context: android.content.Context) : TextToSpeech.OnInitListener {
    private var ready = false
    private val speaker = TextToSpeech(context.applicationContext, this)
    override fun onInit(status: Int) {
        ready = status == TextToSpeech.SUCCESS
        if (ready) speaker.language = Locale("pt", "BR")
    }
    fun say(text: String) { if (ready) speaker.speak(text, TextToSpeech.QUEUE_FLUSH, null, "faceponto-confirmation") }
    fun close() { speaker.stop(); speaker.shutdown() }
}

@Composable private fun FacePontoApp() {
    val context = LocalContext.current; val store = remember { CredentialStore(context) }
    var credentials by remember { mutableStateOf(store.read()) }
    MaterialTheme { if (credentials == null) PairingScreen { store.write(it); credentials = it } else TerminalScreen(credentials!!) }
}

@Composable private fun PairingScreen(onPaired: (TerminalCredentials) -> Unit) {
    val scope = rememberCoroutineScope(); var code by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("Informe o código gerado pelo administrador.") }
    Column(Modifier.fillMaxSize().background(Color(0xFFF3F7F4)).padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("CONFIGURAR TERMINAL", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Color(0xFF12372A)); Spacer(Modifier.height(24.dp))
        OutlinedTextField(code, { code = it }, label = { Text("Código de pareamento") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), enabled = !busy)
        Spacer(Modifier.height(16.dp)); Button(onClick = { busy = true; message = "Conectando..."; scope.launch {
            runCatching { PairingClient(BuildConfig.API_BASE_URL).pair(code) }.onSuccess(onPaired).onFailure { message = it.message ?: "Não foi possível parear." }; busy = false
        } }, enabled = code.trim().length >= 32 && !busy) { Text("PAREAR") }
        Spacer(Modifier.height(16.dp)); Text(message, textAlign = TextAlign.Center, color = Color(0xFF345B4D))
    }
}

@Composable private fun TerminalScreen(credentials: TerminalCredentials) {
    val context = LocalContext.current; var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val voice = remember { FacePontoVoice(context) }
    DisposableEffect(Unit) { onDispose { voice.close() } }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    val pending by produceState<Int?>(null) { value = withContext(Dispatchers.IO) { TerminalDatabase.open(context).punches().pendingCount() } }
    val catalogCount by produceState<Int?>(null) { delay(6_000); value = withContext(Dispatchers.IO) { TerminalDatabase.open(context).punches().catalogCount() } }
    val clockVerified by produceState<Boolean?>(null) {
        delay(6_000); val boot = BootIdentity(context).current()
        value = withContext(Dispatchers.IO) {
            TerminalDatabase.open(context).punches().latestClockAnchor(boot.id)?.let { anchor ->
                val validityMs = Instant.parse(anchor.expiresAt).toEpochMilli() - Instant.parse(anchor.serverTimestamp).toEpochMilli()
                android.os.SystemClock.elapsedRealtime() - anchor.deviceElapsedMs <= validityMs
            } == true
        }
    }
    val engine by produceState<OpenCvFaceEngine?>(null) { value = withContext(Dispatchers.IO) { runCatching { OpenCvFaceEngine(context).also { it.initialize() } }.getOrNull() } }
    var observation by remember { mutableStateOf<FaceObservation?>(null) }
    var embedding by remember { mutableStateOf<FloatArray?>(null) }
    var passivePadScore by remember { mutableStateOf<Float?>(null) }
    var enrollmentMessage by remember { mutableStateOf<String?>(null) }
    var profileRevision by remember { mutableIntStateOf(0) }
    var selectedEnrollmentEmployeeId by remember { mutableStateOf("") }
    var enrollmentMenuOpen by remember { mutableStateOf(false) }
    val candidates by produceState(initialValue = emptyList(), profileRevision) {
        value = withContext(Dispatchers.IO) { TerminalDatabase.open(context).punches().facialProfileCandidates() }
    }
    val catalogEmployees by produceState(initialValue = emptyList<CatalogEmployeeEntity>()) {
        while (true) {
            value = withContext(Dispatchers.IO) { TerminalDatabase.open(context).punches().catalogEmployees() }
            delay(5_000)
        }
    }
    val enrollmentCandidates = catalogEmployees.filter { employee ->
        employee.serverProfileId != null && candidates.none { candidate -> candidate.employeeId == employee.id }
    }
    val selectedEnrollmentEmployee = enrollmentCandidates.firstOrNull { it.id == selectedEnrollmentEmployeeId }
    LaunchedEffect(enrollmentCandidates, selectedEnrollmentEmployeeId) {
        if (enrollmentCandidates.none { it.id == selectedEnrollmentEmployeeId }) {
            selectedEnrollmentEmployeeId = enrollmentCandidates.firstOrNull()?.id.orEmpty()
        }
    }
    var localMatch by remember { mutableStateOf<LocalMatch?>(null) }
    var movementChallenge by remember { mutableStateOf(MovementChallengeState.create()) }
    var padFrames by remember { mutableStateOf(emptyList<PadFrame>()) }
    var requireFaceExit by remember { mutableStateOf(false) }
    var captureMessage by remember { mutableStateOf<String?>(null) }
    var capturing by remember { mutableStateOf(false) }
    val padProvider: PresentationAttackDetectionProvider = remember {
        defaultPadProvider(BuildConfig.DEBUG)
    }
    val scope = rememberCoroutineScope()
    LaunchedEffect(embedding, candidates) {
        localMatch = embedding?.let { probe -> withContext(Dispatchers.IO) { runCatching { LocalFaceMatcher().identify(probe, candidates) }.getOrNull() } }
    }
    LaunchedEffect(observation, localMatch, passivePadScore) {
        observation?.let {
            if (requireFaceExit) {
                if (it.count == 0) {
                    requireFaceExit = false
                    movementChallenge = MovementChallengeState.create()
                    padFrames = emptyList()
                    captureMessage = "Ponto registrado. Pronto para a próxima marcação."
                }
                return@let
            }
            if (it.count == 0 && movementChallenge.step != MovementStep.CENTER) {
                movementChallenge = MovementChallengeState.create()
                padFrames = emptyList()
                captureMessage = "Rosto saiu da câmera. Vamos recomeçar quando você voltar."
                return@let
            }
            if (captureMessage?.startsWith("Rosto saiu da câmera") == true) captureMessage = null
            val now = android.os.SystemClock.elapsedRealtime()
            val advanced = movementChallenge.advance(it, localMatch != null, now)
            movementChallenge = advanced
            if (localMatch != null && it.usable) {
                padFrames = (padFrames + PadFrame(now, it.confidence, advanced.step == MovementStep.COMPLETE, passivePadScore)).takeLast(12)
            }
        }
    }
    LaunchedEffect(movementChallenge.step) {
        val match = localMatch ?: return@LaunchedEffect
        if (!ActivePresencePolicy.passed(movementChallenge) || capturing || requireFaceExit) return@LaunchedEffect
        capturing = true
        captureMessage = "Registrando ponto localmente..."
        val result = withContext(Dispatchers.IO) {
            android.util.Log.i("FacePontoPad", "evaluating_test_pad frames=${padFrames.size}")
            when (val decision = padProvider.evaluate(padFrames)) {
                is PadDecision.Passed -> {
                    android.util.Log.i("FacePontoPad", "test_pad_passed; persisting")
                    runCatching { persistFacePunch(context, match.employeeId, decision) }.fold(
                        onSuccess = { android.util.Log.i("FacePontoPad", "punch_persisted"); "Ponto registrado com sucesso. Afaste o rosto para liberar a próxima marcação." to true },
                        onFailure = { android.util.Log.e("FacePontoPad", "punch_persist_failed", it); "Não foi possível registrar: ${it.message ?: "dados incompletos"}" to false },
                    )
                }
                is PadDecision.Failed -> "Presença recusada: ${decision.reason}" to false
                is PadDecision.Unavailable -> "Ponto bloqueado: ${decision.reason}" to false
            }
        }
        captureMessage = result.first
        requireFaceExit = result.second
        if (!requireFaceExit) {
            delay(1_500)
            movementChallenge = MovementChallengeState.create()
            padFrames = emptyList()
        }
        capturing = false
    }
    LaunchedEffect(Unit) {
        if (!granted) permission.launch(Manifest.permission.CAMERA)
        TerminalSyncWorker.schedule(context)
        while (true) {
            delay(30_000)
            TerminalSyncWorker.refreshNow(context)
        }
    }
    val employeeName = localMatch?.employeeName?.trim()?.substringBefore(' ') ?: ""
    val punchAccepted = captureMessage?.startsWith("Ponto registrado") == true
    val spokenConfirmation = when {
        captureMessage?.startsWith("Ponto registrado com sucesso") == true -> "${employeeName.ifBlank { "Funcionário" }}, ponto registrado com sucesso."
        captureMessage?.startsWith("Rosto saiu da câmera") == true || captureMessage?.startsWith("Presença recusada") == true || captureMessage?.startsWith("Não foi possível registrar") == true -> "Não foi possível verificar. Tente novamente."
        else -> null
    }
    LaunchedEffect(spokenConfirmation) { spokenConfirmation?.let(voice::say) }
    LaunchedEffect(punchAccepted) {
        if (punchAccepted) {
            val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 85)
            tone.startTone(ToneGenerator.TONE_PROP_ACK, 180)
            delay(230)
            tone.release()
        }
    }
    val title = when {
        punchAccepted && employeeName.isNotBlank() -> "${timeGreeting()}, $employeeName!"
        requireFaceExit && employeeName.isNotBlank() -> "Obrigado, $employeeName!"
        employeeName.isNotBlank() -> "Olá, $employeeName"
        else -> "Registre seu ponto"
    }
    val status = captureMessage ?: when {
        engine == null -> "Preparando a câmera…"
        requireFaceExit -> "Pode se afastar."
        observation?.count == 0 -> "Posicione o rosto no centro da câmera"
        observation?.count ?: 0 > 1 -> "Apenas uma pessoa por vez"
        localMatch != null && !capturing -> movementChallenge.instruction
        observation?.usable == true -> "Rosto ainda não cadastrado neste terminal"
        else -> "Ajuste a posição e a iluminação"
    }
    Column(Modifier.fillMaxSize().background(Color(0xFFF3F7F4)).padding(horizontal = 20.dp, vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("FACEPONTO", fontSize = 14.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp, color = Color(0xFF2B6B55))
        Text(title, fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Color(0xFF12372A), textAlign = TextAlign.Center)
        if (!punchAccepted) Text("Olhe para a câmera para registrar sua jornada.", fontSize = 16.sp, color = Color(0xFF48655A), textAlign = TextAlign.Center)
        Box(Modifier.weight(1f).fillMaxWidth().background(Color.Black, RoundedCornerShape(28.dp)), contentAlignment = Alignment.Center) { if (granted) CameraPreview(engine, { observation = it.observation; embedding = it.embedding; passivePadScore = it.passivePadScore }, Modifier.fillMaxSize()) else Text("Permita o uso da câmera", color = Color.White) }
        if (!punchAccepted) Surface(color = Color.White, shape = RoundedCornerShape(18.dp), tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(status, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF12372A), textAlign = TextAlign.Center)
                if (!punchAccepted && localMatch != null && movementChallenge.step != MovementStep.CENTER) Text("Siga a orientação sem sair da câmera.", fontSize = 14.sp, color = Color(0xFF48655A), textAlign = TextAlign.Center)
            }
        }
        if (BuildConfig.DEBUG) Surface(color = Color(0xFFFFF4D6), shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Cadastro facial — responsável", fontWeight = FontWeight.Bold, color = Color(0xFF6B4B00))
                Text("Selecione a pessoa preparada no painel e peça para ela olhar para a câmera.", fontSize = 13.sp, color = Color(0xFF6B4B00))
                if (enrollmentCandidates.isNotEmpty()) {
                    Box {
                        OutlinedButton(onClick = { enrollmentMenuOpen = true }) { Text(selectedEnrollmentEmployee?.name ?: "Selecione o funcionário") }
                        DropdownMenu(expanded = enrollmentMenuOpen, onDismissRequest = { enrollmentMenuOpen = false }) {
                            enrollmentCandidates.forEach { employee -> DropdownMenuItem(text = { Text(employee.name) }, onClick = { selectedEnrollmentEmployeeId = employee.id; enrollmentMenuOpen = false }) }
                        }
                    }
                    Button(onClick = {
                        val captured = embedding ?: return@Button
                        val employee = selectedEnrollmentEmployee ?: return@Button
                        scope.launch {
                            enrollmentMessage = "Protegendo amostra..."
                            enrollmentMessage = withContext(Dispatchers.IO) {
                                val dao = TerminalDatabase.open(context).punches()
                                val encrypted = BiometricCipher().encrypt(employee.id, OpenCvFaceEngine.RECOGNITION_SHA256, captured)
                                dao.saveFacialProfile(FacialProfileEntity(employee.id, encrypted, OpenCvFaceEngine.RECOGNITION_SHA256, 1, System.currentTimeMillis()))
                                "Amostra cifrada para ${employee.name}"
                            }
                            profileRevision++
                        }
                    }, enabled = embedding != null && selectedEnrollmentEmployee != null) { Text("Cadastrar amostra") }
                } else {
                    Text("Nenhum perfil facial pendente. No painel, prepare primeiro o funcionário que será cadastrado.", fontSize = 13.sp, color = Color(0xFF6B4B00))
                }
                enrollmentMessage?.let { Text(it, fontSize = 12.sp, color = Color(0xFF6B4B00)) }
            }
        }
    }
}

private fun timeGreeting(hour: Int = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)): String = when (hour) {
    in 5..11 -> "Bom dia"
    in 12..17 -> "Boa tarde"
    else -> "Boa noite"
}

private suspend fun persistFacePunch(context: android.content.Context, employeeId: String, pad: PadDecision.Passed) {
    val dao = TerminalDatabase.open(context).punches()
    val employee = requireNotNull(dao.catalogEmployee(employeeId)) { "Funcionário ausente do catálogo" }
    val terminal = requireNotNull(dao.terminalCatalogState()) { "Terminal sem local atribuído" }
    val profileId = requireNotNull(employee.serverProfileId) { "Perfil facial não provisionado" }
    val profileVersion = requireNotNull(employee.serverProfileVersion) { "Versão do perfil ausente" }
    val recognitionModel = requireNotNull(employee.recognitionModelSha256) { "Modelo de reconhecimento ausente" }
    require(employee.livenessModelSha256 == pad.descriptor.modelSha256) { "Catálogo precisa atualizar a política de presença" }
    require(employee.policyVersion == pad.descriptor.policyVersion) { "Versão da política de presença incompatível" }
    val boot = BootIdentity(context).current()
    val anchor = requireNotNull(dao.latestClockAnchor(boot.id)) { "Relógio ainda não verificado" }
    val elapsed = android.os.SystemClock.elapsedRealtime()
    val expiresAt = Instant.parse(anchor.expiresAt)
    val deviceTimestamp = Instant.parse(anchor.serverTimestamp).plusMillis(elapsed - anchor.deviceElapsedMs)
    require(deviceTimestamp.isBefore(expiresAt)) { "Relógio precisa ser verificado novamente" }
    dao.persistCapturedPunch(PunchEventEntity(
        id = UUID.randomUUID().toString(), employeeId = employee.id,
        terminalAssignmentId = terminal.terminalAssignmentId, deviceTimestamp = deviceTimestamp.toString(),
        deviceElapsedMs = elapsed, bootId = boot.id, clockAnchorId = anchor.id,
        profileId = profileId, profileVersion = profileVersion, recognitionModelSha256 = recognitionModel,
        livenessModelSha256 = pad.descriptor.modelSha256, policyVersion = pad.descriptor.policyVersion,
        livenessSessionId = pad.sessionId, createdAtMs = System.currentTimeMillis(),
    ))
    TerminalSyncWorker.schedule(context)
}

@Composable private fun CameraPreview(engine: OpenCvFaceEngine?, onObservation: (FaceAnalysis) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    DisposableEffect(Unit) { onDispose { executor.shutdown() } }
    val view = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    DisposableEffect(engine) {
        var disposed = false
        var provider: ProcessCameraProvider? = null
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            if (disposed) return@addListener
            provider = future.get()
            val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            var lastAnalysis = 0L
            analysis.setAnalyzer(executor) { image ->
                try {
                    val now = android.os.SystemClock.elapsedRealtime()
                    if (engine != null && now - lastAnalysis >= 500) {
                        lastAnalysis = now
                        val source = image.toBitmap()
                        val matrix = Matrix().apply { postRotate(image.imageInfo.rotationDegrees.toFloat()) }
                        val rotated = Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
                        val result = engine.analyze(rotated)
                        rotated.recycle()
                        view.post { onObservation(result) }
                    }
                } finally { image.close() }
            }
            provider?.unbindAll()
            provider?.bindToLifecycle(context as ComponentActivity, CameraSelector.DEFAULT_FRONT_CAMERA, preview, analysis)
        }, ContextCompat.getMainExecutor(context))
        onDispose {
            disposed = true
            provider?.unbindAll()
        }
    }
    AndroidView(factory = { view }, modifier = modifier)
}
