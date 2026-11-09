package expo.modules.finzennotifications

import android.app.Notification
import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.text.Normalizer
import java.util.UUID

/**
 * Filtro de seguridad NATIVO + cola cifrada.
 *
 * Orden: (1) lista blanca de paquetes  (2) reglas de remitente (WhatsApp: solo Addi/Sistecredito,
 * nunca grupos)  (3) descarte de OTP  (4) deduplicacion  (5) cola cifrada con Keystore que JS lee con
 * peekQueue y confirma con ackQueue (si JS se cae a medias, no se pierde nada).
 */
object NotificationStore {
  private const val PREFS = "finzen_notifications"
  private const val KEY_PATTERNS = "patterns"
  private const val KEY_QUEUE_LEGACY = "queue"
  private const val KEY_QUEUE = "queue_v2"
  private const val KEY_LEARN_UNTIL = "learn_until"
  private const val KEY_SEEN = "seen"
  private const val KEY_FPS = "fps"
  private const val KEY_SENDER_RULES = "sender_rules"
  private const val KEY_SENDER_BIND = "sender_bind"
  private const val KEY_SENDER_BIND_ON = "sender_bind_on"
  private const val MAX_QUEUE = 200
  private const val MAX_SEEN = 300
  private const val MAX_FPS = 100
  private const val MAX_FIELD = 4000
  private const val LEARN_MS = 10 * 60 * 1000L
  private const val REPLAY_MS = 24 * 60 * 60 * 1000L

  private val lock = Any()

  @Volatile
  var onQueued: (() -> Unit)? = null

  private val I = RegexOption.IGNORE_CASE
  private val OTP_PATTERNS = listOf(
    Regex("c[o\u00f3]digo\\s+(?:de\\s+)?(?:verificaci[o\u00f3]n|seguridad|confirmaci[o\u00f3]n|acceso|ingreso|autenticaci[o\u00f3]n|validaci[o\u00f3]n|un\\s+solo\\s+uso)", I),
    Regex("\\botp\\b", I),
    Regex("clave\\s+(?:temporal|din[a\u00e1]mica|virtual|de\\s+un\\s+solo\\s+uso|de\\s+(?:acceso|seguridad))", I),
    Regex("contrase[\u00f1n]a\\s+(?:temporal|din[a\u00e1]mica|de\\s+un\\s+solo\\s+uso)", I),
    Regex("\\btoken\\b", I),
    Regex("\\b(?:pin|cvv|cvc)\\b", I),
    Regex("no\\s+(?:lo\\s+|la\\s+)?(?:compartas|facilites|reveles|entregues)", I),
    Regex("nunca\\s+(?:te\\s+)?(?:pediremos|solicitaremos|pedimos|solicitamos)", I),
    Regex("(?:tu|su)\\s+c[o\u00f3]digo\\s+(?:es|:)", I),
    Regex("verification\\s+code|one[-\\s]?time\\s+(?:code|password)", I),
  )

  // ---- Reglas de remitente (WhatsApp) ----
  private val DEFAULT_SENDERS: Map<String, List<String>> = mapOf(
    "com.google.android.apps.messages" to listOf("tigo"),
    "com.samsung.android.messaging" to listOf("tigo"),
  )
  private val DIACRITICS = Regex("\\p{Mn}+")
  private val NON_ALNUM = Regex("[^a-z0-9]+")

  private fun norm(s: String): String =
    Normalizer.normalize(s, Normalizer.Form.NFD).replace(DIACRITICS, "").lowercase()

  /** "Sistecr\u00e9dito", "Addi Colombia", "~Addi" -> primer token normalizado. "Addiction" NO coincide con "addi". */
  private fun firstToken(s: String): String = norm(s).split(NON_ALNUM).firstOrNull { it.isNotEmpty() } ?: ""

