package expo.modules.finzennotifications

import android.app.Notification
import android.content.Context
import android.content.SharedPreferences
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

/**
 * Filtro de seguridad NATIVO y cola de notificaciones.
 *
 * Orden de seguridad (el mismo que en @finzen/core, pero aquí corre ANTES de que
 * nada llegue a JavaScript):
 *   1. Lista blanca: si el paquete no coincide, no se lee ni el título ni el texto.
 *   2. Descarte de OTP / claves: se descarta sin guardar nada.
 *   3. Lo que pasa se guarda en una cola privada de la app (SharedPreferences, no
 *      accesible por otras apps) hasta que JavaScript la vacía; ahí se enmascara,
 *      se interpreta y se borra el texto original.
 */
object NotificationStore {
  private const val PREFS = "finzen_notifications"
  private const val KEY_PATTERNS = "patterns"
  private const val KEY_QUEUE = "queue"
  private const val KEY_LEARN = "learn"
  private const val KEY_SEEN = "seen"
  private const val MAX_QUEUE = 200
  private const val MAX_SEEN = 300
  private const val MAX_FIELD = 4000

  private val lock = Any()

  /** Lo asigna el módulo de Expo mientras la app está abierta, para avisar a JS. */
  @Volatile
  var onQueued: (() -> Unit)? = null

  private val OTP_PATTERNS = listOf(
    Regex("c[oó]digo\\s+(?:de\\s+)?(?:verificaci[oó]n|seguridad|confirmaci[oó]n|acceso|ingreso)", RegexOption.IGNORE_CASE),
    Regex("\\botp\\b", RegexOption.IGNORE_CASE),
    Regex("clave\\s+(?:temporal|din[aá]mica|de\\s+un\\s+solo\\s+uso|de\\s+(?:acceso|seguridad))", RegexOption.IGNORE_CASE),
    Regex("contrase[ñn]a\\s+(?:temporal|de\\s+un\\s+solo\\s+uso)", RegexOption.IGNORE_CASE),
    Regex("\\btoken\\b", RegexOption.IGNORE_CASE),
    Regex("no\\s+(?:lo\\s+|la\\s+)?compartas", RegexOption.IGNORE_CASE),
    Regex("nunca\\s+(?:te\\s+)?(?:pediremos|solicitaremos)", RegexOption.IGNORE_CASE),
    Regex("(?:tu|su)\\s+c[oó]digo\\s+(?:es|:)", RegexOption.IGNORE_CASE),
  )

  private fun prefs(ctx: Context): SharedPreferences =
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun handle(ctx: Context, sbn: StatusBarNotification) {
    val pkg = sbn.packageName ?: return
    if (pkg == ctx.packageName) return
    val p = prefs(ctx)

    // Modo aprendizaje: solo se anota el NOMBRE del paquete (jamás el contenido).
    if (p.getBoolean(KEY_LEARN, false)) recordSeen(p, pkg)

    val n = sbn.notification ?: return
    if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    if (!matchesWhitelist(p, pkg)) return

    val extras = n.extras ?: return
    // Topes de longitud: una notificación enorme no debe poder inflar la cola ni alentar el análisis.
    val title = (extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: "").take(MAX_FIELD)
    val text = ((extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
      ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString() ?: "").take(MAX_FIELD)
    if (text.isBlank()) return

    val combined = "$title $text"
    if (OTP_PATTERNS.any { it.containsMatchIn(combined) }) return

    enqueue(p, pkg, title, text, sbn.postTime)
    onQueued?.invoke()
  }

  private fun matchesWhitelist(p: SharedPreferences, pkg: String): Boolean {
    val raw = p.getString(KEY_PATTERNS, null) ?: return false // sin lista blanca → no se lee nada
    val lower = pkg.lowercase()
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).any { i ->
        try { Regex(arr.getString(i)).containsMatchIn(lower) } catch (_: Throwable) { false }
      }
    } catch (_: Throwable) {
      false
    }
  }

  private fun enqueue(p: SharedPreferences, pkg: String, title: String, text: String, at: Long) {
    synchronized(lock) {
      val arr = try { JSONArray(p.getString(KEY_QUEUE, "[]")) } catch (_: Throwable) { JSONArray() }
      arr.put(JSONObject().put("packageName", pkg).put("title", title).put("text", text).put("receivedAt", at))
      // Tope de seguridad: si JS tarda en vaciar, se descartan las más antiguas.
      val trimmed = if (arr.length() > MAX_QUEUE) {
        JSONArray().also { out -> for (i in arr.length() - MAX_QUEUE until arr.length()) out.put(arr.get(i)) }
      } else arr
      p.edit().putString(KEY_QUEUE, trimmed.toString()).apply()
    }
  }

  /** Devuelve la cola como JSON y la borra (el texto original no queda en disco). */
  fun drain(ctx: Context): String {
    synchronized(lock) {
      val p = prefs(ctx)
      val raw = p.getString(KEY_QUEUE, "[]") ?: "[]"
      p.edit().putString(KEY_QUEUE, "[]").commit()
      return raw
    }
  }

  fun setWhitelist(ctx: Context, patterns: List<String>) {
    prefs(ctx).edit().putString(KEY_PATTERNS, JSONArray(patterns).toString()).apply()
  }

  fun setLearning(ctx: Context, enabled: Boolean) {
    prefs(ctx).edit().putBoolean(KEY_LEARN, enabled).apply()
  }

  private fun recordSeen(p: SharedPreferences, pkg: String) {
    synchronized(lock) {
      val obj = try { JSONObject(p.getString(KEY_SEEN, "{}")) } catch (_: Throwable) { JSONObject() }
      val cur = obj.optJSONObject(pkg)
      val count = (cur?.optInt("count", 0) ?: 0) + 1
      if (cur == null && obj.length() >= MAX_SEEN) return
      obj.put(pkg, JSONObject().put("count", count).put("last", System.currentTimeMillis()))
      p.edit().putString(KEY_SEEN, obj.toString()).apply()
    }
  }

  fun seenJson(ctx: Context): String = prefs(ctx).getString(KEY_SEEN, "{}") ?: "{}"

  fun clearSeen(ctx: Context) {
    prefs(ctx).edit().putString(KEY_SEEN, "{}").apply()
  }
}
