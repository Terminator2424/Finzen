package expo.modules.finzennotifications

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Puente JS ↔ servicio de notificaciones. No expone texto de notificaciones salvo
 * `drainQueue`, que ya viene filtrado por lista blanca y OTP.
 */
class FinzenNotificationsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.AppContextLost()

  override fun definition() = ModuleDefinition {
    Name("FinzenNotifications")

    Events("onQueued")

    OnCreate {
      NotificationStore.onQueued = {
        try { sendEvent("onQueued") } catch (_: Throwable) {}
      }
    }

    OnDestroy {
      NotificationStore.onQueued = null
    }

    // ¿El usuario ya concedió "Acceso a notificaciones" a FinZen?
    Function("isListenerEnabled") {
      val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: ""
      flat.split(":").any { it.startsWith(context.packageName + "/") }
    }

    Function("openListenerSettings") {
      val i = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(i)
    }

    // Android 13+: en apps instaladas fuera de Play Store hay que permitir "ajustes restringidos"
    // desde la ficha de la app antes de poder activar el acceso a notificaciones.
    Function("openAppSettings") {
      val i = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(i)
    }

    Function("setWhitelist") { patterns: List<String> ->
      NotificationStore.setWhitelist(context, patterns)
    }

    Function("setLearningMode") { enabled: Boolean ->
      NotificationStore.setLearning(context, enabled)
    }

    Function("getSeenPackages") { NotificationStore.seenJson(context) }

    Function("clearSeenPackages") { NotificationStore.clearSeen(context) }

    Function("drainQueue") { NotificationStore.drain(context) }
  }
}
