package expo.modules.finzennotifications

import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.service.notification.NotificationListenerService
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject

/** Estado del lector + utilidades para mantenerlo enganchado. */
object ListenerHealth {
  private const val PREFS = "finzen_health"

  /** Solo vale para ESTE proceso: si el proceso muere vuelve a false hasta que el sistema reenganche. */
  @Volatile private var connected = false

  private fun p(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private fun stamp(ctx: Context, key: String) { p(ctx).edit().putLong(key, System.currentTimeMillis()).apply() }

  fun markConnected(ctx: Context) { connected = true; stamp(ctx, "last_connected"); clearAlert(ctx) }
  fun markDisconnected(ctx: Context) { connected = false; stamp(ctx, "last_disconnected") }
  fun markEvent(ctx: Context) { stamp(ctx, "last_event") }
  fun markQueued(ctx: Context) { stamp(ctx, "last_queued") }

  fun recordError(ctx: Context, code: String) {
    p(ctx).edit().putString("last_error", code).putLong("last_error_at", System.currentTimeMillis()).apply()
  }
  fun bump(ctx: Context, key: String) {
    val sp = p(ctx)
    sp.edit().putInt(key, sp.getInt(key, 0) + 1).apply()
  }
  fun setInt(ctx: Context, key: String, value: Int) { p(ctx).edit().putInt(key, value).apply() }

  fun isEnabled(ctx: Context): Boolean =
    NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)

  fun isConnected(): Boolean = connected

  fun persistent(ctx: Context): Boolean = p(ctx).getBoolean("persistent", false)

  fun setPersistent(ctx: Context, on: Boolean) {
    p(ctx).edit().putBoolean("persistent", on).apply()
    try {
      val i = Intent(ctx, FinzenForegroundService::class.java)
      if (on) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
      } else {
        ctx.stopService(i)
      }
    } catch (t: Throwable) {
      recordError(ctx, "fgs:" + t.javaClass.simpleName)
    }
  }

  fun requestRebind(ctx: Context) {
    try {
      NotificationListenerService.requestRebind(ComponentName(ctx, FinzenNotificationListener::class.java))
    } catch (t: Throwable) {
      recordError(ctx, "rebind:" + t.javaClass.simpleName)
    }
  }

  /** Truco clasico: apagar/encender el componente obliga al sistema a volver a enlazarlo. */
  fun forceRebind(ctx: Context) {
    try {
      val pm = ctx.packageManager
      val cn = ComponentName(ctx, FinzenNotificationListener::class.java)
      pm.setComponentEnabledSetting(cn, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
      pm.setComponentEnabledSetting(cn, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
    } catch (t: Throwable) {
      recordError(ctx, "force:" + t.javaClass.simpleName)
    }
    requestRebind(ctx)
  }

  fun ensureBound(ctx: Context) {
    if (!isEnabled(ctx)) return
    if (!connected) requestRebind(ctx)
  }

  fun ignoringBattery(ctx: Context): Boolean = try {
    (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(ctx.packageName)
  } catch (_: Throwable) { false }

  /** Ultimas 20 decisiones del filtro nativo: paquete + motivo. Sin texto de notificaciones. */
  fun trace(ctx: Context, pkg: String, stage: String) {
    synchronized(this) {
      val sp = p(ctx)
      val arr = try { JSONArray(sp.getString("trace", "[]")) } catch (_: Throwable) { JSONArray() }
      arr.put(JSONObject().put("t", System.currentTimeMillis()).put("p", pkg).put("s", stage))
      val out = JSONArray()
      for (i in maxOf(0, arr.length() - 20) until arr.length()) out.put(arr.get(i))
      sp.edit().putString("trace", out.toString()).apply()
    }
  }

  fun traceJson(ctx: Context): String = p(ctx).getString("trace", "[]") ?: "[]"

  private const val ALERT_CHANNEL = "finzen_alerts"
  private const val ALERT_ID = 1002
  private const val ALERT_EVERY_MS = 12L * 60L * 60L * 1000L

  fun clearAlert(ctx: Context) {
    try { NotificationManagerCompat.from(ctx).cancel(ALERT_ID) } catch (_: Throwable) {}
  }

  /**
   * Si el lector sigue caido, avisa (una vez cada 12 h). Se llama desde el vigilante, DESPUES de intentar reenganchar.
   * Solo avisa si el lector ya funciono alguna vez (si nunca se configuro, no hay nada que avisar).
   */
  fun alertIfDead(ctx: Context) {
    val enabled = isEnabled(ctx)
    if (enabled && connected) { clearAlert(ctx); return }
    val sp = p(ctx)
    if (sp.getLong("last_connected", 0L) == 0L) return
    val now = System.currentTimeMillis()
    if (now - sp.getLong("last_alert", 0L) < ALERT_EVERY_MS) return
    try {
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        nm.createNotificationChannel(
          android.app.NotificationChannel(ALERT_CHANNEL, "Avisos del lector", android.app.NotificationManager.IMPORTANCE_DEFAULT)
        )
      }
      val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
      val pi = if (launch != null) {
        android.app.PendingIntent.getActivity(
          ctx, 0, launch, android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        )
      } else null
      val text = if (enabled) {
        "FinZen dej\u00f3 de leer tus notificaciones. \u00c1brela para reconectar el lector."
      } else {
        "El acceso a las notificaciones est\u00e1 desactivado. \u00c1brela para volver a activarlo."
      }
      val n = androidx.core.app.NotificationCompat.Builder(ctx, ALERT_CHANNEL)
        .setSmallIcon(android.R.drawable.stat_notify_error)
        .setContentTitle("FinZen no est\u00e1 leyendo")
        .setContentText(text)
        .setStyle(androidx.core.app.NotificationCompat.BigTextStyle().bigText(text))
        .setAutoCancel(true)
        .setContentIntent(pi)
        .build()
      nm.notify(ALERT_ID, n)
      sp.edit().putLong("last_alert", now).apply()
    } catch (t: Throwable) {
      recordError(ctx, "alert:" + t.javaClass.simpleName)
    }
  }

  fun snapshot(ctx: Context): String {
    val sp = p(ctx)
    return JSONObject()
      .put("enabled", isEnabled(ctx))
      .put("connected", connected)
      .put("lastConnected", sp.getLong("last_connected", 0L))
      .put("lastDisconnected", sp.getLong("last_disconnected", 0L))
      .put("lastEvent", sp.getLong("last_event", 0L))
      .put("lastQueued", sp.getLong("last_queued", 0L))
      .put("queued", NotificationStore.queueSize(ctx))
      .put("ignoringBattery", ignoringBattery(ctx))
      .put("persistent", persistent(ctx))
      .put("senderBinding", NotificationStore.senderBindingOn(ctx))
      .put("learningUntil", NotificationStore.learningUntil(ctx))
      .put("spoofBlocked", sp.getInt("spoof_blocked", 0))
      .put("rejectedPatterns", sp.getInt("rejected_patterns", 0))
      .put("lastError", sp.getString("last_error", "") ?: "")
      .put("lastErrorAt", sp.getLong("last_error_at", 0L))
      .put("sdk", Build.VERSION.SDK_INT)
      .put("manufacturer", Build.MANUFACTURER)
      .toString()
  }
}