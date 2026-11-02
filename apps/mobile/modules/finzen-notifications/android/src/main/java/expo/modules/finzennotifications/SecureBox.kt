package expo.modules.finzennotifications

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** AES-256-GCM con clave en el Keystore de Android: la clave no sale del telefono ni entra en respaldos. */
object SecureBox {
  private const val ALIAS = "finzen_queue_key_v1"
  private const val PROVIDER = "AndroidKeyStore"

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance(PROVIDER).apply { load(null) }
    (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
    gen.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return gen.generateKey()
  }

  fun seal(plain: String): String {
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.ENCRYPT_MODE, key())
    val ct = c.doFinal(plain.toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(c.iv + ct, Base64.NO_WRAP)
  }

  fun open(b64: String): String? = try {
    val all = Base64.decode(b64, Base64.NO_WRAP)
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, all, 0, 12))
    String(c.doFinal(all, 12, all.size - 12), Charsets.UTF_8)
  } catch (_: Throwable) {
    null
  }
}