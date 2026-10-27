package expo.modules.finzennotifications

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

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

    Function("isListenerEnabled") {
      val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: ""
      flat.split(":").any { it.startsWith(context.packageName + "/") }
    }

    Function("openListenerSettings") {
      val i = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(i)
    }

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

    // Nueva función para apagar el servicio si el usuario lo desea
    Function("stopForegroundService") {
      try {
        val intent = Intent(context, FinzenForegroundService::class.java)
        context.stopService(intent)
      } catch (_: Exception) {}
    }
  }
}