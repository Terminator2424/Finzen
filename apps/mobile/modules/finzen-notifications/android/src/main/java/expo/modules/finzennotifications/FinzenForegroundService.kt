package expo.modules.finzennotifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/** Opcional (modo persistente). Antes crasheaba en Android 14 por no declarar el tipo del servicio. */
class FinzenForegroundService : Service() {
  private val channelId = "finzen_listener_channel"
  private val notificationId = 1001

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    return try {
      createChannel()
      val n = buildNotification()
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(notificationId, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
      } else {
        startForeground(notificationId, n)
      }
      START_STICKY
    } catch (t: Throwable) {
      ListenerHealth.recordError(applicationContext, "fgs:" + t.javaClass.simpleName)
      stopSelf()
      START_NOT_STICKY
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val ch = NotificationChannel(channelId, "Lector de notificaciones FinZen", NotificationManager.IMPORTANCE_LOW)
      getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }
  }

  private fun buildNotification(): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pi = if (launch != null) {
      PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    } else null
    return NotificationCompat.Builder(this, channelId)
      .setContentTitle("FinZen est\u00e1 activo")
      .setContentText("Leyendo notificaciones de tus apps de pago")
      .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setContentIntent(pi)
      .build()
  }
}