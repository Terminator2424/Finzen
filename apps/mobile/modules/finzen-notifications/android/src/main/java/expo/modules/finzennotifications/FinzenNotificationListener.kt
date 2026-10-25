package expo.modules.finzennotifications

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Servicio de lectura de notificaciones. Toda la lógica vive en [NotificationStore];
 * aquí solo se recibe el evento y se protege contra cualquier excepción para que un
 * error nunca tumbe el servicio.
 */
class FinzenNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null) return
    try {
      NotificationStore.handle(applicationContext, sbn)
    } catch (_: Throwable) {
      // Silencioso a propósito: no se registra el contenido de ninguna notificación.
    }
  }
}
