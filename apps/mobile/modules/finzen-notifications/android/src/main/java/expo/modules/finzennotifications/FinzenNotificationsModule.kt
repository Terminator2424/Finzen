package expo.modules.finzennotifications

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FinzenNotificationsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.AppContextLost()

  private fun launch(i: Intent) {
    context.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  override fun definition() = ModuleDefinition {
    Name("FinzenNotifications")

    Events("onQueued")

    OnCreate {
      NotificationStore.onQueued = {
        try { sendEvent("onQueued") } catch (_: Throwable) {}
      }
      // Cada vez que arranca JS: vigilante programado y lector reenganchado si hace falta.
      try {
        ListenerWatchdogJob.schedule(context)
        ListenerHealth.ensureBound(context)
      } catch (_: Throwable) {}
    }

    OnActivityEntersForeground {
      try { ListenerHealth.ensureBound(context) } catch (_: Throwable) {}
    }

    OnDestroy {
      NotificationStore.onQueued = null
    }

    Function("isListenerEnabled") { ListenerHealth.isEnabled(context) }

    Function("openListenerSettings") {
      var opened = false
      if (Build.VERSION.SDK_INT >= 30) {
        try {
          launch(
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(
              Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
              ComponentName(context, FinzenNotificationListener::class.java).flattenToString()
            )
          )
          opened = true
        } catch (_: Throwable) {}
      }
      if (!opened) launch(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    Function("openAppSettings") {
      launch(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName)))
    }

    Function("requestIgnoreBattery") {
      try {
        launch(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + context.packageName)))
      } catch (_: Throwable) {
        try { launch(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) } catch (_: Throwable) {}
      }
    }

    Function("setWhitelist") { patterns: List<String> -> NotificationStore.setWhitelist(context, patterns) }
    Function("setLearningMode") { enabled: Boolean -> NotificationStore.setLearning(context, enabled) }
    Function("getSeenPackages") { NotificationStore.seenJson(context) }
    Function("clearSeenPackages") { NotificationStore.clearSeen(context) }

    // Cola: drainQueue se mantiene por compatibilidad; lo correcto es peekQueue + ackQueue.
    Function("drainQueue") { NotificationStore.drain(context) }
    Function("peekQueue") { NotificationStore.peek(context) }
    Function("ackQueue") { ids: List<String> -> NotificationStore.ack(context, ids) }

    // Salud y autorreparacion
    Function("health") { ListenerHealth.snapshot(context) }
    Function("requestRebind") { ListenerHealth.requestRebind(context) }
    Function("forceRebind") { ListenerHealth.forceRebind(context) }
    Function("setPersistentMode") { on: Boolean -> ListenerHealth.setPersistent(context, on) }
    Function("stopForegroundService") { ListenerHealth.setPersistent(context, false) }

    // Remitentes (WhatsApp)
    Function("setSenderRules") { json: String -> NotificationStore.setSenderRules(context, json) }
    Function("setSenderBinding") { on: Boolean -> NotificationStore.setSenderBinding(context, on) }
    Function("resetSenderBindings") { NotificationStore.resetSenderBindings(context) }
  }
}