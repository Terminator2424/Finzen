package expo.modules.finzennotifications

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context

/** Cada ~15 min comprueba que el lector siga enganchado y lo reengancha si no. Sobrevive reinicios. */
class ListenerWatchdogJob : JobService() {
  override fun onStartJob(params: JobParameters?): Boolean {
    try { ListenerHealth.ensureBound(applicationContext) } catch (_: Throwable) {}
    return false
  }

  override fun onStopJob(params: JobParameters?): Boolean = false

  companion object {
    private const val JOB_ID = 4021

    fun schedule(ctx: Context) {
      try {
        val js = ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
        if (js.allPendingJobs.any { it.id == JOB_ID }) return
        val info = JobInfo.Builder(JOB_ID, ComponentName(ctx, ListenerWatchdogJob::class.java))
          .setPeriodic(15 * 60 * 1000L)
          .setPersisted(true)
          .build()
        js.schedule(info)
      } catch (t: Throwable) {
        ListenerHealth.recordError(ctx, "job:" + t.javaClass.simpleName)
      }
    }
  }
}