  private fun senderRules(p: SharedPreferences): Map<String, List<String>> {
    val raw = p.getString(KEY_SENDER_RULES, null) ?: return DEFAULT_SENDERS
    return try {
      val o = JSONObject(raw)
      val m = HashMap<String, List<String>>()
      o.keys().forEach { k ->
        val a = o.getJSONArray(k)
        m[k] = (0 until a.length()).map { norm(a.getString(it)).replace(NON_ALNUM, "") }.filter { it.isNotEmpty() }
      }
      m
    } catch (_: Throwable) {
      DEFAULT_SENDERS
    }
  }

  fun setSenderRules(ctx: Context, json: String) {
    try { JSONObject(json) } catch (_: Throwable) { return }
    prefs(ctx).edit().putString(KEY_SENDER_RULES, json).apply()
  }

  fun senderBindingOn(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_SENDER_BIND_ON, false)
  fun setSenderBinding(ctx: Context, on: Boolean) { prefs(ctx).edit().putBoolean(KEY_SENDER_BIND_ON, on).apply() }
  fun resetSenderBindings(ctx: Context) { prefs(ctx).edit().putString(KEY_SENDER_BIND, "{}").apply() }

  /** Anclaje opcional (confianza en el primer uso): el remitente "addi" queda fijado al primer chat (sbn.tag). */
  private fun senderBindingOk(ctx: Context, p: SharedPreferences, key: String, sbn: StatusBarNotification): Boolean {
    if (!p.getBoolean(KEY_SENDER_BIND_ON, false)) return true
    val id = sbn.tag ?: return true
    synchronized(lock) {
      val obj = try { JSONObject(p.getString(KEY_SENDER_BIND, "{}")) } catch (_: Throwable) { JSONObject() }
      val cur = obj.optString(key, "")
      if (cur.isEmpty()) {
        obj.put(key, id)
        p.edit().putString(KEY_SENDER_BIND, obj.toString()).apply()
        return true
      }
      if (cur == id) return true
    }
    ListenerHealth.bump(ctx, "spoof_blocked")
    return false
  }

  private fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ---- Lista blanca con regex validados (cache) ----
  private var cachedRaw: String? = null
  private var cachedRegexes: List<Regex> = emptyList()
  private val PROBES = listOf("", "zz.zz.zz", "a")
  private val NESTED_QUANT = Regex("\\([^)]*[+*][^)]*\\)[+*{]")
  private val LITERAL_RUN = Regex("[A-Za-z0-9]{4,}")

  private fun safeRegex(s: String): Regex? {
    if (s.length !in 3..200) return null
    if (NESTED_QUANT.containsMatchIn(s) || !LITERAL_RUN.containsMatchIn(s)) return null
    return try {
      val rx = Regex(s)
      if (PROBES.any { rx.containsMatchIn(it) }) null else rx
    } catch (_: Throwable) {
      null
    }
  }

  private fun patterns(ctx: Context, raw: String): List<Regex> {
    synchronized(lock) {
      if (raw == cachedRaw) return cachedRegexes
      val out = ArrayList<Regex>()
      var rejected = 0
      try {
        val arr = JSONArray(raw)
        for (i in 0 until arr.length()) {
          val rx = safeRegex(arr.optString(i, ""))
          if (rx != null) out.add(rx) else rejected++
        }
      } catch (_: Throwable) {}
      cachedRaw = raw
      cachedRegexes = out
      ListenerHealth.setInt(ctx, "rejected_patterns", rejected)
      return out
    }
  }

  private fun matchesWhitelist(ctx: Context, p: SharedPreferences, pkg: String): Boolean {
    val raw = p.getString(KEY_PATTERNS, null) ?: return false // sin lista blanca -> no se lee nada
    val lower = pkg.lowercase()
    return try { patterns(ctx, raw).any { it.containsMatchIn(lower) } } catch (_: Throwable) { false }
  }

