package expo.modules.finzennotifications

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class FinzenNotificationListener : NotificationListenerService() {

  override fun onListenerConnected() {
    super.onListenerConnected()
    val ctx = applicationContext
    ListenerHealth.markConnected(ctx)
    ListenerWatchdogJob.schedule(ctx)
    // Recupera lo que llego mientras el servicio estuvo desenganchado (sigue en la barra).
    try {
      activeNotifications?.forEach {
        try { NotificationStore.handle(ctx, it, replay = true) } catch (_: Throwable) {}
      }
    } catch (t: Throwable) {
      ListenerHealth.recordError(ctx, "replay:" + t.javaClass.simpleName)
    }
    if (ListenerHealth.persistent(ctx)) {
      try { ListenerHealth.setPersistent(ctx, true) } catch (_: Throwable) {}
    }
  }

  override fun onListenerDisconnected() {
    super.onListenerDisconnected()
    ListenerHealth.markDisconnected(applicationContext)
    // CLAVE: sin esto el sistema no vuelve a enlazar el servicio hasta reinstalar el APK.
    ListenerHealth.requestRebind(applicationContext)
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null) return
    try {
      NotificationStore.handle(applicationContext, sbn)
    } catch (t: Throwable) {
      ListenerHealth.recordError(applicationContext, "handle:" + t.javaClass.simpleName)
    }
  }
}