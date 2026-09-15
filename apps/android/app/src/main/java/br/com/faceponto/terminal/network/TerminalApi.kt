package br.com.faceponto.terminal.network

import br.com.faceponto.terminal.auth.CredentialStore
import br.com.faceponto.terminal.auth.TerminalCredentials
import br.com.faceponto.terminal.storage.PunchEventEntity
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

class TerminalApi(private val store: CredentialStore, private val baseUrl: String = br.com.faceponto.terminal.BuildConfig.API_BASE_URL) {
    fun heartbeat(pending: Int): JSONObject = authorized("POST", "/v1/terminal/heartbeat", JSONObject().put("pending_count", pending).put("app_version", "0.1.0"))
    fun catalog(): JSONObject = authorized("GET", "/v1/terminal/catalog", null)
    fun clockAnchor(bootId: String, deviceElapsedMs: Long, uncertaintyMs: Int): JSONObject =
        authorized("POST", "/v1/terminal/clock-anchors", JSONObject().put("boot_id", bootId)
            .put("device_elapsed_ms", deviceElapsedMs).put("uncertainty_ms", uncertaintyMs.coerceIn(0, 60_000)))
    fun sync(events: List<PunchEventEntity>): JSONArray {
        val payload = JSONObject().put("protocol_version", 1).put("events", JSONArray(events.map(::eventJson)))
        val headers = if (br.com.faceponto.terminal.BuildConfig.DEBUG && events.any { it.policyVersion == 999 })
            mapOf("X-FacePonto-Test-Fault" to "drop-after-commit") else emptyMap()
        return authorized("POST", "/v1/terminal/sync", payload, headers).getJSONArray("results")
    }

    private fun eventJson(event: PunchEventEntity) = JSONObject()
        .put("id", event.id).put("employee_id", event.employeeId).put("terminal_assignment_id", event.terminalAssignmentId)
        .put("device_timestamp", event.deviceTimestamp).put("device_elapsed_ms", event.deviceElapsedMs).put("boot_id", event.bootId)
        .put("clock_anchor_id", event.clockAnchorId ?: JSONObject.NULL).put("source", "face")
        .put("recognition", JSONObject().put("profile_id", event.profileId).put("profile_version", event.profileVersion)
            .put("recognition_model_sha256", event.recognitionModelSha256).put("liveness_model_sha256", event.livenessModelSha256)
            .put("policy_version", event.policyVersion).put("liveness_session_id", event.livenessSessionId).put("liveness_result", "passed"))

    private fun authorized(method: String, path: String, body: JSONObject?, headers: Map<String, String> = emptyMap()): JSONObject {
        var credentials = store.read() ?: error("Terminal não pareado")
        if (credentials.expiresAtEpochSeconds <= Instant.now().epochSecond + 60) credentials = refresh(credentials)
        var response = request(method, path, body, credentials.accessToken, headers)
        if (response.first == 401) { credentials = refresh(credentials); response = request(method, path, body, credentials.accessToken, headers) }
        if (response.first !in 200..299) error("API ${response.first}")
        return JSONObject(response.second)
    }

    private fun refresh(current: TerminalCredentials): TerminalCredentials {
        val response = request("POST", "/v1/terminal/refresh", JSONObject().put("refresh_token", current.refreshToken), null)
        if (response.first !in 200..299) error("Sessão expirada")
        val json = JSONObject(response.second)
        return current.copy(accessToken = json.getString("access_token"), refreshToken = json.getString("refresh_token"),
            expiresAtEpochSeconds = Instant.now().epochSecond + json.getLong("expires_in")).also(store::write)
    }

    private fun request(method: String, path: String, body: JSONObject?, token: String?, headers: Map<String, String> = emptyMap()): Pair<Int, String> {
        val connection = URL("$baseUrl$path").openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = method; connection.connectTimeout = 10_000; connection.readTimeout = 15_000
            connection.setRequestProperty("Accept", "application/json")
            headers.forEach(connection::setRequestProperty)
            token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) { connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json"); connection.outputStream.use { it.write(body.toString().toByteArray()) } }
            val status = connection.responseCode
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            status to text
        } finally { connection.disconnect() }
    }
}