  // ---- Entrada principal ----
  fun handle(ctx: Context, sbn: StatusBarNotification, replay: Boolean = false) {
    val pkg = sbn.packageName ?: return
    if (pkg.startsWith("com.whatsapp")) return // WhatsApp ya no se lee
    if (pkg == ctx.packageName) return
    val p = prefs(ctx)

    if (!replay) ListenerHealth.markEvent(ctx)
    // Modo aprendizaje (caduca solo): se anota el NOMBRE del paquete, jamas el contenido.
    if (!replay && isLearning(p)) recordSeen(p, pkg)
    if (replay && System.currentTimeMillis() - sbn.postTime > REPLAY_MS) return

    val n = sbn.notification ?: return
    if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    if (!matchesWhitelist(ctx, p, pkg)) {
      // Temporal: solo apps financieras conocidas, para no llenar la bitacora con ruido.
      if (!replay && Regex("nequi|\\.nu\\.|nubank|addi|sistecredito|whatsapp|bancolombia|daviplata", I).containsMatchIn(pkg)) {
        ListenerHealth.trace(ctx, pkg, "NO_EN_LISTA_BLANCA")
      }
      return
    }

    val extras = n.extras ?: return
    val title = (extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: "").take(MAX_FIELD)
    val style = try { NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n) } catch (_: Throwable) { null }
    val lastMsg = style?.messages?.lastOrNull()

    // Reglas de remitente: si el paquete tiene reglas (WhatsApp), solo pasan chats individuales permitidos.
    var senderKey: String? = null
    val allowed = senderRules(p)[pkg]
    if (allowed != null) {
      if (isGroup(extras, style, title)) return
      val first = firstToken(title)
      if (first.isEmpty() || first !in allowed) return
      if (!senderBindingOk(ctx, p, first, sbn)) return
      senderKey = first
    }

    val text = (
      lastMsg?.text?.toString()
        ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
        ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        ?: extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.joinToString(" ") { it.toString() }
        ?: ""
    ).take(MAX_FIELD)
    if (text.isBlank()) { ListenerHealth.trace(ctx, pkg, "TEXTO_VACIO"); return }

    val combined = "$title $text"
    if (OTP_PATTERNS.any { it.containsMatchIn(combined) }) { ListenerHealth.trace(ctx, pkg, "DESCARTADA_OTP"); return }

    val at = lastMsg?.timestamp?.takeIf { it > 0L } ?: sbn.postTime
    val item = JSONObject()
      .put("id", UUID.randomUUID().toString())
      .put("packageName", pkg)
      .put("title", title)
      .put("text", text)
      .put("receivedAt", at)
    if (senderKey != null) item.put("senderKey", senderKey)

