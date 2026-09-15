package br.com.faceponto.terminal.recognition

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class BiometricCipher {
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun encrypt(employeeId: String, modelHash: String, embedding: FloatArray): ByteArray {
        val plain = ByteBuffer.allocate(embedding.size * Float.SIZE_BYTES).apply {
            embedding.forEach(::putFloat)
        }.array()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD("$employeeId:$modelHash".toByteArray())
        val ciphertext = cipher.doFinal(plain)
        return ByteBuffer.allocate(1 + cipher.iv.size + ciphertext.size)
            .put(cipher.iv.size.toByte()).put(cipher.iv).put(ciphertext).array()
    }

    fun decrypt(employeeId: String, modelHash: String, packed: ByteArray): FloatArray {
        val buffer = ByteBuffer.wrap(packed)
        val iv = ByteArray(buffer.get().toInt() and 0xff).also(buffer::get)
        val ciphertext = ByteArray(buffer.remaining()).also(buffer::get)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        cipher.updateAAD("$employeeId:$modelHash".toByteArray())
        val plain = ByteBuffer.wrap(cipher.doFinal(ciphertext))
        return FloatArray(plain.remaining() / Float.SIZE_BYTES) { plain.float }
    }

    private fun key(): SecretKey = (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)
        ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
            generateKey()
        }

    companion object { private const val KEY_ALIAS = "faceponto-biometric-v1" }
}
