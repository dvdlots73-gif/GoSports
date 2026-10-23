package ie.home.gosports

import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import kotlin.concurrent.thread

/** Polls ESPN every 45s while a watched match is live or about to start, posting goal/card alerts. */
class WatchService : Service() {
    @Volatile private var running = true
    private var worker: Thread? = null

    override fun onBind(i: Intent?) = null

    override fun onStartCommand(i: Intent?, flags: Int, startId: Int): Int {
        Alerts.channels(this)
        val n = Alerts.notification(this, Alerts.CH_WATCHING, "Checking your teams' matches…", "")
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(1, n)
        if (worker == null) worker = thread { watch() }
        return START_NOT_STICKY
    }

    private fun watch() {
        val nm = getSystemService(NotificationManager::class.java)
        val prefs = Alerts.prefs(this)
        var failures = 0
        while (running) {
            val now = System.currentTimeMillis()
            // Just after midnight UTC, a late match is still filed under yesterday.
            val days = if (java.time.Instant.ofEpochMilli(now).atZone(java.time.ZoneOffset.UTC).hour < 3) listOf(-1L, 0L) else listOf(0L)
            val matches = Alerts.watchedMatches(this, now, days)
            if (matches == null) {
                if (++failures > 20) break // ~15 minutes without network: give up until the next planned alarm
            } else {
                failures = 0
                for (m in matches) {
                    val (alerts, snap) = diff(Snap.fromJson(prefs.getString("snap_${m.id}", null)), m)
                    prefs.edit().putString("snap_${m.id}", snap.toJson()).apply()
                    alerts.forEach { a -> nm.notify("${m.id}|${a.title}|${a.body}".hashCode(), Alerts.notification(this, Alerts.CH_ALERTS, a.title, a.body)) }
                }
                val live = matches.filter { it.state == "in" || (it.state == "pre" && it.start - now < 10 * Alerts.MIN) }
                if (live.isEmpty()) break
                nm.notify(1, Alerts.notification(this, Alerts.CH_WATCHING, "Watching " + live.joinToString { it.title }, live.joinToString(" · ") { it.score }))
            }
            try { Thread.sleep(45_000) } catch (e: InterruptedException) { break }
        }
        // ponytail: snap_<id> prefs are never cleared; a few hundred bytes per match, fine for years.
        Alerts.plan(this)
        stopSelf()
    }

    // Android 15 caps data-sync services at 6 hours a day; a match is ~2.
    override fun onTimeout(startId: Int, fgsType: Int) { running = false; worker?.interrupt(); stopSelf() }

    override fun onDestroy() { running = false; worker?.interrupt() }
}