    val queued = enqueue(ctx, p, item, fingerprint(pkg, at, text))
    ListenerHealth.trace(ctx, pkg, if (queued) "ENCOLADA" else "DUPLICADA_O_FALLO_CIFRADO")
    if (queued) {
      ListenerHealth.markQueued(ctx)
      onQueued?.invoke()
    }
  }

  private fun isGroup(extras: Bundle, style: NotificationCompat.MessagingStyle?, title: String): Boolean {
    if (style?.isGroupConversation == true) return true
    if (extras.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION, false)) return true
    return title.contains(" @ ")
  }

  private fun fingerprint(pkg: String, at: Long, text: String): String {
    val d = MessageDigest.getInstance("SHA-256").digest("$pkg|$at|$text".toByteArray(Charsets.UTF_8))
    return d.joinToString("") { "%02x".format(it) }.take(16)
  }

  // ---- Cola cifrada ----
  private fun readArr(p: SharedPreferences, key: String): JSONArray =
    try { JSONArray(p.getString(key, "[]")) } catch (_: Throwable) { JSONArray() }

  private fun tail(arr: JSONArray, max: Int): JSONArray {
    if (arr.length() <= max) return arr
    val out = JSONArray()
    for (i in arr.length() - max until arr.length()) out.put(arr.get(i))
    return out
  }

  private fun enqueue(ctx: Context, p: SharedPreferences, item: JSONObject, fp: String): Boolean {
    synchronized(lock) {
      val fps = readArr(p, KEY_FPS)
      for (i in 0 until fps.length()) if (fps.optString(i) == fp) return false
      val sealed = try {
        SecureBox.seal(item.toString())
      } catch (t: Throwable) {
        ListenerHealth.recordError(ctx, "seal:" + t.javaClass.simpleName)
        return false
      }
      fps.put(fp)
      val q = readArr(p, KEY_QUEUE)
      q.put(JSONObject().put("i", item.getString("id")).put("d", sealed))
      p.edit()
        .putString(KEY_FPS, tail(fps, MAX_FPS).toString())
        .putString(KEY_QUEUE, tail(q, MAX_QUEUE).toString())
        .apply()
      return true
    }
  }

  private fun migrateLegacy(p: SharedPreferences) {
    val raw = p.getString(KEY_QUEUE_LEGACY, null) ?: return
    if (raw == "[]") return
    try {
      val old = JSONArray(raw)
      val q = readArr(p, KEY_QUEUE)
      for (i in 0 until old.length()) {
        val o = old.optJSONObject(i) ?: continue
        val id = UUID.randomUUID().toString()
        o.put("id", id)
        q.put(JSONObject().put("i", id).put("d", SecureBox.seal(o.toString())))
      }
      p.edit().putString(KEY_QUEUE, tail(q, MAX_QUEUE).toString()).putString(KEY_QUEUE_LEGACY, "[]").commit()
    } catch (_: Throwable) {}
  }

  /** Devuelve la cola SIN borrarla. JS importa y luego llama ackQueue(ids). */
  fun peek(ctx: Context): String {
    synchronized(lock) {
      val p = prefs(ctx)
      migrateLegacy(p)
      val q = readArr(p, KEY_QUEUE)
      val out = JSONArray()
      val keep = JSONArray()
      for (i in 0 until q.length()) {
        val o = q.optJSONObject(i) ?: continue
        val plain = SecureBox.open(o.optString("d")) ?: continue // ilegible (clave perdida): se descarta
        try { out.put(JSONObject(plain)); keep.put(o) } catch (_: Throwable) {}
      }
      if (keep.length() != q.length()) p.edit().putString(KEY_QUEUE, keep.toString()).apply()
      return out.toString()
    }
  }

  fun ack(ctx: Context, ids: List<String>) {
    synchronized(lock) {
      val p = prefs(ctx)
      val drop = ids.toHashSet()
      val q = readArr(p, KEY_QUEUE)
      val keep = JSONArray()
      for (i in 0 until q.length()) {
        val o = q.optJSONObject(i) ?: continue
        if (o.optString("i") !in drop) keep.put(o)
      }
      p.edit().putString(KEY_QUEUE, keep.toString()).commit()
    }
  }

  /** Compatibilidad con el drainQueue actual: lee y borra (riesgo de perdida si JS cae; migra a peek+ack). */
  fun drain(ctx: Context): String {
    synchronized(lock) {
      val raw = peek(ctx)
      prefs(ctx).edit().putString(KEY_QUEUE, "[]").commit()
      return raw
    }
  }

  fun queueSize(ctx: Context): Int = readArr(prefs(ctx), KEY_QUEUE).length()

  // ---- Configuracion ----
  fun setWhitelist(ctx: Context, patterns: List<String>) {
    prefs(ctx).edit().putString(KEY_PATTERNS, JSONArray(patterns).toString()).apply()
  }

  fun setLearning(ctx: Context, enabled: Boolean) {
    prefs(ctx).edit().putLong(KEY_LEARN_UNTIL, if (enabled) System.currentTimeMillis() + LEARN_MS else 0L).apply()
  }

  fun learningUntil(ctx: Context): Long = prefs(ctx).getLong(KEY_LEARN_UNTIL, 0L)
  private fun isLearning(p: SharedPreferences): Boolean = System.currentTimeMillis() < p.getLong(KEY_LEARN_UNTIL, 0L)

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
  fun clearSeen(ctx: Context) { prefs(ctx).edit().putString(KEY_SEEN, "{}").apply() }
}