package ie.home.gosports

import org.json.JSONObject

/** Football match state from ESPN's scoreboard, and what changed since the last look. No Android APIs, so it's unit-testable. */
data class Side(val id: String, val name: String, val short: String, val score: String)
data class Event(val key: String, val kind: String, val text: String)
data class Match(
    val id: String, val state: String, val status: String, val start: Long,
    val home: Side, val away: Side, val events: List<Event>,
) {
    val score get() = "${home.short} ${home.score}–${away.score} ${away.short}"
    val title get() = "${home.short} v ${away.short}"
    fun involves(teams: Set<String>) = listOf(home, away).any { it.name in teams || it.short in teams }
}

/** What we remember about a match between polls (saved as JSON so it survives the service restarting). */
data class Snap(val state: String, val halfTime: Boolean, val seen: Set<String>) {
    fun toJson(): String = JSONObject().put("s", state).put("h", halfTime).put("k", org.json.JSONArray(seen.toList())).toString()

    companion object {
        fun fromJson(s: String?): Snap? = s?.let {
            val o = JSONObject(it)
            val k = o.getJSONArray("k")
            Snap(o.getString("s"), o.getBoolean("h"), (0 until k.length()).map(k::getString).toSet())
        }
    }
}

data class Alert(val title: String, val body: String)

fun parseMatches(json: JSONObject): List<Match> {
    val events = json.optJSONArray("events") ?: return emptyList()
    return (0 until events.length()).mapNotNull { i ->
        val ev = events.getJSONObject(i)
        val comp = ev.optJSONArray("competitions")?.optJSONObject(0) ?: return@mapNotNull null
        val cs = comp.getJSONArray("competitors")
        val sides = (0 until cs.length()).map { cs.getJSONObject(it) }
        fun side(c: JSONObject?): Side {
            val t = c?.optJSONObject("team") ?: JSONObject()
            return Side(t.optString("id"), t.optString("displayName"), t.optString("shortDisplayName", t.optString("displayName")), c?.optString("score", "0") ?: "0")
        }
        val home = side(sides.find { it.optString("homeAway") == "home" } ?: sides.getOrNull(0))
        val away = side(sides.find { it.optString("homeAway") == "away" } ?: sides.getOrNull(1))
        val shortOf = mapOf(home.id to home.short, away.id to away.short)
        val det = comp.optJSONArray("details")
        val list = (0 until (det?.length() ?: 0)).mapNotNull { j ->
            val d = det!!.getJSONObject(j)
            val kind = when {
                d.optBoolean("shootout") -> return@mapNotNull null // penalty shootouts: the full-time alert covers it
                d.optBoolean("redCard") -> "red"
                d.optBoolean("scoringPlay") -> "goal"
                d.optBoolean("yellowCard") -> "yellow"
                else -> return@mapNotNull null
            }
            val p = d.optJSONArray("athletesInvolved")?.optJSONObject(0)
            val who = p?.optString("shortName")?.ifEmpty { null } ?: p?.optString("displayName") ?: "?"
            val clock = d.optJSONObject("clock")?.optString("displayValue") ?: ""
            val teamId = d.optJSONObject("team")?.optString("id") ?: ""
            val text = when (kind) {
                "goal" -> "$who $clock" + when { d.optBoolean("ownGoal") -> " (og)"; d.optBoolean("penaltyKick") -> " (pen)"; else -> "" }
                else -> "$who (${shortOf[teamId] ?: "?"}) $clock"
            }
            Event("$kind|$clock|${p?.optString("id") ?: who}|$teamId", kind, text)
        }
        val type = ev.optJSONObject("status")?.optJSONObject("type") ?: JSONObject()
        Match(
            ev.getString("id"), type.optString("state", "pre"), type.optString("name"),
            java.time.OffsetDateTime.parse(ev.getString("date")).toInstant().toEpochMilli(), // e.g. 2026-10-18T13:00Z
            home, away, list,
        )
    }
}

/**
 * New alerts for a match since its last snapshot. The first time a match is seen it's remembered
 * silently, so opening the app mid-match doesn't replay every earlier goal and card.
 */
fun diff(prev: Snap?, m: Match): Pair<List<Alert>, Snap> {
    val halfTime = m.status == "STATUS_HALFTIME"
    if (prev == null) return emptyList<Alert>() to Snap(m.state, halfTime, m.events.map { it.key }.toSet())
    val out = mutableListOf<Alert>()
    val off = Regex("POSTPONED|CANCELED|ABANDONED|SUSPENDED|DELAYED").containsMatchIn(m.status)
    if (prev.state == "pre" && m.state == "in") out += Alert("Kick-off", m.title)
    for (e in m.events) if (e.key !in prev.seen) out += when (e.kind) {
        "goal" -> Alert("⚽ GOAL! ${m.score}", e.text)
        "red" -> Alert("🟥 Red card – ${e.text}", m.score)
        else -> Alert("🟨 Yellow card – ${e.text}", m.score)
    }
    if (halfTime && !prev.halfTime) out += Alert("Half-time", m.score)
    if (m.state == "post" && prev.state != "post") out += if (off) Alert("Not played", "${m.title} · ${m.status.removePrefix("STATUS_").lowercase()}") else Alert("Full-time", m.score)
    return out to Snap(m.state, halfTime || prev.halfTime, prev.seen + m.events.map { it.key })
}
