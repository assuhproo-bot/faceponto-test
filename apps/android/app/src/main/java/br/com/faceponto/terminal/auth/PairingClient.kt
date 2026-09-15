package br.com.faceponto.terminal.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

class PairingClient(private val baseUrl: String) {
    suspend fun pair(code: String): TerminalCredentials = withContext(Dispatchers.IO) {
        val connection = URL("$baseUrl/v1/terminal/pair").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"; connection.connectTimeout = 10_000; connection.readTimeout = 15_000; connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(JSONObject().put("code", code.trim()).toString().toByteArray()) }
            val body = (if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream).bufferedReader().use { it.readText() }
            if (connection.responseCode !in 200..299) throw Exception(JSONObject(body).optString("message", "Pareamento recusado."))
            val json = JSONObject(body)
            TerminalCredentials(json.getString("terminal_id"), json.getString("company_id"), json.getString("location_id"), json.getString("access_token"), json.getString("refresh_token"), Instant.now().epochSecond + json.getLong("expires_in"))
        } finally { connection.disconnect() }
    }
}
