package ie.home.gosports

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * Goal and card alerts for watched football teams (the site's followed teams plus ★ favourites).
 * How it runs: an exact alarm fires a few minutes before a watched kick-off and starts WatchService,
 * which polls ESPN until the match ends, then plans the next alarm. Opening the app, changing ★ teams
 * and rebooting all re-plan.
 */
object Alerts {
    private val LEAGUES = listOf("eng.1", "eng.2", "eng.3", "eng.4", "eng.fa", "eng.league_cup")
    private const val ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer"
    private val DEFAULT_TEAMS = setOf("Oldham Athletic", "Manchester United")
    const val CH_ALERTS = "alerts"
    const val CH_WATCHING = "watching"
    const val MIN = 60_000L
    private const val HOUR = 60 * MIN

    fun prefs(c: Context) = c.getSharedPreferences("alerts", Context.MODE_PRIVATE)
    fun teams(c: Context): Set<String> = prefs(c).getStringSet("teams", null) ?: DEFAULT_TEAMS

    fun setTeams(c: Context, names: Set<String>) {
        if (names == teams(c)) return
        prefs(c).edit().putStringSet("teams", names).apply()
        thread { plan(c) }
    }

    /** Today's (and, just after midnight UTC, yesterday's) matches for watched teams across the English leagues. */
    fun watchedMatches(c: Context, now: Long = System.currentTimeMillis(), days: List<Long> = listOf(0)): List<Match>? {
        val teams = teams(c)
        var ok = false
        val out = LEAGUES.flatMap { league ->
            days.flatMap { d ->
                runCatching { parseMatches(JSONObject(get("$ESPN/$league/scoreboard?dates=${ymd(now + d * 24 * HOUR)}"))) }
                    .onSuccess { ok = true }.getOrDefault(emptyList())
            }
        }.filter { it.involves(teams) }.distinctBy { it.id }
        return if (ok) out else null // null = no network, so callers retry soon instead of assuming no matches
    }

    /** Sets the next alarm: now if a watched match is live or about to start, else shortly before the next kick-off. */
    fun plan(c: Context) {
        val now = System.currentTimeMillis()
        val matches = watchedMatches(c, now, listOf(-1, 0, 1))
        val at = when {
            matches == null -> now + 15 * MIN
            matches.any { it.state == "in" || (it.state == "pre" && it.start - now < 10 * MIN) } -> now + 2_000
            else -> minOf(matches.filter { it.state == "pre" }.minOfOrNull { it.start - 5 * MIN } ?: Long.MAX_VALUE, now + 6 * HOUR)
        }
        val am = c.getSystemService(AlarmManager::class.java)
        val pi = PendingIntent.getBroadcast(c, 0, Intent(c, AlarmReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        // Exact alarms may start a foreground service from the background; Android 12 needs the user to allow them.
        if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    fun channels(c: Context) {
        c.getSystemService(NotificationManager::class.java).createNotificationChannels(listOf(
            NotificationChannel(CH_ALERTS, "Goals and cards", NotificationManager.IMPORTANCE_HIGH),
            NotificationChannel(CH_WATCHING, "Watching a match", NotificationManager.IMPORTANCE_LOW),
        ))
    }

    fun notification(c: Context, channel: String, title: String, body: String): Notification {
        val open = PendingIntent.getActivity(c, 0, Intent(c, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(c, channel).setSmallIcon(R.drawable.ic_stat).setContentTitle(title)
            .setContentText(body).setContentIntent(open).setAutoCancel(true).build()
    }

    private fun ymd(t: Long) = java.time.Instant.ofEpochMilli(t).toString().take(10).replace("-", "")

    private fun get(url: String): String {
        val c = java.net.URL(url).openConnection() as java.net.HttpURLConnection
        c.connectTimeout = 15_000; c.readTimeout = 15_000
        if (c.responseCode >= 400) throw java.io.IOException("HTTP ${c.responseCode}")
        return c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
    }
}

/** The planned alarm: starts watching (the service stops itself straight away if nothing is on). */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        runCatching { c.startForegroundService(Intent(c, WatchService::class.java)) }
            .onFailure { val p = goAsync(); thread { Alerts.plan(c); p.finish() } }
    }
}

/** Alarms are wiped on reboot, so plan again. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.action != Intent.ACTION_BOOT_COMPLETED) return
        val p = goAsync()
        thread { Alerts.plan(c); p.finish() }
    }
}
