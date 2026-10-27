package expo.modules.finzennotifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class FinzenForegroundService : Service() {

    private val CHANNEL_ID = "finzen_listener_channel"
    private val NOTIFICATION_ID = 1001

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = createNotification()
        startForeground(NOTIFICATION_ID, notification)
        return START_STICKY // Si Android lo mata, lo reinicia
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "Lector de Notificaciones FinZen",
                NotificationManager.IMPORTANCE_LOW // Baja para no molestar
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(serviceChannel)
        }
    }

    private fun createNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("FinZen está activo")
            .setContentText("Protegiendo tus cuentas y leyendo notificaciones...")
            .setSmallIcon(android.R.drawable.ic_menu_camera) // Ícono por defecto de Android
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true) // No se puede deslizar
            .build()
    }
}