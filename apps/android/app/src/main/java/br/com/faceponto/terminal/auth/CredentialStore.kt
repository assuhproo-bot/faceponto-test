package br.com.faceponto.terminal.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class TerminalCredentials(val terminalId: String, val companyId: String, val locationId: String, val accessToken: String, val refreshToken: String, val expiresAtEpochSeconds: Long)

class CredentialStore(context: Context) {
    private val preferences = context.getSharedPreferences("terminal_credentials", Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    fun read(): TerminalCredentials? = runCatching {
        val packed = Base64.decode(preferences.getString("encrypted", null) ?: return null, Base64.NO_WRAP)
        val ivSize = packed[0].toInt(); val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, packed.copyOfRange(1, 1 + ivSize)))
        val json = JSONObject(String(cipher.doFinal(packed.copyOfRange(1 + ivSize, packed.size)), Charsets.UTF_8))
        TerminalCredentials(json.getString("terminal_id"), json.getString("company_id"), json.getString("location_id"), json.getString("access_token"), json.getString("refresh_token"), json.getLong("expires_at"))
    }.getOrNull()
    fun write(value: TerminalCredentials) {
        val json = JSONObject().put("terminal_id", value.terminalId).put("company_id", value.companyId).put("location_id", value.locationId)
            .put("access_token", value.accessToken).put("refresh_token", value.refreshToken).put("expires_at", value.expiresAtEpochSeconds)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
        val packed = byteArrayOf(cipher.iv.size.toByte()) + cipher.iv + cipher.doFinal(json.toString().toByteArray())
        check(preferences.edit().putString("encrypted", Base64.encodeToString(packed, Base64.NO_WRAP)).commit())
    }
    private fun key(): SecretKey = (keyStore.getKey(KEY_ALIAS, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
        init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); generateKey()
    }
    private companion object { const val KEY_ALIAS = "faceponto-terminal-credentials-v1" }
}
