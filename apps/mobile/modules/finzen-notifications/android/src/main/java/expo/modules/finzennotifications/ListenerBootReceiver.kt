package expo.modules.finzennotifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Tras reiniciar el telefono o actualizar la app: reprograma el vigilante y reengancha el lector. */
class ListenerBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    try {
      ListenerWatchdogJob.schedule(context)
      ListenerHealth.ensureBound(context)
    } catch (_: Throwable) {}
  }
}