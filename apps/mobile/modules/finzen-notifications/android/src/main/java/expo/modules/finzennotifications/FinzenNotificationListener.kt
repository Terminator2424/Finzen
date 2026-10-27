package expo.modules.finzennotifications

import android.content.Intent
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class FinzenNotificationListener : NotificationListenerService() {

  override fun onListenerConnected() {
    super.onListenerConnected()
    startForegroundService()
  }

  private fun startForegroundService() {
    try {
      val intent = Intent(this, FinzenForegroundService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        startForegroundService(intent)
      } else {
        startService(intent)
      }
    } catch (_: Exception) {
      // Si falla, no rompemos el flujo
    }
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null) return
    try {
      NotificationStore.handle(applicationContext, sbn)
    } catch (_: Throwable) {
      // Silencioso
    }
  }
}